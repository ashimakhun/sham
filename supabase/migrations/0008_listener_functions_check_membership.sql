-- ARU-16: the listener removal functions act only on actual listeners of the course.
-- Amends listener_homework_photos() and remove_listener() from 0004_course_members.sql (0004 is not edited).
-- Before: both checked only that the caller is a teacher or mentor, so remove_listener(C, U) deleted U's homework
-- for C even when U was never a listener of C. Now:
--   * listener_homework_photos(C, U) returns no rows unless U has a course_members row for C.
--   * remove_listener(C, U) deletes the membership row first and deletes U's homework for C only when a
--     membership row was actually deleted; otherwise it returns without error and deletes nothing.
--     The delete takes the row lock, so of two concurrent removals only one deletes (the other sees no row).
-- Same names, arguments, return types, security definer, search_path and privileges, so the app needs no change.

create or replace function listener_homework_photos(course uuid, member uuid)
  returns table (id uuid, photo_path text)
  language plpgsql stable security definer set search_path = public
  as $$
begin
  if my_role() is null or my_role() not in ('teacher', 'mentor') then
    raise exception 'Only a teacher or mentor can do this.' using errcode = '42501';
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
  -- Membership first: if it is already gone (never a listener, or removed by someone else), stop here.
  delete from course_members m where m.course_id = course and m.user_id = member;
  removed := found;
  if not removed then
    return;
  end if;
  delete from homework h where h.course_id = course and h.student_id = member;
end $$;

revoke execute on function listener_homework_photos(uuid, uuid) from public, anon;
revoke execute on function remove_listener(uuid, uuid) from public, anon;
grant execute on function listener_homework_photos(uuid, uuid) to authenticated;
grant execute on function remove_listener(uuid, uuid) to authenticated;
