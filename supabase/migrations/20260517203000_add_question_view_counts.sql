alter table public.user_question_progress
add column if not exists view_count integer not null default 0;

alter table public.user_question_progress
add column if not exists last_viewed_at timestamptz;
