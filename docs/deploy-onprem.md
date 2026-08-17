# Deploy on-prem — runbook (stan: 2026-08-14)

Aplikacja działa na serwerze `chatbot` (Ubuntu 26.04, LAN 192.168.1.188, użytkownik
`tm` z sudo). Wszystko żyje w `/opt/wistal`:

```
/opt/wistal/
├── compose.yml          # postgres + app + caddy + migrate (profil "tools")
├── .env                 # sekrety runtime — NIE commitować
├── app/                 # klon repo Wistal-Chatbot/wistal-onprem (+ Dockerfile)
├── caddy/Caddyfile      # domena chatbot.wistal.com.pl, tls internal
└── backups/
```

Adres aplikacji: **https://chatbot.wistal.com.pl** — Caddy serwuje tylko pod tą
nazwą (wejście po IP nie działa). Nazwa musi być w firmowym DNS albo w `hosts`
klienta: `192.168.1.188 chatbot.wistal.com.pl`. Certyfikat jest z wewnętrznego CA
Caddy (`tls internal`) — przeglądarka ostrzega, to spodziewane.

## Standardowy deploy nowej wersji

```bash
cd /opt/wistal/app && git fetch origin && git reset --hard origin/main
cd /opt/wistal
docker compose build app
docker compose --profile tools build migrate     # run NIE przebudowuje obrazu!
docker compose --profile tools run --rm migrate
docker compose up -d
```

Repo jest prywatne — remote ma wpięte poświadczenia (read-only PAT) albo trzeba je
podać. Sprawdzenie stanu: `docker compose ps`, logi: `docker compose logs -f app`,
test z serwera:
`curl -k -I --resolve chatbot.wistal.com.pl:443:127.0.0.1 https://chatbot.wistal.com.pl/`
(oczekiwane 200/307).

Po każdej zmianie w `.env`: `docker compose up -d --force-recreate app`
(zwykły `restart` NIE wczytuje nowych zmiennych).

## Config deployu w repo

Konfiguracja jest wersjonowana w `wistal-onprem` (bez sekretów):

| W repo | Na serwerze |
| --- | --- |
| `Dockerfile` | `/opt/wistal/app/Dockerfile` — ten sam plik, klon repo |
| `deploy/compose.yml` | `/opt/wistal/compose.yml` |
| `deploy/caddy/Caddyfile` | `/opt/wistal/caddy/Caddyfile` |

`Dockerfile` jeździ z repo sam (`git reset --hard` w `/opt/wistal/app`). Dwa
pozostałe leżą **piętro wyżej niż klon**, więc po ich zmianie trzeba je skopiować
ręcznie — ścieżki w `compose.yml` (`./app`, `./caddy/Caddyfile`) są względne
wobec `/opt/wistal`, uruchomienie compose z katalogu `deploy/` nie zadziała:

```bash
cd /opt/wistal && cp app/deploy/compose.yml compose.yml && cp app/deploy/caddy/Caddyfile caddy/Caddyfile
```

Kopie w repo mogą się rozjechać z serwerem — przy zmianie configu edytuj w repo
i skopiuj na serwer, nie odwrotnie.

## Znane miny (wszystkie już wdrożone — nie cofać!)

1. **Obraz bazy musi mieć pgvector**: `pgvector/pgvector:pg16`, nie
   `postgres:16-alpine`. Bez tego migracja 0000 pada po cichu na
   `CREATE EXTENSION vector` (drizzle nie pokazuje błędu, tabele nie powstają).
2. **Dockerfile, etap builder**: przed `RUN npm run build` musi być blok `ENV`
   z placeholderami `DATABASE_URL`, `JWT_SECRET`, `RESEND_API_KEY`,
   `ANTHROPIC_API_KEY` — Next przy „Collecting page data" importuje moduły,
   które rzucają bez env. Placeholdery nie trafiają do obrazu runtime.
3. **Dockerfile, etap runner**: `COPY --from=builder --chown=nextjs:nodejs
   /app/public ./public` — bez `--chown` kontener (user `nextjs`) dostaje
   EACCES na `/app/public/assets` i crashuje w pętli.
4. **next.config.ts** musi mieć `output: "standalone"` (Dockerfile kopiuje
   `.next/standalone`).
5. **`.env` bez pustych linii `VAR=`** — pusty string omija fallbacki `??`
   (np. `ANTHROPIC_USAGE_API_URL=` → `new URL("")` → czat pada z
   CHAT_SERVICE_UNAVAILABLE).
6. **Klucze Anthropic**: `ANTHROPIC_API_KEY` = `sk-ant-api...` (rozmowy);
   `ANTHROPIC_ADMIN_KEY` = `sk-ant-admin...` (tylko odczyt zużycia, opcjonalny).
7. **Resend**: bez zweryfikowanej domeny wysyłka działa wyłącznie z
   `onboarding@resend.dev` i wyłącznie na adres właściciela konta Resend.
   Po weryfikacji `wistal.com.pl` (SPF/DKIM w DNS) → `RESEND_FROM_EMAIL=chatbot@wistal.com.pl`.

## Baza

Postgres w kontenerze; user `wistal`, db `wistal` (hasło w `.env`).
Konsola: `docker compose exec postgres psql -U wistal -d wistal`.
Nadanie admina: `UPDATE chatbot.app_users SET is_admin = true WHERE email = '...';`
Konto użytkownika tworzy się samo przy pierwszym udanym logowaniu OTP.

## TODO (kolejność wg ważności)

1. **Dane z Neona**: lokalna baza ma puste `erp_tables`, `erp_columns`,
   `schema_objects`, `schema_embeddings`, `system_prompts`, `quick_actions`,
   `app_settings`, `ai_reports` — bez nich text-to-SQL nie zna schematu ERP.
   Plan: `pg_dump` (data-only, schemat `chatbot`, z pominięciem tabel auth
   i `app_users`) ze starego Neona (URL w env Vercela) → `psql` lokalnie.
2. **Sync z Optimy**: repo `optima-neon-sync` przepiąć z Neona na lokalny postgres.
3. ~~**Wersjonowanie configu deployu**~~ — ZROBIONE 2026-08-17. `Dockerfile`,
   `deploy/compose.yml`, `deploy/caddy/Caddyfile` i `next.config.ts` ze
   `standalone` są w repo (patrz „Config deployu w repo" wyżej). Lokalna edycja
   `next.config.ts` na serwerze jest już zbędna — zniknie przy `git reset --hard`.
4. **Higiena sekretów**: zregenerować klucz Resend i klucz admin Anthropic
   (przewinęły się przez czat), usunąć niepotrzebne PAT-y GitHub.
5. Docelowo: prawdziwy certyfikat TLS zamiast `tls internal`, wpis w firmowym DNS.
