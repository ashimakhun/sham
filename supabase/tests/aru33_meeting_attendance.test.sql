-- ARU-33: listeners mark attendance for completed meetings. Rules under test: supabase/migrations/0017_meeting_attendance.sql.
-- Course A is owned by M with listeners S1 (student) and M2 (mentor). S2 (student), N (mentor, owns B) and the teacher T
-- are not listeners of A. Meetings of A (inserted as the admin): Mc completed, Ms scheduled upcoming, Mst scheduled
-- and already started, Mx canceled.
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M'));

set session_replication_role = replica;
insert into course_meetings (id, course_id, starts_at, topic, status, created_by) values
  ('00000000-0000-0000-0000-0000000a0001', t.id('A'), now() - interval '2 days', 'Done',     'completed', t.id('M')),
  ('00000000-0000-0000-0000-0000000a0002', t.id('A'), now() + interval '2 days', 'Upcoming', 'scheduled', t.id('M')),
  ('00000000-0000-0000-0000-0000000a0003', t.id('A'), now() - interval '1 hour', 'Started',  'scheduled', t.id('M')),
  ('00000000-0000-0000-0000-0000000a0004', t.id('A'), now() - interval '1 day',  'Canceled', 'canceled',  t.id('M'));
set session_replication_role = origin;

-- AC 1 / AC 2: listeners mark their own attendance; a repeat is a no-op.
select t.login('S1');
select t.lives($$select mark_attendance('00000000-0000-0000-0000-0000000a0001')$$, 'AC2 student listener marks Mc');
select t.lives($$select mark_attendance('00000000-0000-0000-0000-0000000a0001')$$, 'AC2 marking again is accepted');
select t.eq((select count(*) from meeting_attendance where meeting_id = '00000000-0000-0000-0000-0000000a0001'), 1::bigint,
  'AC2 still one mark after a repeat');
select t.eq((select user_id from meeting_attendance), t.id('S1'), 'AC2 the mark is the caller''s own');
reset role; select t.login('M2');
select t.lives($$select mark_attendance('00000000-0000-0000-0000-0000000a0001')$$, 'AC1 mentor listener marks Mc');

-- AC 4: only completed meetings; unknown ids are "not found".
reset role; select t.login('S1');
select t.throws($$select mark_attendance('00000000-0000-0000-0000-0000000a0002')$$, '23514', 'AC4 upcoming scheduled meeting is rejected');
select t.throws($$select mark_attendance('00000000-0000-0000-0000-0000000a0003')$$, '23514', 'AC4 started but not completed meeting is rejected');
select t.throws($$select mark_attendance('00000000-0000-0000-0000-0000000a0004')$$, '23514', 'AC4 canceled meeting is rejected');
select t.throws($$select mark_attendance('00000000-0000-0000-0000-0000000000ff')$$, 'P0002', 'AC4 unknown meeting is "not found"');
select t.throws($$select unmark_attendance('00000000-0000-0000-0000-0000000000ff')$$, 'P0002', 'AC4 unknown meeting on undo is "not found"');
do $$ begin
  perform mark_attendance('00000000-0000-0000-0000-0000000a0004');
exception when others then
  perform t.eq(sqlerrm, 'Attendance can be marked only for completed meetings.', 'AC4 exact completed-only message');
end $$;

-- AC 5: non-listeners (student, mentor, owner, teacher) get the listener error, even on a scheduled meeting.
reset role; select t.login('S2');
select t.throws($$select mark_attendance('00000000-0000-0000-0000-0000000a0001')$$, '42501', 'AC5 student not in A is rejected');
reset role; select t.login('N');
select t.throws($$select mark_attendance('00000000-0000-0000-0000-0000000a0001')$$, '42501', 'AC5 mentor not in A is rejected');
reset role; select t.login('M');
select t.throws($$select mark_attendance('00000000-0000-0000-0000-0000000a0001')$$, '42501', 'AC5 the owner is rejected');
select t.throws($$select mark_attendance('00000000-0000-0000-0000-0000000a0002')$$, '42501', 'AC5 listener check comes before the status check');
reset role; select t.login('T');
select t.throws($$select mark_attendance('00000000-0000-0000-0000-0000000a0001')$$, '42501', 'AC5 the teacher is rejected');
do $$ begin
  perform mark_attendance('00000000-0000-0000-0000-0000000a0001');
exception when others then
  perform t.eq(sqlerrm, 'Only listeners of this course can mark attendance.', 'AC5 exact listener message');
end $$;
reset role; select t.login(null);
select t.throws($$select mark_attendance('00000000-0000-0000-0000-0000000a0001')$$, '42501', 'roles: anon cannot mark');
select t.throws($$select unmark_attendance('00000000-0000-0000-0000-0000000a0001')$$, '42501', 'roles: anon cannot undo');
select t.eq((select count(*) from meeting_attendance), 0::bigint, 'roles: anon reads nothing');

-- No direct writes for anyone.
reset role; select t.login('S1');
select t.throws($$insert into meeting_attendance (meeting_id, user_id) values ('00000000-0000-0000-0000-0000000a0002', '00000000-0000-0000-0000-0000000000c1')$$, '42501',
  'roles: a listener cannot insert directly');
select t.eq(t.affected($$delete from meeting_attendance$$), 0::bigint, 'roles: a listener cannot delete directly');
select t.eq(t.affected($$update meeting_attendance set marked_at = now()$$), 0::bigint, 'roles: a listener cannot update directly');
reset role; select t.login('T');
select t.throws($$insert into meeting_attendance (meeting_id, user_id) values ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000000c2')$$, '42501',
  'roles: the teacher cannot insert directly');
select t.eq(t.affected($$delete from meeting_attendance$$), 0::bigint, 'roles: the teacher cannot delete directly');

-- AC 8: students read only their own marks; mentors and the teacher read all.
reset role; select t.login('S1');
select t.eq((select count(*) from meeting_attendance), 1::bigint, 'AC8 student reads only their own mark');
reset role; select t.login('S2');
select t.eq((select count(*) from meeting_attendance), 0::bigint, 'AC8 other student reads none');
reset role; select t.login('T');
select t.eq((select count(*) from meeting_attendance), 2::bigint, 'AC8 teacher reads all marks');
reset role; select t.login('N');
select t.eq((select count(*) from meeting_attendance), 2::bigint, 'AC8 a mentor reads all marks');
reset role; select t.login('M2');
select t.eq((select count(*) from meeting_attendance), 2::bigint, 'AC8 a mentor listener reads all marks (hidden in the app only)');

-- AC 3: undo removes only the caller's mark; undo without a mark is a no-op.
reset role; select t.login('M2');
select t.lives($$select unmark_attendance('00000000-0000-0000-0000-0000000a0001')$$, 'AC3 mentor listener undoes');
select t.eq((select count(*) from meeting_attendance where user_id = t.id('M2')), 0::bigint, 'AC3 M2''s mark is gone');
select t.eq((select count(*) from meeting_attendance where user_id = t.id('S1')), 1::bigint, 'AC3 S1''s mark is untouched');
select t.lives($$select unmark_attendance('00000000-0000-0000-0000-0000000a0001')$$, 'AC3 undo with no mark is a no-op');

-- AC 9 / AC 3: a removed listener can't undo, and their mark stays stored; added back, it is theirs again.
reset role; select t.login('M');
select t.lives($$select remove_listener('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1')$$, 'AC9 remove S1');
reset role; select t.login('S1');
select t.throws($$select unmark_attendance('00000000-0000-0000-0000-0000000a0001')$$, '42501', 'AC3 a removed listener cannot undo');
select t.throws($$select mark_attendance('00000000-0000-0000-0000-0000000a0001')$$, '42501', 'AC9 a removed listener cannot mark');
reset role;
select t.eq((select count(*) from meeting_attendance where user_id = t.id('S1')), 1::bigint, 'AC9 the removed listener''s mark stays stored');
select t.login('M');
select t.lives($$insert into course_members (course_id, user_id, added_by) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1')$$,
  'AC9 add S1 back');
reset role; select t.login('S1');
select t.eq((select count(*) from meeting_attendance), 1::bigint, 'AC9 added back: the mark is there again');

-- AC 10: an owner change leaves marks unchanged.
reset role; select t.login('T');
select t.lives($$select change_course_owner('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2')$$, 'AC10 owner changes to N');
select t.eq((select count(*) from meeting_attendance), 1::bigint, 'AC10 marks unchanged after owner change');

-- Data: publication and cascades.
reset role;
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'meeting_attendance'),
  'data: the table is in supabase_realtime');
delete from course_meetings where id = '00000000-0000-0000-0000-0000000a0001';
select t.eq((select count(*) from meeting_attendance), 0::bigint, 'data: deleting a meeting deletes its marks');
