import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONSENT_LINE, systemPrompt } from '../src/agent/system-prompt.ts';
import { markerDefs } from '../src/markers.ts';
import { parseReply } from '../src/messenger.ts';
import { consentError, containsContactInfo, markerError } from '../src/rules.ts';
import { RecordConsentArgs } from '../src/tools.ts';

const consent = (given: boolean, is_18_plus: boolean) => ({ consent: { given, is_18_plus, recorded_at: new Date() } });

test('nothing is saved without consent and 18+', () => {
  assert.match(consentError(null)!, /No consent/);
  assert.match(consentError({ consent: null })!, /No consent/);
  assert.match(consentError(consent(true, false))!, /18\+/);
  assert.match(consentError(consent(false, true))!, /did not consent/);
  assert.equal(consentError(consent(true, true)), null);
});

test('sensitive markers need confirmed: true; unknown keys are rejected', () => {
  const defs = markerDefs();
  assert.match(markerError(defs.get('health'), 'health', undefined)!, /sensitive/);
  assert.match(markerError(defs.get('politics'), 'politics', false)!, /sensitive/);
  assert.equal(markerError(defs.get('politics'), 'politics', true), null);
  assert.equal(markerError(defs.get('lifestyle'), 'lifestyle', undefined), null);
  assert.match(markerError(undefined, 'ssn', true)!, /Unknown marker/);
});

test('record_consent arguments require explicit booleans and an E.164 phone', () => {
  const base = { user_id: crypto.randomUUID(), first_name: 'Sam', phone: '+17135550100', is_18_plus: true, consent_given: true };
  assert.ok(RecordConsentArgs.safeParse(base).success);
  assert.equal(RecordConsentArgs.safeParse({ ...base, phone: '713-555-0100' }).success, false);
  assert.equal(RecordConsentArgs.safeParse({ ...base, is_18_plus: 'yes' }).success, false);
});

test('system prompt opens with the AI disclosure and asks for 18+ and consent', () => {
  assert.match(CONSENT_LINE, /AI matchmaker/);
  assert.match(CONSENT_LINE, /18 or older/);
  assert.match(CONSENT_LINE, /okay for me to save/);
  assert.ok(systemPrompt().includes(CONSENT_LINE));
});

test('intros with contact info are caught', () => {
  assert.ok(containsContactInfo('Text me at (713) 555-0100'));
  assert.ok(containsContactInfo('sam@example.com'));
  assert.ok(containsContactInfo('find me @samlikesdogs'));
  assert.equal(containsContactInfo('Sam, meet Alex.\nYou both love hiking and want kids.'), false);
});

test('YES / NO replies are recognised, anything else ignored', () => {
  assert.equal(parseReply('YES'), 'yes');
  assert.equal(parseReply('yes!! sounds fun'), 'yes');
  assert.equal(parseReply(' No thanks'), 'no');
  assert.equal(parseReply('maybe'), null);
  assert.equal(parseReply('nobody asked'), null);
});
