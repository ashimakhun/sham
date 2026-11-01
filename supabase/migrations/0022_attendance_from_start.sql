-- Attendance from the start (ARU-45): listeners mark (and undo) their attendance as soon as a meeting has started,
-- not only once it is Completed. A meeting is "open for attendance" when its start time has passed (database clock)
-- and it isn't Canceled. Run after 0019_hidden_courses.sql (these are its versions of the two functions, with the
-- hidden-course check kept) and 0020/0021 if present; it doesn't depend on them.
-- Replaces two functions only: no table, policy or grant change, and nothing is deleted (marks on a meeting that
-- is later canceled or rescheduled stay stored; they just can't be changed while it isn't open).
-- Checks, in order: the meeting exists (and its course is visible), the caller is a listener, not canceled, started.

create or replace function mark_attendance(meeting uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
  begin
    select * into m from course_meetings where id = meeting;
    if not found or course_hidden_from_me(m.course_id) then
      raise exception 'Meeting not found.' using errcode = 'P0002';
    end if;
    if not is_member(m.course_id) then
      raise exception 'Only listeners of this course can mark attendance.' using errcode = '42501';
    end if;
    if m.status = 'canceled' then
      raise exception 'Attendance can''t be changed for a canceled meeting.' using errcode = '23514';
    end if;
    if m.starts_at > now() then
      raise exception 'Attendance can be marked once the meeting has started.' using errcode = '23514';
    end if;
    insert into meeting_attendance (meeting_id, user_id) values (meeting, auth.uid())
      on conflict (meeting_id, user_id) do nothing;
  end $$;

create or replace function unmark_attendance(meeting uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
  begin
    select * into m from course_meetings where id = meeting;
    if not found or course_hidden_from_me(m.course_id) then
      raise exception 'Meeting not found.' using errcode = 'P0002';
    end if;
    if not is_member(m.course_id) then
      raise exception 'Only listeners of this course can mark attendance.' using errcode = '42501';
    end if;
    if m.status = 'canceled' then
      raise exception 'Attendance can''t be changed for a canceled meeting.' using errcode = '23514';
    end if;
    -- A meeting rescheduled into the future closes attendance again until its new start.
    if m.starts_at > now() then
      raise exception 'Attendance can be marked once the meeting has started.' using errcode = '23514';
    end if;
    delete from meeting_attendance where meeting_id = meeting and user_id = auth.uid();
  end $$;
