create table if not exists public.user_problem_views (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id integer not null,
  viewed_at timestamptz not null default now(),
  source text not null default 'page'
);

create index if not exists user_problem_views_user_question_idx
on public.user_problem_views (user_id, question_id, viewed_at desc);

alter table public.user_problem_views enable row level security;

drop policy if exists "Users can read own problem views" on public.user_problem_views;
create policy "Users can read own problem views"
on public.user_problem_views
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own problem views" on public.user_problem_views;
create policy "Users can insert own problem views"
on public.user_problem_views
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own problem views" on public.user_problem_views;
create policy "Users can delete own problem views"
on public.user_problem_views
for delete
to authenticated
using (auth.uid() = user_id);
