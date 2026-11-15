import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import pg from 'pg';

const globalForPool = globalThis as unknown as { tigerPool?: pg.Pool };

export function tiger(): pg.Pool {
  if (!process.env.TIGER_DATABASE_URL) throw new Error('TIGER_DATABASE_URL is not set in the repo-root .env.local or .env');
  if (!globalForPool.tigerPool) {
    const url = new URL(process.env.TIGER_DATABASE_URL);
    url.searchParams.delete('sslmode');
    const ca = [...rootCertificates, readFileSync(join(process.cwd(), 'certs', 'tiger-ca.pem'), 'utf8')];
    globalForPool.tigerPool = new pg.Pool({ connectionString: url.toString(), ssl: { ca }, max: 3 });
  }
  return globalForPool.tigerPool;
}

export interface FunnelDay {
  day: string;
  proposed: number;
  intros_sent: number;
  yes_replies: number;
  no_replies: number;
  connected: number;
  declined: number;
}

export interface Stats {
  totals: { markers_total: number; markers_24h: number; profiled_users: number; proposed_total: number; connected_total: number };
  funnel: FunnelDay[];
  at: string;
}

export async function loadStats(): Promise<Stats> {
  const db = tiger();
  const [funnel, totals] = await Promise.all([
    db.query<FunnelDay>(`SELECT day::date::text AS day, proposed::int, intros_sent::int, yes_replies::int, no_replies::int,
        connected::int, declined::int
      FROM match_funnel_daily ORDER BY day DESC LIMIT 14`),
    db.query<Stats['totals']>(`SELECT
        (SELECT count(*) FROM marker_observations)::int AS markers_total,
        (SELECT count(*) FROM marker_observations WHERE time > now() - INTERVAL '24 hours')::int AS markers_24h,
        (SELECT count(DISTINCT user_id) FROM marker_observations)::int AS profiled_users,
        (SELECT count(*) FROM match_events WHERE event = 'proposed')::int AS proposed_total,
        (SELECT count(*) FROM match_events WHERE event = 'connected')::int AS connected_total`),
  ]);
  return { totals: totals.rows[0]!, funnel: funnel.rows, at: new Date().toISOString() };
}
