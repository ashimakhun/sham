-- ARU-159: Privacy Policy and Terms of Use. The database records which version of the two documents (one number for
-- both, src/lib/legal.ts LEGAL_VERSION) each account agreed to, and when (server time).
--   1. legal_agreements: id, user_id (→ profiles, on delete cascade, so deleting an account (ARU-75) removes its
--      agreements), version (whole number >= 1), agreed_at (server time); unique (user_id, version). A table of its
--      own, not a column on profiles: every workspace member reads all profiles. RLS: each account reads its own rows
--      only (nobody, the teacher included, reads anyone else's). No insert, update or delete from the app: rows are
--      written only by handle_new_user() and agree_to_terms(), both security definer. Not workspace-scoped data that
--      others read, so no workspace_id and no workspace_guard() (analysis note 4). Not in the realtime publication.
--   2. handle_new_user() (latest from 0067, every rule kept) also reads `terms_version` from the sign-up's user data.
--      It must be a whole number >= 1, else the sign-up is refused with sham:signup_update_app (as a missing workspace
--      choice), so no account is created. The agreement is inserted with agreed_at = now(). Only an admin (SQL Editor:
--      session user postgres or supabase_admin) may still add an auth user without it, as in 0060.
--   3. agree_to_terms(version): for the signed-in person (any access status), saves their agreement to that version
--      (no-op when it exists); a version < 1 is refused (sham:terms_version_invalid). Not for public or anon.
-- Deletes no data and changes no existing rows. Existing accounts have no agreement, so the app asks them once (AC 8).

-- 1. Agreements.
create table legal_agreements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  version integer not null check (version >= 1),
  agreed_at timestamptz not null default now(),
  unique (user_id, version)
);
alter table legal_agreements enable row level security;
revoke all on legal_agreements from public, anon, authenticated;
grant select on legal_agreements to authenticated;
create policy "read own agreements" on legal_agreements for select to authenticated using (user_id = auth.uid());

-- 2. Sign-up: the agreement too (0067 otherwise unchanged).
create or replace function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    ws_name text := meta ->> 'workspace_name';
    invite text := meta ->> 'invite_code';
    uname text := lower(regexp_replace(coalesce(meta ->> 'username', ''), '^\s+|\s+$', '', 'g'));
    -- ARU-174: trim_spaces() (0031, as Edit name since ARU-56) also strips no-break and other Unicode spaces, which
    -- \s doesn't match under the database's character class, so a name of only those spaces counts as blank.
    display text := trim_spaces(coalesce(meta ->> 'full_name', ''));
    is_admin boolean := session_user in ('postgres', 'supabase_admin');
    -- ARU-159: the version of the Privacy Policy and Terms of Use agreed to at sign-up (src/lib/legal.ts).
    terms text := btrim(coalesce(meta ->> 'terms_version', ''));
    ws uuid;
    creates boolean := false;
  begin
    -- ARU-159 AC 5: every sign-up from the app agrees to a version: a whole number >= 1. Missing or anything else is
    -- refused like a missing workspace choice (an older app, a direct Auth API call). Admins may still omit it (0060).
    if terms = '' then
      if not is_admin then
        raise exception 'Update the app to create an account.' using errcode = '22023', hint = 'sham:signup_update_app';
      end if;
    elsif terms !~ '^[0-9]{1,9}$' or terms::integer < 1 then
      raise exception 'Update the app to create an account.' using errcode = '22023', hint = 'sham:signup_update_app';
    end if;

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
    -- ARU-159 AC 5: the agreement, in the same step as the account (also with email confirmation on).
    if terms <> '' then
      insert into legal_agreements (user_id, version, agreed_at) values (new.id, terms::integer, now());
    end if;
    return new;
  end $$;
-- As after 0063: only its trigger runs it.
revoke execute on function handle_new_user() from public, anon, authenticated;

-- 3. AC 9: agree to a new version (the "We've updated our Terms" screen). Server time; a second call is a no-op.
create function agree_to_terms(version integer) returns void
  language plpgsql security definer set search_path = public
  as $$
  #variable_conflict use_column
  declare
    me uuid := auth.uid();
  begin
    if me is null then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    if agree_to_terms.version is null or agree_to_terms.version < 1 then
      raise exception 'Update the app to agree to the terms.' using errcode = '22023', hint = 'sham:terms_version_invalid';
    end if;
    insert into legal_agreements (user_id, version, agreed_at)
      values (me, agree_to_terms.version, now())
      on conflict (user_id, version) do nothing;
  end $$;
revoke execute on function agree_to_terms(integer) from public, anon;
grant execute on function agree_to_terms(integer) to authenticated;
