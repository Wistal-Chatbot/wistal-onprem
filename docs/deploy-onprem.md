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

1. ~~**Dane z Neona**~~ — ODPUSZCZONE 2026-08-17, po sprawdzeniu kodu. Powód:
   - `schema_objects` i `schema_embeddings` nie są używane przez żaden kod
     aplikacji (tylko definicja schematu i `lib/db/verify.ts`) — to pozostałość
     po wcześniejszym podejściu z wyszukiwaniem semantycznym;
   - `erp_tables`, `erp_columns` i `system_prompts` są zaseedowane migracjami
     0005/0006 z `DEFAULT_ERP_MODEL` i `prompt-defaults.ts`, które są też
     fallbackiem runtime — czat zna schemat ERP bez żadnego importu;
   - bez odpowiednika w kodzie zostają tylko `quick_actions`, `ai_reports`
     i `app_settings`, czyli treści odtwarzalne ręcznie w panelu admina.

   Zdanie „bez nich text-to-SQL nie zna schematu ERP" z poprzedniej wersji tego
   punktu było nieprawdziwe.
2. ~~**Sync z Optimy**~~ — ZROBIONE 2026-08-25. Repo `optima-neon-sync` chodzi
   jako usługa `sync` w compose na serwerze chatbota (Raspberry Pi z README nigdy
   nie powstało i nie jest potrzebne). Pierwszy pełny cykl: 532 620 wierszy
   w 9 tabelach, 0 błędów, zero sierot w powiązaniach, dane od 2016-11-02.
   Cykl powtarza się raz na dobę; świeżość widać w panelu admina
   („Status systemu" → „Synchronizacja z Optimą", źródło: `public.migration_log`).

   Schemat `public` zakłada `sql/001_public_schema.sql` z repo synca — nie ma go
   w migracjach drizzle, bo `public` należy do synca, a nie do aplikacji.
   Połączenie do Optimy: `192.168.1.251`, port **dynamiczny 50150** (świadomie
   nieprzypięty — patrz sekcja 1 instrukcji w repo synca), konto `wistal_readonly`.

   **Neon jest od tego momentu zbędny** — dane płyną z Optimy prosto do lokalnego
   postgresa i nic ich stamtąd nie potrzebuje.
3. ~~**Wersjonowanie configu deployu**~~ — ZROBIONE 2026-08-17. `Dockerfile`,
   `deploy/compose.yml`, `deploy/caddy/Caddyfile` i `next.config.ts` ze
   `standalone` są w repo (patrz „Config deployu w repo" wyżej). Lokalna edycja
   `next.config.ts` na serwerze jest już zbędna — zniknie przy `git reset --hard`.
4. **Higiena sekretów**: zregenerować klucz Resend i klucz admin Anthropic
   (przewinęły się przez czat), usunąć niepotrzebne PAT-y GitHub. Dochodzi
   **hasło konta `tm`** (też przewinęło się przez czat) — a że `tm` jest w grupie
   `docker`, czyli faktycznie ma uprawnienia roota, to hasło otwiera cały
   `/opt/wistal/.env` mimo praw `600`. Rotować je razem z kluczami, nie osobno.
   Przy haśle Postgresa pamiętać o zmianie w **dwóch** miejscach w `.env`:
   `POSTGRES_PASSWORD` i hasło wewnątrz `DATABASE_URL`.
5. Docelowo: prawdziwy certyfikat TLS zamiast `tls internal`, wpis w firmowym DNS.
6. ~~**Migracja poprawiająca seed `erp_columns`**~~ — ZROBIONE 2026-08-25,
   migracja `0008_fix_erp_columns_towar_kod_pk`. `towar_kod` nie jest częścią
   klucza głównego tabel pozycji (kolumna z LEFT JOIN, bywa NULL; sync robi
   ON CONFLICT na dwóch kolumnach). Wygenerowana przez drizzle-kit w obrazie
   `wistal-migrate` na serwerze — lokalna maszyna nie ma Node'a. Idempotentna:
   ponowne uruchomienie daje UPDATE 0.
