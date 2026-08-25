import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/drizzle";
import { appUsers, queryAudit } from "@/lib/db/schema";

/**
 * Aggregation queries powering the admin „Przegląd" (Overview) endpoint
 * (`GET /api/admin/overview`). All day-boundary math is done in Europe/Warsaw so
 * „dziś" means a Polish calendar day regardless of where the function runs. These
 * return raw DB-shaped values (numbers / Dates); the route formats them for display.
 *
 * Monthly AI spend for the „Zużycie AI / mies." tile is NOT here — it comes live
 * from the Anthropic Cost API via `getMonthlyAiSpend` (`lib/ai/token-usage.ts`).
 */

/** Timezone used for all „today" / „this month" boundaries. */
const TZ = "Europe/Warsaw";

// ── Users KPI ──────────────────────────────────────────────────────────────

export interface UserOverviewStats {
  activeUsers: number;
  newThisWeek: number;
}

/** Active-user count + how many were created in the last 7 days (for the delta). */
export async function getUserOverviewStats(): Promise<UserOverviewStats> {
  const [row] = await db
    .select({
      activeUsers: sql<number>`count(*) filter (where ${appUsers.isActive})`,
      newThisWeek: sql<number>`count(*) filter (where ${appUsers.createdAt} >= now() - interval '7 days')`,
    })
    .from(appUsers);

  return {
    activeUsers: Number(row?.activeUsers ?? 0),
    newThisWeek: Number(row?.newThisWeek ?? 0),
  };
}

// ── Queries-today KPI ────────────────────────────────────────────────────────

export interface QueryCountStats {
  today: number;
  yesterday: number;
}

/** Audited query counts for today and yesterday (Warsaw days), for the d/d delta. */
export async function getQueryCountStats(): Promise<QueryCountStats> {
  const [row] = await db
    .select({
      today: sql<number>`count(*) filter (where (${queryAudit.createdAt} at time zone ${TZ})::date = (now() at time zone ${TZ})::date)`,
      yesterday: sql<number>`count(*) filter (where (${queryAudit.createdAt} at time zone ${TZ})::date = (now() at time zone ${TZ})::date - 1)`,
    })
    .from(queryAudit);

  return {
    today: Number(row?.today ?? 0),
    yesterday: Number(row?.yesterday ?? 0),
  };
}

// ── Response-time KPI ────────────────────────────────────────────────────────

export interface AvgResponseStats {
  /** Mean SQL execution time today, in ms (null when no queries yet). */
  todayMs: number | null;
  yesterdayMs: number | null;
}

/**
 * Mean `query_audit.execution_ms` today vs. yesterday. Note this is the SQL
 * execution time, the closest available proxy for „czas odpowiedzi" — not the
 * end-to-end AI answer latency (which isn't recorded).
 */
export async function getAvgResponseStats(): Promise<AvgResponseStats> {
  const [row] = await db
    .select({
      todayMs: sql<
        number | null
      >`avg(${queryAudit.executionMs}) filter (where (${queryAudit.createdAt} at time zone ${TZ})::date = (now() at time zone ${TZ})::date)`,
      yesterdayMs: sql<
        number | null
      >`avg(${queryAudit.executionMs}) filter (where (${queryAudit.createdAt} at time zone ${TZ})::date = (now() at time zone ${TZ})::date - 1)`,
    })
    .from(queryAudit);

  return {
    todayMs: row?.todayMs != null ? Number(row.todayMs) : null,
    yesterdayMs: row?.yesterdayMs != null ? Number(row.yesterdayMs) : null,
  };
}

// ── 7-day query chart ────────────────────────────────────────────────────────

export interface DailyCount {
  /** Warsaw calendar day, `YYYY-MM-DD`. */
  date: string;
  count: number;
}

/**
 * Query counts per Warsaw day for the last 7 days, oldest → newest, with empty
 * days filled as 0 (via `generate_series`) so the chart always has 7 bars.
 */
export async function getQueriesLast7Days(): Promise<DailyCount[]> {
  const rows = await db.execute(sql`
    with days as (
      select generate_series(
        (now() at time zone ${TZ})::date - 6,
        (now() at time zone ${TZ})::date,
        interval '1 day'
      )::date as day
    )
    select to_char(days.day, 'YYYY-MM-DD') as date,
           count(qa.id) as count
    from days
    left join ${queryAudit} qa
      on (qa.created_at at time zone ${TZ})::date = days.day
    group by days.day
    order by days.day asc
  `);

  const list = rows as unknown as Array<{ date: string; count: string | number }>;
  return Array.from(list).map((r) => ({ date: r.date, count: Number(r.count) }));
}

// ── Users table ──────────────────────────────────────────────────────────────

export interface UserOverviewRow {
  id: string;
  name: string | null;
  email: string;
  isAdmin: boolean;
  /** Audited queries in the current calendar month (Warsaw). */
  monthlyQueries: number;
  /** Most recent sign of life: latest query or last login. */
  lastActivity: Date | null;
}

/** Active users with their monthly query count and last activity, busiest first. */
export async function getUsersOverview(limit = 12): Promise<UserOverviewRow[]> {
  const monthlyQueriesExpr = sql<number>`count(${queryAudit.id}) filter (where (${queryAudit.createdAt} at time zone ${TZ}) >= date_trunc('month', now() at time zone ${TZ}))`;

  const rows = await db
    .select({
      id: appUsers.id,
      name: appUsers.name,
      email: appUsers.email,
      isAdmin: appUsers.isAdmin,
      monthlyQueries: monthlyQueriesExpr,
      lastActivity: sql<
        string | null
      >`greatest(max(${queryAudit.createdAt}), ${appUsers.lastLoginAt})`,
    })
    .from(appUsers)
    .leftJoin(queryAudit, eq(queryAudit.userId, appUsers.id))
    .where(eq(appUsers.isActive, true))
    .groupBy(appUsers.id)
    .orderBy(desc(monthlyQueriesExpr))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    isAdmin: r.isAdmin,
    monthlyQueries: Number(r.monthlyQueries ?? 0),
    lastActivity: r.lastActivity ? new Date(r.lastActivity) : null,
  }));
}

// ── System status ────────────────────────────────────────────────────────────

export interface SystemStatusRow {
  key: string;
  label: string;
  online: boolean;
  valueLabel: string;
}

/**
 * Po ilu godzinach bez udanego cyklu synchronizacja jest „nieświeża". Sync chodzi
 * raz na dobę (`SYNC_INTERVAL_MINUTES=1440`), więc półtorej doby przepuszcza cykl
 * spóźniony, ale pokazuje pominięty.
 */
const SYNC_STALE_AFTER_MS = 36 * 60 * 60 * 1000;

const relFmt = new Intl.RelativeTimeFormat("pl", { numeric: "auto" });

/** Wiek ostatniego cyklu jako „2 godz. temu" / „wczoraj". */
function agoPl(date: Date): string {
  const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relFmt.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relFmt.format(hours, "hour");
  return relFmt.format(Math.round(hours / 24), "day");
}

/**
 * Stan synchronizacji z Optimą, odczytany z `public.migration_log` — tabeli
 * zapisywanej przez repo `optima-neon-sync` (jeden wiersz na tabelę na cykl).
 *
 * Ten wiersz istnieje, bo awaria synchronizacji jest z natury **cicha**: Optima
 * łączy się nazwą instancji i działa dalej, więc jedynym objawem są dane, które
 * przestają się odświeżać. Bez tego trzeba by zaglądać do bazy, żeby zauważyć.
 *
 * Brak tabeli (sync jeszcze nie wdrożony) daje `warn`, nigdy wyjątek — cały
 * przegląd nie może się wywrócić przez nieobecną zależność.
 */
async function getOptimaSyncStatus(): Promise<SystemStatusRow> {
  const base = { key: "sync", label: "Synchronizacja z Optimą" };

  try {
    const rows = await db.execute(sql`
      select
        max(uruchomiono_o) filter (where status = 'ok') as last_ok,
        count(*) filter (
          where status = 'error'
            and uruchomiono_o = (select max(uruchomiono_o) from public.migration_log)
        ) as failed_in_last_run
      from public.migration_log
    `);

    const [row] = rows as unknown as Array<{
      last_ok: string | Date | null;
      failed_in_last_run: string | number;
    }>;

    const lastOk = row?.last_ok ? new Date(row.last_ok) : null;
    const failed = Number(row?.failed_in_last_run ?? 0);

    if (!lastOk) {
      return { ...base, online: false, valueLabel: "Nigdy nie uruchomiona" };
    }
    // Częściowa awaria: cykl przeszedł, ale któraś tabela padła. Warto pokazać,
    // bo dane są wtedy niespójne między tabelami, a nie po prostu stare.
    if (failed > 0) {
      return {
        ...base,
        online: false,
        valueLabel: `Błędy w ostatnim cyklu (${failed})`,
      };
    }

    const stale = Date.now() - lastOk.getTime() > SYNC_STALE_AFTER_MS;
    return { ...base, online: !stale, valueLabel: agoPl(lastOk) };
  } catch {
    return { ...base, online: false, valueLabel: "Brak danych" };
  }
}

/** Live health of the dependencies we can actually check: DB, AI provider, sync. */
export async function getSystemStatus(): Promise<SystemStatusRow[]> {
  let dbOnline = false;
  try {
    await db.execute(sql`select 1`);
    dbOnline = true;
  } catch {
    dbOnline = false;
  }

  const modelConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
  const syncStatus = await getOptimaSyncStatus();

  return [
    {
      key: "db",
      label: "API danych",
      online: dbOnline,
      valueLabel: dbOnline ? "Online" : "Niedostępne",
    },
    {
      key: "model",
      label: "Model językowy",
      online: modelConfigured,
      valueLabel: modelConfigured ? "Online" : "Nieskonfigurowany",
    },
    syncStatus,
  ];
}
