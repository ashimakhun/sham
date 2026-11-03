-- QA ARU-86: gaps in aru86_teacher_deletes_any_pdf.test.sql: the teacher still can't edit, rename, move or overwrite
-- another user's PDF (row or file), can't add a file into another user's folder, the new delete rule doesn't reach
-- Blog posts or other buckets, a course-only PDF of a course the teacher deleted (ARU-85, now visible to everyone) can
-- still be deleted, and a mentor's own delete still works.
select t.seed();
create function pg_temp.p(n int) returns uuid language sql immutable as $$ select md5('aru86qa-' || n)::uuid $$;
grant execute on function pg_temp.p(int) to authenticated;

set session_replication_role = replica;
insert into material_files (id, author_id, name, course_id, course_only, storage_path, size_bytes) values
  (pg_temp.p(1), t.id('M'), 'M book', null, false, t.id('M') || '/' || pg_temp.p(1) || '.pdf', 10),
  (pg_temp.p(2), t.id('N'), 'A only', t.id('A'), true, t.id('N') || '/' || pg_temp.p(2) || '.pdf', 10),
  (pg_temp.p(3), t.id('M'), 'M own', null, false, t.id('M') || '/' || pg_temp.p(3) || '.pdf', 10);
insert into storage.objects (bucket_id, name, owner) values
  ('materials', t.id('M') || '/' || pg_temp.p(1) || '.pdf', t.id('M')),
  ('materials', t.id('N') || '/' || pg_temp.p(2) || '.pdf', t.id('N')),
  ('materials', t.id('M') || '/' || pg_temp.p(3) || '.pdf', t.id('M'));
insert into materials (id, teacher_id, title, body) values (pg_temp.p(9), t.id('M'), 'M post', 'Body');
set session_replication_role = origin;

select t.login('T');
-- Editing stays author-only (row and file).
select t.eq(t.affected(format('update material_files set course_id = %L where id = %L', t.id('B'), pg_temp.p(1))), 0::bigint,
  'AC1 the teacher can''t move another''s PDF to a course');
select t.eq(t.affected(format('update storage.objects set name = %L where bucket_id = ''materials'' and name = %L',
  t.id('T') || '/stolen.pdf', t.id('M') || '/' || pg_temp.p(1) || '.pdf')), 0::bigint, 'AC1 the teacher can''t rename another''s file');
select t.throws(format('insert into storage.objects (bucket_id, name, owner) values (''materials'', %L, %L)',
  t.id('M') || '/planted.pdf', t.id('T')), '42501', 'AC1 the teacher can''t add a file into another''s folder');
-- The new rule is for Knowledge base PDFs only: Blog posts of others stay.
select t.eq(t.affected(format('delete from materials where id = %L', pg_temp.p(9))), 0::bigint,
  'out of scope: the teacher still can''t delete another''s Blog post');
reset role;

-- A course-only PDF whose course was deleted (ARU-85): visible to everyone, still deletable by the teacher.
select t.login('T');
select t.lives(format('select delete_course(%L)', t.id('A')), 'ARU-85 the teacher deletes course A');
select t.eq(t.affected(format('delete from storage.objects where bucket_id = ''materials'' and name = %L',
  t.id('N') || '/' || pg_temp.p(2) || '.pdf')), 1::bigint, 'AC5 the teacher deletes the no-longer-course PDF''s file');
select t.eq(t.affected(format('delete from material_files where id = %L', pg_temp.p(2))), 1::bigint, 'AC5 and its row');
reset role;

-- AC 7: a mentor still deletes their own PDF (file and row).
select t.login('M');
select t.eq(t.affected(format('delete from storage.objects where bucket_id = ''materials'' and name = %L',
  t.id('M') || '/' || pg_temp.p(3) || '.pdf')), 1::bigint, 'AC7 a mentor deletes their own file');
select t.eq(t.affected(format('delete from material_files where id = %L', pg_temp.p(3))), 1::bigint, 'AC7 and their own row');
reset role;
select t.eq((select count(*) from material_files where id = pg_temp.p(1)), 1::bigint, 'M''s other PDF is untouched');
