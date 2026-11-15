'use client';

import { useEffect, useState } from 'react';
import type { Stats } from '../lib/tiger';

const TILES: { key: keyof Stats['totals']; label: string }[] = [
  { key: 'profiled_users', label: 'People profiled' },
  { key: 'markers_total', label: 'Markers recorded' },
  { key: 'markers_24h', label: 'Markers, last 24 h' },
  { key: 'proposed_total', label: 'Matches proposed' },
  { key: 'connected_total', label: 'Mutual YES' },
];

const COLUMNS = ['proposed', 'intros_sent', 'yes_replies', 'no_replies', 'connected', 'declined'] as const;

export default function Page() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch('/api/stats', { cache: 'no-store' });
        const body = await response.json();
        if (!alive) return;
        if (!response.ok) throw new Error(body.error ?? response.statusText);
        setStats(body);
        setError(null);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  return (
    <main>
      <header>
        <h1>Aurora Matchmaker</h1>
        <p className="muted">
          Live from Tiger Data · refreshes every 10 s
          {stats && ` · updated ${new Date(stats.at).toLocaleTimeString()}`}
        </p>
      </header>
      {error && <p className="error">{error}</p>}
      <section className="tiles">
        {TILES.map(t => (
          <div className="tile" key={t.key}>
            <div className="value">{stats ? stats.totals[t.key].toLocaleString() : '–'}</div>
            <div className="muted">{t.label}</div>
          </div>
        ))}
      </section>
      <section>
        <h2>Match funnel by day</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Day</th>{COLUMNS.map(c => <th key={c}>{c.replace('_', ' ')}</th>)}</tr>
            </thead>
            <tbody>
              {stats?.funnel.length ? stats.funnel.map(d => (
                <tr key={d.day}><td>{d.day}</td>{COLUMNS.map(c => <td key={c}>{d[c]}</td>)}</tr>
              )) : (
                <tr><td colSpan={COLUMNS.length + 1} className="muted">No match events yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
