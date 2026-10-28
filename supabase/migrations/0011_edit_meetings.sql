-- Edit and reschedule meetings (ARU-15): the course owner or the teacher changes the date and start time, topic
-- and link/place of a Scheduled meeting. Run after 0010_course_meetings.sql. Adds a column, a trigger and a
-- function; nothing is deleted. There is still no update policy: edits go only through update_meeting().

-- Set when the start time changes (shown as "Rescheduled"); null for meetings never moved.
alter table course_meetings add column rescheduled_at timestamptz;

-- A new meeting has never been rescheduled, whatever the insert says.
create function course_meetings_new_not_rescheduled() returns trigger
  language plpgsql set search_path = public
  as $$
  begin
    new.rescheduled_at := null;
    return new;
  end $$;
create trigger course_meetings_new_not_rescheduled before insert on course_meetings
  for each row execute function course_meetings_new_not_rescheduled();

-- Changes a Scheduled meeting's start, topic and location (nothing else). A changed start must be in the future
-- and sets rescheduled_at; an unchanged start (compared exactly) skips the future check, so the topic or link of a
-- past, unmarked meeting can still be fixed. A blank topic becomes 'Meeting', a blank location null. Saving the
-- same values again changes nothing (safe retry).
create function update_meeting(meeting uuid, new_starts_at timestamptz, new_topic text, new_location text)
  returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
    moved boolean;
  begin
    select * into m from course_meetings where id = meeting for update;
    if not found then
      raise exception 'Meeting not found.' using errcode = 'P0002';
    end if;
    if not (owns_course(m.course_id) or my_role() = 'teacher') then
      raise exception 'Only the course owner or the teacher can edit a meeting.' using errcode = '42501';
    end if;
    if m.status <> 'scheduled' then
      raise exception 'This meeting is already %; it can''t be edited.', m.status using errcode = '23514';
    end if;
    if new_starts_at is null then
      raise exception 'Pick a date and start time.' using errcode = '22023';
    end if;
    moved := new_starts_at is distinct from m.starts_at;
    if moved and new_starts_at <= now() then
      raise exception 'Pick a time in the future.' using errcode = '23514';
    end if;
    update course_meetings set
      starts_at = new_starts_at,
      topic = coalesce(nullif(trim(new_topic), ''), 'Meeting'),
      location = nullif(trim(new_location), ''),
      rescheduled_at = case when moved then now() else m.rescheduled_at end
    where id = meeting;
  end $$;
revoke execute on function update_meeting(uuid, timestamptz, text, text) from public, anon;
grant execute on function update_meeting(uuid, timestamptz, text, text) to authenticated;
