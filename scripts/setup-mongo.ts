import { setTimeout as pause } from 'node:timers/promises';
import { EMBEDDING_DIMS, loadConfig, VECTOR_INDEX } from '../src/config.ts';
import { connect } from '../src/db.ts';
import type { SearchIndexInfo } from '../src/db.ts';

const dbs = await connect(loadConfig());
const existing = new Set((await dbs.mongo.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name));
for (const name of ['users', 'profiles', 'matches']) {
  if (!existing.has(name)) { await dbs.mongo.createCollection(name); console.log(`created ${name}`); }
}

await dbs.users.createIndex({ phone: 1 }, { unique: true });
await dbs.matches.createIndex({ user_ids: 1, status: 1 });
await dbs.matches.createIndex({ created_at: 1 });

const definition = {
  fields: [
    { type: 'vector', path: 'embedding', numDimensions: EMBEDDING_DIMS, similarity: 'cosine' },
    { type: 'filter', path: 'looking_for' },
    { type: 'filter', path: 'wants_to_meet' },
    { type: 'filter', path: 'region' },
    { type: 'filter', path: 'gender' },
  ],
};
const indexes = await dbs.profiles.listSearchIndexes().toArray();
if (indexes.some(i => i.name === VECTOR_INDEX)) {
  await dbs.profiles.updateSearchIndex(VECTOR_INDEX, definition);
  console.log(`updated search index ${VECTOR_INDEX}`);
} else {
  await dbs.profiles.createSearchIndex({ name: VECTOR_INDEX, type: 'vectorSearch', definition });
  console.log(`created search index ${VECTOR_INDEX}`);
}

for (let i = 0; i < 60; i++) {
  const index = (await dbs.profiles.listSearchIndexes(VECTOR_INDEX).toArray() as SearchIndexInfo[])[0];
  if (index?.queryable && index.status === 'READY') { console.log(`${VECTOR_INDEX} is READY`); break; }
  if (i === 0) console.log('waiting for the vector index to build…');
  await pause(5000);
}
await dbs.close();
