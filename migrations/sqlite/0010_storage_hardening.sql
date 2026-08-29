CREATE UNIQUE INDEX schedules_owner_saved_search_unique_idx
  ON schedules(owner_id, saved_search_id);

CREATE INDEX notification_deliveries_schedule_latest_idx
  ON notification_deliveries(schedule_id, created_at DESC, id DESC);

CREATE TABLE rate_limit_windows (
  key TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 512),
  count INTEGER NOT NULL CHECK (count >= 0),
  reset_at_ms INTEGER NOT NULL CHECK (reset_at_ms >= 0)
) STRICT;

CREATE INDEX rate_limit_windows_reset_idx ON rate_limit_windows(reset_at_ms);
