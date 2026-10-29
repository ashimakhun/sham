-- ARU-24 (post-merge QA): the app hides a course's details from a student who is not a listener; the data
-- behind those details must already be denied by RLS (no policy change in ARU-24). One place that checks every
-- course table for such a student, plus what stays readable on purpose (the course row itself).
select t.seed();
delete from homework;
-- A owned by M with listener S1; S2 is in nothing.
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
insert into homework (id, student_id, course_id, title) values (t.id('HW_A1'), t.id('S1'), t.id('A'), 'S1 in A');
insert into course_messages (course_id, author_id, body) values (t.id('A'), t.id('M'), 'Welcome to Algebra');
insert into course_meetings (course_id, starts_at, topic, created_by)
  values (t.id('A'), now() + interval '1 day', 'Secret topic', t.id('M'));

select t.login('S2');
-- Readable on purpose (out of scope: column-level hiding): every course's row, so titles can be listed.
select t.eq((select count(*) from courses), 2::bigint, 'courses stay readable for a non-listener student (titles are listed)');
-- Denied: everything else about course A.
select t.eq((select count(*) from course_members where course_id = t.id('A')), 0::bigint, 'non-listener student: no listener rows of A');
select t.eq((select count(*) from course_messages where course_id = t.id('A')), 0::bigint, 'non-listener student: no chat messages of A');
select t.eq((select count(*) from course_meetings where course_id = t.id('A')), 0::bigint, 'non-listener student: no meetings of A');
select t.eq((select count(*) from homework where course_id = t.id('A')), 0::bigint, 'non-listener student: no homework of A');
select t.throws($$insert into homework (student_id, course_id, title) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d1', 'not in A')$$, '42501',
  'non-listener student: submitting homework to A is rejected');
select t.throws($$insert into course_messages (course_id, author_id, body) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2', 'hi')$$, '42501',
  'non-listener student: posting in A''s chat is rejected');

-- The listener student S1 still sees all of it (AC 6 unchanged).
reset role; select t.login('S1');
select t.eq((select count(*) from course_members where course_id = t.id('A')), 1::bigint, 'listener student: sees A''s listeners');
select t.eq((select count(*) from course_messages where course_id = t.id('A')), 1::bigint, 'listener student: sees A''s chat');
select t.eq((select count(*) from course_meetings where course_id = t.id('A')), 1::bigint, 'listener student: sees A''s meetings');
select t.eq((select count(*) from homework where course_id = t.id('A')), 1::bigint, 'listener student: sees own homework in A');

-- AC 7 at the data level: once added, S2 sees A's details; once removed, they're gone again.
reset role;
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S2'), t.id('M'));
select t.login('S2');
select t.eq((select count(*) from course_meetings where course_id = t.id('A')), 1::bigint, 'after being added: S2 sees A''s meetings');
select t.eq((select count(*) from course_messages where course_id = t.id('A')), 1::bigint, 'after being added: S2 sees A''s chat');
reset role; select t.login('M');
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2')$$, 'M removes S2 from A');
reset role; select t.login('S2');
select t.eq((select count(*) from course_meetings where course_id = t.id('A')), 0::bigint, 'after removal: S2 sees no meetings of A');
select t.eq((select count(*) from course_messages where course_id = t.id('A')), 0::bigint, 'after removal: S2 sees no chat of A');
