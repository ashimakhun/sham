-- ARU-72: new message counter for the general chat (0029), the same pattern as the course chats (ARU-31, 0016).
-- One read position per user: the server time of the newest general chat message they have seen. A "new" message is
-- one written by someone else after that position. Approved accounts only (is_approved(), 0021).
-- Run after 0032 (0032_accountant.sql, which it does not depend on). Adds a table, a trigger and three functions, and seeds a position for every approved account;
-- nothing existing is changed.

create table general_chat_reads (
  user_id uuid primary key references profiles (id) on delete cascade,
  last_read_at timestamptz not null
);

alter table general_chat_reads enable row level security;

-- Only your own row, and only while your account is approved. A declined account's row is kept (hidden while
-- declined), so being accepted again restores the earlier position.
create policy "own general chat position readable" on general_chat_reads for select to authenticated
  using (user_id = auth.uid() and is_approved());
create policy "own general chat position insertable" on general_chat_reads for insert to authenticated
  with check (user_id = auth.uid() and is_approved());
create policy "own general chat position updatable" on general_chat_reads for update to authenticated
  using (user_id = auth.uid() and is_approved())
  with check (user_id = auth.uid() and is_approved());
-- No delete policy.

-- Same guard as course_chat_reads_guard (0016): the device clock is never trusted (a future time is cut to the
-- server's now()), a position never moves backwards, and a row can't be moved to another user.
create function general_chat_reads_guard() returns trigger
  language plpgsql set search_path = public
  as $$
  begin
    new.last_read_at := least(new.last_read_at, now());
    if tg_op = 'UPDATE' then
      new.user_id := old.user_id;
      new.last_read_at := greatest(old.last_read_at, new.last_read_at);
    end if;
    return new;
  end $$;

create trigger general_chat_reads_guard before insert or update on general_chat_reads
  for each row execute function general_chat_reads_guard();

-- What the app calls while the general chat is open: marks everything up to `upto` (the newest message shown) as
-- read, using that message's server timestamp. Security invoker, so RLS on general_messages and general_chat_reads
-- applies as usual.
create function mark_general_chat_read(upto uuid) returns timestamptz
  language plpgsql security invoker set search_path = public
  as $$
  declare
    msg_at timestamptz;
    result timestamptz;
  begin
    if auth.uid() is null then
      raise exception 'Please sign in again.' using errcode = '42501';
    end if;
    if not is_approved() then
      raise exception 'Your account is not approved.' using errcode = '42501';
    end if;
    select created_at into msg_at from general_messages where id = upto;
    if msg_at is null then
      raise exception 'Message not found.' using errcode = 'P0002';
    end if;
    insert into general_chat_reads (user_id, last_read_at) values (auth.uid(), msg_at)
      on conflict (user_id) do update set last_read_at = excluded.last_read_at -- the trigger keeps the later
      returning last_read_at into result;
    return result;
  end $$;
revoke execute on function mark_general_chat_read(uuid) from public, anon;
grant execute on function mark_general_chat_read(uuid) to authenticated;

-- The caller's new-message count. Security invoker: general_messages RLS gives waiting / declined accounts nothing,
-- so they get 0. Own messages never count; with no position every message from others counts.
create function general_chat_unread_count() returns bigint
  language sql stable security invoker set search_path = public
  as $$
    select count(*)
    from general_messages m
    left join general_chat_reads r on r.user_id = auth.uid()
    where m.author_id <> auth.uid()
      and (r.last_read_at is null or m.created_at > r.last_read_at)
  $$;
revoke execute on function general_chat_unread_count() from public, anon;
grant execute on function general_chat_unread_count() to authenticated;

-- Release: every account already approved starts at "read up to now", so the general chat doesn't light up for
-- everyone. Accounts approved later have no row, so every message from others counts for them (AC 9). A function so
-- the DB tests can run the same seed; only the admin can call it. Existing rows are left alone.
create function seed_general_chat_reads() returns void
  language sql security definer set search_path = public
  as $$
    insert into general_chat_reads (user_id, last_read_at)
    select p.id, now() from profiles p where p.access_status = 'approved'
    on conflict do nothing
  $$;
revoke execute on function seed_general_chat_reads() from public, anon, authenticated;

select seed_general_chat_reads();
