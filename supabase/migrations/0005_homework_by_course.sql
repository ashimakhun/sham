-- Homework by course (ARU-14): listeners (students and mentors) submit homework only to courses they are in;
-- mentors and the teacher see and check homework in any course, never their own (product-owner decision
-- 2026-10-28: every mentor has the teacher's homework rights). profiles.mentor_id no longer grants anything.
-- Run after 0004_course_members.sql, when nobody is using the app: it DELETES ALL HOMEWORK. Afterwards empty
-- the "homework" storage bucket once (see README); SQL cannot delete Storage files.

-- Old homework is dropped (product-owner decision): from now on homework only exists inside a course.
delete from homework;
alter table homework alter column course_id set not null;

comment on column homework.student_id is 'Submitted by: the listener (student or mentor) who sent this homework.';

-- True when the signed-in user owns the course (created_by; changeable later in ARU-9). Used by ARU-9/ARU-10.
create function owns_course(course uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from courses where id = course and created_by = auth.uid()) $$;
revoke execute on function owns_course(uuid) from public, anon;
grant execute on function owns_course(uuid) to authenticated;

-- Drop every rule based on profiles.mentor_id / is_my_student() (both are kept, but unused).
drop policy "homework readable" on homework;
drop policy "students submit own homework" on homework;
drop policy "mentors check their students' homework" on homework;
drop policy "homework photos readable by owner, mentor, teacher" on storage.objects;

-- See: your own homework; mentors and the teacher see all.
create policy "homework readable" on homework for select to authenticated using (
  student_id = auth.uid() or my_role() in ('teacher', 'mentor')
);

-- Submit: as yourself, a student or mentor, only to a course you are a listener of.
create policy "listeners submit own homework" on homework for insert to authenticated with check (
  student_id = auth.uid()
  and my_role() in ('student', 'mentor')
  and is_member(course_id)
  and status = 'submitted'
  and checked_by is null
);

-- Check: any mentor or the teacher, never on your own homework, always as yourself.
create policy "mentors and teacher check homework" on homework for update to authenticated
  using (my_role() in ('teacher', 'mentor') and student_id <> auth.uid())
  with check (my_role() in ('teacher', 'mentor') and student_id <> auth.uid() and checked_by = auth.uid());

-- Checking may only change the check columns (not title, course, photo or who submitted it).
revoke update on homework from anon, authenticated;
grant update (status, checked_by, checked_at, mentor_comment) on homework to authenticated;

-- Photos: readable when the homework row is (goes through the row, so it follows the rules above).
create policy "homework photos readable with their homework" on storage.objects for select to authenticated using (
  bucket_id = 'homework'
  and exists (
    select 1 from homework h
    where h.photo_path = storage.objects.name
      and (h.student_id = auth.uid() or my_role() in ('teacher', 'mentor'))
  )
);
