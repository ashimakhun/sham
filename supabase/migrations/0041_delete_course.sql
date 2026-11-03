-- Delete a course (ARU-85): the teacher deletes any course (hidden ones too) with everything in it. Run after
-- 0040. Adds two functions and two Storage policies; no existing data or rule is changed.
--
-- How the app deletes a course (src/lib/store.tsx, deleteCourse):
--   1. course_homework_photos(course) lists the homework photos of the course that are still in Storage;
--   2. the app removes them through the Storage API (SQL can't delete Storage files), then lists again: anything
--      still listed was skipped by Storage (remove() silently skips objects RLS hides), so it stops with an error;
--   3. delete_course(course) deletes the course's homework and the course in one transaction.
-- Everything else that belongs to a course already goes with it (on delete cascade): course_members,
-- course_messages, course_meetings (-> homework_assignments, meeting_attendance), course_chat_reads,
-- course_feedback, course_billing, course_payments, course_payment_exemptions. material_files.course_id is set to
-- null, so the course's Knowledge base PDFs stay with "No course". homework.course_id and homework.assignment_id
-- don't cascade, so delete_course() deletes that homework itself first.
-- ARU-83 (delete a discipline) reuses delete_course() for each of its courses, so the two can't drift apart.

-- The teacher's homework photos to remove before delete_course(): the photo of every homework of the course (by
-- course, or by an assignment of the course) that is still in the "homework" bucket. A photo that is already gone
-- isn't listed, so a retry after a partial delete lists only what is left. Teacher only (42501); a course that
-- doesn't exist (e.g. a retry after the course was deleted) raises "Course not found." (P0002).
create function course_homework_photos(course uuid)
  returns table (photo_path text)
  language plpgsql stable security definer set search_path = public
  as $$
begin
  if my_role() is distinct from 'teacher' then
    raise exception 'Only the teacher can delete a course.' using errcode = '42501';
  end if;
  if not exists (select 1 from courses c where c.id = course) then
    raise exception 'Course not found.' using errcode = 'P0002';
  end if;
  return query
    select distinct h.photo_path
    from homework h
    where (h.course_id = course
           or h.assignment_id in (select a.id from homework_assignments a where a.course_id = course))
      and h.photo_path is not null
      and exists (select 1 from storage.objects o where o.bucket_id = 'homework' and o.name = h.photo_path);
end $$;

-- Deletes the course and everything in it in one transaction: all of it or none of it. Teacher only (42501), even
-- for the course's owner; an unknown course raises "Course not found." (P0002), which the app treats as done.
create function delete_course(course uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
begin
  if my_role() is distinct from 'teacher' then
    raise exception 'Only the teacher can delete a course.' using errcode = '42501';
  end if;
  -- Lock the row so a concurrent change (owner, discipline) waits for the delete.
  perform 1 from courses c where c.id = course for update;
  if not found then
    raise exception 'Course not found.' using errcode = 'P0002';
  end if;
  delete from homework h
  where h.course_id = course
     or h.assignment_id in (select a.id from homework_assignments a where a.course_id = course);
  delete from courses c where c.id = course;
end $$;

revoke execute on function course_homework_photos(uuid) from public, anon;
revoke execute on function delete_course(uuid) from public, anon;
grant execute on function course_homework_photos(uuid) to authenticated;
grant execute on function delete_course(uuid) to authenticated;

-- The teacher reads and deletes every homework photo, not only those of current listeners (0004's
-- is_listener_homework_photo): a removed listener's photo, or one whose homework row is already gone, must not be
-- left behind. Storage deletes also need SELECT on the object. Mentors' and students' rights are unchanged.
create policy "teacher reads every homework photo" on storage.objects for select to authenticated
  using (bucket_id = 'homework' and my_role() = 'teacher');
create policy "teacher deletes every homework photo" on storage.objects for delete to authenticated
  using (bucket_id = 'homework' and my_role() = 'teacher');
