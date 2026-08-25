-- One row per tracked event. Run once against the database behind DATABASE_URL:
--   psql "$DATABASE_URL" -f api/schema.sql

create table if not exists events (
  id           bigserial primary key,
  -- Server truth. `ts` is the client's clock and is not to be trusted for
  -- ordering -- a wrong device clock, or a queue that sat through a week
  -- offline, both arrive looking like the present.
  received_at  timestamptz not null default now(),
  name         text        not null,
  ts           bigint      not null,
  install_id   text        not null,
  imagery      text        not null,
  props        jsonb       not null,
  -- Resolved server-side from the request IP by the edge, which sees it
  -- anyway. The address itself is never read into this process and never
  -- stored; city is as fine-grained as this gets.
  country      text,
  region       text,
  city         text
);

-- The two access patterns that exist: "how did this location play" and
-- "what happened recently".
create index if not exists events_name_received_idx on events (name, received_at desc);
create index if not exists events_location_idx
  on events ((props ->> 'locationId')) where name = 'round_complete';

-- Runtime configuration. One row, edited by the admin panel, read by every
-- client at boot. Versioned so a score can be traced to the curve that produced
-- it: without that, retuning lambda silently makes yesterday's scores and
-- today's incomparable, and the events table exists to compare them.
create table if not exists config (
  id         int         primary key default 1,
  version    int         not null default 1,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  constraint config_singleton check (id = 1)
);
