-- ARU-189: the Create account form's Language switch. The language picked there travels in the sign-up's user data
-- (`language`, only when the switch was touched) and is saved on the new account in the same step, so a student who
-- joins with an invite code (pending, can't update their own profile: my_role() is null, 0021 / 0078) gets it too.
--   handle_new_user() (latest from 0075, every rule kept: username, display name, terms_version → legal_agreements,
--   workspace create / join) also stores `language` in profiles.language when it is exactly 'en' or 'ru'. Any other
--   value, or none, is ignored and stored as null (the phone's language); the sign-up is never refused for it.
-- No table, column, policy or grant changes; changes no existing rows. profiles.language keeps its check (0051).

-- Sign-up: the language too (0075 otherwise unchanged).
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
    -- ARU-189: the language picked on the Create account form. Named lang, not language, so it can't be mistaken for
    -- the profiles.language column (analysis note 3).
    lang text := meta ->> 'language';
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

    insert into profiles (id, full_name, workspace_id, role, access_status, language)
    values (
      new.id,
      -- An admin insert without a username keeps the name as given (0026: blank allowed), never the email.
      case when uname = '' then coalesce(meta ->> 'full_name', '') else display end,
      ws,
      case when creates then 'teacher' else 'student' end::user_role,
      case when creates then 'approved' else 'pending' end::access_status,
      -- ARU-189: exactly 'en' or 'ru' is saved; anything else, or nothing (an older app), is ignored (null: follow the
      -- phone). Never refuses the sign-up.
      case when lang in ('en', 'ru') then lang else null end
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
