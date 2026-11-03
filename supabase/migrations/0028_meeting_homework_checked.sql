-- ARU-60: the teacher or a mentor marks a completed meeting's homework as checked, which moves the meeting to the
-- course's MEETING HISTORY. Adds two nullable columns and one function; nothing is deleted or changed.
--   course_meetings.homework_checked_at / homework_checked_by   null = not checked (existing rows start unchecked)
--   set_meeting_homework_checked(meeting, checked)              the only way to set or clear them
-- course_meetings has no update policy (0010), so a direct update still changes nothing; it is already in the
-- supabase_realtime publication (0010), so every device sees the change live. The select policies are unchanged.

alter table course_meetings add column homework_checked_at timestamptz;
alter table course_meetings add column homework_checked_by uuid references profiles (id) on delete set null;

-- Who: the teacher on any course, or a mentor who can see the course and isn't one of its listeners (a mentor
-- listener is a student there: "never their own", as for checking homework). Only an approved account has a role
-- (my_role() is null otherwise, 0021), so signed-out and pending callers are refused too.
-- What: completed meetings only. Marking an already checked meeting keeps the first mark, and undoing an unchecked one
-- does nothing, so a retry after a network error is safe.
create function set_meeting_homework_checked(meeting uuid, checked boolean) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
    caller_role user_role := my_role();
  begin
    select * into m from course_meetings where id = meeting for update;
    -- A meeting the caller can't see (unknown, or in a hidden course) gets the same answer as "not allowed".
    if not found or course_hidden_from_me(m.course_id) then
      raise exception 'You can''t mark homework checked on this meeting.' using errcode = '42501';
    end if;
    if not (
      coalesce(caller_role = 'teacher', false)
      or (coalesce(caller_role = 'mentor', false) and not is_member(m.course_id))
    ) then
      raise exception 'Only the teacher or a mentor who isn''t a listener of this course can mark homework checked.'
        using errcode = '42501';
    end if;
    if m.status <> 'completed' then
      raise exception 'Homework can be marked checked only on completed meetings.' using errcode = '23514';
    end if;
    if checked then
      if m.homework_checked_at is not null then
        return; -- already checked: keep the first mark
      end if;
      update course_meetings set homework_checked_at = now(), homework_checked_by = auth.uid() where id = meeting;
    else
      update course_meetings set homework_checked_at = null, homework_checked_by = null where id = meeting;
    end if;
  end $$;

revoke execute on function set_meeting_homework_checked(uuid, boolean) from public, anon;
grant execute on function set_meeting_homework_checked(uuid, boolean) to authenticated;
