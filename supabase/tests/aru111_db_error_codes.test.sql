-- ARU-111 (Russian version, part 5): every message a database function or trigger raises for users carries a
-- sham: code in its hint (AC 1, AC 7), the English message and errcode are unchanged (AC 1, AC 6, AC 8), and messages
-- with values carry them in detail as JSON (AC 3). Rules under test: supabase/migrations/0053_db_error_codes.sql.
select t.seed();

-- What a statement raises: errcode | message | hint | detail.
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

-- AC 1 / AC 7: a scan of every function in public. Each raise exception has a sham: hint, except the developer-only
-- messages on this allowlist.
create temp table raises as
  select p.proname, r[1] as stmt
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  cross join lateral regexp_matches(p.prosrc, $re$raise\s+exception\s+((?:[^;']|'(?:[^']|'')*')*);$re$, 'gi') as r;
select t.ok((select count(*) from raises) >= 90, 'scan: the raise statements are found');
select t.eq(
  (select string_agg(proname || ': ' || left(stmt, 80), E'\n' order by proname)
   from raises
   where stmt !~ $re$hint\s*=\s*('sham:|case when)$re$
     and stmt !~ $re$^'Unknown notification type: %'$re$),
  null::text,
  'AC1 every user-facing raise has a sham: code');

-- AC 1 / AC 8: the English message and the errcode stay as they were; the code comes with them.
select t.login('S1');
select t.eq(pg_temp.err(format('select set_course_discipline(%L, %L)', t.id('A'), gen_random_uuid())),
  '42501 | Only the course owner can change its discipline. | sham:discipline_owner_only',
  'AC1 a student changing a discipline: message, errcode and code');
select t.eq(pg_temp.err(format('select delete_course(%L)', t.id('A'))),
  '42501 | Only the teacher can delete a course. | sham:only_teacher_delete_course', 'AC1 a student deleting a course');
select t.eq(pg_temp.err(format('select mark_attendance(%L)', gen_random_uuid())),
  'P0002 | Meeting not found. | sham:meeting_not_found', 'AC1 P0002 kept (the app''s "already gone" path)');

-- AC 3: values in detail.
select t.login('T');
select t.eq(pg_temp.err(format('select set_user_role(%L, %L)', t.id('M'), 'student')),
  format('23514 | Mentor Max owns 1 course(s): Algebra. Reassign them first | sham:owner_owns_courses_titles | %s',
    json_build_object('name', 'Mentor Max', 'count', 1, 'titles', 'Algebra')::text),
  'AC3 owner with courses: name, count and titles in detail');

reset role;
update profiles set access_status = 'pending' where id = t.id('S3');
select t.login('T');
select t.eq(pg_temp.err(format('select set_user_role(%L, %L)', t.id('S3'), 'mentor')),
  format('23514 | Accept %s first. | sham:accept_first | %s', (select full_name from profiles where id = t.id('S3')),
    json_build_object('name', (select full_name from profiles where id = t.id('S3')))::text),
  'AC3 "Accept <name> first." carries the name');

-- Signed out: unchanged refusals.
select t.login(null);
select t.ok(pg_temp.err('select disconnect_telegram()') like '42501 |%', 'signed out is still refused');
