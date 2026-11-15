-- Time-series events only. No profile text, quotes or embeddings belong here.

CREATE TABLE IF NOT EXISTS marker_observations (
  time        TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     UUID        NOT NULL,
  call_id     UUID,
  marker_key  TEXT        NOT NULL,
  importance  SMALLINT    NOT NULL CHECK (importance BETWEEN 1 AND 5),
  confidence  REAL        NOT NULL CHECK (confidence BETWEEN 0 AND 1)
);
SELECT create_hypertable('marker_observations', by_range('time'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS marker_observations_user_idx ON marker_observations (user_id, time DESC);

CREATE TABLE IF NOT EXISTS match_events (
  time      TIMESTAMPTZ NOT NULL DEFAULT now(),
  match_id  UUID        NOT NULL,
  user_id   UUID,
  event     TEXT        NOT NULL CHECK (event IN ('proposed', 'intro_sent', 'intro_failed', 'yes', 'no', 'connected', 'declined'))
);
SELECT create_hypertable('match_events', by_range('time'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS match_events_match_idx ON match_events (match_id, time DESC);
CREATE INDEX IF NOT EXISTS match_events_user_idx ON match_events (user_id, time DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS match_funnel_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 day', time) AS day,
  count(*) FILTER (WHERE event = 'proposed')   AS proposed,
  count(*) FILTER (WHERE event = 'intro_sent') AS intros_sent,
  count(*) FILTER (WHERE event = 'yes')        AS yes_replies,
  count(*) FILTER (WHERE event = 'no')         AS no_replies,
  count(*) FILTER (WHERE event = 'connected')  AS connected,
  count(*) FILTER (WHERE event = 'declined')   AS declined
FROM match_events
GROUP BY day
WITH NO DATA;

SELECT add_continuous_aggregate_policy('match_funnel_daily',
  start_offset => INTERVAL '30 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => TRUE);
