-- ARU-182: the course owner, and the teacher on any course in their workspace (hidden ones too), changes a course's
-- description on Edit course. `courses` has no update grant or policy (0003), so the change goes through this
-- security definer function, with the same checks as set_course_discipline() (0033 / 0053):
--   * not found, hidden from me, or in another workspace (course_hidden_from_me(), 0059) -> "Course not found.";
--   * not approved, or neither the owner nor the teacher -> "Only the course owner can change its description.";
--   * the description is stored trimmed; an unchanged value (after trimming) returns without writing (safe retry).
-- The existing zz_workspace_guard trigger on courses still runs on the update. No table, column, policy or grant on a
-- table changes; deletes nothing.

create or replace function set_course_description(course uuid, description text) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    c courses%rowtype;
    -- Leading and trailing spaces, tabs and line breaks go, as JavaScript's trim() does in the app.
    trimmed text := regexp_replace(coalesce(description, ''), '^\s+|\s+$', '', 'g');
  begin
    select * into c from courses where id = course for update;
    -- course_hidden_from_me() is false for the teacher, so the teacher reaches hidden courses too.
    if not found or course_hidden_from_me(c.id) then
      raise exception 'Course not found.' using errcode = 'P0002', hint = 'sham:course_not_found';
    end if;
    if not is_approved() or (c.created_by is distinct from auth.uid() and my_role() is distinct from 'teacher') then
      raise exception 'Only the course owner can change its description.'
        using errcode = '42501', hint = 'sham:course_description_owner_only';
    end if;
    if trimmed = c.description then
      return; -- unchanged: always allowed, safe retry
    end if;
    update courses set description = trimmed where id = course;
  end $$;
revoke execute on function set_course_description(uuid, text) from public, anon;
grant execute on function set_course_description(uuid, text) to authenticated;
