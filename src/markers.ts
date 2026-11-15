import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type MarkerKind = 'filter' | 'values' | 'profile';

export interface MarkerDef { key: string; kind: MarkerKind; core: boolean; sensitive: boolean; description: string }

const DEFAULT_PATH = fileURLToPath(new URL('../docs/markers.md', import.meta.url));

// docs/markers.md is the single source of truth; its table rows become the allowed marker keys.
export function parseMarkers(markdown: string): Map<string, MarkerDef> {
  const defs = new Map<string, MarkerDef>();
  for (const line of markdown.split('\n')) {
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length !== 5 || cells[0] === 'key' || cells[0]!.startsWith('-')) continue;
    const [key, kind, core, sensitive, description] = cells as [string, string, string, string, string];
    if (kind !== 'filter' && kind !== 'values' && kind !== 'profile') throw new Error(`docs/markers.md: unknown kind "${kind}" for ${key}`);
    defs.set(key, { key, kind, core: core === 'yes', sensitive: sensitive === 'yes', description });
  }
  return defs;
}

let cached: Map<string, MarkerDef> | undefined;

export function markerDefs(path = DEFAULT_PATH): Map<string, MarkerDef> {
  cached ??= parseMarkers(readFileSync(path, 'utf8'));
  return cached;
}
