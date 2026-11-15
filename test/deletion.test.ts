import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { connect } from '../src/db.ts';
import { deleteUser } from '../src/users.ts';

const env = process.env;
const configured = Boolean(env.MONGODB_URI && env.TIGER_DATABASE_URL);

test('deleting a user removes them from MongoDB and Tiger', { skip: !configured && 'MONGODB_URI / TIGER_DATABASE_URL not set' }, async () => {
  const dbs = await connect({ MONGODB_URI: env.MONGODB_URI!, MONGODB_DB: `${env.MONGODB_DB || 'matchmaker'}_test`, TIGER_DATABASE_URL: env.TIGER_DATABASE_URL! });
  try {
    const me = randomUUID();
    const other = randomUUID();
    const matchId = randomUUID();
    const now = new Date();
    await dbs.users.insertMany([
      { _id: me, first_name: 'Del', phone: `+1555${Date.now() % 10_000_000}`, consent: { given: true, is_18_plus: true, recorded_at: now }, created_at: now },
      { _id: other, first_name: 'Keep', phone: `+1556${Date.now() % 10_000_000}`, consent: { given: true, is_18_plus: true, recorded_at: now }, created_at: now },
    ]);
    await dbs.profiles.insertMany([{ _id: me, markers: {}, updated_at: now }, { _id: other, markers: {}, updated_at: now }]);
    await dbs.matches.insertOne({ _id: matchId, user_ids: [me, other], intro: 'x', shared: [], score: 1, status: 'proposed', replies: {}, created_at: now });
    await dbs.tiger.query('INSERT INTO marker_observations (user_id, marker_key, importance, confidence) VALUES ($1, $2, 3, 0.9)', [me, 'lifestyle']);
    await dbs.tiger.query("INSERT INTO match_events (match_id, user_id, event) VALUES ($1, $2, 'proposed'), ($1, $3, 'yes')", [matchId, me, other]);

    const result = await deleteUser(dbs, me);

    assert.deepEqual(result.mongo, { users: 1, profiles: 1, matches: 1, calls: 0, transcripts: 0 });
    assert.deepEqual(result.tiger, { marker_observations: 1, match_events: 2 });
    assert.equal(await dbs.users.countDocuments({ _id: me }), 0);
    assert.equal(await dbs.users.countDocuments({ _id: other }), 1);
    const left = await dbs.tiger.query('SELECT count(*)::int AS n FROM match_events WHERE match_id = $1 OR user_id = $2', [matchId, me]);
    assert.equal(left.rows[0].n, 0);

    await deleteUser(dbs, other);
  } finally {
    await dbs.close();
  }
});
