-- ARU-169: password recovery, part 2. The teacher makes a one-time reset code for an accepted student or mentor of
-- their own workspace who lost both their password and their recovery code. The person types it on part 1's Forgot
-- password screen instead of a recovery code (same field, same lock, same message on every failure).
--   1. reset_codes: at most one per account (user_id → profiles, on delete cascade). Only the SHA-256 hash and the
--      expiry (24 hours, server time) are stored. RLS on with no policies: signed-in users keep only the SELECT grant
--      every public table has (ARU-43's RLS sweep reads them all), which returns no rows; nothing else for anyone.
--   2. make_reset_code(target) (teacher, authenticated): returns the plain code once with its expiry. A new code
--      replaces the old one. Refusals, in this order, each changing nothing: not the teacher (only_teacher_reset_code);
--      no such account or another workspace (user_not_found); own account or not a student/mentor
--      (reset_code_students_mentors); waiting or declined (accept_first); no username yet (reset_code_no_username).
--   3. workspace_usernames() (teacher, authenticated): user_id + username of the accepted accounts in the teacher's
--      workspace, for Manage roles. Anyone else gets no rows; usernames' own RLS is unchanged (own row only).
--   4. recovery_check (part 1, service_role) also accepts a valid, unexpired reset code for that username. Shared
--      lock: one check per attempt, a wrong code counts once whichever kind was typed. recovery_finish also deletes
--      the account's reset code, so any successful recovery (either kind) ends a pending reset code (AC 6, AC 8); the
--      old recovery code goes too, as before, so the Save your recovery code screen follows.
-- The recover-password Edge Function is unchanged: it calls these two functions.
-- Changes no existing rows.

-- 1. Codes.
create table reset_codes (
  user_id uuid primary key references profiles (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table reset_codes enable row level security;
revoke all on reset_codes from public, anon, authenticated;
grant select on reset_codes to authenticated; -- no policy: always no rows

-- 2. The teacher makes a code.
create function make_reset_code(target uuid)
  returns table (code text, expires_at timestamptz)
  language plpgsql security definer set search_path = public
  as $$
  declare
    p profiles%rowtype;
    plain text;
    expiry timestamptz := now() + interval '24 hours';
  begin
    if my_role() is distinct from 'teacher' then
      raise exception 'Only the teacher can make reset codes.' using errcode = '42501', hint = 'sham:only_teacher_reset_code';
    end if;
    -- Locks the person's profile: two devices of the teacher leave only the newest code.
    select * into p from profiles where id = target for update;
    if not found or p.workspace_id is distinct from my_workspace() then
      raise exception 'User not found' using errcode = 'P0002', hint = 'sham:user_not_found';
    end if;
    if p.id = auth.uid() or p.role not in ('student', 'mentor') then
      raise exception 'Reset codes can be made only for students and mentors.'
        using errcode = '42501', hint = 'sham:reset_code_students_mentors';
    end if;
    if p.access_status <> 'approved' then
      raise exception 'Accept % first.', p.full_name using errcode = '23514', hint = 'sham:accept_first',
        detail = json_build_object('name', p.full_name)::text;
    end if;
    if not exists (select 1 from usernames u where u.user_id = p.id) then
      raise exception '% has no username yet. They need to sign in and choose one first.', p.full_name
        using errcode = '23514', hint = 'sham:reset_code_no_username', detail = json_build_object('name', p.full_name)::text;
    end if;

    plain := recovery_code_generate();
    insert into reset_codes (user_id, code_hash, expires_at, created_by, created_at)
      values (p.id, recovery_code_hash(plain), expiry, auth.uid(), now())
      on conflict (user_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at,
        created_by = excluded.created_by, created_at = excluded.created_at;
    return query select plain, expiry;
  end $$;
revoke execute on function make_reset_code(uuid) from public, anon, service_role;
grant execute on function make_reset_code(uuid) to authenticated;

-- 3. Usernames for the teacher's Manage roles.
create function workspace_usernames()
  returns table (user_id uuid, username text)
  language sql stable security definer set search_path = public
  as $$
    select u.user_id, u.username
    from usernames u
    join profiles p on p.id = u.user_id
    where my_role() = 'teacher'
      and p.workspace_id = my_workspace()
      and p.access_status = 'approved'
    order by u.username
  $$;
revoke execute on function workspace_usernames() from public, anon, service_role;
grant execute on function workspace_usernames() to authenticated;

-- 4. Part 1's check and finish, now also for reset codes. Same signature and results as 0073.
create or replace function recovery_check(username text, code text)
  returns table (result text, user_id uuid)
  language plpgsql security definer set search_path = public
  as $$
  declare
    uname text := lower(regexp_replace(coalesce($1, ''), '^\s+|\s+$', '', 'g'));
    typed text := recovery_code_hash($2);
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

    -- Both kinds are always looked up, so a wrong code takes the same work whichever kind it was meant to be.
    select u.user_id into account from usernames u where u.username = uname;
    select exists (select 1 from recovery_codes c where c.user_id = account and c.code_hash = typed)
        or exists (select 1 from reset_codes r where r.user_id = account and r.code_hash = typed and r.expires_at > now())
      into matches;
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

create or replace function recovery_finish(account uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    delete from recovery_codes c where c.user_id = account;
    delete from reset_codes r where r.user_id = account;
    delete from auth.sessions s where s.user_id = account;
    delete from recovery_attempts a where a.username = (select u.username from usernames u where u.user_id = account);
  end $$;
revoke execute on function recovery_finish(uuid) from public, anon, authenticated;
grant execute on function recovery_finish(uuid) to service_role;
