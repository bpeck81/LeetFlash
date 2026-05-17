create table if not exists public.question_solutions (
  question_id integer primary key,
  slug text not null unique,
  title text not null,
  difficulty text not null check (difficulty in ('Easy', 'Medium', 'Hard')),
  prompt text not null default '',
  starter_code text not null default 'class Solution:' || chr(10) || '    pass',
  approach text[] not null default '{}',
  solution text not null default '',
  generated_by text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_question_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id integer not null,
  seen boolean not null default false,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_question_id integer,
  random_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists question_solutions_touch_updated_at on public.question_solutions;
create trigger question_solutions_touch_updated_at
before update on public.question_solutions
for each row execute function public.touch_updated_at();

drop trigger if exists user_question_progress_touch_updated_at on public.user_question_progress;
create trigger user_question_progress_touch_updated_at
before update on public.user_question_progress
for each row execute function public.touch_updated_at();

drop trigger if exists user_settings_touch_updated_at on public.user_settings;
create trigger user_settings_touch_updated_at
before update on public.user_settings
for each row execute function public.touch_updated_at();

alter table public.question_solutions enable row level security;
alter table public.user_question_progress enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "Anyone can read question solutions" on public.question_solutions;
create policy "Anyone can read question solutions"
on public.question_solutions
for select
to anon, authenticated
using (true);

drop policy if exists "Users can read own question progress" on public.user_question_progress;
create policy "Users can read own question progress"
on public.user_question_progress
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own question progress" on public.user_question_progress;
create policy "Users can insert own question progress"
on public.user_question_progress
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own question progress" on public.user_question_progress;
create policy "Users can update own question progress"
on public.user_question_progress
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can read own settings" on public.user_settings;
create policy "Users can read own settings"
on public.user_settings
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own settings" on public.user_settings;
create policy "Users can insert own settings"
on public.user_settings
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own settings" on public.user_settings;
create policy "Users can update own settings"
on public.user_settings
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
