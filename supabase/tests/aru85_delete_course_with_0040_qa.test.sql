-- QA ARU-85 with ARU-75's 0040: deleting a course whose shared rows point to a deleted account (null author,
-- checker, creator) works, and the course's former owner can then delete their account.
-- Needs 0040_delete_account.sql (ARU-75): fails by design on this branch until ARU-93 stacks it on ARU-75's.
select t.seed();
select t.make_assignments(t.id('A'));
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M2'));
insert into homework (id, student_id, course_id, assignment_id, title, status, checked_by) values
  (md5('aru85qa40-hw')::uuid, t.id('S1'), t.id('A'), t.assignment(t.id('A'), 1), 'Checked by M2', 'checked', t.id('M2'));
insert into course_messages (course_id, author_id, body) values (t.id('A'), t.id('M2'), 'from M2');
update course_meetings set notes_updated_by = t.id('M2') where course_id = t.id('A');

-- M2 deletes their account: A's rows stay with null references.
select t.lives(format('delete from auth.users where id = %L', t.id('M2')), 'ARU-75 M2 (owns nothing) is deleted');
select t.eq((select count(*) from course_messages where course_id = t.id('A') and author_id is null), 1::bigint,
  'the message stays with no author');

-- The owner M can't delete their account while owning A.
select t.ok(account_deletion_problem(t.id('M')) like 'You own courses: Algebra%', 'ARU-75 M owns A: account deletion refused');

-- The teacher deletes A (null references included); then M can be deleted.
select t.login('T');
select t.lives($$select delete_course(t.id('A'))$$, 'the teacher deletes A with rows pointing to a deleted account');
reset role;
select t.eq((select count(*) from course_messages where course_id = t.id('A')), 0::bigint, 'AC5 the null-author message is gone too');
select t.eq((select count(*) from homework where id = md5('aru85qa40-hw')::uuid), 0::bigint, 'AC5 the homework checked by a deleted account is gone');
select t.eq(account_deletion_problem(t.id('M')), null::text, 'edge: the former owner can now delete their account');
select t.lives(format('delete from auth.users where id = %L', t.id('M')), 'ARU-75 the former owner''s account is deleted');
