-- ARU-197: the course owner or the teacher marks a course Completed, and can reopen it.
--   * courses.completed_at / completed_by: null = active. Only complete_course() and reopen_course() set them: courses
--     has no update grant or policy (0003), and a before-insert trigger clears both on every new course, so nobody
--     creates a course that is already completed.
--   * complete_course(course): the course's current owner, or the teacher on any course of their workspace (hidden
--     ones too). Sets the two columns and, in the same step, cancels every Scheduled meeting of the course the way
--     set_meeting_status(…, 'canceled') does (status, status_changed_by / _at). Completing a completed course changes
--     nothing (safe retry; completed_at stays).
--   * reopen_course(course): the same people. Clears the two columns; the meetings canceled by completing stay
--     canceled. Reopening an active course changes nothing.
--     Refusals, as set_course_description() (0076): not found, hidden from me or another workspace -> "Course not
--     found."; not approved, or neither the owner nor the teacher -> the new role messages.
--   * A completed course takes no new meeting, homework assignment or listener. A before-insert trigger on
--     course_meetings, homework_assignments and course_members refuses the row with its own sham: code, on every
--     insert path (security definer functions and the service role included); a restrictive insert policy says the
--     same for app roles. Rows that exist are untouched: homework already assigned is still sent and checked,
--     listeners are still removed, meetings keep their notes and attendance.
--   * Feedback (0025): a listener adds feedback once the course has started OR is completed, so a completed course
--     with no completed meeting takes feedback too. Edit and delete are unchanged.
-- Reads are unchanged: no select policy, grant or publication changes (courses and course_meetings are already in
-- supabase_realtime). Deletes nothing; existing courses stay active (both columns null).

-- 1. The state. completed_by is cleared when that account is deleted (as the other "who did it" columns, 0040).
alter table courses
  add column completed_at timestamptz,
  add column completed_by uuid references profiles (id) on delete set null;

-- A new course is always active, whatever the insert sends.
create function courses_new_not_completed() returns trigger
  language plpgsql set search_path = public
  as $$
  begin
    new.completed_at := null;
    new.completed_by := null;
    return new;
  end $$;
revoke execute on function courses_new_not_completed() from public, anon, authenticated;
create trigger courses_new_not_completed before insert on courses
  for each row execute function courses_new_not_completed();

-- 2. Is the course completed? For the policies below. A course hidden from the caller (or of another workspace)
--    answers false, so the function tells nothing about courses the caller can't see; their own rules refuse those.
create function course_completed(course uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select not course_hidden_from_me(course)
      and exists (select 1 from courses where id = course and completed_at is not null)
  $$;
revoke execute on function course_completed(uuid) from public, anon;
grant execute on function course_completed(uuid) to authenticated;

-- 3. Complete and reopen.
create function complete_course(course uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    c courses%rowtype;
  begin
    -- The row lock makes a meeting, assignment or listener added at the same moment either wait for this and be
    -- refused, or be saved first and (a Scheduled meeting) canceled below. See course_completed_guard().
    select * into c from courses where id = course for update;
    -- course_hidden_from_me() is false for the teacher, so the teacher reaches hidden courses too.
    if not found or course_hidden_from_me(c.id) then
      raise exception 'Course not found.' using errcode = 'P0002', hint = 'sham:course_not_found';
    end if;
    if not is_approved() or (c.created_by is distinct from auth.uid() and my_role() is distinct from 'teacher') then
      raise exception 'Only the course owner or the teacher can complete a course.'
        using errcode = '42501', hint = 'sham:course_complete_role';
    end if;
    if c.completed_at is not null then
      return; -- already completed: safe retry, the first time and person stay
    end if;
    update courses set completed_at = now(), completed_by = auth.uid() where id = course;
    update course_meetings
      set status = 'canceled', status_changed_by = auth.uid(), status_changed_at = now()
      where course_id = course and status = 'scheduled';
  end $$;
revoke execute on function complete_course(uuid) from public, anon;
grant execute on function complete_course(uuid) to authenticated;

create function reopen_course(course uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    c courses%rowtype;
  begin
    select * into c from courses where id = course for update;
    if not found or course_hidden_from_me(c.id) then
      raise exception 'Course not found.' using errcode = 'P0002', hint = 'sham:course_not_found';
    end if;
    if not is_approved() or (c.created_by is distinct from auth.uid() and my_role() is distinct from 'teacher') then
      raise exception 'Only the course owner or the teacher can reopen a course.'
        using errcode = '42501', hint = 'sham:course_reopen_role';
    end if;
    if c.completed_at is null then
      return; -- already active: safe retry
    end if;
    -- Meetings canceled by completing stay canceled (canceled is final, 0010).
    update courses set completed_at = null, completed_by = null where id = course;
  end $$;
revoke execute on function reopen_course(uuid) from public, anon;
grant execute on function reopen_course(uuid) to authenticated;

-- 4. Nothing new in a completed course. One trigger function for the three tables (each has course_id).
--    For an app call on a course hidden from the caller it stays silent, so the existing rules answer as today
--    ("not found" / the RLS refusal) and the course's state isn't told. Named to run after the tables' own
--    before-insert checks (role, "Meeting not found." …) and before zz_workspace_guard.
create function course_completed_guard() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    app boolean := coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon');
    done boolean;
  begin
    if app and course_hidden_from_me(new.course_id) then
      return new;
    end if;
    -- The key-share lock waits for a complete_course() or reopen_course() that is running on this course and then
    -- reads the state it left (see complete_course()).
    select c.completed_at is not null into done from courses c where c.id = new.course_id for key share;
    if coalesce(done, false) then
      if tg_table_name = 'course_meetings' then
        raise exception 'This course is completed. New meetings can''t be added.'
          using errcode = '23514', hint = 'sham:course_completed_no_meetings';
      elsif tg_table_name = 'homework_assignments' then
        raise exception 'This course is completed. New homework can''t be assigned.'
          using errcode = '23514', hint = 'sham:course_completed_no_homework';
      else
        raise exception 'This course is completed. New listeners can''t be added.'
          using errcode = '23514', hint = 'sham:course_completed_no_listeners';
      end if;
    end if;
    return new;
  end $$;
revoke execute on function course_completed_guard() from public, anon, authenticated;

create trigger no_new_rows_in_completed_course before insert on course_meetings
  for each row execute function course_completed_guard();
create trigger no_new_rows_in_completed_course before insert on homework_assignments
  for each row execute function course_completed_guard();
create trigger no_new_rows_in_completed_course before insert on course_members
  for each row execute function course_completed_guard();

-- The same rule as restrictive insert policies (app roles), next to the hidden-course ones from 0019.
create policy "completed courses: no new meetings" on course_meetings as restrictive for insert
  to authenticated with check (not course_completed(course_id));
create policy "completed courses: no new homework" on homework_assignments as restrictive for insert
  to authenticated with check (not course_completed(course_id));
create policy "completed courses: no new listeners" on course_members as restrictive for insert
  to authenticated with check (not course_completed(course_id));

-- 5. Feedback: a completed course takes feedback even if no meeting was ever completed. Otherwise as 0025.
drop policy "listeners add own feedback to started courses" on course_feedback;
create policy "listeners add own feedback to started or completed courses" on course_feedback for insert
  to authenticated
  with check (user_id = auth.uid() and is_member(course_id) and (course_started(course_id) or course_completed(course_id)));
