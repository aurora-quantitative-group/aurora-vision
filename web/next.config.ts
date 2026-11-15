import type { NextConfig } from 'next';

// Share the repo-root .env (TIGER_DATABASE_URL) instead of keeping a second copy of the secret.
try { process.loadEnvFile('../.env'); } catch { /* no root .env: rely on the environment */ }

const config: NextConfig = {};

export default config;
