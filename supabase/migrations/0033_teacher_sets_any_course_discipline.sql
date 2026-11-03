-- ARU-70: the teacher sets, changes or clears the discipline of any course (hidden courses too), not only the ones
-- they own. Mentors still change only the courses they currently own. Replaces set_course_discipline (0031); no table,
-- policy or data changes, deletes nothing.
-- Numbered 0033, after 0032 (ARU-65, accountant); this file doesn't depend on it.

create or replace function set_course_discipline(course uuid, discipline uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    c courses%rowtype;
  begin
    select * into c from courses where id = course for update;
    -- course_hidden_from_me() is false for the teacher, so the teacher reaches hidden courses too.
    if not found or course_hidden_from_me(c.id) then
      raise exception 'Course not found.' using errcode = 'P0002';
    end if;
    if not is_approved() or (c.created_by is distinct from auth.uid() and my_role() is distinct from 'teacher') then
      raise exception 'Only the course owner can change its discipline.' using errcode = '42501';
    end if;
    if discipline is not distinct from c.discipline_id then
      return; -- unchanged: always allowed, safe retry
    end if;
    -- The teacher sees hidden disciplines, so they can pick them; a mentor can't.
    if discipline is not null and not discipline_visible_to_me(discipline) then
      raise exception 'Discipline not found.' using errcode = 'P0002';
    end if;
    update courses set discipline_id = discipline where id = course;
  end $$;
revoke execute on function set_course_discipline(uuid, uuid) from public, anon;
grant execute on function set_course_discipline(uuid, uuid) to authenticated;
