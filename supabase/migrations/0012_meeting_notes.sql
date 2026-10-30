-- Notes on completed meetings (ARU-28): the course's current owner or the teacher adds, edits or clears one notes
-- text (Markdown: bold, italic, lists, links) on a Completed meeting. Run after 0011_edit_meetings.sql. Adds three
-- columns, a trigger and a function; nothing is deleted. There is still no update policy: notes change only through
-- set_meeting_notes(). Reading uses the existing "meetings readable" select policy.

alter table course_meetings
  add column notes text check (char_length(notes) <= 10000),
  add column notes_updated_by uuid references profiles (id),
  add column notes_updated_at timestamptz;

-- A new meeting has no notes, whatever the insert says (so notes can't skip the Completed rule or fake the editor).
create function course_meetings_new_no_notes() returns trigger
  language plpgsql set search_path = public
  as $$
  begin
    new.notes := null;
    new.notes_updated_by := null;
    new.notes_updated_at := null;
    return new;
  end $$;
create trigger course_meetings_new_no_notes before insert on course_meetings
  for each row execute function course_meetings_new_no_notes();

-- Sets the notes of a Completed meeting. Surrounding whitespace (spaces, tabs, line breaks) is trimmed; blank text removes the notes (null).
-- Records who saved and when. Last save wins.
create function set_meeting_notes(meeting uuid, new_notes text)
  returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
    -- Trims spaces, tabs and line breaks (trim() alone removes only spaces).
    cleaned text := nullif(regexp_replace(new_notes, '^\s+|\s+$', '', 'g'), '');
  begin
    select * into m from course_meetings where id = meeting for update;
    if not found then
      raise exception 'Meeting not found.' using errcode = 'P0002';
    end if;
    if not (owns_course(m.course_id) or my_role() = 'teacher') then
      raise exception 'Only the course owner or the teacher can edit notes.' using errcode = '42501';
    end if;
    if m.status <> 'completed' then
      raise exception 'Notes can be added only to completed meetings.' using errcode = '23514';
    end if;
    if char_length(cleaned) > 10000 then
      raise exception 'Notes can be at most 10,000 characters.' using errcode = '22001';
    end if;
    update course_meetings set
      notes = cleaned,
      notes_updated_by = auth.uid(),
      notes_updated_at = now()
    where id = meeting;
  end $$;
revoke execute on function set_meeting_notes(uuid, text) from public, anon;
grant execute on function set_meeting_notes(uuid, text) to authenticated;
