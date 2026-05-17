alter table public.question_solutions
add column if not exists examples text not null default '';

alter table public.question_solutions
add column if not exists constraints_text text not null default '';
