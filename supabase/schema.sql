-- Recall sync schema. Single-user app, but RLS is scoped to auth.uid()
-- because this is a public repo and the DB is reachable with a public anon key.
-- Mirrors the localStorage shape in index.html (sessions / actions / expenses / folders)
-- so the client can keep the same in-memory model and just add a sync layer on top.

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  position int not null default 0,
  unique(user_id, name)
);

-- id is text (not uuid) because the client already generates ids like
-- 's_1784268367115' (see `'s_'+Date.now()` in processTranscript) and those
-- ids are used to reconcile local sessions with cloud rows during migration.
create table if not exists public.sessions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date timestamptz not null,
  duration int not null default 0,
  transcript text not null default '',
  title text not null default 'Untitled session',
  summary text not null default '',
  kind text not null default 'note',
  category text not null default 'Personal',
  processed boolean not null default false,
  updated_at timestamptz not null default now(),
  -- tombstone: deletes sync as a flag so other devices drop their local copy
  -- instead of re-uploading it (row-deletes looked like "new local session" to them)
  deleted_at timestamptz
);
-- migration for databases created before deleted_at existed
alter table public.sessions add column if not exists deleted_at timestamptz;
create index if not exists sessions_user_date_idx on public.sessions(user_id, date desc);

create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  idx int not null,
  text text not null,
  due date,
  status text not null default 'open',
  archived_at timestamptz,
  unique(session_id, idx)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  idx int not null,
  description text not null,
  amount numeric not null,
  currency text not null default 'INR',
  unique(session_id, idx)
);

alter table public.folders enable row level security;
alter table public.sessions enable row level security;
alter table public.actions enable row level security;
alter table public.expenses enable row level security;

drop policy if exists "own rows" on public.folders;
create policy "own rows" on public.folders for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on public.sessions;
create policy "own rows" on public.sessions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on public.actions;
create policy "own rows" on public.actions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on public.expenses;
create policy "own rows" on public.expenses for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
