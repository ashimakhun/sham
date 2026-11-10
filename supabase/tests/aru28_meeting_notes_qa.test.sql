-- ARU-28 QA additions to aru28_meeting_notes.test.sql, updated for ARU-142 (official notes retired; meeting notes are
-- the signed notes of meeting_listener_notes): multibyte length limit, whitespace trimming of tabs and line breaks, no
-- meeting delete path, signed-out reads, notes kept through other meeting changes, and the author recorded by the
-- function, never by the caller. Rules: supabase/migrations/0012_meeting_notes.sql, 0055 and 0057.
-- Course A owned by mentor M; S1 a student listener of A; T the teacher.
select t.seed();
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
insert into course_meetings (id, course_id, starts_at, topic, status, created_by) values
  ('00000000-0000-0000-0000-00000000f291', t.id('A'), now() - interval '2 days', 'Done', 'completed', t.id('M')),
  ('00000000-0000-0000-0000-00000000f292', t.id('A'), now() + interval '1 day', 'Future', 'scheduled', t.id('M'));

-- ARU-142 AC 1: official notes can't be written by anyone any more.
select t.login('M');
select t.throws($$select set_meeting_notes('00000000-0000-0000-0000-00000000f291', 'x')$$, '42501', 'ARU-142 owner: set_meeting_notes revoked');

-- AC 6: the limit counts characters, not bytes: 10,000 emoji (40,000 bytes) are accepted, 10,001 are not.
select t.lives($$select add_meeting_listener_notes('00000000-0000-0000-0000-00000000f291', repeat('😀', 10000), true)$$,
  'AC6 10,000 multibyte characters accepted');
reset role;
select t.eq((select char_length(body) from meeting_listener_notes where meeting_id = '00000000-0000-0000-0000-00000000f291'
  and author_id = t.id('M')), 10000, 'AC6 all 10,000 multibyte characters stored');
select t.login('M');
select t.throws(format('select update_meeting_listener_notes(%L, %L)',
  (select id from meeting_listener_notes where author_id = t.id('M')), repeat('é', 10001)), '22001',
  'AC6 10,001 multibyte characters rejected');
-- Surrounding whitespace doesn't count toward the limit: it is trimmed first.
select t.lives(format('select update_meeting_listener_notes(%L, %L)',
  (select id from meeting_listener_notes where author_id = t.id('M')), E'\n\n' || repeat('a', 10000) || E'  \t\n'),
  'AC6 10,000 characters plus surrounding whitespace accepted after trimming');

-- AC 5/6: tabs and line breaks around the notes are trimmed; line breaks inside are kept (lists need them).
select t.lives(format('select update_meeting_listener_notes(%L, %L)',
  (select id from meeting_listener_notes where author_id = t.id('M')), E'\t\n- one\n- two\n\n'),
  'AC5 notes with surrounding tabs and line breaks saved');
reset role;
select t.eq((select body from meeting_listener_notes where author_id = t.id('M')), E'- one\n- two',
  'AC5 surrounding tabs and line breaks trimmed, inner line break kept');
select t.login('M');
select t.throws(format('select update_meeting_listener_notes(%L, %L)',
  (select id from meeting_listener_notes where author_id = t.id('M')), E'\t \n \r\n'), '23514',
  'AC6 tabs and line breaks only are refused (notes are removed with delete, ARU-125)');

-- The author is always the caller: the function has no parameter for it, and a direct write is impossible.
select t.login('T');
select t.lives($$select add_meeting_listener_notes('00000000-0000-0000-0000-00000000f291', 'Teacher notes', true)$$, 'teacher saves notes');
reset role;
select t.ok(exists (select 1 from meeting_listener_notes where author_id = t.id('T') and body = 'Teacher notes'),
  'the author is the caller (the teacher)');
select t.login('M');
select t.throws(format('update meeting_listener_notes set author_id = %L', t.id('S1')), '42501',
  'the owner cannot rewrite who wrote the notes');

-- AC 2: meetings are kept: nobody can delete one, notes or not.
select t.eq(t.affected($$delete from course_meetings where id = '00000000-0000-0000-0000-00000000f291'$$), 0::bigint,
  'AC2 the owner cannot delete a meeting');
reset role; select t.login('T');
select t.eq(t.affected($$delete from course_meetings where course_id = '00000000-0000-0000-0000-0000000000d1'$$), 0::bigint,
  'AC2 the teacher cannot delete meetings');
reset role;
select t.ok(not exists (select 1 from pg_policies where tablename = 'course_meetings' and cmd in ('DELETE', 'ALL')),
  'AC2 no delete policy on course_meetings');
select t.eq((select count(*) from course_meetings where course_id = t.id('A')), 2::bigint, 'AC2 both meetings still exist');

-- AC 7 / access: a listener reads the notes; signed-out users read nothing.
select t.login('S1');
select t.eq((select count(*) from meeting_listener_notes where meeting_id = '00000000-0000-0000-0000-00000000f291'), 2::bigint,
  'AC7 listener reads the notes');
reset role; select t.login(null);
select t.eq((select count(*) from course_meetings), 0::bigint, 'signed out: no meetings readable');
select t.throws($$select count(*) from meeting_listener_notes$$, '42501', 'signed out: no notes readable');
select t.throws($$select add_meeting_listener_notes('00000000-0000-0000-0000-00000000f291', 'x')$$, '42501',
  'signed out: cannot save notes');

-- Editing a scheduled meeting (ARU-15) still works and never touches notes; a completed one stays locked.
reset role; select t.login('M');
select t.lives($$select update_meeting('00000000-0000-0000-0000-00000000f292', now() + interval '2 days', 'Moved', null)$$,
  'regression: update_meeting on a scheduled meeting still works');
select t.throws($$select update_meeting('00000000-0000-0000-0000-00000000f291', now() + interval '2 days', 'Edit done', null)$$, '23514',
  'regression: a completed meeting with notes cannot be edited');
reset role;
select t.ok((select topic = 'Done' from course_meetings where id = '00000000-0000-0000-0000-00000000f291')
  and (select body = 'Teacher notes' from meeting_listener_notes where author_id = t.id('T')),
  'notes and topic of the completed meeting are unchanged');
select t.eq((select count(*) from meeting_listener_notes where meeting_id = '00000000-0000-0000-0000-00000000f292'), 0::bigint,
  'the edited scheduled meeting still has no notes');
