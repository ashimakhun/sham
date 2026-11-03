-- QA ARU-41: gaps in aru41_meeting_start_notifications.test.sql: update_meeting() keeps every 0021 check after the
-- replace, moving away and back to the same time clears the claim, nobody writes start_notified_at directly, a hidden
-- course's listeners are included, two meetings of one course at the same time, a meeting starting exactly now, a
-- declined listener left out, and the teacher (an app user) can't claim.
select t.seed();
insert into courses (id, title, created_by, hidden) values ('00000000-0000-0000-0000-0000000041c1', 'Secret *club* <b>', t.id('M'), true);
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('S2'), t.id('M')),
  ('00000000-0000-0000-0000-0000000041c1', t.id('S1'), t.id('M'));
update profiles set access_status = 'rejected' where id = t.id('S2'); -- declined after being added

-- Meetings (as the admin): two in A starting now and 30 s ago, one in the hidden course 10 s ago, one future.
insert into course_meetings (id, course_id, starts_at, topic, status, created_by) values
  ('00000000-0000-0000-0000-0000000041a1', t.id('A'), now(), 'Now', 'scheduled', t.id('M')),
  ('00000000-0000-0000-0000-0000000041a2', t.id('A'), now() - interval '30 seconds', 'Earlier', 'scheduled', t.id('M')),
  ('00000000-0000-0000-0000-0000000041a3', '00000000-0000-0000-0000-0000000041c1', now() - interval '10 seconds', 'Hidden', 'scheduled', t.id('M')),
  ('00000000-0000-0000-0000-0000000041a4', t.id('A'), now() + interval '1 day', 'Future', 'scheduled', t.id('M'));

-- The teacher (an app user) can't claim.
select t.login('T');
select t.throws('select * from claim_started_meetings()', '42501', 'AC10 the teacher can''t claim');
-- Nobody writes start_notified_at directly, the owner included.
select t.login('M');
select t.eq(t.affected($$update course_meetings set start_notified_at = now() where id = '00000000-0000-0000-0000-0000000041a4'$$), 0::bigint,
  'the owner can''t set start_notified_at directly');
reset role;

-- The service role claims: three meetings, S1 only (S2 declined), hidden course included with its title as typed.
set role service_role;
create temp table c as select * from claim_started_meetings();
reset role;
select t.eq((select count(*) from c), 3::bigint, 'AC8 both A meetings (now and 30 s ago) and the hidden one are claimed');
select t.ok((select bool_and(listener_ids = array[t.id('S1')]) from c), 'AC1 only the Approved listener S1 (declined S2 left out)');
select t.eq((select course_title from c where meeting_id = '00000000-0000-0000-0000-0000000041a3'), 'Secret *club* <b>',
  'edge: a hidden course is announced to its listener, with the title as typed');
select t.ok(not exists (select 1 from c where meeting_id = '00000000-0000-0000-0000-0000000041a4'), 'the future meeting isn''t claimed');

-- update_meeting() keeps the 0021 checks.
select t.login('N');
select t.throws($$select update_meeting('00000000-0000-0000-0000-0000000041a4', now() + interval '2 days', 'x', null)$$, '42501',
  'regression: a mentor who doesn''t own the course can''t edit');
select t.throws($$select update_meeting('00000000-0000-0000-0000-0000000041a3', now() + interval '2 days', 'x', null)$$, 'P0002',
  'regression: a hidden course''s meeting is not found for an outsider');
select t.login('M');
select t.throws($$select update_meeting('00000000-0000-0000-0000-0000000041a4', now() - interval '1 hour', 'x', null)$$, '23514',
  'regression: moving into the past is refused');
reset role;
update course_meetings set status = 'completed' where id = '00000000-0000-0000-0000-0000000041a2';
select t.login('M');
select t.throws($$select update_meeting('00000000-0000-0000-0000-0000000041a2', now() + interval '1 day', 'x', null)$$, '23514',
  'regression: a completed meeting can''t be edited');

-- Edge: claimed, moved away, then back to the same time: the claim is cleared.
reset role;
update course_meetings set start_notified_at = now() where id = '00000000-0000-0000-0000-0000000041a4';
create temp table orig as select starts_at from course_meetings where id = '00000000-0000-0000-0000-0000000041a4';
grant select on orig to authenticated;
select t.login('M');
select t.lives($$select update_meeting('00000000-0000-0000-0000-0000000041a4', now() + interval '3 days', 'Future', null)$$, 'moved away');
select t.lives($$select update_meeting('00000000-0000-0000-0000-0000000041a4', (select starts_at from orig), 'Future', null)$$, 'and back');
reset role;
select t.ok((select start_notified_at is null and starts_at = (select starts_at from orig) from course_meetings
  where id = '00000000-0000-0000-0000-0000000041a4'), 'edge: back at the original time, unclaimed, so it is announced again');
