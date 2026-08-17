<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Wistal ERP Chatbot Dashboard

Internal Next.js (App Router) + PostgreSQL app: Wistal staff query ERP data in
natural language (text-to-SQL with Claude `claude-sonnet-4-6`), browse data manually,
and run structured AI reports. Auth is email OTP → JWT, restricted to
`@wistal.com.pl` (plus addresses listed in `AUTH_ALLOWED_EXTERNAL_EMAILS`).

**Hosting: on-prem** (migrated from Vercel + Neon in Aug 2026). The app runs in
docker compose on the internal server `chatbot` (Ubuntu, 192.168.1.188) under
`/opt/wistal`, served by Caddy at **https://chatbot.wistal.com.pl** (internal TLS).
Canonical repo: `Wistal-Chatbot/wistal-onprem` (fresh history; the old `wistal`
repo is frozen). See [docs/deploy-onprem.md](docs/deploy-onprem.md) for the full
deployment runbook, known pitfalls, and the current TODO list — read it before
touching anything deploy- or env-related.

Key architectural facts after the migration:

- **Database**: PostgreSQL 16 with pgvector, in the `postgres` compose service
  (image `pgvector/pgvector:pg16` — plain `postgres:16-alpine` lacks pgvector and
  silently breaks migration 0000). Schema `chatbot`, managed by drizzle-kit
  migrations in `lib/db/migrations/`.
- **OTP + rate limiting live in Postgres** (`auth_verification_tokens` with an
  `attempts` counter, `auth_rate_limits` with an atomic fixed-window upsert) —
  Upstash Redis / Vercel KV was removed entirely. Do not reintroduce `KV_*` env vars.
- **OTP emails** go through Resend (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`).
- `ANTHROPIC_API_KEY` must be a standard `sk-ant-api...` key; the optional
  `ANTHROPIC_ADMIN_KEY` (`sk-ant-admin...`) only feeds the monthly-usage tile.
- **Never leave empty `VAR=` lines in `.env`** — several call sites use `??`
  fallbacks, and an empty string bypasses them (e.g. `new URL("")` crashes chat).

## Core conventions

- **A new page or widget = a `.tsx` file + a co-located `.css` file** (prefer a CSS
  Module, `Component.module.css`). Keep styling in the stylesheet, not inline, and
  reuse the design tokens (navy `#1E2188`, page bg `#eaecf0`, IBM Plex Sans/Mono).
- **Many small commits, not one big one.** After making and summarizing changes,
  propose grouped `git add` + short `git commit -m` commands — one per logical change.
- **Read-only data access, always.** Every generated query is a `SELECT`; the SQL
  validator blocks writes/DDL, enforces a table allowlist, and injects a row limit.
- **Polish** for all UI copy and model answers.
- **Schema changes**: edit `lib/db/schema/*`, run `npx drizzle-kit generate`, review
  the generated SQL (add indexes by hand — drizzle won't), and remember the server
  applies migrations via `docker compose --profile tools run --rm migrate` (rebuild
  that image first: `docker compose --profile tools build migrate`).
