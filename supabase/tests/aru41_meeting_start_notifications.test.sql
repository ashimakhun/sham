-- ARU-41: claim_started_meetings(), the claim reset in update_meeting() and the cron job.
-- Rules under test: supabase/migrations/0035_meeting_start_notifications.sql.
-- Fixture (t.seed): course A owned by mentor M, B by mentor N; teacher T. Listeners of A: S1 (student), M2 (mentor) and
-- S3 (pending); of B: S2. Meetings are made as the admin, relative to the database clock.
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M')),
  (t.id('A'), t.id('S3'), t.id('M')),
  (t.id('B'), t.id('S2'), t.id('N'));
update profiles set access_status = 'pending' where id = t.id('S3');

create function t.bot() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
end $$;
grant execute on function t.bot() to anon, authenticated, service_role;
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

-- A meeting's fixed id.
create function t.mid(name text) returns uuid language sql immutable as $$ select md5('aru41-' || name)::uuid $$;
grant execute on function t.mid(text) to anon, authenticated, service_role;

-- A meeting in `course`, starting `ago` before now (negative = in the future).
create function t.meeting(name text, course text, ago interval, status meeting_status default 'scheduled')
  returns void language sql security definer as $$
  insert into course_meetings (id, course_id, starts_at, topic, status, created_by)
  values (t.mid(name), t.id(course), now() - ago, 'Topic ' || name, status, t.id('M'))
$$;
create function t.claimed(name text) returns boolean language sql security definer as $$
  select start_notified_at is not null from course_meetings where id = t.mid(name)
$$;
grant execute on function t.claimed(text) to anon, authenticated, service_role;
-- The claim's result as "meeting:title:listener,listener" lines, sorted (listener names are the fixture keys).
create table t.last_claim (line text);
grant all on t.last_claim to service_role;
create function t.claim() returns text language plpgsql as $$
declare
  result text;
begin
  delete from t.last_claim;
  insert into t.last_claim
    select coalesce((select k from unnest(array['D1','D2','D3','DB','R1','R2','N1','N2','N3']) k where t.mid(k) = c.meeting_id), '?')
      || ':' || c.course_title || ':'
      || coalesce((select string_agg(k, ',' order by k) from unnest(array['S1','S2','S3','M','M2','N','T']) k
                   where t.id(k) = any (c.listener_ids)), '')
    from claim_started_meetings() c;
  select coalesce(string_agg(line, ' | ' order by line), '') into result from t.last_claim;
  return result;
end $$;
grant execute on function t.claim() to service_role;

-- Data: the new column, nullable and empty for existing meetings; the function's grants.
select t.ok(exists (select 1 from information_schema.columns where table_name = 'course_meetings'
  and column_name = 'start_notified_at' and is_nullable = 'YES'), 'data: course_meetings.start_notified_at is nullable');
select t.ok(not has_function_privilege('anon', 'claim_started_meetings()', 'execute'), 'AC10 anon can''t run it');
select t.ok(not has_function_privilege('authenticated', 'claim_started_meetings()', 'execute'), 'AC10 app users can''t run it');
select t.ok(has_function_privilege('service_role', 'claim_started_meetings()', 'execute'), 'AC10 the service role can');
select t.login('S1');
select t.throws('select * from claim_started_meetings()', '42501', 'AC10 a listener calling it is refused');
select t.login(null);
select t.throws('select * from claim_started_meetings()', '42501', 'AC10 anon calling it is refused');
reset role;

-- AC 1 / 5 / 6 / 8: what is due right now.
select t.meeting('D1', 'A', interval '30 seconds');
select t.meeting('D2', 'A', interval '90 seconds');            -- same course, also due: its own message (AC 8)
select t.meeting('DB', 'B', interval '20 seconds');            -- another course at the same time (AC 8)
select t.meeting('F1', 'A', - interval '1 hour');              -- future
select t.meeting('O1', 'A', interval '3 minutes');             -- started more than 2 minutes ago (AC 6)
select t.meeting('X1', 'A', interval '30 seconds', 'canceled');   -- AC 5
select t.meeting('C1', 'A', interval '30 seconds', 'completed');  -- AC 5
select t.meeting('K1', 'A', interval '30 seconds');
update course_meetings set start_notified_at = now() - interval '10 seconds' where id = t.mid('K1'); -- already claimed

select t.bot();
select t.eq(t.claim(), 'D1:Algebra:M2,S1 | D2:Algebra:M2,S1 | DB:Biology:S2',
  'AC1/AC8 due meetings with their course title and Approved listeners (not S3 pending, not the owner, not the teacher)');
select t.eq(t.claim(), '', 'AC3 a second call claims nothing');
reset role;
select t.ok(t.claimed('D1') and t.claimed('D2') and t.claimed('DB'), 'AC3 claimed meetings are marked');
select t.ok(not t.claimed('F1'), 'a future meeting stays unclaimed');
select t.ok(not t.claimed('O1'), 'AC6 an older meeting is never claimed');
select t.ok(not t.claimed('X1') and not t.claimed('C1'), 'AC5 canceled and completed meetings are never claimed');

-- AC 6 boundary: just inside 2 minutes is claimed, just outside isn't.
select t.meeting('N1', 'A', interval '119 seconds');
select t.meeting('N2', 'A', interval '121 seconds');
select t.bot();
select t.eq(t.claim(), 'N1:Algebra:M2,S1', 'AC6 119 s ago is claimed, 121 s ago is not');
reset role;

-- AC 7 + edge: listeners and the title are taken at claim time.
delete from course_members where course_id = t.id('A') and user_id = t.id('S1');
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S2'), t.id('M'));
update courses set title = 'Algebra 101 *new*' where id = t.id('A');
select t.meeting('N3', 'A', interval '5 seconds');
select t.bot();
select t.eq(t.claim(), 'N3:Algebra 101 *new*:M2,S2',
  'AC7 a removed listener gets nothing, a new one does; the course title is the current one');
reset role;
delete from course_members where course_id = t.id('A') and user_id = t.id('S2');
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'));
update courses set title = 'Algebra' where id = t.id('A');

-- AC 4: moving the start clears the claim; editing only the topic or location keeps it.
select t.meeting('R1', 'A', - interval '2 hours');
update course_meetings set start_notified_at = now() where id = t.mid('R1');
select t.login('M');
select t.lives(format('select update_meeting(%L, (select starts_at from course_meetings where id = %L), %L, %L)',
  t.mid('R1'), t.mid('R1'), 'New topic', 'Room 5'), 'owner edits only the topic and location');
reset role;
select t.ok(t.claimed('R1'), 'AC4 a topic/location-only edit keeps the claim');
select t.login('M');
select t.lives(format('select update_meeting(%L, now() + interval ''3 hours'', %L, null)', t.mid('R1'), 'New topic'),
  'owner moves the meeting');
reset role;
select t.ok(not t.claimed('R1'), 'AC4 moving the start clears the claim');
select t.eq((select topic from course_meetings where id = t.mid('R1')), 'New topic', 'update_meeting still saves the topic');
select t.ok((select rescheduled_at is not null from course_meetings where id = t.mid('R1')), 'and still marks it rescheduled');

-- AC 4: announced, moved away and back to the same time: announced again at that time.
select t.meeting('R2', 'A', - interval '1 day');
update course_meetings set start_notified_at = now() where id = t.mid('R2');
select t.login('T');
select t.lives(format('select update_meeting(%L, now() + interval ''2 days'', null, null)', t.mid('R2')), 'the teacher moves it');
reset role;
select t.ok(not t.claimed('R2'), 'AC4 the teacher''s move clears the claim too');
-- Back to "now" (as the admin: update_meeting only allows future times), then the job runs.
update course_meetings set starts_at = now() - interval '10 seconds' where id = t.mid('R2');
select t.bot();
select t.eq(t.claim(), 'R2:Algebra:M2,S1', 'AC4 the moved meeting is announced at its new time');
reset role;

-- update_meeting keeps its 0021 rules.
select t.login('N');
select t.throws(format('select update_meeting(%L, now() + interval ''1 day'', null, null)', t.mid('F1')), '42501',
  'another mentor still can''t edit the meeting');
select t.login('M');
select t.throws(format('select update_meeting(%L, now() - interval ''1 hour'', null, null)', t.mid('F1')), '23514',
  'a move into the past is still refused');
select t.throws(format('select update_meeting(%L, now() + interval ''1 day'', null, null)', t.mid('X1')), '23514',
  'a canceled meeting still can''t be edited');
-- App users can't write the claim directly (no update policy on course_meetings).
select t.eq(t.affected(format('update course_meetings set start_notified_at = null where id = %L', t.mid('D1'))), 0::bigint,
  'nobody clears a claim directly');
reset role;
select t.ok(t.claimed('D1'), 'the claim is unchanged');

-- AC 9: the job runs every minute and reads the URL and the secret from Vault on each run.
select t.eq((select schedule from cron.job where jobname = 'meeting-start-notifications'), '* * * * *',
  'AC9 the job runs every minute');
select t.ok((select command like '%vault.decrypted_secrets%meeting_notify_url%' and command like '%meeting_notify_secret%'
  and command like '%x-cron-secret%' and command like '%timeout_milliseconds := 60000%'
  from cron.job where jobname = 'meeting-start-notifications'), 'AC9 URL and secret come from Vault; 60 s timeout');
-- Running its command posts to the stored URL with the stored secret.
insert into vault.decrypted_secrets values
  ('meeting_notify_url', 'https://example.supabase.co/functions/v1/meeting-start-notifications'),
  ('meeting_notify_secret', 's3cret');
do $$ begin execute (select command from cron.job where jobname = 'meeting-start-notifications'); end $$;
select t.eq((select url || ' ' || (headers ->> 'x-cron-secret') from net.requests order by id desc limit 1),
  'https://example.supabase.co/functions/v1/meeting-start-notifications s3cret', 'AC9 the job posts with the secret');
