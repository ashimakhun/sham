-- QA ARU-60: gaps in aru60_meeting_homework_checked.test.sql: a null "checked", role and membership changes after a
-- mark, a new owner, deleting the checker's account, and that students still read the meeting (with the new columns).
-- Course A owned by mentor M, listener S1; N is a mentor not in A; teacher T.
select t.seed();
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
insert into course_meetings (id, course_id, starts_at, topic, status, created_by) values
  ('00000000-0000-0000-0000-00000060a0c1', t.id('A'), now() - interval '2 days', 'Done', 'completed', t.id('M'));
create function t.c() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-00000060a0c1'::uuid $$;
create function t.checked_by() returns uuid language sql security definer as $$
  select homework_checked_by from course_meetings where id = t.c()
$$;
grant execute on function t.c(), t.checked_by() to anon, authenticated;

select t.login('N');
select t.lives($$select set_meeting_homework_checked(t.c(), true)$$, 'N (not a listener) marks C checked');
reset role;

-- AC 8: N is added as a listener of A afterwards: N can no longer undo; the teacher can.
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('N'), t.id('M'));
select t.login('N');
select t.throws($$select set_meeting_homework_checked(t.c(), false)$$, '42501', 'AC8 a mentor who became a listener can''t undo');
select t.login('T');
select t.lives($$select set_meeting_homework_checked(t.c(), false)$$, 'AC7 the teacher undoes');

-- A mentor made a student loses the action.
select t.login('T');
select t.lives($$select set_user_role(t.id('M2'), 'student')$$, 'M2 (no courses) is made a student');
select t.login('M2');
select t.throws($$select set_meeting_homework_checked(t.c(), true)$$, '42501', 'AC8 a mentor made a student is refused');

-- A new owner who isn't a listener can mark; the old owner (still a mentor, not a listener) can too.
select t.login('T');
select t.lives($$select remove_listener(t.id('A'), t.id('N'))$$, 'N is removed from A again');
select t.lives($$select change_course_owner(t.id('A'), t.id('N'))$$, 'A is handed to N');
select t.login('N');
select t.lives($$select set_meeting_homework_checked(t.c(), true)$$, 'the new owner marks C');
select t.login('M');
select t.lives($$select set_meeting_homework_checked(t.c(), true)$$, 'the old owner''s retry is a no-op');
reset role;
select t.eq(t.checked_by(), t.id('N'), 'AC10 the first mark is kept');

-- Students still read the meeting, with the new columns (the app shows "Homework checked by …").
select t.login('S1');
select t.ok((select homework_checked_at is not null and homework_checked_by = t.id('N') from course_meetings where id = t.c()),
  'AC6 a student listener reads who checked and when');
select t.eq(t.affected($$update course_meetings set homework_checked_at = null where id = t.c()$$), 0::bigint,
  'AC8 a student can''t clear it directly');

-- Deleting the checker's account keeps the mark, with an unknown checker (the app shows "Unknown").
reset role;
update courses set created_by = t.id('M') where id in (t.id('A'), t.id('B'));
delete from auth.users where id = t.id('N');
select t.ok((select homework_checked_at is not null and homework_checked_by is null from course_meetings where id = t.c()),
  'AC6 the checker''s account deleted: still checked, checker unknown');
