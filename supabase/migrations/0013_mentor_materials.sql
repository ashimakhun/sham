-- ARU-26: mentors share materials and delete their own, like the teacher.
-- teacher_id keeps its name; it means "author". Reading stays open to everyone signed in (unchanged).
-- my_role() is checked on every write, so a mentor who is made a student can no longer delete their old rows.
drop policy "teachers add materials" on materials;
drop policy "teachers delete own materials" on materials;

create policy "teachers and mentors add materials" on materials for insert to authenticated
  with check (teacher_id = auth.uid() and my_role() in ('teacher', 'mentor'));
create policy "authors delete own materials" on materials for delete to authenticated
  using (teacher_id = auth.uid() and my_role() in ('teacher', 'mentor'));
