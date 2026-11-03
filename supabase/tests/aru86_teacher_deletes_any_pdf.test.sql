-- ARU-86: the teacher deletes any Knowledge base PDF (row and file). Policies under test:
-- supabase/migrations/0043_teacher_deletes_any_material_file.sql (the authors' own rules are 0018's).
-- PDFs: by mentor M, by mentor M2 who is later made a student, by N (course-only on a hidden course), by T (own), and
-- one by S3 (an author state only seeded data can reach). Seeded as the admin.
select t.seed();

create function t.pdf(name text) returns uuid language sql immutable as $$ select md5('aru86-' || name)::uuid $$;
create function t.pdfpath(who text, name text) returns text language sql immutable as $$
  select t.id(who)::text || '/' || t.pdf(name)::text || '.pdf'
$$;
grant execute on function t.pdf(text), t.pdfpath(text, text) to anon, authenticated;

set session_replication_role = replica;
insert into courses (id, title, created_by, hidden) values (md5('aru86-hidden')::uuid, 'Hidden', t.id('N'), true);
insert into material_files (id, author_id, name, course_id, course_only, storage_path, size_bytes) values
  (t.pdf('m'), t.id('M'), 'M book', null, false, t.pdfpath('M', 'm'), 10),
  (t.pdf('m2'), t.id('M2'), 'M2 book', null, false, t.pdfpath('M2', 'm2'), 10),
  (t.pdf('m3'), t.id('M'), 'M book 2', null, false, t.pdfpath('M', 'm3'), 10),
  (t.pdf('hidden'), t.id('N'), 'Hidden course book', md5('aru86-hidden')::uuid, true, t.pdfpath('N', 'hidden'), 10),
  (t.pdf('own'), t.id('T'), 'T book', null, false, t.pdfpath('T', 'own'), 10),
  (t.pdf('s3'), t.id('S3'), 'Student book', null, false, t.pdfpath('S3', 's3'), 10);
insert into storage.objects (bucket_id, name, owner) values
  ('materials', t.pdfpath('M', 'm'), t.id('M')),
  ('materials', t.pdfpath('M2', 'm2'), t.id('M2')),
  ('materials', t.pdfpath('M', 'm3'), t.id('M')),
  ('materials', t.pdfpath('N', 'hidden'), t.id('N')),
  ('materials', t.pdfpath('T', 'own'), t.id('T')),
  ('materials', t.pdfpath('S3', 's3'), t.id('S3'));
-- M2 is made a student after sharing.
update profiles set role = 'student' where id = t.id('M2');
set session_replication_role = origin;

-- AC 7: a mentor can't delete another user's PDF (row or file).
select t.login('N');
select t.eq(t.affected($$delete from material_files where id = t.pdf('m')$$), 0::bigint, 'AC7 a mentor can''t delete another''s row');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'materials' and name = t.pdfpath('M', 'm')$$), 0::bigint,
  'AC7 a mentor can''t delete another''s file');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'materials' and name = t.pdfpath('T', 'own')$$), 0::bigint,
  'AC7 a mentor can''t delete the teacher''s file');
-- AC 8: students (M2, now a student, included) delete nothing, not even their own.
reset role; select t.login('S1');
select t.eq(t.affected($$delete from material_files$$), 0::bigint, 'AC8 a student deletes no row');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'materials'$$), 0::bigint, 'AC8 a student deletes no file');
reset role; select t.login('M2');
select t.eq(t.affected($$delete from material_files where id = t.pdf('m2')$$), 0::bigint, 'AC8 a mentor made student can''t delete their own');
reset role; select t.login(null);
select t.eq(t.affected($$delete from material_files$$), 0::bigint, 'anon deletes no row');
reset role;
select t.eq((select count(*) from material_files), 6::bigint, 'nothing deleted so far');
select t.eq((select count(*) from storage.objects where bucket_id = 'materials'), 6::bigint, 'no file deleted so far');

-- AC 1 / AC 3 / AC 4 / AC 5 / AC 9: the teacher deletes file then row, whoever the author is.
select t.login('T');
select t.eq((select count(*) from storage.objects where bucket_id = 'materials'), 6::bigint,
  'AC9 the teacher reads every PDF (Storage needs SELECT to delete)');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'materials' and name = t.pdfpath('M', 'm')$$), 1::bigint,
  'AC1 the teacher deletes a mentor''s file');
select t.eq(t.affected($$delete from material_files where id = t.pdf('m')$$), 1::bigint, 'AC1 the teacher deletes a mentor''s row');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'materials' and name = t.pdfpath('M2', 'm2')$$), 1::bigint,
  'AC4 the file of a mentor made student');
select t.eq(t.affected($$delete from material_files where id = t.pdf('m2')$$), 1::bigint, 'AC4 the row of a mentor made student');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'materials' and name = t.pdfpath('S3', 's3')$$), 1::bigint,
  'AC4 any author: a student''s file');
select t.eq(t.affected($$delete from material_files where id = t.pdf('s3')$$), 1::bigint, 'AC4 any author: a student''s row');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'materials' and name = t.pdfpath('N', 'hidden')$$), 1::bigint,
  'AC5 the file of a course-only PDF on a hidden course');
select t.eq(t.affected($$delete from material_files where id = t.pdf('hidden')$$), 1::bigint, 'AC5 its row');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'materials' and name = t.pdfpath('T', 'own')$$), 1::bigint,
  'AC6 own file');
select t.eq(t.affected($$delete from material_files where id = t.pdf('own')$$), 1::bigint, 'AC6 own row');
-- AC 10: already gone deletes nothing, without an error.
select t.eq(t.affected($$delete from material_files where id = t.pdf('m')$$), 0::bigint, 'AC10 an already deleted row: 0 rows');
reset role;
select t.eq((select count(*) from storage.objects where bucket_id = 'materials' and name in
  (t.pdfpath('M', 'm'), t.pdfpath('M2', 'm2'), t.pdfpath('S3', 's3'), t.pdfpath('N', 'hidden'), t.pdfpath('T', 'own'))), 0::bigint,
  'AC3 the deleted files are really gone');
select t.eq((select count(*) from material_files where id = t.pdf('m3')), 1::bigint, 'other PDFs untouched');
select t.eq((select count(*) from storage.objects where name = t.pdfpath('M', 'm3')), 1::bigint, 'other files untouched');
select t.eq((select count(*) from storage.objects where bucket_id = 'homework'), 2::bigint, 'homework photos untouched');

-- AC 9: someone no longer the teacher can't. (A teacher can't be demoted by set_user_role; the admin does it here.)
set session_replication_role = replica;
update profiles set role = 'mentor' where id = t.id('T');
set session_replication_role = origin;
select t.login('T');
select t.eq(t.affected($$delete from material_files where id = t.pdf('m3')$$), 0::bigint, 'AC9 a former teacher can''t delete another''s row');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'materials' and name = t.pdfpath('M', 'm3')$$), 0::bigint,
  'AC9 a former teacher can''t delete another''s file');
reset role;
