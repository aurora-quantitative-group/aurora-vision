import { loadConfig, VECTOR_INDEX } from '../src/config.ts';
import { connect } from '../src/db.ts';
import type { SearchIndexInfo } from '../src/db.ts';

const dbs = await connect(loadConfig());

console.log('== MongoDB');
for (const name of ['users', 'profiles', 'matches']) {
  console.log(`${name}: ${await dbs.mongo.collection(name).countDocuments()} documents`);
}
console.log(`profiles with embeddings: ${await dbs.profiles.countDocuments({ embedding: { $exists: true } })}`);
for (const index of await dbs.profiles.listSearchIndexes().toArray() as SearchIndexInfo[]) {
  const fields = (index.latestDefinition?.fields ?? []).map(f => `${f.type}:${f.path}`).join(', ');
  console.log(`search index ${index.name}${index.name === VECTOR_INDEX ? '' : ' (unexpected)'}: ${index.status}, queryable=${index.queryable} [${fields}]`);
}

console.log('\n== Tiger');
const hypertables = await dbs.tiger.query("SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_schema = 'public' ORDER BY 1");
console.log(`hypertables: ${hypertables.rows.map(r => r.hypertable_name).join(', ') || 'none'}`);
const aggregates = await dbs.tiger.query('SELECT view_name, materialized_only FROM timescaledb_information.continuous_aggregates ORDER BY 1');
console.log(`continuous aggregates: ${aggregates.rows.map(r => `${r.view_name} (realtime=${!r.materialized_only})`).join(', ') || 'none'}`);
for (const table of ['marker_observations', 'match_events']) {
  const { rows } = await dbs.tiger.query(`SELECT count(*)::int AS n FROM ${table}`);
  console.log(`${table}: ${rows[0].n} rows`);
}
const funnel = await dbs.tiger.query('SELECT * FROM match_funnel_daily ORDER BY day DESC LIMIT 3');
console.log('match_funnel_daily (latest):', funnel.rows);

await dbs.close();
