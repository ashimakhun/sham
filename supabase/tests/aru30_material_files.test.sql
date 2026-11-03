-- ARU-30: Knowledge base PDFs. Rules under test: supabase/migrations/0018_material_files.sql.
-- Fixture (t.seed): teacher T; mentors M (owns A), N (owns B), M2; students S1, S2, S3; courses A, B.
select t.seed();

create function t.f(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000f00' || lpad(n::text, 2, '0'))::uuid
$$;
create function t.fpath(who text, n int) returns text language sql immutable as $$
  select t.id(who)::text || '/' || t.f(n)::text || '.pdf'
$$;
grant execute on function t.f(int), t.fpath(text, int) to anon, authenticated;

-- Data checks.
select t.ok((select relrowsecurity from pg_class where oid = 'public.material_files'::regclass), 'data: RLS is on');
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'material_files'),
  'AC9 data: material_files is in the realtime publication');
select t.eq((select file_size_limit from storage.buckets where id = 'materials'), 26214400::bigint,
  'AC4 data: the bucket allows 25 MB at most');
select t.eq((select allowed_mime_types from storage.buckets where id = 'materials'), array['application/pdf'],
  'AC4 data: the bucket allows PDFs only');
select t.ok(not (select public from storage.buckets where id = 'materials'), 'data: the bucket is private');

-- AC 3: a mentor and the teacher upload (file, then row).
select t.login('M');
select t.lives($$insert into storage.objects (bucket_id, name, owner) values ('materials', t.fpath('M', 1), t.id('M'))$$,
  'AC3 mentor uploads a PDF to their own folder');
select t.lives($$insert into material_files (id, author_id, name, description, course_id, storage_path, size_bytes)
  values (t.f(1), t.id('M'), '  Algebra book  ', E'  Chapter 1\n', t.id('A'), t.fpath('M', 1), 1000)$$,
  'AC3 mentor adds the item');
select t.eq((select name || '|' || description from material_files where id = t.f(1)), 'Algebra book|Chapter 1',
  'AC2 name and description are trimmed');
select t.login('T');
select t.lives($$insert into storage.objects (bucket_id, name, owner) values ('materials', t.fpath('T', 2), t.id('T'))$$,
  'AC3 teacher uploads a PDF');
select t.lives($$insert into material_files (id, author_id, name, storage_path, size_bytes)
  values (t.f(2), t.id('T'), 'Teacher book', t.fpath('T', 2), 26214400)$$, 'AC3/AC4 teacher adds a 25 MB item, no course');

-- Retry: the same id again is a duplicate (the app treats it as already saved).
select t.throws($$insert into material_files (id, author_id, name, storage_path, size_bytes)
  values (t.f(2), t.id('T'), 'Teacher book', t.fpath('T', 2), 10)$$, '23505', 'retry: the same item id is not saved twice');

-- Validation.
select t.throws($$insert into material_files (id, author_id, name, storage_path, size_bytes)
  values (t.f(3), t.id('T'), E'  \n ', t.fpath('T', 3), 10)$$, '23514', 'AC6 a blank name is rejected');
select t.throws($$insert into material_files (id, author_id, name, storage_path, size_bytes)
  values (t.f(3), t.id('T'), repeat('x', 201), t.fpath('T', 3), 10)$$, '23514', 'AC6 a 201-character name is rejected');
select t.lives($$insert into material_files (id, author_id, name, description, storage_path, size_bytes)
  values (t.f(3), t.id('T'), repeat('й', 200), repeat('d', 2000), t.fpath('T', 3), 10)$$,
  'AC6 200-character name and 2,000-character description are accepted');
select t.throws($$insert into material_files (id, author_id, name, description, storage_path, size_bytes)
  values (t.f(4), t.id('T'), 'x', repeat('d', 2001), t.fpath('T', 4), 10)$$, '23514', 'AC6 a 2,001-character description is rejected');
select t.throws($$insert into material_files (id, author_id, name, storage_path, size_bytes)
  values (t.f(4), t.id('T'), 'x', t.fpath('T', 4), 26214401)$$, '23514', 'AC4 over 25 MB is rejected');
select t.throws($$insert into material_files (id, author_id, name, storage_path, size_bytes)
  values (t.f(4), t.id('T'), 'x', t.fpath('M', 1), 10)$$, '23514', 'a row cannot point at another user''s file');

-- AC 8: students can't upload at all; nobody adds as someone else; anon reads and writes nothing.
select t.login('S1');
select t.throws($$insert into material_files (id, author_id, name, storage_path, size_bytes)
  values (t.f(5), t.id('S1'), 'mine', t.fpath('S1', 5), 10)$$, '42501', 'AC8 a student cannot add an item');
select t.throws($$insert into storage.objects (bucket_id, name, owner) values ('materials', t.fpath('S1', 5), t.id('S1'))$$,
  '42501', 'AC8 a student cannot upload a PDF');
select t.login('N');
select t.throws($$insert into material_files (id, author_id, name, storage_path, size_bytes)
  values (t.f(5), t.id('M'), 'fake', t.fpath('M', 5), 10)$$, '42501', 'AC8 a mentor cannot add an item as someone else');
select t.throws($$insert into storage.objects (bucket_id, name, owner) values ('materials', t.fpath('M', 5), t.id('N'))$$,
  '42501', 'AC8 a mentor cannot upload into another user''s folder');
select t.login(null);
select t.eq((select count(*) from material_files), 0::bigint, 'anon reads no items');
select t.eq((select count(*) from storage.objects where bucket_id = 'materials'), 0::bigint, 'anon reads no PDFs');

-- AC 1 / AC 5: everyone signed in reads all items and PDFs.
select t.login('S2');
select t.eq((select count(*) from material_files), 3::bigint, 'AC1 a student sees all items');
select t.eq((select count(*) from storage.objects where bucket_id = 'materials'), 2::bigint, 'AC5 a student can read the PDFs');
select t.login('N');
select t.eq((select count(*) from material_files), 3::bigint, 'AC1 another mentor sees all items');

-- AC 6 / AC 8: only the author edits, and only name, description and course.
select t.eq(t.affected($$update material_files set name = 'hacked' where id = t.f(1)$$), 0::bigint,
  'AC8 another mentor cannot rename');
select t.login('T');
select t.eq(t.affected($$update material_files set name = 'hacked' where id = t.f(1)$$), 0::bigint,
  'AC8 the teacher cannot rename a mentor''s item');
select t.login('S1');
select t.eq(t.affected($$update material_files set course_id = null where id = t.f(1)$$), 0::bigint,
  'AC8 a student cannot re-link');
select t.login('M');
select t.eq(t.affected($$update material_files set name = ' Algebra, 2nd ed. ', description = '', course_id = t.id('B')
  where id = t.f(1)$$), 1::bigint, 'AC6 the author renames and re-links');
select t.eq((select name || '|' || course_id::text from material_files where id = t.f(1)), 'Algebra, 2nd ed.|' || t.id('B')::text,
  'AC6 the changes are saved, trimmed');
select t.ok((select updated_at >= created_at from material_files where id = t.f(1)), 'AC6 updated_at is set');
select t.lives($$update material_files set course_id = null where id = t.f(1)$$, 'AC6 the author sets No course');
select t.throws($$update material_files set storage_path = t.fpath('T', 2) where id = t.f(1)$$, '42501',
  'the author cannot change the file path');
select t.throws($$update material_files set size_bytes = 1 where id = t.f(1)$$, '42501', 'the author cannot change the size');
select t.throws($$update material_files set author_id = t.id('N') where id = t.f(1)$$, '42501',
  'the author cannot hand the item to someone else');
select t.throws($$update material_files set name = '' where id = t.f(1)$$, '23514', 'AC6 renaming to blank is rejected');

-- AC 7 / AC 8: only the author deletes (row and file).
select t.login('N');
select t.eq(t.affected($$delete from material_files where id = t.f(1)$$), 0::bigint, 'AC8 another mentor cannot delete');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'materials' and name = t.fpath('M', 1)$$), 0::bigint,
  'AC8 another mentor cannot delete the PDF');
-- (ARU-86: the teacher now deletes any item and PDF; tested in aru86_teacher_deletes_any_pdf.test.sql.)
select t.login('S1');
select t.eq(t.affected($$delete from material_files$$), 0::bigint, 'AC8 a student deletes nothing');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'materials'$$), 0::bigint, 'AC8 a student deletes no PDF');
select t.login('M');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'materials' and name = t.fpath('M', 1)$$), 1::bigint,
  'AC7 the author deletes the PDF');
select t.eq(t.affected($$delete from material_files where id = t.f(1)$$), 1::bigint, 'AC7 the author deletes the item');

-- Edge case: the author is made a student. Their item stays visible but they can't change or delete it.
select t.login('M2');
select t.lives($$insert into storage.objects (bucket_id, name, owner) values ('materials', t.fpath('M2', 6), t.id('M2'))$$,
  'M2 uploads a PDF');
select t.lives($$insert into material_files (id, author_id, name, storage_path, size_bytes)
  values (t.f(6), t.id('M2'), 'Mo book', t.fpath('M2', 6), 10)$$, 'M2 adds an item');
select t.login('T');
select t.lives($$select set_user_role(t.id('M2'), 'student')$$, 'the teacher makes M2 a student');
select t.login('M2');
select t.eq(t.affected($$update material_files set name = 'x' where id = t.f(6)$$), 0::bigint,
  'role changed: M2 can no longer rename');
select t.eq(t.affected($$delete from material_files where id = t.f(6)$$), 0::bigint, 'role changed: M2 can no longer delete');
select t.eq(t.affected($$delete from storage.objects where name = t.fpath('M2', 6)$$), 0::bigint,
  'role changed: M2 can no longer delete the PDF');
select t.login('S2');
select t.ok(exists (select 1 from material_files where id = t.f(6)), 'role changed: the item stays visible to others');

-- Edge case: a deleted course leaves its items as "No course" (courses can't be deleted in the app today).
reset role;
insert into courses (id, title, created_by) values ('00000000-0000-0000-0000-0000000000d9', 'Chemistry', t.id('M'));
update material_files set course_id = '00000000-0000-0000-0000-0000000000d9' where id = t.f(2);
delete from courses where id = '00000000-0000-0000-0000-0000000000d9';
select t.ok((select course_id is null from material_files where id = t.f(2)), 'a deleted course leaves the item with no course');
