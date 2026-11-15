import { createHash } from 'node:crypto';
import { loadConfig } from '../src/config.ts';
import { connect } from '../src/db.ts';
import type { Marker, Profile, User } from '../src/db.ts';
import { Gemini } from '../src/gemini.ts';
import { markerDefs } from '../src/markers.ts';
import { completeness, filterFieldValue } from '../src/rules.ts';
import { profileText } from '../src/tools.ts';

// Fake people for the matcher. Phones are in the reserved 555-01xx range and seed users are never texted.
const NAMES = ['Maya', 'Jordan', 'Priya', 'Luis', 'Hannah', 'Marcus', 'Sofia', 'Ethan', 'Aaliyah', 'Noah',
  'Grace', 'Diego', 'Chloe', 'Samir', 'Olivia', 'Jamal', 'Emma', 'Kenji', 'Isabel', 'Tyler',
  'Zara', 'Ben', 'Lena', 'Omar', 'Ruby', 'Caleb', 'Nina', 'Theo', 'Avery', 'Rowan'];
const GENDERS = ['woman', 'man', 'woman', 'man', 'woman', 'man', 'woman', 'man', 'woman', 'man', 'nonbinary'];
const JOBS = ['nurse', 'software engineer', 'teacher', 'architect', 'chef', 'paramedic', 'graphic designer', 'accountant', 'musician', 'physical therapist'];
const INTERESTS = ['hiking, climbing', 'cooking, wine bars', 'board games, sci-fi', 'running, cycling', 'live music, vinyl', 'painting, museums', 'soccer, barbecue', 'yoga, reading', 'travel, photography', 'gardening, dogs'];
const WEEKENDS = ['a long trail run and brunch', 'farmers market then cooking for friends', 'a lazy morning and a museum', 'a road trip somewhere new', 'a concert and late tacos'];

const choose = <T,>(list: T[], i: number, salt: number) => list[(i * 7 + salt * 3) % list.length]!;

function uuidFrom(text: string): string {
  const h = createHash('sha1').update(`aurora-seed:${text}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function marker(value: string, importance: number, quote: string): Marker {
  return { value, importance, confidence: 0.9, quote, call_ids: [] };
}

const people = NAMES.map((name, i) => {
  const gender = GENDERS[i % GENDERS.length]!;
  const wants = gender === 'nonbinary' ? 'woman, man, nonbinary' : gender === 'woman' ? (i % 6 === 0 ? 'woman' : 'man') : (i % 7 === 0 ? 'man' : 'woman');
  const markers: Record<string, Marker> = {
    gender: marker(gender, 5, `I'm a ${gender}.`),
    wants_to_meet: marker(wants, 5, `I'd like to meet a ${wants}.`),
    looking_for: marker(i % 5 === 4 ? 'casual' : 'long_term', 5, 'That is what I am looking for.'),
    region: marker(i % 4 === 3 ? 'austin' : 'houston', 4, 'I live here.'),
    wants_kids: marker(choose(['yes', 'no', 'open'], i, 1), 1 + (i % 5), 'Kids are something I think about.'),
    lifestyle: marker(choose(['active', 'balanced', 'homebody'], i, 2), 3, 'That is my pace of life.'),
    drinking: marker(choose(['never', 'socially', 'socially', 'often'], i, 3), 2, 'About my drinking.'),
    pets: marker(choose(['has_dogs', 'has_cats', 'wants_pets', 'no_pets'], i, 4), 3, 'About pets.'),
    occupation: marker(choose(JOBS, i, 5), 3, 'That is my job.'),
    interests: marker(choose(INTERESTS, i, 6), 4, 'I love these.'),
    weekend: marker(choose(WEEKENDS, i, 7), 2, 'My ideal weekend.'),
  };
  const summary = `${name} is a ${markers.occupation!.value} in ${markers.region!.value} who loves ${markers.interests!.value}. `
    + `An ideal weekend is ${markers.weekend!.value}. Lifestyle is ${markers.lifestyle!.value}, and on kids the answer is ${markers.wants_kids!.value}. `
    + `Looking for ${markers.looking_for!.value.replace('_', '-')} with a ${wants}.`;
  return { id: uuidFrom(name), name, phone: `+1713555${String(100 + i).padStart(4, '0')}`, markers, summary };
});

const config = loadConfig();
const dbs = await connect(config);
const defs = markerDefs();
const embeddings = await new Gemini(config).embed(people.map(p => profileText({ summary: p.summary, markers: p.markers })));
const now = new Date();

for (const [i, p] of people.entries()) {
  const user: User = { _id: p.id, first_name: p.name, phone: p.phone, seed: true, consent: { given: true, is_18_plus: true, recorded_at: now }, created_at: now };
  const filters = Object.fromEntries(['gender', 'wants_to_meet', 'looking_for', 'region'].map(k => [k, filterFieldValue(k, p.markers[k]!.value)]));
  const profile: Profile = {
    _id: p.id,
    ...filters,
    markers: p.markers,
    summary: p.summary,
    embedding: embeddings[i]!,
    completeness: completeness({ markers: p.markers }, defs),
    updated_at: now,
  };
  await dbs.users.replaceOne({ _id: p.id }, user, { upsert: true });
  await dbs.profiles.replaceOne({ _id: p.id }, profile, { upsert: true });
}
console.log(`seeded ${people.length} fake profiles with ${embeddings[0]!.length}-dim embeddings`);
await dbs.close();
