import type { MarkerDef } from './markers.ts';
import type { Profile, User } from './db.ts';

export const MAX_PENDING = 1;
export const MAX_PER_WEEK = 3;

export function consentError(user: Pick<User, 'consent'> | null): string | null {
  if (!user || !user.consent) return 'No consent on record. Disclose you are an AI matchmaker, ask for consent and confirm they are 18+, then call record_consent.';
  if (!user.consent.is_18_plus) return 'This person is not confirmed 18+. Save nothing and end the call politely.';
  if (!user.consent.given) return 'This person did not consent to saving data. Save nothing.';
  return null;
}

export function markerError(def: MarkerDef | undefined, key: string, confirmed: boolean | undefined): string | null {
  if (!def) return `Unknown marker "${key}". Use only the keys listed in your instructions.`;
  if (def.sensitive && confirmed !== true) {
    return `"${key}" is sensitive: save it only if they volunteered it and confirmed you may save it, then call again with confirmed: true.`;
  }
  return null;
}

// Filter markers are copied to top-level profile fields that the vector index filters on.
export function filterFieldValue(key: string, value: string): string | string[] {
  const clean = value.trim().toLowerCase();
  return key === 'wants_to_meet' ? clean.split(',').map(v => v.trim()).filter(Boolean) : clean;
}

export function completeness(profile: Pick<Profile, 'markers'>, defs: Map<string, MarkerDef>): number {
  const core = [...defs.values()].filter(d => d.core);
  const filled = core.filter(d => (profile.markers[d.key]?.confidence ?? 0) >= 0.6).length;
  return core.length ? Math.round((filled / core.length) * 100) / 100 : 0;
}

const PHONE = /\+?\d[\d\s().-]{6,}\d/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const HANDLE_OR_LINK = /(^|\s)@\w{2,}|https?:\/\/|www\.|instagram|snapchat|tiktok|whatsapp/i;

export function containsContactInfo(text: string): boolean {
  return PHONE.test(text) || EMAIL.test(text) || HANDLE_OR_LINK.test(text);
}
