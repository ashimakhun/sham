-- Delete a discipline (ARU-83): the teacher deletes a discipline (visible or hidden) with every course in it
-- (hidden courses too). Run after 0041_delete_course.sql, whose delete_course() and course_homework_photos() this
-- reuses for each course, so deleting a course alone (ARU-85) and with its discipline can't drift apart. The
-- teacher's Storage policies on the "homework" bucket also come from 0041. Adds two functions; changes no data.
--
-- The app (src/lib/store.tsx, deleteDiscipline) does what deleteCourse does, for the whole discipline:
--   1. discipline_homework_photos(discipline) lists the homework photos of its courses still in Storage;
--   2. it removes them through the Storage API, then lists again and stops with an error if any is left;
--   3. delete_discipline(discipline) deletes every course (with everything in it) and the discipline in one
--      transaction.

-- The homework photos of every course in the discipline that are still in Storage. Teacher only (42501); a
-- discipline that doesn't exist (e.g. a retry after it was deleted) raises "Discipline not found." (P0002).
create function discipline_homework_photos(discipline uuid)
  returns table (photo_path text)
  language plpgsql stable security definer set search_path = public
  as $$
begin
  if my_role() is distinct from 'teacher' then
    raise exception 'Only the teacher can delete a discipline.' using errcode = '42501';
  end if;
  if not exists (select 1 from disciplines d where d.id = discipline) then
    raise exception 'Discipline not found.' using errcode = 'P0002';
  end if;
  return query
    select distinct p.photo_path
    from courses c
    cross join lateral course_homework_photos(c.id) p
    where c.discipline_id = discipline;
end $$;

-- Deletes every course of the discipline (through delete_course(), 0041) and then the discipline, in one
-- transaction: all of it or none of it. Teacher only (42501), even for a mentor who owns a course in it; an unknown
-- discipline raises "Discipline not found." (P0002), which the app treats as done.
create function delete_discipline(discipline uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
declare
  c record;
begin
  if my_role() is distinct from 'teacher' then
    raise exception 'Only the teacher can delete a discipline.' using errcode = '42501';
  end if;
  -- Locking the row makes a concurrent "set this course's discipline" (its foreign key check) wait for the delete,
  -- so no course can join the discipline halfway through.
  perform 1 from disciplines d where d.id = discipline for update;
  if not found then
    raise exception 'Discipline not found.' using errcode = 'P0002';
  end if;
  for c in select id from courses where discipline_id = discipline for update loop
    perform delete_course(c.id);
  end loop;
  delete from disciplines d where d.id = discipline;
end $$;

revoke execute on function discipline_homework_photos(uuid) from public, anon;
revoke execute on function delete_discipline(uuid) from public, anon;
grant execute on function discipline_homework_photos(uuid) to authenticated;
grant execute on function delete_discipline(uuid) to authenticated;
