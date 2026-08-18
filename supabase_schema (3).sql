-- Maiya's Dashboard — Supabase schema
-- Run this in the Supabase SQL editor for a NEW Supabase project
-- (Settings > SQL Editor > New query > paste all > Run)

-- 1. GOALS (the four growing circles: Lives, New Clients, Premium, Points)
create table if not exists goals (
  id text primary key,              -- 'lives' | 'new_clients' | 'premium' | 'points'
  label text not null,
  current_value numeric not null default 0,
  goal_value numeric not null default 0,
  updated_at timestamptz not null default now()
);

insert into goals (id, label, current_value, goal_value) values
  ('lives', 'Lives', 0, 75),
  ('new_clients', 'New Clients', 0, 48),
  ('premium', 'Premium', 0, 150000),
  ('points', 'Points', 0, 250000)
on conflict (id) do nothing;

-- 2. CASE OPEN
create table if not exists case_open (
  id uuid primary key default gen_random_uuid(),
  client_name text not null default '',
  lives numeric not null default 0,
  new_clients numeric not null default 0,
  premium numeric not null default 0,
  aum numeric not null default 0,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. APPLICATIONS SUBMITTED (same shape as Case Open)
create table if not exists applications_submitted (
  id uuid primary key default gen_random_uuid(),
  client_name text not null default '',
  lives numeric not null default 0,
  new_clients numeric not null default 0,
  premium numeric not null default 0,
  aum numeric not null default 0,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. HOT LIST
create table if not exists hot_list (
  id uuid primary key default gen_random_uuid(),
  date_opened date,
  client_name text not null default '',
  ff_income numeric not null default 0,
  action_date date,
  lives numeric not null default 0,
  new_clients numeric not null default 0,
  premium numeric not null default 0,
  aum numeric not null default 0,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5. CONVERSION SETTINGS (editable close-rate assumptions used for projections)
-- stage 'open_to_submitted'  = Case Open -> Applications Submitted
-- stage 'submitted_to_placed' = Applications Submitted -> Placed (In Force)
create table if not exists conversion_settings (
  id text primary key,               -- '<metric>__<stage>', e.g. 'lives__open_to_submitted'
  close_rate_override numeric,        -- null = use auto-calculated ratio
  updated_at timestamptz not null default now()
);

insert into conversion_settings (id, close_rate_override) values
  ('lives__open_to_submitted', null),
  ('new_clients__open_to_submitted', null),
  ('premium__open_to_submitted', null),
  ('lives__submitted_to_placed', null),
  ('new_clients__submitted_to_placed', null),
  ('premium__submitted_to_placed', null)
on conflict (id) do nothing;

-- 6. CURRENT CLIENTS (the pipeline: Fact Finder Complete -> ... -> In Force)
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  client_name text not null default '',
  source text default '',            -- free text, matched against source_options for its color
  lives numeric not null default 1,
  new_clients numeric not null default 1,
  premium numeric not null default 0,
  aum numeric not null default 0,
  status text not null default 'Fact Finder Complete',
  notes text default '',
  date_added date default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 7. SOURCE OPTIONS (editable, color-coded list for the Source dropdown)
create table if not exists source_options (
  id text primary key,               -- slug, e.g. 'linkedin'
  label text not null,
  color text not null default '#1F6F5C',
  sort_order int not null default 0
);

insert into source_options (id, label, color, sort_order) values
  ('linkedin', 'LinkedIn', '#0A66C2', 1),
  ('event', 'Event', '#C9A227', 2),
  ('referral', 'Referral', '#1F6F5C', 3)
on conflict (id) do nothing;

alter table clients enable row level security;
alter table source_options enable row level security;
create policy "public read/write clients" on clients for all using (true) with check (true);
create policy "public read/write source_options" on source_options for all using (true) with check (true);

-- Supabase projects created after May 2026 no longer auto-expose new tables to
-- the Data API — an explicit grant is required or the dashboard can't read/write.
grant select, insert, update, delete
on table goals, case_open, applications_submitted, hot_list,
   conversion_settings, clients, source_options
to anon;

-- Enable Row Level Security + open policies for a single-user internal tool.
-- (Since this dashboard is only used by Maiya via a private link with the anon key,
--  this keeps setup simple. Tighten with auth if it's ever shared more broadly.)
alter table goals enable row level security;
alter table case_open enable row level security;
alter table applications_submitted enable row level security;
alter table hot_list enable row level security;
alter table conversion_settings enable row level security;

create policy "public read/write goals" on goals for all using (true) with check (true);
create policy "public read/write case_open" on case_open for all using (true) with check (true);
create policy "public read/write applications_submitted" on applications_submitted for all using (true) with check (true);
create policy "public read/write hot_list" on hot_list for all using (true) with check (true);
create policy "public read/write conversion_settings" on conversion_settings for all using (true) with check (true);
