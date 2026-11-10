-- Minimal stand-ins for what a Supabase project provides before our migrations run:
-- the anon/authenticated roles, auth.users + auth.uid(), the storage schema, and the
-- supabase_realtime publication. Lets supabase/migrations run on plain Postgres for tests.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
-- Supabase Auth's own role: the sign-up inserts into auth.users as it (ARU-146 tests switch to it).
create role supabase_auth_admin nologin;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);

-- Same resolution order as Supabase's auth.uid().
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz default now(), -- as in Supabase (ARU-112's leftover sweep reads it)
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;

-- Supabase: folder parts of an object name ('a/b/c.jpg' -> {a,b}).
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;

create publication supabase_realtime;

-- Supabase's default grants: RLS, not table privileges, is what restricts access.
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema auth to supabase_auth_admin;
grant select, insert, update, delete on auth.users to supabase_auth_admin;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- pg_cron, pg_net and Vault (ARU-41): just enough for migrations that schedule a job. cron.schedule() stores the job
-- (replacing one of the same name, like pg_cron); net.http_post() records the request instead of sending it;
-- vault.decrypted_secrets is a plain table here.
create schema cron;
create table cron.job (
  jobid bigserial primary key,
  jobname text unique,
  schedule text not null,
  command text not null
);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;

create schema net;
create table net.requests (
  id bigserial primary key,
  url text,
  body jsonb,
  params jsonb,
  headers jsonb,
  timeout_milliseconds integer
);
create function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint language sql as $$
  insert into net.requests (url, body, params, headers, timeout_milliseconds)
  values (url, body, params, headers, timeout_milliseconds)
  returning id
$$;

create schema vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
