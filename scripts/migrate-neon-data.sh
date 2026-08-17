#!/usr/bin/env bash
#
# One-off migration of the chatbot metadata (ERP schema model, prompts, quick
# actions, settings, reports) from the old Neon database into the on-prem
# Postgres. Run on the `chatbot` server, from /opt/wistal.
#
#   ENV_FILE=/opt/wistal/backups/neon.env  # must contain a single NEON_URL= line
#   CONFIRM=yes ./migrate-neon-data.sh
#
# Without CONFIRM=yes the script stops after the read-only report, so you can see
# what would be overwritten. See docs/deploy-onprem.md.
#
# Two things this handles that a plain `pg_dump | psql` does not:
#
#   1. `system_prompts`, `quick_actions` and `ai_reports` carry a `created_by`
#      FK into `chatbot.app_users`. Local accounts are recreated on first OTP
#      login and get fresh UUIDs, so every value coming from Neon is an orphan.
#      Rows load with triggers disabled and orphan authorship is nulled after —
#      the columns are nullable by design (`ON DELETE SET NULL`).
#   2. `erp_tables`, `erp_columns` and `system_prompts` are seeded by migrations
#      0005/0006, so the target is *not* empty. Neon holds the edited version and
#      wins, hence the TRUNCATE before load.
#
set -euo pipefail

ENV_FILE=${ENV_FILE:-/opt/wistal/backups/neon.env}
OUT_DIR=${OUT_DIR:-/opt/wistal/backups}
PG_IMAGE=${PG_IMAGE:-pgvector/pgvector:pg16}
COMPOSE_DIR=${COMPOSE_DIR:-/opt/wistal}
CONFIRM=${CONFIRM:-no}

STAMP=$(date +%Y%m%d-%H%M%S)
DUMP="$OUT_DIR/neon-metadata-$STAMP.sql"
SAFETY="$OUT_DIR/pre-neon-import-$STAMP.sql"

# Load order matters only for humans reading it; the restore disables triggers.
TABLES=(
  erp_tables erp_columns
  schema_objects schema_embeddings
  system_prompts quick_actions app_settings ai_reports
)
# Tables whose authorship must be re-pointed at local accounts (i.e. nulled).
AUTHORED=(system_prompts quick_actions ai_reports)
# serial PKs whose sequence must be moved past the imported ids.
SERIALS=(erp_columns schema_objects schema_embeddings system_prompts quick_actions)

psql_local() { docker compose -f "$COMPOSE_DIR/compose.yml" exec -T postgres psql -U "${POSTGRES_USER:-wistal}" -d "${POSTGRES_DB:-wistal}" -v ON_ERROR_STOP=1 "$@"; }

[[ -r "$ENV_FILE" ]] || { echo "FATAL: brak $ENV_FILE (potrzebna linia NEON_URL=...)" >&2; exit 1; }

echo "== Stan lokalnej bazy przed importem =="
for t in "${TABLES[@]}"; do
  printf '  %-20s %s\n' "$t" "$(psql_local -tAc "SELECT count(*) FROM chatbot.$t")"
done
echo "  (ai_report_executions: $(psql_local -tAc 'SELECT count(*) FROM chatbot.ai_report_executions') — zostanie skasowane przez TRUNCATE ... CASCADE)"

if [[ "$CONFIRM" != "yes" ]]; then
  echo
  echo "Tryb podglądu. Uruchom ponownie z CONFIRM=yes, żeby wykonać import."
  exit 0
fi

echo "== 1/5 Kopia bezpieczeństwa schematu chatbot =="
docker compose -f "$COMPOSE_DIR/compose.yml" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-wistal}" -d "${POSTGRES_DB:-wistal}" -n chatbot > "$SAFETY"
echo "  -> $SAFETY ($(wc -c < "$SAFETY") B)"

echo "== 2/5 Zrzut danych z Neona =="
dump_args=(--data-only --disable-triggers --no-owner --no-privileges)
for t in "${TABLES[@]}"; do dump_args+=(-t "chatbot.$t"); done
docker run --rm --env-file "$ENV_FILE" "$PG_IMAGE" \
  sh -c 'exec pg_dump "$NEON_URL" "$@"' -- "${dump_args[@]}" > "$DUMP"
echo "  -> $DUMP ($(wc -c < "$DUMP") B)"
printf '  bloków COPY: %s\n' "$(grep -c '^COPY chatbot\.' "$DUMP" || true)"

echo "== 3/5 Czyszczenie tabel docelowych =="
psql_local -c "TRUNCATE $(printf 'chatbot.%s,' "${TABLES[@]}" | sed 's/,$//') CASCADE;"

echo "== 4/5 Ładowanie =="
psql_local -f - < "$DUMP"

echo "== 5/5 Porządki po imporcie =="
for t in "${AUTHORED[@]}"; do
  n=$(psql_local -tAc "UPDATE chatbot.$t x SET created_by = NULL
        WHERE x.created_by IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM chatbot.app_users u WHERE u.id = x.created_by)
        RETURNING 1" | grep -c 1 || true)
  printf '  %-20s osieroconych created_by wyzerowano: %s\n' "$t" "$n"
done
for t in "${SERIALS[@]}"; do
  psql_local -tAc "SELECT setval(pg_get_serial_sequence('chatbot.$t','id'),
                     COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM chatbot.$t" \
    | xargs printf "  sekwencja $t ustawiona na %s\n"
done

echo "== Weryfikacja =="
for t in "${TABLES[@]}"; do
  printf '  %-20s %s\n' "$t" "$(psql_local -tAc "SELECT count(*) FROM chatbot.$t")"
done
orphans=$(psql_local -tAc "SELECT
  (SELECT count(*) FROM chatbot.system_prompts s WHERE s.created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chatbot.app_users u WHERE u.id = s.created_by))
+ (SELECT count(*) FROM chatbot.quick_actions q  WHERE q.created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chatbot.app_users u WHERE u.id = q.created_by))
+ (SELECT count(*) FROM chatbot.ai_reports r     WHERE r.created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chatbot.app_users u WHERE u.id = r.created_by))")
echo "  osierocone created_by: $orphans (musi być 0)"
[[ "$orphans" == "0" ]] || { echo "FATAL: integralność FK nie domyka się" >&2; exit 1; }

echo
echo "Gotowe. Restart aplikacji:  docker compose up -d --force-recreate app"
echo "Rollback:                   psql < $SAFETY (po DROP SCHEMA chatbot CASCADE)"
echo "Na koniec skasuj $ENV_FILE — zawiera hasło do Neona."
