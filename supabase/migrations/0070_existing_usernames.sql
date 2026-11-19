-- ARU-168: no personal data at sign-in, part 2. Older accounts (no usernames row, made before ARU-164 or by an admin)
-- choose a username and a display name; then their real email and sign-up name are erased from Supabase Auth. After a
-- 60-day deadline a daily job does it for every remaining account, except teachers (criterion change, 19 Nov: a moved
-- teacher would have no recovery code and nobody to issue a reset code, so the teacher keeps the email until they
-- choose a username themselves).
--   1. app_settings.username_deadline: now() + 60 days, set once here.
--   2. move_to_username(user, username): the one move routine (AC 6). Sets auth.users.email to
--      <username>@users.sham.invalid and erases the old email and sign-up name from auth.users (pending email change,
--      email tokens, user metadata), auth.identities.identity_data, auth.audit_log_entries.payload and
--      auth.one_time_tokens. Sessions and refresh tokens are not touched, so nobody is signed out. Callers insert the
--      usernames row FIRST (ARU-175's auth_email_change_guard from 0067 allows the new address only then).
--   3. choose_username(username, display_name): the app's Save (AC 3, AC 7), own account only.
--   4. move_unclaimed_accounts(): the job (AC 8), run daily by pg_cron as postgres. Does nothing before the deadline.
-- The internal domain is also in 0067 and src/lib/username.ts (USERNAME_DOMAIN): keep them in step.
-- BEFORE running it: pg_cron must be on (Database -> Extensions; already on if 0035 / 0054 ran).
-- Changes no existing rows itself, except app_settings' new column.

do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'Turn on the pg_cron extension first (Database -> Extensions -> pg_cron), then run this again.';
  end if;
end $$;

-- 1. The deadline. app_settings is readable by approved accounts (0050); nobody in the app can change it.
alter table app_settings add column username_deadline timestamptz;
update app_settings set username_deadline = now() + interval '60 days';

-- 2. The move (AC 6). Security definer, owned by the migration's role (postgres), which may write in auth.
create function move_to_username(account uuid, uname text) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    new_email text := lower(uname) || '@users.sham.invalid';
    old_email text;
    pattern text;
  begin
    select u.email into old_email from auth.users u where u.id = account for update;
    if not found then
      raise exception 'User not found' using errcode = 'P0002', hint = 'sham:user_not_found';
    end if;
    -- The caller has inserted the usernames row already: for an app call, ARU-175's guard (0067) refuses the new
    -- address otherwise, and the whole call rolls back.

    -- auth.users: the internal address, no pending change or email token, no email or sign-up name in the metadata.
    -- Empty strings, not null: Supabase Auth reads these token columns as strings.
    update auth.users set
      email = new_email,
      email_change = '',
      email_change_token_new = '',
      email_change_token_current = '',
      email_change_confirm_status = 0,
      confirmation_token = '',
      recovery_token = '',
      reauthentication_token = '',
      raw_user_meta_data = (coalesce(raw_user_meta_data, '{}'::jsonb) - 'email' - 'full_name' - 'name')
        || jsonb_build_object('username', lower(uname))
    where id = account;

    -- auth.identities: only sub, the internal address and the verified flags stay (identities.email follows
    -- identity_data). An identity keyed by the old email gets the user id as its key, as Supabase does today.
    update auth.identities i set
      identity_data = jsonb_strip_nulls(jsonb_build_object(
        'sub', coalesce(i.identity_data -> 'sub', to_jsonb(account::text)),
        'email', new_email,
        'email_verified', i.identity_data -> 'email_verified',
        'phone_verified', i.identity_data -> 'phone_verified')),
      provider_id = case when old_email is not null and lower(i.provider_id) = lower(old_email) then account::text
                         else i.provider_id end
    where i.user_id = account;

    -- auth.audit_log_entries: this user's entries name the internal address (actor_username, traits.user_email), and
    -- the old email is replaced wherever else it appears (any letter case).
    update auth.audit_log_entries a set payload = (
        case when a.payload::jsonb ? 'actor_username' and a.payload::jsonb ->> 'actor_id' = account::text
             then jsonb_set(a.payload::jsonb, '{actor_username}', to_jsonb(new_email)) else a.payload::jsonb end
      )::json
    where a.payload::jsonb ->> 'actor_id' = account::text;
    update auth.audit_log_entries a set payload = jsonb_set(a.payload::jsonb, '{traits,user_email}', to_jsonb(new_email))::json
    where (a.payload::jsonb ->> 'actor_id' = account::text or a.payload::jsonb -> 'traits' ->> 'user_id' = account::text)
      and a.payload::jsonb -> 'traits' ? 'user_email';
    if coalesce(old_email, '') <> '' then
      pattern := regexp_replace(old_email, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g');
      update auth.audit_log_entries a set payload = regexp_replace(a.payload::text, pattern, new_email, 'gi')::json
      where a.payload::text ~* pattern;
    end if;

    -- auth.one_time_tokens: every row of this user (they hold the old email in relates_to).
    delete from auth.one_time_tokens t where t.user_id = account;
  end $$;
revoke execute on function move_to_username(uuid, text) from public, anon, authenticated, service_role;

-- 3. AC 3 / AC 7: the signed-in older account chooses its username and display name. Every refusal changes nothing
-- (it raises, so the transaction rolls back).
create function choose_username(username text, display_name text) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    me uuid := auth.uid();
    uname text := lower(regexp_replace(coalesce($1, ''), '^\s+|\s+$', '', 'g'));
    display text := trim_spaces(coalesce($2, ''));
  begin
    if me is null then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    -- One Save at a time per account (two devices): the second waits, then sees the row and gets already_set.
    perform 1 from profiles p where p.id = me for update;
    if not found then
      raise exception 'User not found' using errcode = 'P0002', hint = 'sham:user_not_found';
    end if;
    if exists (select 1 from usernames u where u.user_id = me) then
      raise exception 'This account already has a username.' using errcode = '23505', hint = 'sham:username_already_set';
    end if;
    if not username_is_valid(uname) then
      raise exception 'Username must be 3 to 30 characters: letters a-z, digits, _ . -; starting and ending with a letter or digit.'
        using errcode = '23514', hint = 'sham:username_invalid';
    end if;
    if display = '' or char_length(display) > 80 then
      raise exception 'Display name must be 1 to 80 characters.' using errcode = '23514', hint = 'sham:display_name_invalid';
    end if;
    if exists (select 1 from usernames u where u.username = uname)
       or exists (select 1 from auth.users a where lower(a.email) = uname || '@users.sham.invalid' and a.id <> me) then
      raise exception 'This username is taken. Try another one.' using errcode = '23505', hint = 'sham:username_taken';
    end if;

    begin
      insert into usernames (user_id, username) values (me, uname);
    exception when unique_violation then
      -- Taken by someone else between the check and the insert.
      raise exception 'This username is taken. Try another one.' using errcode = '23505', hint = 'sham:username_taken';
    end;
    update profiles set full_name = display where id = me;
    perform move_to_username(me, uname);
  end $$;
revoke execute on function choose_username(text, text) from public, anon, service_role;
grant execute on function choose_username(text, text) to authenticated;

-- 4. AC 8: after the deadline, every remaining older account that isn't a teacher gets user-xxxxxx (6 of a-z 0-9,
-- unique) and is moved. An email-like display name becomes that username. Idempotent: moved accounts have a
-- usernames row, so a second run finds nothing. Each account is moved on its own, so one failure doesn't stop the
-- others (it is reported as a warning and retried the next day). Returns how many accounts were moved.
create function move_unclaimed_accounts() returns integer
  language plpgsql security definer set search_path = public
  as $$
  declare
    deadline timestamptz := (select s.username_deadline from app_settings s limit 1);
    r record;
    uname text;
    moved integer := 0;
  begin
    if deadline is null or now() < deadline then
      return 0;
    end if;
    for r in
      select p.id, p.full_name from profiles p
      join auth.users a on a.id = p.id
      where p.role <> 'teacher'
        and not exists (select 1 from usernames u where u.user_id = p.id)
      order by p.created_at, p.id
    loop
      begin
        loop
          uname := 'user-' || (select string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789', 1 + floor(random() * 36)::int, 1), '')
                               from generate_series(1, 6));
          exit when not exists (select 1 from usernames u where u.username = uname)
            and not exists (select 1 from auth.users a where lower(a.email) = uname || '@users.sham.invalid');
        end loop;
        insert into usernames (user_id, username) values (r.id, uname);
        if position('@' in coalesce(r.full_name, '')) > 0 then
          update profiles set full_name = uname where id = r.id;
        end if;
        perform move_to_username(r.id, uname);
        moved := moved + 1;
      exception when others then
        raise warning 'move_unclaimed_accounts: account % not moved: % %', r.id, sqlstate, sqlerrm;
      end;
    end loop;
    return moved;
  end $$;
revoke execute on function move_unclaimed_accounts() from public, anon, authenticated, service_role;

-- Once a day at 02:43 UTC. pg_cron runs it as postgres (the guard lets postgres change any address). Re-running this
-- migration's line replaces the job.
select cron.schedule('username-deadline', '43 2 * * *', $job$select public.move_unclaimed_accounts()$job$);
