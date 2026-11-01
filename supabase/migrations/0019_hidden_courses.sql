-- Hidden courses (ARU-40): a teacher or mentor can create a course as hidden. A hidden course and everything in it
-- (listeners, meetings and notes, attendance, homework assignments, homework and photos, chat and read positions) is
-- visible only to its participants (the current owner and current listeners) and the teacher. Every other student
-- and mentor sees nothing of it. Run after 0018_material_files.sql.
--
-- How: one helper, course_hidden_from_me(), and RESTRICTIVE policies (attendance: its one policy is replaced). Postgres ANDs restrictive policies with the
-- existing (permissive) ones, so for visible courses every rule stays exactly as it was. For a hidden course the
-- caller can't see, reads (and realtime events) return nothing and inserts fail with 42501. Security-definer
-- functions skip RLS, so each one that acts on a course checks the helper itself:
--   change_course_owner         -> "Course not found."
--   listener_homework_photos    -> "Course not found."
--   remove_listener             -> no change, no error
--   set_meeting_status, update_meeting, set_meeting_notes, mark_attendance, unmark_attendance,
--   homework_assignments_before_insert (assign-homework trigger)  -> "Meeting not found."
-- Checked and left unchanged:
--   mark_chat_read, in_course_chat   already only allow the owner, listeners and the teacher (participants).
--   chat_unread_counts               security invoker: the restrictive policies apply to it.
--   seed_course_chat_reads           admin-only; it seeds only the owner, listeners and the teacher.
--   is_listener_homework_photo       used by storage policies, which the restrictive storage policy below limits.
--   is_member, owns_course, my_role  say who the caller is; they reveal nothing about a hidden course.
--   set_user_role (0009)             lists hidden courses a mentor owns: only the teacher can call it.
-- Existing courses stay visible (hidden defaults to false); no data is changed or deleted.

alter table courses add column hidden boolean not null default false;

-- True only when the course exists, is hidden, and the caller is neither its owner, a listener nor the teacher.
-- A course that doesn't exist gives false, so missing-course errors stay what they were (foreign key, not found).
-- Security definer so policies on these tables can use it without recursing through their own policies.
create function course_hidden_from_me(course uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select exists (
      select 1 from courses c
      where c.id = course
        and c.hidden
        and c.created_by is distinct from auth.uid()
        and my_role() is distinct from 'teacher'
        and not exists (select 1 from course_members m where m.course_id = c.id and m.user_id = auth.uid())
    )
  $$;

create function meeting_hidden_from_me(meeting uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$ select coalesce((select course_hidden_from_me(course_id) from course_meetings where id = meeting), false) $$;

-- A homework photo belongs to a hidden course the caller can't see.
create function homework_photo_hidden_from_me(object_name text) returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from homework h where h.photo_path = object_name and course_hidden_from_me(h.course_id)) $$;

revoke execute on function course_hidden_from_me(uuid) from public, anon;
revoke execute on function meeting_hidden_from_me(uuid) from public, anon;
revoke execute on function homework_photo_hidden_from_me(text) from public, anon;
grant execute on function course_hidden_from_me(uuid) to authenticated;
grant execute on function meeting_hidden_from_me(uuid) to authenticated;
grant execute on function homework_photo_hidden_from_me(text) to authenticated;

-- One restrictive policy per command that already has a permissive one (SELECT and INSERT everywhere, UPDATE where
-- updates are allowed). Tables with no update or delete policy keep having none: those writes stay impossible.

-- Courses: the course row itself (its own columns, so a new hidden course passes its creator's insert check).
create policy "hidden courses: readable by participants and the teacher" on courses as restrictive for select
  to authenticated using (not hidden or created_by = auth.uid() or my_role() = 'teacher' or is_member(id));
create policy "hidden courses: created by their owner" on courses as restrictive for insert
  to authenticated with check (not hidden or created_by = auth.uid());

-- Everything that belongs to a course.
create policy "hidden courses: readable by participants and the teacher" on course_members as restrictive for select
  to authenticated using (not course_hidden_from_me(course_id));
create policy "hidden courses: only participants and the teacher add" on course_members as restrictive for insert
  to authenticated with check (not course_hidden_from_me(course_id));

create policy "hidden courses: readable by participants and the teacher" on course_meetings as restrictive for select
  to authenticated using (not course_hidden_from_me(course_id));
create policy "hidden courses: only participants and the teacher add" on course_meetings as restrictive for insert
  to authenticated with check (not course_hidden_from_me(course_id));

create policy "hidden courses: readable by participants and the teacher" on homework_assignments as restrictive
  for select to authenticated using (not course_hidden_from_me(course_id));
create policy "hidden courses: only participants and the teacher add" on homework_assignments as restrictive
  for insert to authenticated with check (not course_hidden_from_me(course_id));

create policy "hidden courses: readable by participants and the teacher" on homework as restrictive for select
  to authenticated using (not course_hidden_from_me(course_id));
create policy "hidden courses: only participants and the teacher add" on homework as restrictive for insert
  to authenticated with check (not course_hidden_from_me(course_id));
create policy "hidden courses: only participants and the teacher check" on homework as restrictive for update
  to authenticated using (not course_hidden_from_me(course_id)) with check (not course_hidden_from_me(course_id));

create policy "hidden courses: readable by participants and the teacher" on course_messages as restrictive for select
  to authenticated using (not course_hidden_from_me(course_id));
create policy "hidden courses: only participants and the teacher post" on course_messages as restrictive for insert
  to authenticated with check (not course_hidden_from_me(course_id));

create policy "hidden courses: readable by participants and the teacher" on course_chat_reads as restrictive
  for select to authenticated using (not course_hidden_from_me(course_id));
create policy "hidden courses: only participants and the teacher add" on course_chat_reads as restrictive
  for insert to authenticated with check (not course_hidden_from_me(course_id));
create policy "hidden courses: only participants and the teacher update" on course_chat_reads as restrictive
  for update to authenticated using (not course_hidden_from_me(course_id)) with check (not course_hidden_from_me(course_id));

-- Attendance keeps a single SELECT policy (writes go only through mark_attendance / unmark_attendance): the
-- 0017 rule plus the hidden-course check.
drop policy "attendance readable" on meeting_attendance;
create policy "attendance readable" on meeting_attendance for select to authenticated
  using ((user_id = auth.uid() or my_role() in ('teacher', 'mentor')) and not meeting_hidden_from_me(meeting_id));

-- Homework photos: reading and deleting follow their homework's course. (Not uploads: the homework row doesn't
-- exist yet when a listener uploads, and the homework insert itself is checked above.)
create policy "hidden courses: homework photos" on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'homework' or not homework_photo_hidden_from_me(name));
create policy "hidden courses: homework photos deletable" on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'homework' or not homework_photo_hidden_from_me(name));

-- Security-definer functions: the same bodies as before plus the hidden-course check (0007, 0008, 0010-0012, 0015,
-- 0017 are not edited).

create or replace function change_course_owner(course uuid, new_owner uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    current_owner uuid;
    target_role user_role;
  begin
    if my_role() is null or my_role() not in ('teacher', 'mentor') then
      raise exception 'Only a teacher or mentor can change the owner.' using errcode = '42501';
    end if;
    select created_by into current_owner from courses where id = course for update;
    -- ARU-40: a hidden course is changed only by the teacher, its owner or a mentor listener.
    if not found or course_hidden_from_me(course) then
      raise exception 'Course not found.' using errcode = 'P0002';
    end if;
    -- Lock the new owner's profile so a concurrent role change can't leave a student owner (see ARU-13).
    select role into target_role from profiles where id = new_owner for share;
    if target_role is null then
      raise exception 'That user does not exist.' using errcode = 'P0002';
    end if;
    if target_role not in ('teacher', 'mentor') then
      raise exception 'Only a teacher or mentor can own a course.' using errcode = '23514';
    end if;
    if current_owner = new_owner then
      return;
    end if;
    if exists (select 1 from course_members m where m.course_id = course and m.user_id = new_owner) then
      raise exception 'This person is a listener of the course. Remove them first.' using errcode = '23514';
    end if;
    update courses set created_by = new_owner where id = course;
  end $$;

create or replace function listener_homework_photos(course uuid, member uuid)
  returns table (id uuid, photo_path text)
  language plpgsql stable security definer set search_path = public
  as $$
begin
  if my_role() is null or my_role() not in ('teacher', 'mentor') then
    raise exception 'Only a teacher or mentor can do this.' using errcode = '42501';
  end if;
  if course_hidden_from_me(course) then
    raise exception 'Course not found.' using errcode = 'P0002';
  end if;
  return query
    select h.id, h.photo_path
    from homework h
    where h.course_id = course
      and h.student_id = member
      and exists (select 1 from course_members m where m.course_id = course and m.user_id = member);
end $$;

create or replace function remove_listener(course uuid, member uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
declare
  removed boolean;
begin
  if my_role() is null or my_role() not in ('teacher', 'mentor') then
    raise exception 'Only a teacher or mentor can do this.' using errcode = '42501';
  end if;
  -- ARU-40: someone who can't see a hidden course changes nothing in it (checked before any delete).
  if course_hidden_from_me(course) then
    return;
  end if;
  -- Membership first: if it is already gone (never a listener, or removed by someone else), stop here.
  delete from course_members m where m.course_id = course and m.user_id = member;
  removed := found;
  if not removed then
    return;
  end if;
  delete from homework h where h.course_id = course and h.student_id = member;
end $$;

create or replace function set_meeting_status(meeting uuid, new_status meeting_status) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
  begin
    select * into m from course_meetings where id = meeting for update;
    if not found or course_hidden_from_me(m.course_id) then
      raise exception 'Meeting not found.' using errcode = 'P0002';
    end if;
    if not (owns_course(m.course_id) or my_role() = 'teacher') then
      raise exception 'Only the course owner or the teacher can change a meeting''s status.' using errcode = '42501';
    end if;
    if new_status = m.status and new_status <> 'scheduled' then
      return; -- already done: safe retry
    end if;
    if m.status <> 'scheduled' then
      raise exception 'This meeting is already %; its status can''t change.', m.status using errcode = '23514';
    end if;
    if new_status = 'scheduled' then
      raise exception 'A meeting can only be marked completed or canceled.' using errcode = '22023';
    end if;
    if new_status = 'completed' and m.starts_at > now() then
      raise exception 'A meeting can be marked completed only after it has started.' using errcode = '23514';
    end if;
    update course_meetings
      set status = new_status, status_changed_by = auth.uid(), status_changed_at = now()
      where id = meeting;
  end $$;

create or replace function update_meeting(meeting uuid, new_starts_at timestamptz, new_topic text, new_location text)
  returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
    moved boolean;
  begin
    select * into m from course_meetings where id = meeting for update;
    if not found or course_hidden_from_me(m.course_id) then
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

create or replace function set_meeting_notes(meeting uuid, new_notes text) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
    -- Trims spaces, tabs and line breaks (trim() alone removes only spaces).
    cleaned text := nullif(regexp_replace(new_notes, '^\s+|\s+$', '', 'g'), '');
  begin
    select * into m from course_meetings where id = meeting for update;
    if not found or course_hidden_from_me(m.course_id) then
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
    if m.status <> 'completed' then
      raise exception 'Attendance can be marked only for completed meetings.' using errcode = '23514';
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
    delete from meeting_attendance where meeting_id = meeting and user_id = auth.uid();
  end $$;

create or replace function homework_assignments_before_insert() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
  begin
    -- A caller without a profile (signed out) has my_role() = null; without the null check the condition would be
    -- null, the raise skipped, and the meeting's state revealed by the next check (ARU-36).
    if my_role() is null then
      raise exception 'Only the course owner or the teacher can assign homework.' using errcode = '42501';
    end if;
    -- ARU-40: a hidden course the caller can't see looks like a missing meeting.
    if course_hidden_from_me(new.course_id) then
      raise exception 'Meeting not found.' using errcode = 'P0002';
    end if;
    if not (owns_course(new.course_id) or my_role() = 'teacher') then
      raise exception 'Only the course owner or the teacher can assign homework.' using errcode = '42501';
    end if;
    select * into m from course_meetings where id = new.meeting_id;
    if not found or m.course_id <> new.course_id then
      raise exception 'Meeting not found.' using errcode = 'P0002';
    end if;
    if m.status <> 'completed' then
      raise exception 'Homework can be assigned only to completed meetings.' using errcode = '23514';
    end if;
    if exists (select 1 from homework_assignments a where a.meeting_id = new.meeting_id and a.id <> new.id) then
      raise exception 'This meeting already has homework.' using errcode = '23505';
    end if;
    if new.due_at is not null and new.due_at <= now() then
      raise exception 'The deadline must be in the future.' using errcode = '23514';
    end if;
    new.title := btrim(new.title);
    new.description := btrim(coalesce(new.description, ''));
    if char_length(new.title) = 0 then
      raise exception 'Enter a title.' using errcode = '23514';
    end if;
    if char_length(new.title) > 200 then
      raise exception 'The title can be at most 200 characters.' using errcode = '23514';
    end if;
    new.created_at := now();
    return new;
  end $$;
