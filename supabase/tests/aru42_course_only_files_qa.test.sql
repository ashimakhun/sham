-- QA ARU-42: course-only Knowledge base PDFs, gaps in aru42_course_only_files.test.sql: the app's own write paths
-- (UPDATE ... RETURNING, upload with no row yet), a demoted author, course_only left true without a course, other
-- users' folders, and hidden courses (0019).
-- Fixture: t.seed(); course A (owner M) with listener S1. Hidden course H (owner M) with listener M2. N, S2 are in
-- neither. Items: CO = course-only on A by N (author not in A); HCO = course-only on H by M; HEV = Everyone on H by M.
select t.seed();
insert into courses (id, title, created_by, hidden) values ('00000000-0000-0000-0000-0000000004a1', 'Secret', t.id('M'), true);
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')), ('00000000-0000-0000-0000-0000000004a1', t.id('M2'), t.id('M'));

create function t.h() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000004a1'::uuid $$;
create function t.q(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000004b' || n::text)::uuid
$$;
create function t.qp(who text, n int) returns text language sql immutable as $$ select t.id(who)::text || '/' || t.q(n)::text || '.pdf' $$;
create function t.names() returns text language sql as $$
  select coalesce(string_agg(name, ',' order by name), '') from material_files
$$;
create function t.pdfs() returns bigint language sql as $$
  select count(*) from storage.objects where bucket_id = 'materials'
$$;
grant execute on function t.h(), t.q(int), t.qp(text, int), t.names(), t.pdfs() to anon, authenticated;

-- The app's upload path: file first (own folder), then the row. No row yet: only the author can read the object.
select t.login('N');
select t.lives($$insert into storage.objects (bucket_id, name, owner) values ('materials', t.qp('N', 1), t.id('N'))$$, 'N uploads');
select t.login('S2');
select t.eq(t.pdfs(), 0::bigint, 'AC6 another user can''t read an object that has no row yet');
select t.login('M2');
select t.eq(t.pdfs(), 0::bigint, 'AC6 nor can another mentor');
select t.login('N');
select t.lives($$insert into material_files (id, author_id, name, course_id, course_only, storage_path, size_bytes)
  values (t.q(1), t.id('N'), 'CO', t.id('A'), true, t.qp('N', 1), 10)$$, 'AC1 N adds CO, course-only on A');
select t.eq(t.names(), 'CO', 'AC4 the author (not in A) sees CO');
select t.login('M');
select t.lives($$insert into storage.objects (bucket_id, name, owner) values ('materials', t.qp('M', 2), t.id('M'))$$, 'M uploads 2');
select t.lives($$insert into material_files (id, author_id, name, course_id, course_only, storage_path, size_bytes)
  values (t.q(2), t.id('M'), 'HCO', t.h(), true, t.qp('M', 2), 10)$$, 'AC9 M adds HCO, course-only on hidden H');
select t.lives($$insert into storage.objects (bucket_id, name, owner) values ('materials', t.qp('M', 3), t.id('M'))$$, 'M uploads 3');
select t.lives($$insert into material_files (id, author_id, name, course_id, storage_path, size_bytes)
  values (t.q(3), t.id('M'), 'HEV', t.h(), t.qp('M', 3), 10)$$, 'AC9 M adds HEV, Everyone on hidden H');

-- AC 9: hidden course H.
select t.login('M2');
select t.eq(t.names(), 'HCO,HEV', 'AC9 H''s mentor listener sees both H items (not CO on A)');
select t.eq(t.pdfs(), 2::bigint, 'AC9 and reads both PDFs');
select t.login('N');
select t.eq(t.names(), 'CO,HEV', 'AC9 a non-participant mentor sees HEV (Everyone) but not HCO');
select t.eq((select count(*) from storage.objects where name = t.qp('M', 2)), 0::bigint, 'AC9 and can''t read HCO''s PDF');
select t.eq((select count(*) from storage.objects where name = t.qp('M', 3)), 1::bigint, 'AC9 but reads HEV''s PDF');
select t.login('S2');
select t.eq(t.names(), 'HEV', 'AC5/AC9 a non-member student sees only HEV');
select t.login('S1');
select t.eq(t.names(), 'CO,HEV', 'AC4 A''s student listener sees CO and HEV, not HCO');
select t.login('T');
select t.eq(t.names(), 'CO,HCO,HEV', 'AC4 the teacher sees all three');

-- The app's edit path: UPDATE ... RETURNING id (updateMaterialFile) works for an author who is not in the course.
select t.login('N');
do $$
declare n int;
begin
  with u as (update material_files set name = 'CO', course_only = true where id = t.q(1) returning id) select count(*) into n from u;
  perform t.eq(n, 1, 'AC2 the author''s update with RETURNING returns the row');
end $$;
-- A non-author's update returns nothing, even for a row they can see.
do $$
declare n int;
begin
  with u as (update material_files set course_only = true where id = t.q(3) returning id) select count(*) into n from u;
  perform t.eq(n, 0, 'AC2 a non-author mentor can''t change HEV');
end $$;

-- course_only left true while the course is unlinked counts as Everyone (direct call; the app always saves false).
select t.lives($$update material_files set course_id = null where id = t.q(1)$$, 'the author unlinks CO but leaves course_only');
reset role;
select t.ok((select course_only and course_id is null from material_files where id = t.q(1)), 'CO is course_only with no course');
select t.login('S2');
select t.ok(t.names() like '%CO%' and exists (select 1 from storage.objects where name = t.qp('N', 1)),
  'no course: visible to everyone, PDF included');
select t.login('N');
select t.lives($$update material_files set course_id = t.id('A') where id = t.q(1)$$, 'the author links CO to A again');
select t.login('S2');
select t.eq(t.names(), 'HEV', 'relinked: S2 loses CO again');

-- Edge case: an author made a student keeps seeing their own course-only item but can't edit it.
select t.login('T');
select t.lives($$select change_course_owner(t.id('B'), t.id('T'))$$, 'the teacher takes B so N can be demoted');
select t.lives($$select set_user_role(t.id('N'), 'student')$$, 'N is made a student');
select t.login('N');
select t.eq(t.names(), 'CO,HEV', 'edge: the demoted author still sees CO (and HEV), not HCO');
select t.eq((select count(*) from storage.objects where name = t.qp('N', 1)), 1::bigint, 'edge: and still reads its PDF');
select t.eq(t.affected($$update material_files set course_only = false where id = t.q(1)$$), 0::bigint,
  'edge: but can''t change it any more');
reset role;
select t.ok((select course_only from material_files where id = t.q(1)), 'CO is still course-only');

-- AC 7 on a hidden course: H moves to the teacher; M (old owner, the author) keeps HCO; a removed listener loses it.
select t.login('T');
select t.lives($$select change_course_owner(t.h(), t.id('T'))$$, 'the teacher takes H');
select t.login('M');
select t.ok(not exists (select 1 from courses where id = t.h()), 'AC7 M no longer sees H');
select t.ok(t.names() like '%HCO%' and exists (select 1 from storage.objects where name = t.qp('M', 2)),
  'AC7 but keeps HCO and its PDF as the author');
select t.login('T');
select t.lives($$select remove_listener(t.h(), t.id('M2'))$$, 'the teacher removes M2 from H');
select t.login('M2');
select t.eq(t.names(), 'HEV', 'AC7 the removed listener keeps only the Everyone item');
select t.eq(t.pdfs(), 1::bigint, 'AC7 and only its PDF');
reset role;
