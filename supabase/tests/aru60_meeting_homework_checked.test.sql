-- ARU-60: mark a completed meeting's homework checked (and undo). Rules: 0028_meeting_homework_checked.sql.
-- Course A owned by mentor M, listeners S1 (student) and M2 (mentor); N owns B and isn't in A; teacher T.
-- Meetings on A: C completed, F future scheduled, P started scheduled, X canceled. H is a hidden course owned by M
-- with a completed meeting HC. P1 is a mentor whose account is still pending.
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M'));
insert into courses (id, title, created_by, hidden) values
  ('00000000-0000-0000-0000-0000000060d3', 'Hidden', t.id('M'), true);
insert into course_meetings (id, course_id, starts_at, topic, status, created_by) values
  ('00000000-0000-0000-0000-0000000060c1', t.id('A'), now() - interval '2 days', 'Done', 'completed', t.id('M')),
  ('00000000-0000-0000-0000-0000000060f1', t.id('A'), now() + interval '1 day', 'Future', 'scheduled', t.id('M')),
  ('00000000-0000-0000-0000-0000000060a1', t.id('A'), now() - interval '1 hour', 'Started', 'scheduled', t.id('M')),
  ('00000000-0000-0000-0000-0000000060e1', t.id('A'), now() - interval '3 days', 'Dropped', 'canceled', t.id('M')),
  ('00000000-0000-0000-0000-0000000060c2', '00000000-0000-0000-0000-0000000060d3', now() - interval '2 days', 'Secret', 'completed', t.id('M'));
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000060b9', 'p1@x.test', '{"full_name":"Pending Pia"}');
update profiles set role = 'mentor' where id = '00000000-0000-0000-0000-0000000060b9'; -- still pending

create function pg_temp.checked(meeting text) returns boolean language sql as $$
  select homework_checked_at is not null from course_meetings where id = meeting::uuid
$$;
create function pg_temp.mark(meeting text, checked boolean) returns text language sql as $$
  select format('select set_meeting_homework_checked(%L, %s)', meeting, case when checked then 'true' else 'false' end)
$$;

-- Data: two nullable columns, existing rows unchecked, still no update policy, function not open to anon.
select t.eq((select count(*) from information_schema.columns where table_name = 'course_meetings'
  and column_name in ('homework_checked_at', 'homework_checked_by') and is_nullable = 'YES'), 2::bigint, 'data: two nullable columns');
select t.eq((select count(*) from course_meetings where homework_checked_at is not null or homework_checked_by is not null),
  0::bigint, 'data: existing meetings start unchecked');
select t.eq((select count(*) from pg_policies where tablename = 'course_meetings' and cmd in ('UPDATE', 'ALL')), 0::bigint,
  'data: still no update policy on course_meetings');
select t.ok(not has_function_privilege('anon', 'set_meeting_homework_checked(uuid, boolean)', 'execute'), 'data: anon cannot run it');
select t.ok(has_function_privilege('authenticated', 'set_meeting_homework_checked(uuid, boolean)', 'execute'), 'data: authenticated can');
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'course_meetings'),
  'data: course_meetings is still in the realtime publication');

-- AC 5: the teacher marks C checked; who and when are recorded.
select t.login('T');
select t.lives(pg_temp.mark('00000000-0000-0000-0000-0000000060c1', true), 'AC5 teacher marks homework checked');
reset role;
select t.ok((select homework_checked_by = t.id('T') and homework_checked_at is not null
  from course_meetings where id = '00000000-0000-0000-0000-0000000060c1'), 'AC5/6 checker and time recorded');

-- AC 10: marking again is a no-op that keeps the first mark, even by someone else.
select t.login('N');
select t.lives(pg_temp.mark('00000000-0000-0000-0000-0000000060c1', true), 'AC10 marking a checked meeting again is no error');
reset role;
select t.eq((select homework_checked_by from course_meetings where id = '00000000-0000-0000-0000-0000000060c1'), t.id('T'),
  'AC10 the first mark is kept');

-- AC 7: a non-listener mentor undoes; undoing again is a no-op.
select t.login('N');
select t.lives(pg_temp.mark('00000000-0000-0000-0000-0000000060c1', false), 'AC7 non-listener mentor undoes the check');
select t.lives(pg_temp.mark('00000000-0000-0000-0000-0000000060c1', false), 'AC10 undoing an unchecked meeting is no error');
reset role;
select t.ok((select homework_checked_at is null and homework_checked_by is null
  from course_meetings where id = '00000000-0000-0000-0000-0000000060c1'), 'AC7 both columns cleared');

-- AC 5: the course owner (a mentor, not a listener) may mark too.
select t.login('M');
select t.lives(pg_temp.mark('00000000-0000-0000-0000-0000000060c1', true), 'AC5 owner mentor marks homework checked');
select t.lives(pg_temp.mark('00000000-0000-0000-0000-0000000060c1', false), 'owner mentor undoes');
reset role;

-- AC 8: students, mentor listeners, signed-out and pending callers are refused; nothing changes.
select t.login('S1');
select t.throws(pg_temp.mark('00000000-0000-0000-0000-0000000060c1', true), '42501', 'AC8 student listener refused');
select t.login('S2');
select t.throws(pg_temp.mark('00000000-0000-0000-0000-0000000060c1', true), '42501', 'AC8 non-listener student refused');
select t.login('M2');
select t.throws(pg_temp.mark('00000000-0000-0000-0000-0000000060c1', true), '42501', 'AC8 mentor listener refused');
select t.login(null);
select t.throws(pg_temp.mark('00000000-0000-0000-0000-0000000060c1', true), '42501', 'AC8 signed out refused');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000060b9","role":"authenticated"}', false);
set role authenticated;
select t.throws(pg_temp.mark('00000000-0000-0000-0000-0000000060c1', true), '42501', 'AC8 pending mentor refused');
reset role;
select t.ok(not pg_temp.checked('00000000-0000-0000-0000-0000000060c1'), 'AC8 refused calls changed nothing');

-- Hidden course: a mentor who can't see it is refused; its owner and the teacher may mark.
select t.login('N');
select t.throws(pg_temp.mark('00000000-0000-0000-0000-0000000060c2', true), '42501', 'hidden course: other mentor refused');
reset role;
select t.ok(not pg_temp.checked('00000000-0000-0000-0000-0000000060c2'), 'hidden course: unchanged');
select t.login('M');
select t.lives(pg_temp.mark('00000000-0000-0000-0000-0000000060c2', true), 'hidden course: its owner marks');
select t.login('T');
select t.lives(pg_temp.mark('00000000-0000-0000-0000-0000000060c2', false), 'hidden course: the teacher undoes');
reset role;

-- AC 8: only completed meetings; an unknown meeting is refused.
select t.login('T');
select t.throws(pg_temp.mark('00000000-0000-0000-0000-0000000060f1', true), '23514', 'AC8 future scheduled refused');
select t.throws(pg_temp.mark('00000000-0000-0000-0000-0000000060a1', true), '23514', 'AC8 started scheduled refused');
select t.throws(pg_temp.mark('00000000-0000-0000-0000-0000000060e1', true), '23514', 'AC8 canceled refused');
select t.throws(pg_temp.mark('00000000-0000-0000-0000-0000000060e1', false), '23514', 'AC8 undo on canceled refused');
do $$ begin
  perform set_meeting_homework_checked('00000000-0000-0000-0000-0000000060e1', true);
exception when others then
  perform t.eq(sqlerrm, 'Homework can be marked checked only on completed meetings.', 'AC8 message');
end $$;
select t.throws(pg_temp.mark('00000000-0000-0000-0000-00000000ffff', true), '42501', 'unknown meeting refused');

-- AC 8: a direct update changes no row, even for the teacher.
select t.eq(t.affected($$update course_meetings set homework_checked_at = now() where id = '00000000-0000-0000-0000-0000000060c1'$$),
  0::bigint, 'AC8 direct update by the teacher changes nothing');
reset role;

-- Edge case: marking a meeting checked doesn't touch any student's homework.
select t.eq((select string_agg(status::text, ',' order by id) from homework), 'submitted,checked,submitted', 'homework statuses unchanged');
