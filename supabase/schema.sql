-- Tree Map: Supabase schema for cloud-backed tree records.
--
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- on the project whose URL/anon key you put in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
--
-- Before running this, also enable anonymous sign-ins:
--   Dashboard → Authentication → Sign In / Providers → Anonymous Sign-Ins → Enable.
-- Without that toggle, `supabase.auth.signInAnonymously()` in the app will fail and
-- the app will silently fall back to localStorage-only mode.

create extension if not exists pgcrypto;

create table if not exists public.trees (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  species text not null,
  notes text,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  photo_url text,
  photo_path text,
  observed_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Running against an existing table (added after the initial create): no-op if the
-- columns are already there.
alter table public.trees add column if not exists photo_url text;
alter table public.trees add column if not exists photo_path text;

create index if not exists trees_owner_id_idx on public.trees (owner_id);
create index if not exists trees_observed_at_idx on public.trees (observed_at desc);

alter table public.trees enable row level security;

-- Anonymous sessions are issued the `authenticated` role in Supabase, so `to authenticated`
-- covers both anonymous and (if ever added later) fully signed-up users.

drop policy if exists trees_select_authenticated on public.trees;
create policy trees_select_authenticated
  on public.trees for select
  to authenticated
  using (true);

drop policy if exists trees_insert_own on public.trees;
create policy trees_insert_own
  on public.trees for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists trees_update_own on public.trees;
create policy trees_update_own
  on public.trees for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists trees_delete_own on public.trees;
create policy trees_delete_own
  on public.trees for delete
  to authenticated
  using (owner_id = auth.uid());

-- Photo storage: one public bucket, objects keyed as "<owner_id>/<uuid>.jpg" so RLS can
-- scope writes/deletes to the uploader via the path's first folder segment.
insert into storage.buckets (id, name, public)
values ('tree-photos', 'tree-photos', true)
on conflict (id) do nothing;

drop policy if exists tree_photos_public_read on storage.objects;
create policy tree_photos_public_read
  on storage.objects for select
  to public
  using (bucket_id = 'tree-photos');

drop policy if exists tree_photos_insert_own on storage.objects;
create policy tree_photos_insert_own
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'tree-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists tree_photos_delete_own on storage.objects;
create policy tree_photos_delete_own
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'tree-photos' and (storage.foldername(name))[1] = auth.uid()::text);
