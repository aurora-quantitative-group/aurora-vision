import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combinedScore, hardFilter, isMutualMatch, limitReached, valuesAgreement } from '../src/matcher.ts';
import { markerDefs } from '../src/markers.ts';
import type { Marker } from '../src/db.ts';

const alex = { gender: 'woman', wants_to_meet: ['man'], looking_for: 'long_term', region: 'houston' };
const sam = { gender: 'man', wants_to_meet: ['woman'], looking_for: 'long_term', region: 'houston' };

test('hard filter requires mutual gender interest, same intent and region', () => {
  assert.deepEqual(hardFilter(alex), {
    $and: [
      { region: { $eq: 'houston' } },
      { looking_for: { $eq: 'long_term' } },
      { gender: { $in: ['man'] } },
      { wants_to_meet: { $eq: 'woman' } },
    ],
  });
});

test('hard filter is null until every filter field is known', () => {
  assert.equal(hardFilter({ ...alex, region: undefined }), null);
  assert.equal(hardFilter({ ...alex, wants_to_meet: [] }), null);
});

test('mutual match needs both directions', () => {
  assert.equal(isMutualMatch(alex, sam), true);
  assert.equal(isMutualMatch(alex, { ...sam, wants_to_meet: ['man'] }), false);
  assert.equal(isMutualMatch(alex, { ...sam, region: 'austin' }), false);
  assert.equal(isMutualMatch(alex, { ...sam, looking_for: 'casual' }), false);
  assert.equal(isMutualMatch(alex, { ...alex }), false);
});

const m = (value: string, importance: number): Marker => ({ value, importance, confidence: 1, quote: '', call_ids: [] });

test('values agreement weighs shared values markers by importance and ignores others', () => {
  const defs = markerDefs();
  const a = { wants_kids: m('yes', 5), lifestyle: m('active', 1), occupation: m('nurse', 5) };
  const b = { wants_kids: m('Yes', 5), lifestyle: m('homebody', 1), occupation: m('chef', 5) };
  assert.ok(Math.abs(valuesAgreement(a, b, defs) - 5 / 6) < 1e-9);
  assert.equal(valuesAgreement({ occupation: m('x', 3) }, {}, defs), 0.5);
});

test('score is 0.6 values + 0.4 similarity', () => {
  assert.ok(Math.abs(combinedScore(1, 0.5) - 0.8) < 1e-9);
});

test('proposal limits: 1 pending, 3 per week', () => {
  assert.equal(limitReached(undefined), false);
  assert.equal(limitReached({ pending: 0, week: 2 }), false);
  assert.equal(limitReached({ pending: 1, week: 1 }), true);
  assert.equal(limitReached({ pending: 0, week: 3 }), true);
});
