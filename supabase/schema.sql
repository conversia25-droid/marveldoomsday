begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  bio text,
  share_public boolean not null default false,
  role text not null default 'viewer' check (role in ('viewer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists share_public boolean not null default false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);
  return new;
end;
$$;

create or replace function public.update_own_profile(
  p_display_name text,
  p_avatar_url text,
  p_bio text,
  p_share_public boolean
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.profiles (id, email, display_name, avatar_url, bio, share_public)
  values (
    auth.uid(),
    auth.jwt()->>'email',
    left(nullif(trim(coalesce(p_display_name, '')), ''), 80),
    left(nullif(trim(coalesce(p_avatar_url, '')), ''), 500),
    left(nullif(trim(coalesce(p_bio, '')), ''), 220),
    coalesce(p_share_public, false)
  )
  on conflict (id) do update set
    email = coalesce(excluded.email, public.profiles.email),
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    bio = excluded.bio,
    share_public = excluded.share_public
  returning * into result;

  return result;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_route_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create table if not exists public.branches (
  id text primary key,
  color text not null default '#8A94A6',
  emblem text not null default 'm',
  title text not null,
  subtitle text,
  merge_text text,
  dashed boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.movies (
  id text primary key,
  branch_id text not null references public.branches(id) on delete cascade,
  title text not null,
  search_query text,
  release_year integer not null,
  story_year numeric(8,2) not null,
  media_type text not null default 'movie' check (media_type in ('movie', 'tv')),
  importance text not null default 'completista' check (importance in ('essencial', 'recomendado', 'completista')),
  note text,
  why text,
  poster_path text,
  tmdb_id integer,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.watch_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  movie_id text not null references public.movies(id) on delete cascade,
  watched boolean not null default true,
  watched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, movie_id)
);

create index if not exists movies_branch_order_idx on public.movies(branch_id, display_order);
create index if not exists movies_active_order_idx on public.movies(active, branch_id, display_order);
create index if not exists watch_progress_user_idx on public.watch_progress(user_id);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_branches_updated_at on public.branches;
create trigger set_branches_updated_at
before update on public.branches
for each row execute function public.set_updated_at();

drop trigger if exists set_movies_updated_at on public.movies;
create trigger set_movies_updated_at
before update on public.movies
for each row execute function public.set_updated_at();

drop trigger if exists set_watch_progress_updated_at on public.watch_progress;
create trigger set_watch_progress_updated_at
before update on public.watch_progress
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.branches enable row level security;
alter table public.movies enable row level security;
alter table public.watch_progress enable row level security;

drop policy if exists "profiles select own or admin" on public.profiles;
drop policy if exists "profiles select own public or admin" on public.profiles;
create policy "profiles select own public or admin"
on public.profiles for select
using (share_public = true or id = auth.uid() or public.is_route_admin());

drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update"
on public.profiles for update
using (public.is_route_admin())
with check (public.is_route_admin());

drop policy if exists "branches public read" on public.branches;
create policy "branches public read"
on public.branches for select
using (true);

drop policy if exists "branches admin write" on public.branches;
create policy "branches admin write"
on public.branches for all
using (public.is_route_admin())
with check (public.is_route_admin());

drop policy if exists "movies public read" on public.movies;
create policy "movies public read"
on public.movies for select
using (true);

drop policy if exists "movies admin write" on public.movies;
create policy "movies admin write"
on public.movies for all
using (public.is_route_admin())
with check (public.is_route_admin());

drop policy if exists "watch progress own read" on public.watch_progress;
create policy "watch progress own read"
on public.watch_progress for select
using (user_id = auth.uid());

drop policy if exists "watch progress own insert" on public.watch_progress;
create policy "watch progress own insert"
on public.watch_progress for insert
with check (user_id = auth.uid());

drop policy if exists "watch progress own update" on public.watch_progress;
create policy "watch progress own update"
on public.watch_progress for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "watch progress own delete" on public.watch_progress;
create policy "watch progress own delete"
on public.watch_progress for delete
using (user_id = auth.uid());

grant usage on schema public to anon, authenticated;
grant select on public.branches, public.movies to anon, authenticated;
grant insert, update, delete on public.branches, public.movies to authenticated;
grant select on public.profiles to anon, authenticated;
grant update on public.profiles to authenticated;
grant execute on function public.update_own_profile(text, text, text, boolean) to authenticated;
grant select, insert, update, delete on public.watch_progress to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.branches;
exception when duplicate_object then
  null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.movies;
exception when duplicate_object then
  null;
end;
$$;

commit;
