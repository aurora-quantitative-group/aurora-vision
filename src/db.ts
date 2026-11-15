import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import type { Collection, Db } from 'mongodb';
import pg from 'pg';
import type { Config } from './config.ts';

export interface Consent { given: boolean; is_18_plus: boolean; recorded_at: Date; call_id?: string }

export interface User {
  _id: string;
  first_name: string;
  phone: string;
  consent: Consent | null;
  seed?: boolean;
  created_at: Date;
}

export interface Marker { value: string; importance: number; confidence: number; quote: string; call_ids: string[] }

export interface Profile {
  _id: string;
  gender?: string;
  wants_to_meet?: string[];
  looking_for?: string;
  region?: string;
  markers: Record<string, Marker>;
  summary?: string;
  embedding?: number[];
  completeness?: number;
  updated_at: Date;
}

export type MatchStatus = 'proposed' | 'connected' | 'declined';

export interface Match {
  _id: string;
  user_ids: [string, string];
  intro: string;
  shared: string[];
  score: number;
  status: MatchStatus;
  replies: Record<string, 'yes' | 'no'>;
  created_at: Date;
  closed_at?: Date;
}

export interface SearchIndexInfo {
  name: string;
  status?: string;
  queryable?: boolean;
  latestDefinition?: { fields?: { type: string; path: string }[] };
}

export interface MessengerState { _id: string; last_seen_at: Date; seen_ids: string[] }

export interface Dbs {
  mongo: Db;
  users: Collection<User>;
  profiles: Collection<Profile>;
  matches: Collection<Match>;
  messenger: Collection<MessengerState>;
  tiger: pg.Pool;
  close(): Promise<void>;
}

const TIGER_CA = fileURLToPath(new URL('../certs/tiger-ca.pem', import.meta.url));

// Tiger services present either a public certificate or one from Tiger's own CA (ca.timescale.com, seen on a
// freshly created service), so trust both and keep verification on. sslmode is dropped from the URL because pg
// lets it override the ssl object.
export function tigerPoolConfig(url: string, max = 5): pg.PoolConfig {
  const parsed = new URL(url);
  parsed.searchParams.delete('sslmode');
  return { connectionString: parsed.toString(), ssl: { ca: [...rootCertificates, readFileSync(TIGER_CA, 'utf8')] }, max };
}

export async function connect(config: Pick<Config, 'MONGODB_URI' | 'MONGODB_DB' | 'TIGER_DATABASE_URL'>): Promise<Dbs> {
  // Warm connections up front so the first Gemini tool call stays under 300 ms.
  const client = await new MongoClient(config.MONGODB_URI, { minPoolSize: 4 }).connect();
  const mongo = client.db(config.MONGODB_DB);
  const tiger = new pg.Pool(tigerPoolConfig(config.TIGER_DATABASE_URL));
  await tiger.query('SELECT 1');
  return {
    mongo,
    users: mongo.collection<User>('users'),
    profiles: mongo.collection<Profile>('profiles'),
    matches: mongo.collection<Match>('matches'),
    messenger: mongo.collection<MessengerState>('messenger_state'),
    tiger,
    async close() { await Promise.all([client.close(), tiger.end()]); },
  };
}
