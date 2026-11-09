-- QA ARU-112: gaps in aru112_photo_deletion.test.sql: the leftover sweep's 23 h / 25 h rule, referenced files and
-- other buckets (AC 7); a start date across a month end and a second call (AC 1); hidden-course homework is due like
-- any other (AC 2); a homework sent again keeps its new photo (AC 3); a photo first seen with 7 days or less records
-- both marks with one message, removed or unchecked photos never count, and marks are recorded for the Pending, the
-- not-linked and the teacher too (AC 4 / AC 5); the switch toggles only its column and every older kind still works
-- (AC 5); app users and anon can't run any job function, set photo_removed_at, set photo_path back or write the start
-- date (AC 9); the cron job reads both Vault values and holds no secret (AC 8).
select t.seed();
grant usage on schema t to service_role;

create function t.bot() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
end $$;
create function t.hid(name text) returns uuid language sql immutable as $$ select md5('aru112qa-' || name)::uuid $$;
-- Checked homework `name` by `who` in `course`, checked `ago` before now, with a stored photo.
create function t.hw(name text, who text, course text, ago interval) returns void
  language plpgsql security definer as $$
  begin
    insert into homework (id, student_id, course_id, title, photo_path, status, checked_by, checked_at)
    values (t.hid(name), t.id(who), t.id(course), 'Title ' || name, t.id(who) || '/' || name || '.jpg', 'checked',
            t.id('M'), now() - ago);
    insert into storage.objects (bucket_id, name, owner) values ('homework', t.id(who) || '/' || name || '.jpg', t.id(who));
  end $$;
create function t.obj(bucket text, name text, age interval) returns void language sql security definer as $$
  insert into storage.objects (bucket_id, name, owner, created_at) values (bucket, name, t.id('S1'), now() - age)
$$;
grant execute on all functions in schema t to anon, authenticated, service_role;

insert into storage.buckets (id, name) values ('payment-proofs', 'payment-proofs'), ('materials', 'materials')
  on conflict do nothing;

-- AC 9: none of the five job functions runs for an app user or anon.
select t.login('T');
select t.throws('select * from start_photo_deletion()', '42501', 'AC9 the teacher can''t set the start date');
select t.throws('select * from leftover_homework_photos(10)', '42501', 'AC9 the teacher can''t list leftovers');
select t.throws('select * from due_homework_photos(10)', '42501', 'AC9 the teacher can''t list due photos');
select t.throws(format('select mark_homework_photos_removed(array[%L]::uuid[], array[''x''])', t.id('HW_A1')), '42501',
  'AC9 the teacher can''t mark a photo removed');
select t.throws('select * from claim_photo_deletion_warnings()', '42501', 'AC9 the teacher can''t record warnings');
reset role;
select t.login(null);
select t.throws('select * from start_photo_deletion()', '42501', 'AC9 signed out can''t set the start date');
select t.throws('select * from claim_photo_deletion_warnings()', '42501', 'AC9 signed out can''t record warnings');
reset role;

-- AC 9: a sender can't set photo_removed_at on insert, nor on update, nor write the start date.
select t.make_assignments(t.id('A'));
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M'))
  on conflict do nothing;
select t.login('S1');
insert into homework (id, student_id, course_id, title, photo_path, assignment_id, photo_removed_at)
  values (t.hid('own'), t.id('S1'), t.id('A'), 'Own', null, t.assignment(t.id('A'), 1), now());
reset role;
select t.ok((select photo_removed_at is null from homework where id = t.hid('own')),
  'AC9 a sender''s insert can''t set photo_removed_at');
select t.login('S1');
select t.throws(format('update homework set photo_removed_at = now() where id = %L', t.hid('own')), '42501',
  'AC9 a sender can''t update photo_removed_at');
select t.throws(format('update homework set photo_path = ''x.jpg'' where id = %L', t.id('HW_A1')), '42501',
  'AC9 a sender can''t set photo_path');
select t.throws('update app_settings set photo_deletion_start = current_date', '42501',
  'AC9 a sender can''t write the start date');
reset role;
select t.login('M');
select t.throws(format('update homework set photo_path = ''x.jpg'' where id = %L', t.id('HW_A1')), '42501',
  'AC9 the course owner can''t set photo_path back');
reset role;

-- AC 7: leftovers. Only the homework bucket, only unreferenced, only older than 24 hours.
select t.obj('homework', 'S1/orphan25.jpg', interval '25 hours');
select t.obj('homework', 'S1/orphan23.jpg', interval '23 hours');
select t.obj('payment-proofs', 'S1/proof.jpg', interval '30 days');
select t.obj('materials', 'M/notes.pdf', interval '30 days');
update storage.objects set created_at = now() - interval '40 days' where bucket_id = 'homework' and name = t.id('S1') || '/a1.jpg';
select t.bot();
select t.eq((select array_agg(name order by name) from leftover_homework_photos(100)), array['S1/orphan25.jpg'],
  'AC7 only the 25 h orphan: not the 23 h one, not a referenced photo, not payment-proofs or materials');
select t.eq((select count(*) from leftover_homework_photos(0)), 0::bigint, 'AC7 a limit of 0 lists nothing');
reset role;
delete from storage.objects where bucket_id = 'homework' and name = 'S1/orphan25.jpg';
select t.bot();
select t.eq((select count(*) from leftover_homework_photos(100)), 0::bigint, 'AC7 after deleting it, a second run finds nothing');
reset role;

-- AC 8: the job reads both Vault values on each run and holds no secret itself.
select t.ok((select command ~ 'photo_deletion_url' and command ~ 'photo_deletion_secret' and command ~ 'x-cron-secret'
  and schedule = '17 3 * * *' from cron.job where jobname = 'photo-deletion'),
  'AC8 the daily job reads the URL and the secret from Vault and sends x-cron-secret');
select t.eq((select count(*) from cron.job where jobname = 'photo-deletion'), 1::bigint, 'AC8 one job');

-- AC 1: the start date is today (UTC) + 30, across a month end; a second call keeps it.
select t.bot();
select t.eq((select start_date - (now() at time zone 'utc')::date from start_photo_deletion()), 30,
  'AC1 first call: today + 30 days');
reset role;
select t.eq((select photo_deletion_start from app_settings), (now() at time zone 'utc')::date + 30, 'AC1 stored');
select t.eq(('2026-12-15'::date + 30), '2027-01-14'::date, 'AC1 the + 30 days crosses a month and year end');
select t.bot();
select t.eq((select first_run from start_photo_deletion()), false, 'AC1 second call: not a first run');
reset role;
select t.eq((select photo_deletion_start from app_settings), (now() at time zone 'utc')::date + 30, 'AC1 date unchanged');

-- From here the start date is in the past, so dates follow checked_at + 6 months.
update app_settings set photo_deletion_start = (now() at time zone 'utc')::date - 400;

-- AC 2: hidden course homework is due like any other.
insert into courses (id, title, created_by, hidden) values (t.hid('H'), 'Hidden', t.id('M2'), true);
insert into homework (id, student_id, course_id, title, photo_path, status, checked_by, checked_at) values
  (t.hid('hidden'), t.id('S2'), t.hid('H'), 'Hidden hw', 'S2/hidden.jpg', 'checked', t.id('M2'), now() - interval '7 months');
select t.bot();
select t.ok(exists (select 1 from due_homework_photos(100) where homework_id = t.hid('hidden')),
  'AC2 homework in a hidden course is due');
reset role;

-- AC 3: a homework whose photo changed after listing keeps its new photo.
update homework set photo_path = 'S2/new.jpg' where id = t.hid('hidden');
select t.bot();
select t.eq(mark_homework_photos_removed(array[t.hid('hidden')], array['S2/hidden.jpg']), 0,
  'AC3 a row that no longer points at the deleted file is not changed');
reset role;
select t.ok((select photo_path = 'S2/new.jpg' and photo_removed_at is null from homework where id = t.hid('hidden')),
  'AC3 its new photo stays');

-- AC 4: marks. W5 first seen with 5 days left gets both marks with one message, counted once. W20 gets only the 30
-- mark. A removed photo and an unchecked one never count.
delete from homework where id = t.hid('hidden');
select t.hw('W5', 'S1', 'A', interval '6 months' - interval '5 days');
select t.hw('W20', 'S1', 'A', interval '6 months' - interval '20 days');
select t.hw('GONE', 'S1', 'A', interval '6 months' - interval '10 days');
update homework set photo_path = null, photo_removed_at = now() where id = t.hid('GONE');
-- Pending S3's photo and the teacher's own homework: marks recorded, no message.
select t.hw('PEND', 'S3', 'A', interval '6 months' - interval '10 days');
update profiles set access_status = 'pending' where id = t.id('S3');
select t.hw('TEACH', 'T', 'A', interval '6 months' - interval '10 days');
select t.bot();
create temp table w as select * from claim_photo_deletion_warnings();
reset role;
select t.eq((select photo_count from w where user_id = t.id('S1')), 2, 'AC4 S1: one message counting W5 and W20 once each');
select t.eq((select earliest - (now() at time zone 'utc')::date from w where user_id = t.id('S1')), 5,
  'AC4 the earliest date is W5''s');
select t.eq((select count(*) from w where user_id in (t.id('S3'), t.id('T'))), 0::bigint,
  'AC4 no message for a Pending sender or the teacher');
select t.eq((select array_agg(mark order by mark) from photo_deletion_warnings where homework_id = t.hid('W5')),
  array[7, 30]::smallint[], 'AC4 W5 records both marks at once');
select t.eq((select array_agg(mark) from photo_deletion_warnings where homework_id = t.hid('W20')),
  array[30]::smallint[], 'AC4 W20 records only the 30-day mark');
select t.eq((select count(*) from photo_deletion_warnings where homework_id = t.hid('GONE')), 0::bigint,
  'AC4 a removed photo is never counted');
select t.eq((select count(*) from photo_deletion_warnings where homework_id in (t.hid('PEND'), t.hid('TEACH'))), 2::bigint,
  'AC5 the 30-day marks are recorded for a Pending sender and the teacher too, so approving later sends nothing');
select t.eq((select count(*) from photo_deletion_warnings where homework_id in (t.id('HW_A1'), t.id('HW_B1'))), 0::bigint,
  'AC4 unchecked homework is never counted');

-- AC 4: 13 days later W20 reaches the 7-day mark: one more message counting only W20.
update homework set checked_at = checked_at - interval '13 days' where id = t.hid('W20');
select t.bot();
select t.eq((select photo_count || ':' || (earliest - (now() at time zone 'utc')::date) from claim_photo_deletion_warnings()
  where user_id = t.id('S1')), '1:7', 'AC4 the 7-day mark sends one more message for W20 only');
select t.eq((select count(*) from claim_photo_deletion_warnings()), 0::bigint, 'AC4 a re-run sends nothing');
reset role;

-- AC 5: the switch toggles only its column; every older kind still toggles.
insert into telegram_links (user_id, chat_id) values (t.id('S1'), 111) on conflict do nothing;
select t.login('S1');
select set_telegram_notification('photo_deletion', false);
reset role;
select t.ok((select not notify_photo_deletion and notify_homework_reviewed and notify_new_homework and notify_meeting_started
  and notify_chat_message and notify_general_chat and notify_new_material from telegram_links where user_id = t.id('S1')),
  'AC5 turning Photo deletion off changes only that switch');
select t.login('S1');
select set_telegram_notification(k, false) from unnest(array['meeting_started', 'new_homework', 'homework_reviewed',
  'chat_message', 'new_account', 'homework_submitted', 'general_chat', 'new_material']) k;
select set_telegram_notification('photo_deletion', true);
reset role;
select t.ok((select notify_photo_deletion and not (notify_meeting_started or notify_new_homework or notify_homework_reviewed
  or notify_chat_message or notify_new_account or notify_homework_submitted or notify_general_chat or notify_new_material)
  from telegram_links where user_id = t.id('S1')), 'AC5 every older kind still toggles, and Photo deletion turns back on');
