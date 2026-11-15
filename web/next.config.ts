import type { NextConfig } from 'next';
import { existsSync } from 'node:fs';

for (const file of ['../.env.local', '../.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const config: NextConfig = {};

export default config;
