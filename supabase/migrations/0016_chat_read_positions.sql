-- New message counter for course chats (ARU-31). One read position per (course, user): the server time of the newest
-- message the user has seen in that chat. A "new" message is one written by someone else after that position.
-- Run after 0014_homework_assignments.sql (and 0015 from ARU-36, which it doesn't depend on). Adds a table, a trigger
-- and two functions, and seeds read positions for everyone already in a chat; nothing existing is changed.

create table course_chat_reads (
  course_id uuid not null references courses (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  last_read_at timestamptz not null,
  primary key (course_id, user_id)
);

alter table course_chat_reads enable row level security;

-- Only your own rows, and only for chats you are in (in_course_chat(), 0006). A removed listener's row is kept (hidden
-- while they're out), so being added back restores their earlier position.
create policy "own read positions readable" on course_chat_reads for select to authenticated
  using (user_id = auth.uid() and in_course_chat(course_id));
create policy "own read positions insertable" on course_chat_reads for insert to authenticated
  with check (user_id = auth.uid() and in_course_chat(course_id));
create policy "own read positions updatable" on course_chat_reads for update to authenticated
  using (user_id = auth.uid() and in_course_chat(course_id))
  with check (user_id = auth.uid() and in_course_chat(course_id));
-- No delete policy.

-- The device clock is never trusted and a position never moves backwards: a time in the future is cut to the server's
-- now(), and an update keeps the later of the old and new values. Rows can't be moved to another course or user.
create function course_chat_reads_guard() returns trigger
  language plpgsql set search_path = public
  as $$
  begin
    new.last_read_at := least(new.last_read_at, now());
    if tg_op = 'UPDATE' then
      new.course_id := old.course_id;
      new.user_id := old.user_id;
      new.last_read_at := greatest(old.last_read_at, new.last_read_at);
    end if;
    return new;
  end $$;

create trigger course_chat_reads_guard before insert or update on course_chat_reads
  for each row execute function course_chat_reads_guard();

-- What the app calls when a chat is open: marks everything up to `upto` (the newest message shown) as read, using that
-- message's server timestamp. Security invoker, so RLS on course_messages and course_chat_reads applies as usual.
create function mark_chat_read(course uuid, upto uuid) returns timestamptz
  language plpgsql security invoker set search_path = public
  as $$
  declare
    msg_at timestamptz;
    result timestamptz;
  begin
    if auth.uid() is null then
      raise exception 'Please sign in again.' using errcode = '42501';
    end if;
    if not in_course_chat(course) then
      raise exception 'You are not in this course chat.' using errcode = '42501';
    end if;
    select created_at into msg_at from course_messages where id = upto and course_id = course;
    if msg_at is null then
      raise exception 'Message not found.' using errcode = 'P0002';
    end if;
    insert into course_chat_reads (course_id, user_id, last_read_at) values (course, auth.uid(), msg_at)
      on conflict (course_id, user_id) do update set last_read_at = excluded.last_read_at -- the trigger keeps the later
      returning last_read_at into result;
    return result;
  end $$;
revoke execute on function mark_chat_read(uuid, uuid) from public, anon;
grant execute on function mark_chat_read(uuid, uuid) to authenticated;

-- New-message counts for every chat the caller is in, in one request. Security invoker: course_messages RLS limits it
-- to chats the caller can read. Own messages never count; with no read position every message from others counts.
-- Courses with 0 new messages are left out.
create function chat_unread_counts() returns table (course_id uuid, unread bigint)
  language sql stable security invoker set search_path = public
  as $$
    select m.course_id, count(*)
    from course_messages m
    left join course_chat_reads r on r.course_id = m.course_id and r.user_id = auth.uid()
    where m.author_id <> auth.uid()
      and (r.last_read_at is null or m.created_at > r.last_read_at)
    group by m.course_id
  $$;
revoke execute on function chat_unread_counts() from public, anon;
grant execute on function chat_unread_counts() to authenticated;

-- Release: everyone already in a chat starts at "read up to now", so existing chats don't light up for everyone.
-- People added later (and new teacher accounts) have no row, so every message from others counts for them (AC 10).
-- A function so the DB tests can run the same seed on their fixture; only the admin can call it. Existing rows are
-- left alone, so running it again changes nothing for people who already have a position.
create function seed_course_chat_reads() returns void
  language sql security definer set search_path = public
  as $$
    insert into course_chat_reads (course_id, user_id, last_read_at)
    select c.id, p.id, now()
    from courses c
    join profiles p
      on p.role = 'teacher'
      or p.id = c.created_by
      or exists (select 1 from course_members cm where cm.course_id = c.id and cm.user_id = p.id)
    on conflict do nothing
  $$;
revoke execute on function seed_course_chat_reads() from public, anon, authenticated;

select seed_course_chat_reads();
