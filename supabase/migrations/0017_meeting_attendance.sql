-- Meeting attendance (ARU-33): a listener of a course marks that they attended a Completed meeting, and can undo it.
-- The course owner, the teacher and mentors see who attended. Run after 0016_chat_read_positions.sql (needs
-- course_meetings from 0010 and is_member() from 0004). Adds a table and two functions; nothing is deleted.

create table meeting_attendance (
  meeting_id uuid not null references course_meetings (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  marked_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);

alter table meeting_attendance enable row level security;

-- See: your own marks; the teacher and every mentor see all (like homework in 0005 and meetings in 0010). Mentor
-- listeners are hidden from others' marks in the app only. Marks of removed listeners stay stored and count again
-- if they are added back.
create policy "attendance readable" on meeting_attendance for select to authenticated
  using (user_id = auth.uid() or my_role() in ('teacher', 'mentor'));

-- No insert, update or delete policy: marks change only through mark_attendance() / unmark_attendance() below,
-- which give readable errors and only ever act on the caller's own mark.

-- Marks the caller as attended. Checks in this order: the meeting exists, the caller is a listener of its course,
-- the meeting is Completed. Marking again is a no-op, so a double tap or a retry never creates two marks.
create function mark_attendance(meeting uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
  begin
    select * into m from course_meetings where id = meeting;
    if not found then
      raise exception 'Meeting not found.' using errcode = 'P0002';
    end if;
    if not is_member(m.course_id) then
      raise exception 'Only listeners of this course can mark attendance.' using errcode = '42501';
    end if;
    if m.status <> 'completed' then
      raise exception 'Attendance can be marked only for completed meetings.' using errcode = '23514';
    end if;
    insert into meeting_attendance (meeting_id, user_id) values (meeting, auth.uid())
      on conflict (meeting_id, user_id) do nothing;
  end $$;
revoke execute on function mark_attendance(uuid) from public, anon;
grant execute on function mark_attendance(uuid) to authenticated;

-- Removes the caller's own mark (no-op if there is none). A removed listener can't undo: their mark stays.
create function unmark_attendance(meeting uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
  begin
    select * into m from course_meetings where id = meeting;
    if not found then
      raise exception 'Meeting not found.' using errcode = 'P0002';
    end if;
    if not is_member(m.course_id) then
      raise exception 'Only listeners of this course can mark attendance.' using errcode = '42501';
    end if;
    delete from meeting_attendance where meeting_id = meeting and user_id = auth.uid();
  end $$;
revoke execute on function unmark_attendance(uuid) from public, anon;
grant execute on function unmark_attendance(uuid) to authenticated;

-- Live updates (RLS still applies to realtime; the app reloads on any event, so DELETE payloads with only the key
-- are fine).
alter publication supabase_realtime add table meeting_attendance;
