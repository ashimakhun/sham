-- QA ARU-65: gaps in aru65_accountant.test.sql: an accountant who can't see a hidden course can't change or unselect
-- its billing (not just select it), selected_by / selected_at can't be given on insert, a one-day period and the
-- 28th, set_accountant with no value and from anon, a declined mentor, a course owner change, a course deleted, the
-- rows another (now switched off) accountant selected, and the teacher setting a period on the hidden course.
select t.seed();
-- H: hidden course owned by M; N is its listener (sees it), M2 doesn't.
insert into courses (id, title, created_by, hidden) values ('00000000-0000-0000-0000-0000000065d1', 'Hidden', t.id('M'), true);
insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000065d1', t.id('N'), t.id('M'));
-- R: a declined mentor.
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000065b1', 'r@x.test', '{"full_name":"Rejected Rae"}');
update profiles set role = 'mentor', access_status = 'rejected' where id = '00000000-0000-0000-0000-0000000065b1';

select t.login('T');
select t.lives(format('select set_accountant(%L, true)', t.id('N')), 'N is an accountant');
select t.lives(format('select set_accountant(%L, true)', t.id('M2')), 'M2 is an accountant');
select t.throws(format('select set_accountant(%L, null)', t.id('N')), '22023', 'set_accountant with no value is refused');
select t.throws($$select set_accountant('00000000-0000-0000-0000-0000000065b1', true)$$, '23514', 'a declined mentor can''t be made an accountant');
reset role;
select t.login(null);
select t.throws(format('select set_accountant(%L, false)', t.id('N')), '42501', 'anon can''t call set_accountant');
reset role;

-- Insert: only the period; the server sets who and when.
select t.login('N');
select t.throws(format('insert into course_billing (course_id, start_day, end_day, selected_by) values (%L, 1, 5, %L)', t.id('A'), t.id('M2')),
  '42501', 'selected_by can''t be given (someone else)');
select t.throws(format('insert into course_billing (course_id, start_day, end_day, selected_at) values (%L, 1, 5, %L)', t.id('A'), '2000-01-01'),
  '42501', 'selected_at can''t be given');
select t.lives(format('insert into course_billing (course_id, start_day, end_day) values (%L, 28, 28)', t.id('A')), 'a one-day period on the 28th');
select t.lives($$insert into course_billing (course_id, start_day, end_day) values ('00000000-0000-0000-0000-0000000065d1', 1, 5)$$,
  'N selects the hidden course H');
reset role;
select t.ok((select selected_by = t.id('N') and selected_at > now() - interval '1 minute' from course_billing where course_id = t.id('A')),
  'the server recorded N and the time');

-- AC 4 / ARU-40: M2 can't see H, so can't read, change or unselect its billing.
select t.login('M2');
select t.eq((select count(*) from course_billing), 1::bigint, 'M2 reads only A');
select t.eq(t.affected($$update course_billing set end_day = 20 where course_id = '00000000-0000-0000-0000-0000000065d1'$$), 0::bigint,
  'M2 can''t change H''s period');
select t.eq(t.affected($$delete from course_billing where course_id = '00000000-0000-0000-0000-0000000065d1'$$), 0::bigint,
  'M2 can''t unselect H');
select t.eq(t.affected(format('update course_billing set start_day = 2, end_day = 9 where course_id = %L', t.id('A'))), 1::bigint,
  'M2 changes A''s period, which N selected');
reset role;
select t.ok((select start_day = 1 and end_day = 5 from course_billing where course_id = '00000000-0000-0000-0000-0000000065d1'), 'H unchanged');

-- AC 6: the teacher changes the hidden course's period.
select t.login('T');
select t.eq(t.affected($$update course_billing set end_day = 10 where course_id = '00000000-0000-0000-0000-0000000065d1'$$), 1::bigint,
  'AC6 the teacher changes H''s period');

-- A declined mentor whose flag is somehow on still reads and changes nothing.
reset role;
update profiles set is_accountant = true where id = '00000000-0000-0000-0000-0000000065b1';
do $q$
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000065b1","role":"authenticated"}', false);
  set role authenticated;
  perform t.ok(not is_accountant(), 'a declined mentor is not an accountant');
  perform t.eq((select count(*) from course_billing), 0::bigint, 'a declined mentor reads no paid courses');
  perform t.eq(t.affected('delete from course_billing'), 0::bigint, 'and unselects nothing');
  reset role;
end $q$;

-- Edge ARU-9: an owner change leaves billing as it is.
select t.login('T');
select t.lives(format('select change_course_owner(%L, %L)', t.id('A'), t.id('N')), 'the teacher gives A to N');
reset role;
select t.ok((select start_day = 2 and end_day = 9 and selected_by = t.id('N') from course_billing where course_id = t.id('A')),
  'edge: billing of A is unchanged after the owner change');

-- AC 2: N is switched off; M2 can still change and unselect the rows N selected.
select t.login('T');
select t.lives(format('select set_accountant(%L, false)', t.id('N')), 'N is switched off');
select t.login('M2');
select t.eq(t.affected(format('delete from course_billing where course_id = %L', t.id('A'))), 1::bigint,
  'AC2 M2 unselects the course N selected after N was switched off');
reset role;

-- A course that is deleted takes its billing row with it.
delete from courses where id = '00000000-0000-0000-0000-0000000065d1';
select t.eq((select count(*) from course_billing), 0::bigint, 'data: deleting a course removes its billing row');
