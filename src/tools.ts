import { z } from 'zod';
import type { Dbs, Profile } from './db.ts';
import type { Gemini } from './gemini.ts';
import { markerDefs } from './markers.ts';
import { enqueue } from './queue.ts';
import { completeness, consentError, filterFieldValue, markerError } from './rules.ts';

export const RecordConsentArgs = z.object({
  user_id: z.uuid().describe('The caller\'s user_id, given to you at the start of the call'),
  first_name: z.string().trim().min(1).max(60).describe('First name only'),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/).describe('The caller\'s phone number in E.164 format, given to you at the start of the call'),
  is_18_plus: z.boolean().describe('True only if they clearly said they are 18 or older'),
  consent_given: z.boolean().describe('True only if they clearly agreed that you may save what they share'),
  call_id: z.uuid().optional(),
});

export const RecordMarkerArgs = z.object({
  user_id: z.uuid(),
  key: z.string().describe('A marker key from the list in your instructions'),
  value: z.string().trim().min(1).max(500).describe('The normalized value, in the format the marker list describes'),
  importance: z.coerce.number().int().min(1).max(5).describe('How much this matters to them, 1 to 5'),
  confidence: z.coerce.number().min(0).max(1).describe('How sure you are of the value, 0 to 1'),
  quote: z.string().trim().max(500).describe('Their exact words that support the value'),
  call_id: z.uuid().optional(),
  confirmed: z.boolean().optional().describe('Required true for sensitive markers: they volunteered it and agreed you may save it'),
});

export const EndCallArgs = z.object({
  user_id: z.uuid(),
  summary: z.string().trim().min(1).max(4000).describe('Three to five sentences about who they are and who they want to meet'),
  call_id: z.uuid().optional(),
});

export type ToolResult = { ok: true; message?: string } | { ok: false; error: string };

export interface ToolContext { dbs: Dbs; gemini: Gemini }

export async function recordConsent(ctx: ToolContext, raw: unknown): Promise<ToolResult> {
  const args = RecordConsentArgs.parse(raw);
  if (!args.is_18_plus) return { ok: false, error: 'Not confirmed 18+. Nothing was saved. Tell them this service is for adults only and end the call politely.' };
  if (!args.consent_given) return { ok: false, error: 'No consent. Nothing was saved. You may keep chatting but do not record anything.' };
  const now = new Date();
  await Promise.all([
    ctx.dbs.users.updateOne(
      { _id: args.user_id },
      {
        $set: { first_name: args.first_name, phone: args.phone, consent: { given: true, is_18_plus: true, recorded_at: now, call_id: args.call_id } },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    ),
    ctx.dbs.profiles.updateOne({ _id: args.user_id }, { $setOnInsert: { markers: {}, updated_at: now } }, { upsert: true }),
  ]);
  return { ok: true, message: 'Consent recorded. You may now save markers.' };
}

export async function recordMarker(ctx: ToolContext, raw: unknown): Promise<ToolResult> {
  const args = RecordMarkerArgs.parse(raw);
  const def = markerDefs().get(args.key);
  const invalid = markerError(def, args.key, args.confirmed);
  if (invalid) return { ok: false, error: invalid };
  const user = await ctx.dbs.users.findOne({ _id: args.user_id }, { projection: { consent: 1 } });
  const blocked = consentError(user);
  if (blocked) return { ok: false, error: blocked };

  const path = `markers.${args.key}`;
  const set: Record<string, unknown> = {
    [`${path}.value`]: args.value,
    [`${path}.importance`]: args.importance,
    [`${path}.confidence`]: args.confidence,
    [`${path}.quote`]: args.quote,
    updated_at: new Date(),
  };
  if (def!.kind === 'filter') set[args.key] = filterFieldValue(args.key, args.value);
  await ctx.dbs.profiles.updateOne(
    { _id: args.user_id },
    { $set: set, $addToSet: { [`${path}.call_ids`]: { $each: args.call_id ? [args.call_id] : [] } } },
    { upsert: true },
  );

  enqueue('marker_observation', async () => {
    await ctx.dbs.tiger.query(
      'INSERT INTO marker_observations (user_id, call_id, marker_key, importance, confidence) VALUES ($1, $2, $3, $4, $5)',
      [args.user_id, args.call_id ?? null, args.key, args.importance, args.confidence],
    );
  });
  return { ok: true };
}

export async function endCall(ctx: ToolContext, raw: unknown): Promise<ToolResult> {
  const args = EndCallArgs.parse(raw);
  const user = await ctx.dbs.users.findOne({ _id: args.user_id }, { projection: { consent: 1 } });
  const blocked = consentError(user);
  if (blocked) return { ok: false, error: blocked };
  await ctx.dbs.profiles.updateOne({ _id: args.user_id }, { $set: { summary: args.summary, updated_at: new Date() } });
  enqueue('embed_profile', () => embedProfile(ctx, args.user_id));
  return { ok: true, message: 'Summary saved.' };
}

export function profileText(profile: Pick<Profile, 'summary' | 'markers'>): string {
  const defs = markerDefs();
  const lines = Object.entries(profile.markers)
    .filter(([key]) => defs.get(key)?.kind !== 'filter')
    .map(([key, m]) => `${key}: ${m.value}`);
  return [profile.summary ?? '', ...lines].join('\n').trim();
}

export async function embedProfile(ctx: ToolContext, userId: string): Promise<void> {
  const profile = await ctx.dbs.profiles.findOne({ _id: userId });
  if (!profile) return;
  const [embedding] = await ctx.gemini.embed([profileText(profile)]);
  await ctx.dbs.profiles.updateOne(
    { _id: userId },
    { $set: { embedding: embedding!, completeness: completeness(profile, markerDefs()), updated_at: new Date() } },
  );
}

export const TOOLS = {
  record_consent: recordConsent,
  record_marker: recordMarker,
  end_call: endCall,
} as const;
