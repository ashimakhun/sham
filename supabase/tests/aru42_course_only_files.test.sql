-- ARU-42: course-only Knowledge base PDFs. Rules under test: supabase/migrations/0020_course_only_material_files.sql.
-- Fixture (t.seed): teacher T; mentors M (owns A), N (owns B), M2; students S1, S2, S3.
-- Course A: owner M, listeners S1 (student) and M2 (mentor). Not in A: S2 (student), N (mentor).
-- Items: CO = course-only on A by N (an author who is not in A); EV = Everyone on A by M; NC = no course by T;
-- TCO = course-only on A by T.
select t.seed();
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M')), (t.id('A'), t.id('M2'), t.id('M'));

create function t.f(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000f42' || lpad(n::text, 2, '0'))::uuid
$$;
create function t.fp(who text, n int) returns text language sql immutable as $$ select t.id(who)::text || '/' || t.f(n)::text || '.pdf' $$;
grant execute on function t.f(int), t.fp(text, int) to anon, authenticated;
-- What a user sees: rows and PDFs.
create function t.rows() returns text language sql as $$
  select coalesce(string_agg(name, ',' order by name), '') from material_files
$$;
create function t.pdfs() returns bigint language sql as $$
  select count(*) from storage.objects where bucket_id = 'materials'
$$;
grant execute on function t.rows(), t.pdfs() to anon, authenticated;

-- AC 10: an item that exists before the column is visible to everyone (default false).
reset role;
insert into storage.objects (bucket_id, name, owner) values ('materials', t.fp('T', 1), t.id('T'));
insert into material_files (id, author_id, name, course_id, storage_path, size_bytes) values (t.f(1), t.id('T'), 'NC', null, t.fp('T', 1), 10);
select t.ok(not (select course_only from material_files where id = t.f(1)), 'AC10 a new or existing item defaults to Everyone');
select t.ok((select is_nullable = 'NO' and column_default = 'false' from information_schema.columns
  where table_name = 'material_files' and column_name = 'course_only'), 'AC10 course_only is not null, default false');
-- Check constraints only: Postgres 18 (ubuntu-latest since 26.04) also lists NOT NULL as a pg_constraint row.
select t.ok(not exists (select 1 from pg_constraint where conrelid = 'material_files'::regclass and contype = 'c'
  and pg_get_constraintdef(oid) like '%course_only%'),
  'data: no check constraint on course_only');
select t.ok((select prosecdef and 'search_path=public' = any(proconfig) from pg_proc where proname = 'can_see_material_file'),
  'data: can_see_material_file is security definer with search_path = public');

-- Uploads through the app's path (file, then row) by each author.
select t.login('N');
select t.lives($$insert into storage.objects (bucket_id, name, owner) values ('materials', t.fp('N', 2), t.id('N'))$$, 'N uploads CO''s PDF');
select t.lives($$insert into material_files (id, author_id, name, course_id, course_only, storage_path, size_bytes)
  values (t.f(2), t.id('N'), 'CO', t.id('A'), true, t.fp('N', 2), 10)$$, 'AC1 a mentor not in A adds a course-only item on A');
select t.login('M');
select t.lives($$insert into storage.objects (bucket_id, name, owner) values ('materials', t.fp('M', 3), t.id('M'))$$, 'M uploads EV''s PDF');
select t.lives($$insert into material_files (id, author_id, name, course_id, storage_path, size_bytes)
  values (t.f(3), t.id('M'), 'EV', t.id('A'), t.fp('M', 3), 10)$$, 'AC1 the owner adds an Everyone item on A');
select t.login('T');
select t.lives($$insert into storage.objects (bucket_id, name, owner) values ('materials', t.fp('T', 4), t.id('T'))$$, 'T uploads TCO''s PDF');
select t.lives($$insert into material_files (id, author_id, name, course_id, course_only, storage_path, size_bytes)
  values (t.f(4), t.id('T'), 'TCO', t.id('A'), true, t.fp('T', 4), 10)$$, 'AC1 the teacher adds a course-only item on A');

-- AC 4: people in the course, the author and the teacher see course-only items (rows and PDFs).
select t.login('M');
select t.eq(t.rows(), 'CO,EV,NC,TCO', 'AC4 the owner sees everything on A');
select t.eq(t.pdfs(), 4::bigint, 'AC4 the owner reads every PDF');
select t.login('S1');
select t.eq(t.rows(), 'CO,EV,NC,TCO', 'AC4 a student listener sees course-only items');
select t.eq(t.pdfs(), 4::bigint, 'AC4 a student listener reads their PDFs');
select t.login('M2');
select t.eq(t.rows(), 'CO,EV,NC,TCO', 'AC4 a mentor listener sees course-only items');
select t.login('T');
select t.eq(t.rows(), 'CO,EV,NC,TCO', 'AC4 the teacher sees everything');
select t.eq(t.pdfs(), 4::bigint, 'AC4 the teacher reads every PDF');
select t.login('N');
select t.eq(t.rows(), 'CO,EV,NC', 'AC4/AC5 the non-member author sees their own course-only item, not the teacher''s');
select t.eq(t.pdfs(), 3::bigint, 'AC4/AC6 the author reads their own PDF, not TCO''s');

-- AC 5 / AC 6: a non-member student sees only Everyone items; course-only rows and PDFs are denied.
select t.login('S2');
select t.eq(t.rows(), 'EV,NC', 'AC5 a non-member student sees only Everyone items');
select t.eq(t.pdfs(), 2::bigint, 'AC6 a non-member student reads only Everyone PDFs');
select t.ok(not exists (select 1 from storage.objects where name = t.fp('N', 2)), 'AC6 no signed URL or download of CO''s PDF');
select t.ok(not exists (select 1 from material_files where id = t.f(2)), 'AC5 opening CO by id finds nothing');
select t.login(null);
select t.eq(t.rows(), '', 'anon sees nothing');

-- AC 2 / AC 8: only the author switches the setting.
select t.login('S1');
select t.eq(t.affected($$update material_files set course_only = false where id = t.f(2)$$), 0::bigint, 'AC2 a student cannot change it');
select t.login('M');
select t.eq(t.affected($$update material_files set course_only = false where id = t.f(2)$$), 0::bigint,
  'AC2 the course owner cannot change someone else''s item');
select t.login('N');
select t.eq(t.affected($$update material_files set course_only = false where id = t.f(2)$$), 1::bigint, 'AC8 the author switches CO to Everyone');
select t.login('S2');
select t.eq(t.rows(), 'CO,EV,NC', 'AC8 S2 now sees CO');
select t.login('N');
select t.eq(t.affected($$update material_files set course_only = true where id = t.f(2)$$), 1::bigint, 'AC8 the author switches it back');
select t.login('S2');
select t.eq(t.rows(), 'EV,NC', 'AC8 S2 no longer sees CO');

-- AC 7: listener and owner changes.
select t.login('M');
select t.lives($$insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S2'), t.id('M'))$$, 'AC7 S2 is added to A');
select t.login('S2');
select t.eq(t.rows(), 'CO,EV,NC,TCO', 'AC7 the new listener sees A''s course-only items');
select t.login('M');
select t.lives($$select remove_listener(t.id('A'), t.id('S1'))$$, 'AC7 S1 is removed from A');
select t.login('S1');
select t.eq(t.rows(), 'EV,NC', 'AC7 the removed listener loses A''s course-only items');
select t.eq(t.pdfs(), 2::bigint, 'AC7 and their PDFs');
select t.login('T');
select t.lives($$select change_course_owner(t.id('A'), t.id('N'))$$, 'AC7 the teacher makes N the owner of A');
select t.login('M');
select t.eq(t.rows(), 'EV,NC', 'AC7 the replaced owner loses A''s course-only items (keeps their own EV)');
select t.login('N');
select t.eq(t.rows(), 'CO,EV,NC,TCO', 'AC7 the new owner sees them');
select t.login('T');
select t.eq(t.rows(), 'CO,EV,NC,TCO', 'AC7 the teacher never loses access');

-- "No course": a course-only flag without a course counts as Everyone (also after the course is unlinked).
select t.login('N');
select t.lives($$update material_files set course_id = null where id = t.f(2)$$, 'AC2 the author unlinks CO (app also saves Everyone)');
select t.login('S3');
select t.ok(exists (select 1 from material_files where id = t.f(2)), 'AC2 an item with no course is visible to everyone');

-- AC 11: an author reads and removes their own object when no row exists (Discard upload?, half-done delete).
select t.login('M2');
select t.lives($$insert into storage.objects (bucket_id, name, owner) values ('materials', t.fp('M2', 9), t.id('M2'))$$,
  'AC11 M2 uploads a PDF and never saves the row');
select t.eq((select count(*) from storage.objects where name = t.fp('M2', 9)), 1::bigint, 'AC11 the author can read their orphan object');
select t.login('S3');
select t.eq((select count(*) from storage.objects where name = t.fp('M2', 9)), 0::bigint, 'AC11 nobody else can read an orphan object');
select t.login('M2');
select t.eq(t.affected($$delete from storage.objects where name = t.fp('M2', 9)$$), 1::bigint, 'AC11 the author removes their orphan object');

-- Regression (ARU-30): upload and delete rules unchanged.
select t.login('S1');
select t.throws($$insert into storage.objects (bucket_id, name, owner) values ('materials', t.fp('S1', 8), t.id('S1'))$$, '42501',
  'regression: a student still cannot upload');
reset role;
