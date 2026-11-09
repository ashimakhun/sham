-- QA ARU-111: gaps in aru111_db_error_codes.test.sql:
-- - The test design's AC 1 samples, end to end: attendance before the start, a meeting already completed (status in
--   detail), not approved. Each keeps its English message and errcode and carries its code.
-- - Every sham: hint in the function bodies is a well-formed code.
-- - A trigger's refusal (a blank name) carries its code.
-- Fixture (t.seed): course A owned by M, listener S1 (added here), teacher T.
select t.seed();

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text; msg text; hint text; det text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate, msg = message_text, hint = pg_exception_hint, det = pg_exception_detail;
  return concat_ws(' | ', code, msg, hint, nullif(det, ''));
end $$;
grant execute on function pg_temp.err(text) to authenticated;

insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
insert into course_meetings (id, course_id, starts_at, status, created_by) values
  (md5('aru111qa-future')::uuid, t.id('A'), now() + interval '2 days', 'scheduled', t.id('M')),
  (md5('aru111qa-done')::uuid, t.id('A'), now() - interval '2 days', 'completed', t.id('M'));

-- Every hint written in a function body is sham: + a lowercase code (no typo like "sham :x" or "Sham:x").
select t.eq(
  (select string_agg(p.proname || ': ' || h[1], ', ')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   cross join lateral regexp_matches(p.prosrc, $re$hint\s*=\s*'([^']*)'$re$, 'g') h
   where h[1] !~ '^sham:[a-z0-9_]+$'),
  null::text, 'every hint is sham:<code>');

select t.login('S1');
select t.eq(pg_temp.err(format('select mark_attendance(%L)', md5('aru111qa-future')::uuid)),
  '23514 | Attendance can be marked once the meeting has started. | sham:attendance_not_started',
  'AC1 attendance before the start: message, errcode and code');
reset role;

select t.login('M');
select t.eq(pg_temp.err(format('select set_meeting_status(%L, %L)', md5('aru111qa-done')::uuid, 'canceled')),
  format('23514 | This meeting is already completed; its status can''t change. | sham:meeting_already_status | %s',
    json_build_object('status', 'completed')::text),
  'AC3 meeting already completed: the status word in detail');
-- A retry of the same status is still fine (AC 8).
select t.eq(pg_temp.err(format('select set_meeting_status(%L, %L)', md5('aru111qa-done')::uuid, 'completed')),
  'no error', 'AC8 the same status again is still a safe retry');
reset role;

-- A trigger's refusal: a blank name.
select t.login('S1');
select t.ok(pg_temp.err(format('update profiles set full_name = %L where id = %L', '   ', t.id('S1')))
  like '% | sham:name_blank', 'AC1 a blank name (trigger) carries sham:name_blank');
reset role;

-- Not approved: a pending account is refused with its code.
update profiles set access_status = 'pending' where id = t.id('S2');
select t.login('S2');
select t.ok(pg_temp.err('select mark_general_chat_read(gen_random_uuid())')
  = '42501 | Your account is not approved. | sham:not_approved', 'AC1 an account not approved: message, errcode, code');
reset role;
