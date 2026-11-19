-- ARU-164: no personal data at sign-in, part 1. New accounts sign up and sign in with a username and a display name;
-- no email, no full name. Existing accounts keep their email until part 2 (ARU-168).
--   1. usernames: one row per account that has a username (user_id → profiles, on delete cascade, so deleting an
--      account frees its username). Lower case, 3–30 characters of a–z 0–9 _ . -, starting and ending with a letter
--      or digit, no "..". Unique. A table of its own, not a column on profiles: every workspace member reads all
--      profiles, and a username is half of a sign-in. RLS: each account reads its own row only; nobody in the app
--      inserts, updates or deletes (the sign-up trigger writes it as security definer).
--   2. handle_new_user() (latest from 0060, every rule kept) also reads `username` and `full_name` from the sign-up's
--      user data:
--        * no username: refused with sham:signup_update_app (an older app, AC 5 / analysis note 2);
--        * a username that breaks the rules: sham:username_invalid;
--        * an Auth address other than <username>@users.sham.invalid: sham:signup_email_mismatch (analysis note 1),
--          so a direct API call can't store a real email or a username that doesn't match its address;
--        * a display name blank or over 80 characters: sham:display_name_invalid;
--        * a username already taken: sham:username_taken (Auth's unique address normally answers first).
--      The display name no longer falls back to the email. Only an admin (SQL Editor: session user postgres or
--      supabase_admin) may still add an auth user without a username, as in 0060.
--   3. access_requests() returns `username` instead of `email` (same rules as 0059), so no function returns an email.
-- The internal domain is also in src/lib/username.ts (USERNAME_DOMAIN): keep both in step.
-- Supabase: Authentication → Email → Confirm email must be OFF (README → Setup) before this is applied.
-- Deletes no data. Existing accounts get no usernames row.

-- 1. Usernames.
create table usernames (
  user_id uuid primary key references profiles (id) on delete cascade,
  username text not null unique
    check (username ~ '^[a-z0-9][a-z0-9_.-]{1,28}[a-z0-9]$' and position('..' in username) = 0)
);
alter table usernames enable row level security;
revoke insert, update, delete, truncate, references, trigger on usernames from public, anon, authenticated;
revoke select on usernames from public, anon;
grant select on usernames to authenticated;
create policy "read own username" on usernames for select to authenticated using (user_id = auth.uid());

-- True for a valid username (already lower case).
create function username_is_valid(name text) returns boolean
  language sql immutable set search_path = public
  as $$
    select coalesce(name ~ '^[a-z0-9][a-z0-9_.-]{1,28}[a-z0-9]$' and position('..' in name) = 0, false)
  $$;
revoke execute on function username_is_valid(text) from public, anon, authenticated;

-- 2. Sign-up: username, display name, then create or join a workspace (0060).
create or replace function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    ws_name text := meta ->> 'workspace_name';
    invite text := meta ->> 'invite_code';
    uname text := lower(regexp_replace(coalesce(meta ->> 'username', ''), '^\s+|\s+$', '', 'g'));
    display text := regexp_replace(coalesce(meta ->> 'full_name', ''), '^\s+|\s+$', '', 'g');
    is_admin boolean := session_user in ('postgres', 'supabase_admin');
    ws uuid;
    creates boolean := false;
  begin
    if uname = '' then
      if not is_admin then
        raise exception 'Update the app to create an account.' using errcode = '22023', hint = 'sham:signup_update_app';
      end if;
    else
      if not username_is_valid(uname) then
        raise exception 'Username must be 3 to 30 characters: letters a-z, digits, _ . -; starting and ending with a letter or digit.'
          using errcode = '23514', hint = 'sham:username_invalid';
      end if;
      if not is_admin and lower(coalesce(new.email, '')) <> uname || '@users.sham.invalid' then
        raise exception 'Create your account in the app with a username.' using errcode = '22023', hint = 'sham:signup_email_mismatch';
      end if;
      if exists (select 1 from usernames u where u.username = uname) then
        raise exception 'This username is taken. Try another one.' using errcode = '23505', hint = 'sham:username_taken';
      end if;
    end if;
    if (not is_admin or uname <> '') and (display = '' or char_length(display) > 80) then
      raise exception 'Display name must be 1 to 80 characters.' using errcode = '23514', hint = 'sham:display_name_invalid';
    end if;

    if ws_name is not null and invite is not null then
      raise exception 'Update the app to create an account.' using errcode = '22023', hint = 'sham:signup_update_app';
    elsif ws_name is not null then
      ws_name := regexp_replace(ws_name, '^\s+|\s+$', '', 'g');
      if char_length(ws_name) not between 1 and 80 then
        raise exception 'Workspace name must be 1 to 80 characters.' using errcode = '23514', hint = 'sham:workspace_name_length';
      end if;
      insert into workspaces (name) values (ws_name) returning id into ws;
      creates := true;
    elsif invite is not null then
      select c.workspace into ws from workspace_invite_codes c
        where c.code = upper(regexp_replace(invite, '^\s+|\s+$', '', 'g'));
      if ws is null then
        raise exception 'No workspace has this invite code.' using errcode = 'P0002', hint = 'sham:invite_code_unknown';
      end if;
    elsif is_admin then
      ws := signup_workspace();
    else
      raise exception 'Update the app to create an account.' using errcode = '22023', hint = 'sham:signup_update_app';
    end if;

    insert into profiles (id, full_name, workspace_id, role, access_status)
    values (
      new.id,
      -- An admin insert without a username keeps the name as given (0026: blank allowed), never the email.
      case when uname = '' then coalesce(meta ->> 'full_name', '') else display end,
      ws,
      case when creates then 'teacher' else 'student' end::user_role,
      case when creates then 'approved' else 'pending' end::access_status
    );
    if uname <> '' then
      insert into usernames (user_id, username) values (new.id, uname);
    end if;
    return new;
  end $$;
-- As after 0063: only its trigger runs it.
revoke execute on function handle_new_user() from public, anon, authenticated;

-- 3. AC 11: access requests show the username, never an email. The return type changes, so drop and recreate.
drop function access_requests();
create function access_requests()
  returns table (id uuid, full_name text, username text, created_at timestamptz, access_status access_status)
  language plpgsql stable security definer set search_path = public
  as $$
  begin
    if my_role() is distinct from 'teacher' then
      raise exception 'Only the teacher can see requests.' using errcode = '42501', hint = 'sham:only_teacher_requests';
    end if;
    return query
      select p.id, p.full_name, u.username, p.created_at, p.access_status
      from profiles p
      left join usernames u on u.user_id = p.id
      where p.access_status <> 'approved'
        and p.workspace_id = my_workspace()
      order by p.created_at, p.id;
  end $$;
revoke execute on function access_requests() from public, anon;
grant execute on function access_requests() to authenticated;
