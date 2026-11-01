-- ARU-30 QA additions to aru30_material_files.test.sql. Rules under test: supabase/migrations/0018_material_files.sql.
-- Storage: nobody writes into someone else's folder or overwrites a stored PDF; a row can only point at the author's
-- own "<author>/<id>.pdf"; the teacher has no special rights over a mentor's item; a demoted mentor can't add new
-- items; server-set times; a link to a course that doesn't exist. (The bucket's PDF-only and 25 MB limits are enforced
-- by the Storage API from storage.buckets, which the dev suite checks; Postgres can't test that part here.)
-- Fixture (t.seed): teacher T; mentors M (owns A), N (owns B), M2; students S1, S2, S3; courses A, B.
select t.seed();

create function t.f(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000f00' || lpad(n::text, 2, '0'))::uuid
$$;
create function t.fpath(who text, n int) returns text language sql immutable as $$
  select t.id(who)::text || '/' || t.f(n)::text || '.pdf'
$$;
grant execute on function t.f(int), t.fpath(text, int) to anon, authenticated;

-- Setup: M has one item with its PDF.
select t.login('M');
insert into storage.objects (bucket_id, name, owner) values ('materials', t.fpath('M', 51), t.id('M'));
insert into material_files (id, author_id, name, storage_path, size_bytes) values (t.f(51), t.id('M'), 'M book', t.fpath('M', 51), 100);

-- Storage: only your own folder; no overwriting a stored PDF (no update policy).
select t.throws($$insert into storage.objects (bucket_id, name, owner) values ('materials', t.fpath('N', 52), t.id('M'))$$, '42501',
  'storage: a mentor cannot upload into another user''s folder');
select t.throws($$insert into storage.objects (bucket_id, name, owner) values ('materials', 'shared/' || t.f(53)::text || '.pdf', t.id('M'))$$, '42501',
  'storage: a mentor cannot upload outside a user folder');
select t.eq(t.affected($$update storage.objects set owner = owner where bucket_id = 'materials' and name = t.fpath('M', 51)$$), 0::bigint,
  'storage: even the author cannot overwrite a stored PDF (no update policy; the PDF cannot be replaced)');
reset role; select t.login('N');
select t.eq(t.affected($$update storage.objects set name = t.fpath('N', 54) where bucket_id = 'materials' and name = t.fpath('M', 51)$$), 0::bigint,
  'storage: another mentor cannot move or rename the author''s PDF');
reset role; select t.login(null);
select t.throws($$insert into storage.objects (bucket_id, name, owner) values ('materials', t.fpath('M', 55), null)$$, '42501',
  'storage: anon cannot upload');

-- A row can only point at the author's own file for that item.
reset role; select t.login('M');
select t.throws($$insert into material_files (id, author_id, name, storage_path, size_bytes)
  values (t.f(56), t.id('M'), 'Points at N', t.id('N')::text || '/' || t.f(56)::text || '.pdf', 10)$$, '23514',
  'row: storage_path in another user''s folder is rejected');
select t.throws($$insert into material_files (id, author_id, name, storage_path, size_bytes)
  values (t.f(57), t.id('M'), 'Points at item 51', t.fpath('M', 51), 10)$$, '23514',
  'row: storage_path of another item is rejected (one file per item)');
select t.throws($$insert into material_files (id, author_id, name, storage_path, size_bytes)
  values (t.f(58), t.id('M'), 'Not a pdf', t.id('M')::text || '/' || t.f(58)::text || '.exe', 10)$$, '23514',
  'row: a path not ending in .pdf is rejected');
select t.throws($$insert into material_files (id, author_id, name, storage_path, size_bytes)
  values (t.f(59), t.id('M'), 'Empty', t.fpath('M', 59), 0)$$, '23514', 'row: a 0-byte size is rejected');
select t.throws($$insert into material_files (id, author_id, name, course_id, storage_path, size_bytes)
  values (t.f(60), t.id('M'), 'Ghost course', '00000000-0000-0000-0000-00000000dead', t.fpath('M', 60), 10)$$, '23503',
  'row: a link to a course that does not exist is rejected');

-- Server-set times: a forged created_at / updated_at is replaced with now().
select t.lives($$insert into material_files (id, author_id, name, storage_path, size_bytes, created_at, updated_at)
  values (t.f(61), t.id('M'), 'Backdated', t.fpath('M', 61), 10, '2000-01-01', '2000-01-01')$$, 'row: insert with forged times');
select t.ok((select created_at > now() - interval '1 minute' and updated_at > now() - interval '1 minute' from material_files where id = t.f(61)),
  'row: created_at and updated_at are the server''s time, not the client''s');
select t.throws($$update material_files set created_at = '2000-01-01' where id = '00000000-0000-0000-0000-0000000f0061'$$, '42501',
  'row: the author cannot change created_at (column grants)');

-- The teacher has no special rights over a mentor's item (AC 8: only the author edits and deletes).
reset role; select t.login('T');
select t.eq(t.affected($$update material_files set name = 'Teacher rename' where id = '00000000-0000-0000-0000-0000000f0051'$$), 0::bigint,
  'AC8 the teacher cannot rename a mentor''s item');
select t.eq(t.affected($$delete from material_files where id = '00000000-0000-0000-0000-0000000f0051'$$), 0::bigint,
  'AC8 the teacher cannot delete a mentor''s item');
select t.eq(t.affected($$delete from storage.objects where bucket_id = 'materials' and name = t.fpath('M', 51)$$), 0::bigint,
  'AC8 the teacher cannot delete a mentor''s PDF');
select t.throws($$insert into material_files (id, author_id, name, storage_path, size_bytes)
  values (t.f(62), t.id('M'), 'In M''s name', t.fpath('M', 62), 10)$$, '42501', 'AC8 the teacher cannot add an item as a mentor');

-- A mentor made a student can't add anything new (edge case: author's role changed).
reset role;
update profiles set role = 'student' where id = t.id('M2');
select t.login('M2');
select t.throws($$insert into storage.objects (bucket_id, name, owner) values ('materials', t.fpath('M2', 63), t.id('M2'))$$, '42501',
  'role changed: a former mentor cannot upload a PDF');
select t.throws($$insert into material_files (id, author_id, name, storage_path, size_bytes)
  values (t.f(63), t.id('M2'), 'Late book', t.fpath('M2', 63), 10)$$, '42501', 'role changed: a former mentor cannot add an item');
select t.eq((select count(*) from material_files where id = t.f(51)), 1::bigint, 'role changed: they still see the items');

-- Nothing above changed M's item.
reset role;
select t.eq((select name || '|' || storage_path from material_files where id = t.f(51)), 'M book|' || t.fpath('M', 51),
  'M''s item is unchanged by everyone else''s attempts');
select t.eq((select count(*) from storage.objects where bucket_id = 'materials' and name = t.fpath('M', 51)), 1::bigint,
  'M''s PDF is still there');
