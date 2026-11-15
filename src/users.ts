import type { Dbs } from './db.ts';

export interface DeleteResult { mongo: Record<string, number>; tiger: Record<string, number> }

// Removes the person everywhere: Mongo state, every match they were in, and their Tiger event rows.
// match_funnel_daily keeps only anonymous daily counts, so it needs no deletion.
export async function deleteUser(dbs: Dbs, userId: string): Promise<DeleteResult> {
  const matchIds = (await dbs.matches.find({ user_ids: userId }, { projection: { _id: 1 } }).toArray()).map(m => m._id);
  const [users, profiles, matches, calls, transcripts] = await Promise.all([
    dbs.users.deleteMany({ _id: userId }),
    dbs.profiles.deleteMany({ _id: userId }),
    dbs.matches.deleteMany({ _id: { $in: matchIds } }),
    dbs.mongo.collection('calls').deleteMany({ user_id: userId }),
    dbs.mongo.collection('transcripts').deleteMany({ user_id: userId }),
  ]);

  const client = await dbs.tiger.connect();
  try {
    await client.query('BEGIN');
    const markers = await client.query('DELETE FROM marker_observations WHERE user_id = $1', [userId]);
    const events = await client.query('DELETE FROM match_events WHERE user_id = $1 OR match_id = ANY($2::uuid[])', [userId, matchIds]);
    await client.query('COMMIT');
    return {
      mongo: { users: users.deletedCount, profiles: profiles.deletedCount, matches: matches.deletedCount, calls: calls.deletedCount, transcripts: transcripts.deletedCount },
      tiger: { marker_observations: markers.rowCount ?? 0, match_events: events.rowCount ?? 0 },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
