-- Campaign Studio schema v1. Idempotent. Run with: python -m app.migrate
-- Interactions are the audit spine: versions, checks, credits, feedback and chat hang off interaction_id.

create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  credit_balance integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  campaign_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  thread_id uuid references threads(id) on delete set null,
  parent_campaign_id uuid references campaigns(id) on delete set null,
  name text not null,
  brief text not null,
  clarity jsonb not null default '{}'::jsonb,
  parsed_brief jsonb not null default '{}'::jsonb,
  publishers jsonb not null default '[]'::jsonb,
  excluded jsonb not null default '[]'::jsonb,
  personas jsonb not null default '[]'::jsonb,
  creatives jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('generating','draft','needs_review','ready','failed')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaigns_user_created on campaigns(user_id, created_at desc);

create table if not exists interactions (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,      -- generate | edit | regenerate | feedback | chat | repair
  mode text not null,      -- guided | free | repair | none
  input jsonb not null default '{}'::jsonb,
  plan jsonb not null default '[]'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  credits_base integer not null default 0,
  credits_usage integer not null default 0,
  status text not null default 'running' check (status in ('running','done','failed','rejected')),
  duration_ms integer,
  prompt_versions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists interactions_thread_created on interactions(thread_id, created_at);

create table if not exists campaign_versions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  interaction_id uuid references interactions(id) on delete set null,
  change_note text,
  created_at timestamptz not null default now(),
  unique (campaign_id, version)
);

create table if not exists validation_results (
  id uuid primary key default gen_random_uuid(),
  interaction_id uuid not null references interactions(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  check_id text not null,
  severity text not null check (severity in ('error','warning')),
  passed boolean not null,
  message text not null,
  target jsonb not null default '{}'::jsonb,
  repair_tool text
);
create index if not exists validation_results_interaction on validation_results(interaction_id);

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  interaction_id uuid references interactions(id) on delete set null,
  target_kind text not null,   -- publisher | creative | persona | config | clarity
  target_id text not null,
  vote text not null check (vote in ('up','down')),
  comment text,
  repair_interaction_id uuid references interactions(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  key text not null,
  value jsonb not null,
  source text not null default 'manual',
  origin_interaction_id uuid references interactions(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

create table if not exists facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete cascade,
  text text not null,
  source text not null default 'manual',
  origin_interaction_id uuid references interactions(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  interaction_id uuid references interactions(id) on delete set null,
  campaign_id uuid references campaigns(id) on delete set null,
  delta integer not null,
  reason text not null,        -- signup_grant | reserve | usage | refund | grant
  usage jsonb,
  balance_after integer not null,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_created on credit_ledger(user_id, created_at desc);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool')),
  content jsonb not null,
  cards jsonb not null default '[]'::jsonb,
  interaction_id uuid references interactions(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_thread_created on chat_messages(thread_id, created_at);

-- Row-level security: the API connects as the service role, but RLS is on so a
-- browser client with the anon key can only ever read its own rows.
do $$ declare t text; begin
  foreach t in array array['profiles','threads','campaigns','interactions','campaign_versions','validation_results','feedback','preferences','facts','credit_ledger','chat_messages'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles for all using (id = auth.uid());
drop policy if exists threads_owner on threads;
create policy threads_owner on threads for all using (user_id = auth.uid());
drop policy if exists campaigns_owner on campaigns;
create policy campaigns_owner on campaigns for all using (user_id = auth.uid());
drop policy if exists interactions_owner on interactions;
create policy interactions_owner on interactions for all using (user_id = auth.uid());
drop policy if exists versions_owner on campaign_versions;
create policy versions_owner on campaign_versions for all using (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = auth.uid()));
drop policy if exists validation_owner on validation_results;
create policy validation_owner on validation_results for all using (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = auth.uid()));
drop policy if exists feedback_owner on feedback;
create policy feedback_owner on feedback for all using (user_id = auth.uid());
drop policy if exists preferences_owner on preferences;
create policy preferences_owner on preferences for all using (user_id = auth.uid());
drop policy if exists facts_owner on facts;
create policy facts_owner on facts for all using (user_id = auth.uid());
drop policy if exists ledger_owner on credit_ledger;
create policy ledger_owner on credit_ledger for all using (user_id = auth.uid());
drop policy if exists chat_owner on chat_messages;
create policy chat_owner on chat_messages for all using (user_id = auth.uid());
