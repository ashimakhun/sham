-- ARU-86: the teacher deletes any Knowledge base PDF, whoever shared it (a mentor, a mentor made a student, a deleted
-- account; course-only PDFs of any course too). Run after 0042. Adds two policies; the authors' own delete policies
-- (0018) stay as they are, so mentors still delete only their own PDFs and students none. Editing stays author-only.
-- Changes and deletes no data.
--
-- my_role() is null for an account that isn't approved (0021), so only an approved teacher passes, and someone who
-- is no longer the teacher is refused. Storage needs SELECT on an object to delete it: the teacher already reads
-- every PDF ("material files readable by signed-in users", 0021, through can_see_material_file()), so no read rule
-- changes. Without the Storage policy remove() would silently skip the PDF and only the row would go.

create policy "teacher deletes any material file" on material_files for delete to authenticated
  using (my_role() = 'teacher');

create policy "teacher deletes any material file from storage" on storage.objects for delete to authenticated
  using (bucket_id = 'materials' and my_role() = 'teacher');
