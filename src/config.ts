import { z } from 'zod';

const Env = z.object({
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is empty: put your Atlas connection string in .env'),
  MONGODB_DB: z.string().default('matchmaker'),
  TIGER_DATABASE_URL: z.string().min(1, 'TIGER_DATABASE_URL is empty: put your Tiger Cloud connection string in .env'),
  GOOGLE_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
  // gemini-embedding-2 merges a list of texts into one vector, so batch embedding needs gemini-embedding-001.
  EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  CHERT_API_KEY: z.string().optional(),
  CHERT_PROJECT_ID: z.string().optional(),
  CHERT_LINE_ID: z.string().optional(),
  PORT: z.coerce.number().default(3001),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  return Env.parse(cleaned);
}

export const EMBEDDING_DIMS = 768;
export const VECTOR_INDEX = 'profiles_embedding';
