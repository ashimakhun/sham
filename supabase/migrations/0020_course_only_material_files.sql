-- Course-only Knowledge base PDFs (ARU-42): the author of a course-linked PDF chooses whether everyone sees it or
-- only the people in that course (its current owner and listeners). The author and the teacher always see it.
-- Run after 0018_material_files.sql (independent of 0019_hidden_courses.sql; either order works).
-- Adds a column and a function, replaces two read policies; nothing is deleted and every existing item stays
-- visible to everyone (course_only defaults to false).

-- No check constraint tying it to course_id: "on delete set null" on the course would then fail. A course_only item
-- whose course is gone (course_id null) counts as visible to everyone; the app saves false with "No course".
alter table material_files add column course_only boolean not null default false;

-- The author may switch it (existing update policy: the author, while a teacher or mentor).
grant update (course_only) on material_files to authenticated;

-- Can the caller see the item stored at this path? Used by both read policies below, so they can't drift apart.
-- Security definer: reads material_files, courses and course_members itself, so their RLS (including hidden courses,
-- 0019) can neither recurse into it nor hide the course from it.
create function can_see_material_file(path text) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select exists (
      select 1 from material_files f
      where f.storage_path = path
        and (
          not f.course_only
          or f.course_id is null
          or f.author_id = auth.uid()
          or my_role() = 'teacher'
          or exists (select 1 from courses c where c.id = f.course_id and c.created_by = auth.uid())
          or exists (select 1 from course_members m where m.course_id = f.course_id and m.user_id = auth.uid())
        )
    )
  $$;
revoke execute on function can_see_material_file(text) from public, anon;
grant execute on function can_see_material_file(text) to authenticated;

-- Rows: was "using (true)" (0018).
drop policy "material files readable" on material_files;
create policy "material files readable" on material_files for select to authenticated
  using (can_see_material_file(storage_path));

-- PDFs: was "bucket_id = 'materials'" (0018). Also the caller's own folder, so an author can still read and remove()
-- an object that has no row (Discard upload?, a half-done delete): Storage needs SELECT as well as DELETE to remove.
drop policy "material files readable by signed-in users" on storage.objects;
create policy "material files readable by signed-in users" on storage.objects for select to authenticated
  using (
    bucket_id = 'materials'
    and (can_see_material_file(name) or (storage.foldername(name))[1] = auth.uid()::text)
  );
