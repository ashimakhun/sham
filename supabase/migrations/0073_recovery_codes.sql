-- ARU-165: password recovery without email, part 1. Each account with a username gets a personal recovery code; the
-- server keeps only its SHA-256 hash. Forgot password (signed out) takes username + recovery code + new password.
--   1. recovery_codes: one row per account (user_id → profiles, on delete cascade). code_hash, saved_at (null until
--      the person ticked "I saved it" and tapped Continue / Done), created_at. RLS on with no policies: signed-in
--      users keep only the SELECT grant every public table has (ARU-43's RLS sweep reads them all), which returns no
--      rows; no insert, update or delete, nothing for anon. The app reads only "do I have a saved code" through
--      my_recovery_code_saved().
--   2. recovery_attempts: wrong recovery attempts per lower-case username (also for usernames that don't exist).
--      5 wrong → locked for 15 minutes. RLS on, no policies (as above: no rows for anyone in the app). Each check first deletes rows whose lock has ended or
--      that weren't touched for a day. Deleting an account's usernames row deletes its attempts row.
--   3. For the signed-in person (authenticated): my_recovery_code_saved(), make_recovery_code() (refused when a
--      saved code exists, so replacing a saved code always needs the password), save_recovery_code(code) (refused when
--      the code shown isn't the current one).
--   4. For the Edge Functions only (service_role): replace_recovery_code(user) (new-recovery-code, after its password
--      check), recovery_check(username, code) and recovery_finish(user) (recover-password). recovery_finish ends
--      every session of the account by deleting its auth.sessions rows (their refresh tokens go with them, Supabase's
--      own cascade). ARU-167's clear_session_ip trigger is before insert or update only, so deletes are unaffected.
-- The code: 16 characters of ABCDEFGHJKMNPQRSTUVWXYZ23456789 (≈79 bits), from gen_random_uuid()'s random bytes
-- (pg_strong_random, a cryptographic source; core Postgres, so no pgcrypto / extensions schema is needed), shown
-- as XXXX-XXXX-XXXX-XXXX. Typed codes ignore letter case, spaces and dashes. Hash: core sha256().
-- Changes no existing rows.

-- 1. Codes.
create table recovery_codes (
  user_id uuid primary key references profiles (id) on delete cascade,
  code_hash text not null,
  saved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table recovery_codes enable row level security;
revoke all on recovery_codes from public, anon, authenticated;
grant select on recovery_codes to authenticated; -- no policy: always no rows

-- 2. Attempts.
create table recovery_attempts (
  username text primary key,
  failures integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table recovery_attempts enable row level security;
revoke all on recovery_attempts from public, anon, authenticated;
grant select on recovery_attempts to authenticated; -- no policy: always no rows

-- Account deleted (ARU-75) or its username row removed: its lock row goes too.
create function recovery_attempts_forget() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  begin
    delete from recovery_attempts a where a.username = old.username;
    return old;
  end $$;
revoke execute on function recovery_attempts_forget() from public, anon, authenticated, service_role;
create trigger recovery_attempts_forget after delete on usernames
  for each row execute function recovery_attempts_forget();

-- Internal helpers: a new code (formatted), and the hash of a typed code.
create function recovery_code_generate() returns text
  language plpgsql volatile set search_path = public
  as $$
  declare
    alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- 31 characters, no 0 O 1 I L
    raw bytea;
    b integer;
    code text := '';
  begin
    while char_length(code) < 16 loop
      raw := uuid_send(gen_random_uuid());
      -- Bytes 6 and 8 carry the UUID version / variant bits; the other 14 are random.
      for i in 0..15 loop
        continue when i in (6, 8);
        b := get_byte(raw, i);
        -- 248 = 8 × 31: rejecting 248..255 keeps every character equally likely.
        continue when b >= 248;
        code := code || substr(alphabet, 1 + b % 31, 1);
        exit when char_length(code) = 16;
      end loop;
    end loop;
    return substr(code, 1, 4) || '-' || substr(code, 5, 4) || '-' || substr(code, 9, 4) || '-' || substr(code, 13, 4);
  end $$;
revoke execute on function recovery_code_generate() from public, anon, authenticated, service_role;

create function recovery_code_hash(code text) returns text
  language sql immutable set search_path = public
  as $$
    select encode(sha256(convert_to(upper(regexp_replace(coalesce(code, ''), '[\s-]', '', 'g')), 'UTF8')), 'hex')
  $$;
revoke execute on function recovery_code_hash(text) from public, anon, authenticated, service_role;

-- Stores a new unsaved code for the account (replacing any older one) and returns it. Internal.
create function recovery_code_store(account uuid) returns text
  language plpgsql security definer set search_path = public
  as $$
  declare
    code text := recovery_code_generate();
  begin
    insert into recovery_codes (user_id, code_hash, saved_at, created_at)
      values (account, recovery_code_hash(code), null, now())
      on conflict (user_id) do update set code_hash = excluded.code_hash, saved_at = null, created_at = now();
    return code;
  end $$;
revoke execute on function recovery_code_store(uuid) from public, anon, authenticated, service_role;

-- 3. The signed-in person.

-- AC 1 / AC 3: whether the own account has a saved code (false also when it has no code at all).
create function my_recovery_code_saved() returns boolean
  language sql stable security definer set search_path = public
  as $$
    select exists (select 1 from recovery_codes c where c.user_id = auth.uid() and c.saved_at is not null)
  $$;
revoke execute on function my_recovery_code_saved() from public, anon, service_role;
grant execute on function my_recovery_code_saved() to authenticated;

-- AC 1 / AC 4: a fresh code for the Save your recovery code screen. Any unsaved code stops working. Refused when the
-- account has a saved code (a stolen session can't replace it without the password) or no username.
create function make_recovery_code() returns text
  language plpgsql security definer set search_path = public
  as $$
  declare
    me uuid := auth.uid();
  begin
    if me is null then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    -- One at a time per account (two devices).
    perform 1 from profiles p where p.id = me for update;
    if not found then
      raise exception 'User not found' using errcode = 'P0002', hint = 'sham:user_not_found';
    end if;
    if not exists (select 1 from usernames u where u.user_id = me) then
      raise exception 'Choose a username first.' using errcode = '42501', hint = 'sham:recovery_needs_username';
    end if;
    if exists (select 1 from recovery_codes c where c.user_id = me and c.saved_at is not null) then
      raise exception 'Your recovery code is already saved. Make a new one in Profile.'
        using errcode = '42501', hint = 'sham:recovery_code_saved';
    end if;
    return recovery_code_store(me);
  end $$;
revoke execute on function make_recovery_code() from public, anon, service_role;
grant execute on function make_recovery_code() to authenticated;

-- AC 3 / AC 7: marks the code shown on screen saved. Refused when it isn't the account's current code (an older
-- screen on another device), so the app shows a fresh one instead. Saving the current code again is fine.
create function save_recovery_code(code text) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    me uuid := auth.uid();
    n integer;
  begin
    if me is null then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    update recovery_codes c set saved_at = coalesce(c.saved_at, now())
      where c.user_id = me and c.code_hash = recovery_code_hash($1);
    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'This recovery code was replaced. Save the new one.'
        using errcode = '22023', hint = 'sham:recovery_code_replaced';
    end if;
  end $$;
revoke execute on function save_recovery_code(text) from public, anon, service_role;
grant execute on function save_recovery_code(text) to authenticated;

-- 4. Edge Functions only.

-- AC 7: new-recovery-code, after it checked the password. The old code stops working at once.
create function replace_recovery_code(account uuid) returns text
  language plpgsql security definer set search_path = public
  as $$
  begin
    perform 1 from profiles p where p.id = account for update;
    if not found then
      raise exception 'User not found' using errcode = 'P0002', hint = 'sham:user_not_found';
    end if;
    if not exists (select 1 from usernames u where u.user_id = account) then
      raise exception 'Choose a username first.' using errcode = '42501', hint = 'sham:recovery_needs_username';
    end if;
    return recovery_code_store(account);
  end $$;
revoke execute on function replace_recovery_code(uuid) from public, anon, authenticated;
grant execute on function replace_recovery_code(uuid) to service_role;

-- AC 9–11: checks a recovery attempt. result: 'ok' (user_id set; nothing changed yet: recover-password sets the
-- password, then calls recovery_finish), 'wrong' (counted) or 'locked' (not counted, nothing checked). An unknown
-- username does the same work and counts the same as a wrong code.
create function recovery_check(username text, code text)
  returns table (result text, user_id uuid)
  language plpgsql security definer set search_path = public
  as $$
  declare
    uname text := lower(regexp_replace(coalesce($1, ''), '^\s+|\s+$', '', 'g'));
    attempt recovery_attempts%rowtype;
    account uuid;
    matches boolean;
  begin
    -- Expired locks and rows untouched for a day go first (unknown usernames are counted too).
    delete from recovery_attempts a
      where (a.locked_until is not null and a.locked_until <= now()) or a.updated_at < now() - interval '1 day';

    insert into recovery_attempts (username) values (uname) on conflict on constraint recovery_attempts_pkey do nothing;
    select * into attempt from recovery_attempts a where a.username = uname for update;
    if attempt.locked_until is not null and attempt.locked_until > now() then
      return query select 'locked'::text, null::uuid;
      return;
    end if;

    select u.user_id into account from usernames u where u.username = uname;
    select exists (
      select 1 from recovery_codes c where c.user_id = account and c.code_hash = recovery_code_hash($2)
    ) into matches;
    if account is not null and matches then
      return query select 'ok'::text, account;
      return;
    end if;

    update recovery_attempts a set
      failures = a.failures + 1,
      locked_until = case when a.failures + 1 >= 5 then now() + interval '15 minutes' end,
      updated_at = now()
    where a.username = uname;
    return query select 'wrong'::text, null::uuid;
  end $$;
revoke execute on function recovery_check(text, text) from public, anon, authenticated;
grant execute on function recovery_check(text, text) to service_role;

-- AC 9: after the new password is set. The used code stops working (no code until the Save screen makes one), every
-- session of the account ends (refresh tokens cascade), and the attempt count is reset.
create function recovery_finish(account uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    delete from recovery_codes c where c.user_id = account;
    delete from auth.sessions s where s.user_id = account;
    delete from recovery_attempts a where a.username = (select u.username from usernames u where u.user_id = account);
  end $$;
revoke execute on function recovery_finish(uuid) from public, anon, authenticated;
grant execute on function recovery_finish(uuid) to service_role;
