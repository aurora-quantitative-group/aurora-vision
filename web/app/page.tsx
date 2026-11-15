'use client';

import { useEffect, useState } from 'react';
import type { Stats } from '../lib/tiger';

const TOTALS: { key: keyof Stats['totals']; label: string }[] = [
  { key: 'profiled_users', label: 'People profiled' },
  { key: 'markers_total', label: 'Markers recorded' },
  { key: 'markers_24h', label: 'Markers, last 24 h' },
  { key: 'proposed_total', label: 'Matches proposed' },
  { key: 'connected_total', label: 'Mutual matches' },
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
      <header className="masthead">
        <a className="event-link" href="https://www.hackuta.com/">HackUTA 2026</a>
        <div className="title">
          <h1>Aurora Ithaca</h1>
        </div>
        <img className="coast" src="/odyssey/coast.webp" alt="" width="240" height="240" />
      </header>

      <div className="report">
        <section className="totals" aria-labelledby="totals-title">
          <h2 id="totals-title">Totals</h2>
          <dl>
            {TOTALS.map(({ key, label }) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{stats ? stats.totals[key].toLocaleString() : '—'}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="activity" aria-labelledby="activity-title">
          <header className="activity-header">
            <h2 id="activity-title">Daily matches</h2>
            {stats && (
              <p className="updated">
                Updated <time dateTime={stats.at}>{new Date(stats.at).toLocaleTimeString()}</time>
              </p>
            )}
          </header>
          {error && (
            <p className="error" role="alert">
              {error}.{stats && ' Showing the last available data.'}
            </p>
          )}
          {!stats && !error && <p role="status">Loading match data…</p>}
          {stats && (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Daily match activity">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    {COLUMNS.map(column => (
                      <th scope="col" key={column}>{column.replaceAll('_', ' ')}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.funnel.map(day => (
                    <tr key={day.day}>
                      <th scope="row">{day.day}</th>
                      {COLUMNS.map(column => <td key={column}>{day[column].toLocaleString()}</td>)}
                    </tr>
                  ))}
                  {!stats.funnel.length && (
                    <tr><td colSpan={COLUMNS.length + 1} className="empty">No match events yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
