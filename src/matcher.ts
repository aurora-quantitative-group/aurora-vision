import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { VECTOR_INDEX } from './config.ts';
import type { Dbs, Marker, Match, Profile } from './db.ts';
import type { Gemini } from './gemini.ts';
import { markerDefs } from './markers.ts';
import type { MarkerDef } from './markers.ts';
import { consentError, containsContactInfo, MAX_PENDING, MAX_PER_WEEK } from './rules.ts';

export class MatchError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type FilterProfile = Pick<Profile, 'gender' | 'wants_to_meet' | 'looking_for' | 'region'>;

function ready(p: FilterProfile): p is Required<FilterProfile> {
  return Boolean(p.gender && p.wants_to_meet?.length && p.looking_for && p.region);
}

// Pre-filter for $vectorSearch: same region and intent, and each person is a gender the other wants to meet.
export function hardFilter(me: FilterProfile): Record<string, unknown> | null {
  if (!ready(me)) return null;
  return {
    $and: [
      { region: { $eq: me.region } },
      { looking_for: { $eq: me.looking_for } },
      { gender: { $in: me.wants_to_meet } },
      { wants_to_meet: { $eq: me.gender } },
    ],
  };
}

export function isMutualMatch(a: FilterProfile, b: FilterProfile): boolean {
  if (!ready(a) || !ready(b)) return false;
  return a.region === b.region
    && a.looking_for === b.looking_for
    && a.wants_to_meet.includes(b.gender)
    && b.wants_to_meet.includes(a.gender);
}

// Importance-weighted share of values markers both people gave the same answer to; 0.5 when none overlap.
export function valuesAgreement(a: Record<string, Marker>, b: Record<string, Marker>, defs: Map<string, MarkerDef>): number {
  let weight = 0;
  let agreed = 0;
  for (const [key, ma] of Object.entries(a)) {
    const mb = b[key];
    if (!mb || defs.get(key)?.kind !== 'values') continue;
    const w = (ma.importance + mb.importance) / 2;
    weight += w;
    if (ma.value.trim().toLowerCase() === mb.value.trim().toLowerCase()) agreed += w;
  }
  return weight ? agreed / weight : 0.5;
}

export function combinedScore(values: number, similarity: number): number {
  return 0.6 * values + 0.4 * similarity;
}

export async function proposalCounts(dbs: Dbs, userIds: string[]): Promise<Map<string, { pending: number; week: number }>> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const rows = await dbs.matches.aggregate<{ _id: string; pending: number; week: number }>([
    { $match: { user_ids: { $in: userIds }, $or: [{ status: 'proposed' }, { created_at: { $gte: weekAgo } }] } },
    { $unwind: '$user_ids' },
    { $match: { user_ids: { $in: userIds } } },
    {
      $group: {
        _id: '$user_ids',
        pending: { $sum: { $cond: [{ $eq: ['$status', 'proposed'] }, 1, 0] } },
        week: { $sum: { $cond: [{ $gte: ['$created_at', weekAgo] }, 1, 0] } },
      },
    },
  ]).toArray();
  return new Map(rows.map(r => [r._id, { pending: r.pending, week: r.week }]));
}

export function limitReached(counts: { pending: number; week: number } | undefined): boolean {
  return Boolean(counts && (counts.pending >= MAX_PENDING || counts.week >= MAX_PER_WEEK));
}

const LlmPick = z.object({
  candidate_user_id: z.string(),
  shared: z.array(z.string().min(1).max(80)).min(1).max(3),
  intro: z.string().min(1).max(400),
});

function publicMarkers(profile: Profile, defs: Map<string, MarkerDef>): string {
  return Object.entries(profile.markers)
    .filter(([key]) => !defs.get(key)?.sensitive)
    .map(([key, m]) => `${key}=${m.value} (importance ${m.importance})`)
    .join('; ');
}

interface Candidate { profile: Profile; firstName: string; similarity: number; values: number; score: number }

function validIntro(intro: string): boolean {
  return intro.split('\n').filter(l => l.trim()).length <= 2 && !containsContactInfo(intro);
}

async function pickWithLlm(gemini: Gemini, me: Profile, myName: string, top: Candidate[], defs: Map<string, MarkerDef>) {
  const prompt = `You are a matchmaker. Pick the best match for ${myName} and write a two-line intro that both people will read.
Line 1 introduces them to each other by first name. Line 2 names what they genuinely share.
Use only first names. Never include phone numbers, emails, social handles, links, last names or sensitive topics.

${myName}: ${me.summary ?? ''}
Markers: ${publicMarkers(me, defs)}

Candidates:
${top.map(c => `- candidate_user_id=${c.profile._id} name=${c.firstName} score=${c.score.toFixed(2)}
  ${c.profile.summary ?? ''}
  Markers: ${publicMarkers(c.profile, defs)}`).join('\n')}

Return candidate_user_id, shared (1-3 short phrases) and intro (exactly two lines).`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const pick = await gemini.json(prompt, LlmPick);
      const chosen = top.find(c => c.profile._id === pick.candidate_user_id);
      if (chosen && validIntro(pick.intro)) return { chosen, shared: pick.shared, intro: pick.intro.trim() };
    } catch (error) { console.warn('[matcher] LLM pick rejected', (error as Error).message); }
  }
  return null;
}

export async function proposeMatch(dbs: Dbs, gemini: Gemini, userId: string): Promise<Match> {
  const defs = markerDefs();
  const [me, myUser] = await Promise.all([dbs.profiles.findOne({ _id: userId }), dbs.users.findOne({ _id: userId })]);
  if (!me || !myUser) throw new MatchError(404, 'Unknown user');
  if (consentError(myUser)) throw new MatchError(403, 'No consent on record for this user');
  const filter = hardFilter(me);
  if (!filter || !me.embedding) throw new MatchError(422, 'Profile is not ready: it needs gender, wants_to_meet, looking_for, region and an end_call summary');
  if (limitReached((await proposalCounts(dbs, [userId])).get(userId))) {
    throw new MatchError(409, `Limit reached: max ${MAX_PENDING} pending and ${MAX_PER_WEEK} proposals a week`);
  }

  const hits = await dbs.profiles.aggregate<Profile & { similarity: number }>([
    { $vectorSearch: { index: VECTOR_INDEX, path: 'embedding', queryVector: me.embedding, numCandidates: 200, limit: 21, filter } },
    { $addFields: { similarity: { $meta: 'vectorSearchScore' } } },
    { $project: { embedding: 0 } },
  ]).toArray();
  const others = hits.filter(h => h._id !== userId && isMutualMatch(me, h)).slice(0, 20);
  const ids = others.map(o => o._id);
  const [users, counts, previous] = await Promise.all([
    dbs.users.find({ _id: { $in: ids } }, { projection: { first_name: 1, consent: 1 } }).toArray(),
    proposalCounts(dbs, ids),
    dbs.matches.find({ user_ids: userId }, { projection: { user_ids: 1 } }).toArray(),
  ]);
  const names = new Map(users.filter(u => !consentError(u)).map(u => [u._id, u.first_name]));
  const seen = new Set(previous.flatMap(m => m.user_ids));

  const candidates: Candidate[] = others
    .filter(o => names.has(o._id) && !seen.has(o._id) && !limitReached(counts.get(o._id)))
    .map(o => {
      const values = valuesAgreement(me.markers, o.markers, defs);
      return { profile: o, firstName: names.get(o._id)!, similarity: o.similarity, values, score: combinedScore(values, o.similarity) };
    })
    .sort((a, b) => b.score - a.score);
  if (!candidates.length) throw new MatchError(404, 'No eligible candidates right now');

  const top = candidates.slice(0, 5);
  const picked = await pickWithLlm(gemini, me, myUser.first_name, top, defs);
  const chosen = picked?.chosen ?? top[0]!;
  const intro = picked?.intro ?? `${myUser.first_name}, meet ${chosen.firstName}.\nWe think you two would get along.`;

  const match: Match = {
    _id: randomUUID(),
    user_ids: [userId, chosen.profile._id],
    intro,
    shared: picked?.shared ?? [],
    score: Math.round(chosen.score * 1000) / 1000,
    status: 'proposed',
    replies: {},
    created_at: new Date(),
  };
  await dbs.matches.insertOne(match);
  await dbs.tiger.query("INSERT INTO match_events (match_id, user_id, event) VALUES ($1, $2, 'proposed')", [match._id, userId]);
  return match;
}
