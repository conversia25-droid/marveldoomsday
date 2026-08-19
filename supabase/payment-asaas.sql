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

alter table public.profiles add column if not exists premium_lifetime boolean not null default false;
alter table public.profiles add column if not exists premium_since timestamptz;
alter table public.profiles add column if not exists premium_source text;
alter table public.profiles add column if not exists asaas_customer_id text;

create or replace function public.has_lifetime_access()
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
      and premium_lifetime = true
  );
$$;

create unique index if not exists profiles_asaas_customer_id_uidx
on public.profiles(asaas_customer_id)
where asaas_customer_id is not null;

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'asaas',
  provider_payment_id text unique,
  provider_customer_id text,
  external_reference text unique,
  status text not null default 'PENDING',
  amount numeric(10,2) not null default 9.99,
  net_amount numeric(10,2),
  billing_type text not null default 'PIX',
  invoice_url text,
  paid_at timestamptz,
  raw_payment jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (provider = 'asaas'),
  check (billing_type = 'PIX')
);

create table if not exists public.payment_events (
  id text primary key,
  provider text not null default 'asaas',
  event_name text not null,
  provider_payment_id text,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  check (provider = 'asaas')
);

create index if not exists purchases_user_idx on public.purchases(user_id, created_at desc);
create index if not exists purchases_provider_payment_idx on public.purchases(provider_payment_id);
create index if not exists payment_events_payment_idx on public.payment_events(provider_payment_id);

drop trigger if exists set_purchases_updated_at on public.purchases;
create trigger set_purchases_updated_at
before update on public.purchases
for each row execute function public.set_updated_at();

alter table public.purchases enable row level security;
alter table public.payment_events enable row level security;

drop policy if exists "watch progress own insert" on public.watch_progress;
create policy "watch progress own insert"
on public.watch_progress for insert
with check (user_id = auth.uid() and public.has_lifetime_access());

drop policy if exists "watch progress own update" on public.watch_progress;
create policy "watch progress own update"
on public.watch_progress for update
using (user_id = auth.uid() and public.has_lifetime_access())
with check (user_id = auth.uid() and public.has_lifetime_access());

drop policy if exists "watch progress own delete" on public.watch_progress;
create policy "watch progress own delete"
on public.watch_progress for delete
using (user_id = auth.uid() and public.has_lifetime_access());

drop policy if exists "purchases own or admin read" on public.purchases;
create policy "purchases own or admin read"
on public.purchases for select
using (user_id = auth.uid() or public.is_route_admin());

revoke execute on function public.has_lifetime_access() from public;
grant execute on function public.has_lifetime_access() to authenticated;
grant select on public.purchases to authenticated;

commit;
