-- ARU-112: the daily photo-deletion job's database side.
-- Rules under test: supabase/migrations/0054_homework_photo_deletion.sql (on top of 0050's photo_deletion_date()).
-- Fixture (t.seed): S1 sent HW_A1 (A, photo S1/a1.jpg, submitted) and HW_B1 (B, photo S1/b1.jpg, submitted); S2 and S3
-- are students. Below, extra homework is made as the admin with checked_at relative to now.
select t.seed();
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

create function t.bot() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
end $$;
grant execute on function t.bot() to anon, authenticated, service_role;

create function t.hid(name text) returns uuid language sql immutable as $$ select md5('aru112-' || name)::uuid $$;
grant execute on function t.hid(text) to anon, authenticated, service_role;
-- Homework `name` by `who` in `course`, checked `checked_ago` before now (null = not checked), with a photo or not.
create function t.hw(name text, who text, course text, checked_ago interval, photo boolean default true)
  returns void language plpgsql security definer as $$
  begin
    insert into homework (id, student_id, course_id, title, description, photo_path, status, checked_by, checked_at,
                          mentor_comment)
    values (t.hid(name), t.id(who), t.id(course), 'Title ' || name, 'Desc ' || name,
            case when photo then t.id(who) || '/' || name || '.jpg' end,
            case when checked_ago is null then 'submitted' else 'checked' end::homework_status,
            case when checked_ago is null then null else t.id('M') end,
            now() - checked_ago, case when checked_ago is null then null else 'Nice' end);
    if photo then
      insert into storage.objects (bucket_id, name, owner) values ('homework', t.id(who) || '/' || name || '.jpg', t.id(who));
    end if;
  end $$;
-- Names (fixture keys) of what due_homework_photos(n) returns, in order.
create function t.due(n integer) returns text language sql as $$
  select coalesce(string_agg(
    coalesce((select k from unnest(array['OLD','OLDER','SOON','D30','D40','UNCHK','NOPHOTO','HIDDEN','S2SOON']) k
              where t.hid(k) = d.homework_id), '?'), ',' order by ord), '')
  from due_homework_photos(n) with ordinality as d(homework_id, photo_path, ord)
$$;
grant execute on function t.due(integer) to service_role;
-- claim_photo_deletion_warnings() as "user:count:earliest" lines, sorted.
create function t.warn() returns text language sql as $$
  select coalesce(string_agg(
    coalesce((select k from unnest(array['S1','S2','S3','M','M2','T']) k where t.id(k) = w.user_id), '?')
      || ':' || w.photo_count || ':' || (w.earliest - (now() at time zone 'utc')::date), ' | ' order by w.user_id), '')
  from claim_photo_deletion_warnings() w
$$;
grant execute on function t.warn() to service_role;

-- Data: new columns and table, defaults.
select t.ok(exists (select 1 from information_schema.columns where table_name = 'homework'
  and column_name = 'photo_removed_at' and is_nullable = 'YES'), 'data: homework.photo_removed_at is nullable');
select t.ok((select bool_and(photo_removed_at is null) from homework), 'data: existing homework has no removal time');
select t.ok(exists (select 1 from information_schema.columns where table_name = 'telegram_links'
  and column_name = 'notify_photo_deletion' and column_default = 'true' and is_nullable = 'NO'),
  'AC5 telegram_links.notify_photo_deletion defaults to on');
select t.ok((select relrowsecurity from pg_class where relname = 'photo_deletion_warnings'), 'AC9 warnings table has RLS on');

-- AC 9: only the service role runs the job's functions.
select t.ok(not has_function_privilege('authenticated', 'start_photo_deletion()', 'execute'), 'AC9 app users can''t set the start date');
select t.ok(not has_function_privilege('anon', 'start_photo_deletion()', 'execute'), 'AC9 anon can''t set the start date');
select t.ok(not has_function_privilege('authenticated', 'due_homework_photos(integer)', 'execute'), 'AC9 app users can''t list due photos');
select t.ok(not has_function_privilege('authenticated', 'mark_homework_photos_removed(uuid[],text[])', 'execute'),
  'AC9 app users can''t mark photos removed');
select t.ok(not has_function_privilege('authenticated', 'claim_photo_deletion_warnings()', 'execute'),
  'AC9 app users can''t record warnings');
select t.ok(not has_function_privilege('authenticated', 'leftover_homework_photos(integer)', 'execute'),
  'AC9 app users can''t list leftover files');
select t.ok(has_function_privilege('service_role', 'start_photo_deletion()', 'execute')
  and has_function_privilege('service_role', 'due_homework_photos(integer)', 'execute')
  and has_function_privilege('service_role', 'mark_homework_photos_removed(uuid[],text[])', 'execute')
  and has_function_privilege('service_role', 'claim_photo_deletion_warnings()', 'execute')
  and has_function_privilege('service_role', 'leftover_homework_photos(integer)', 'execute'), 'AC9 the service role can run all five');
select t.login('S1');
select t.throws('select * from start_photo_deletion()', '42501', 'AC9 a student calling the start is refused');
select t.throws($$select mark_homework_photos_removed(array[t.id('HW_A1')], array['x'])$$, '42501',
  'AC9 a student marking a photo removed is refused');
select t.throws($$update homework set photo_removed_at = now() where id = t.id('HW_A1')$$, '42501',
  'AC9 a student can''t set the removal time');
select t.throws($$update homework set photo_path = 'x.jpg' where id = t.id('HW_A1')$$, '42501',
  'AC9 a student can''t set photo_path back');
reset role;
select t.ok(not has_column_privilege('authenticated', 'homework', 'photo_removed_at', 'update'),
  'AC9 photo_removed_at is not in the client update grant');

-- AC 1: the first run sets today + 30; later runs keep it.
select t.ok((select photo_deletion_start is null from app_settings), 'AC8 the start date is empty before the job runs');
select t.bot();
select t.eq((select format('%s/%s', start_date - (now() at time zone 'utc')::date, first_run) from start_photo_deletion()),
  '30/t', 'AC1 first run: start = today (UTC) + 30, and it says so');
select t.eq((select format('%s/%s', start_date - (now() at time zone 'utc')::date, first_run) from start_photo_deletion()),
  '30/f', 'AC1 second run: the same date, not a first run');
reset role;
select t.eq((select photo_deletion_start - (now() at time zone 'utc')::date from app_settings), 30, 'AC1 the stored date');

-- Photos for the rest of the test. Deletion date = UTC date of checked_at + 6 months, never before the start date.
select t.hw('OLDER', 'S1', 'A', interval '8 months');
select t.hw('OLD', 'S1', 'A', interval '7 months');
select t.hw('SOON', 'S1', 'A', interval '6 months' - interval '5 days');   -- about 5 days left
select t.hw('D30', 'S1', 'B', interval '6 months' - interval '20 days');   -- about 20 days left
select t.hw('D40', 'S1', 'B', interval '6 months' - interval '40 days');   -- about 40 days left
select t.hw('UNCHK', 'S1', 'A', null);                                     -- not checked: never touched
select t.hw('NOPHOTO', 'S1', 'A', interval '8 months', false);
update courses set hidden = true where id = t.id('B');
select t.hw('HIDDEN', 'S2', 'B', interval '7 months');                     -- hidden course: same rule
select t.hw('S2SOON', 'S2', 'A', interval '6 months' - interval '3 days');

-- AC 1: right after the first run nothing is due (every date is at least the start date, 30 days away).
select t.bot();
select t.eq(t.due(100), '', 'AC1 nothing is due while the start date is 30 days away');
reset role;

-- From here on, the deletion start date has passed.
update app_settings set photo_deletion_start = (now() at time zone 'utc')::date - 400;

-- AC 2: what is due, most overdue first; the limit takes the oldest.
select t.bot();
select t.eq(t.due(100), 'OLDER,OLD,HIDDEN',
  'AC2 due: checked photos with a date today or earlier, oldest first (hidden course included; not unchecked, not without a photo, not future)');
select t.eq(t.due(1), 'OLDER', 'edge case: a limited run takes the most overdue');

-- AC 2 / AC 3: marking removed clears the path and stores the time, only for the file that was deleted.
select t.eq(mark_homework_photos_removed(array[t.hid('OLDER'), t.hid('OLD')], array[t.id('S1') || '/OLDER.jpg', 'other.jpg']),
  1, 'AC2 only the row still pointing at the deleted file changes');
reset role;
select t.eq((select format('%s|%s|%s|%s|%s|%s', photo_path is null, photo_removed_at is not null, title, description,
  status, mentor_comment) from homework where id = t.hid('OLDER')),
  't|t|Title OLDER|Desc OLDER|checked|Nice', 'AC2 path cleared, removal time set; title, text, status and comment stay');
select t.ok((select checked_at is not null and checked_by = t.id('M') from homework where id = t.hid('OLDER')),
  'AC2 checker and checked_at stay');
select t.ok((select photo_path is not null and photo_removed_at is null from homework where id = t.hid('OLD')),
  'AC3 a row whose path didn''t match is untouched (retried next run)');
select t.bot();
select t.eq(t.due(100), 'OLD,HIDDEN', 'AC3 a removed photo is no longer due');
select t.eq(mark_homework_photos_removed(array[t.hid('OLDER')], array[t.id('S1') || '/OLDER.jpg']), 0,
  'AC3 marking it again changes nothing');
reset role;
select t.ok((select photo_path is not null from homework where id = t.hid('UNCHK')), 'AC2 unchecked homework keeps its photo');

-- AC 4: warnings. S1 has SOON (~5 days: both marks) and D30 (~20 days: the 30-day mark); D40 is too far; OLD is
-- overdue (it is deleted, not warned). S2 has S2SOON but is Pending below: the marks are recorded, no row comes back.
update profiles set access_status = 'pending' where id = t.id('S2');
select t.bot();
select t.eq(t.warn(), format('S1:2:%s', (select photo_deletion_date(checked_at) - (now() at time zone 'utc')::date
  from homework where id = t.hid('SOON'))), 'AC4 one row for S1: 2 photos, the earliest date (SOON''s)');
reset role;
select t.eq((select string_agg(mark::text, ',' order by mark) from photo_deletion_warnings where homework_id = t.hid('SOON')),
  '7,30', 'AC4 a photo first seen with 7 days or less records both marks');
select t.eq((select string_agg(mark::text, ',' order by mark) from photo_deletion_warnings where homework_id = t.hid('D30')),
  '30', 'AC4 a photo 20 days away records the 30-day mark only');
select t.eq((select count(*) from photo_deletion_warnings where homework_id in (t.hid('D40'), t.hid('OLD'), t.hid('UNCHK'),
  t.hid('OLDER'))), 0::bigint, 'AC4 nothing for a photo 40 days away, overdue, unchecked or removed');
select t.eq((select count(*) from photo_deletion_warnings where user_id = t.id('S2')), 2::bigint,
  'AC4 / note 1: a Pending sender''s marks are still recorded (no backfill later)');
select t.bot();
select t.eq(t.warn(), '', 'AC4 a second run the same day finds no new mark');
reset role;
update profiles set access_status = 'approved' where id = t.id('S2');
select t.bot();
select t.eq(t.warn(), '', 'AC5 approving S2 later sends nothing for marks already passed');
reset role;

-- AC 4: D30 reaches 7 days later on (moved closer by the admin): one more message, for that photo.
update homework set checked_at = now() - interval '6 months' + interval '6 days' where id = t.hid('D30');
select t.bot();
select t.eq(t.warn(), format('S1:1:%s', (select photo_deletion_date(checked_at) - (now() at time zone 'utc')::date
  from homework where id = t.hid('D30'))), 'AC4 the 7-day mark: one more message, for the 1 photo that reached it');
reset role;

-- AC 9: app users read no warning, their own included.
select t.login('S1');
select t.eq((select count(*) from photo_deletion_warnings), 0::bigint, 'AC9 a sender reads no warning records');
select t.throws($$insert into photo_deletion_warnings (homework_id, mark, user_id, deletion_date)
  values (t.hid('D40'), 30, t.id('S1'), current_date)$$, '42501', 'AC9 a sender can''t write one');
select t.login('T');
select t.eq((select count(*) from photo_deletion_warnings), 0::bigint, 'AC9 the teacher reads none either');
reset role;

-- AC 7: leftover files: homework bucket only, unreferenced, older than 24 hours.
insert into storage.objects (bucket_id, name, owner, created_at) values
  ('homework', 'left/25h.jpg', t.id('S1'), now() - interval '25 hours'),
  ('homework', 'left/23h.jpg', t.id('S1'), now() - interval '23 hours'),
  ('payment-proofs', 'left/proof.jpg', t.id('S1'), now() - interval '3 days'),
  ('materials', 'left/file.pdf', t.id('M'), now() - interval '3 days');
update storage.objects set created_at = now() - interval '30 days' where name = t.id('S1') || '/a1.jpg'; -- still used
update storage.objects set created_at = now() - interval '9 months' where name = t.id('S1') || '/OLDER.jpg'; -- removed row
select t.bot();
select t.eq((select string_agg(name, ',' order by name) from leftover_homework_photos(100)),
  t.id('S1') || '/OLDER.jpg,left/25h.jpg',
  'AC7 unreferenced homework files older than 24 h (not 23 h old, not still used, not other buckets)');
select t.eq((select count(*) from leftover_homework_photos(1)), 1::bigint, 'AC7 the limit is respected');
reset role;

-- AC 5: the switch.
insert into telegram_links (user_id, chat_id) values (t.id('S1'), 111);
select t.ok((select notify_photo_deletion from telegram_links where user_id = t.id('S1')), 'AC5 a new link has it on');
select t.login('S1');
select t.lives($$select set_telegram_notification('photo_deletion', false)$$, 'AC5 a student turns it off');
reset role;
select t.ok((select not notify_photo_deletion and notify_new_material and notify_homework_reviewed
  from telegram_links where user_id = t.id('S1')), 'AC5 only Photo deletion changed');
select t.login('S1');
select t.lives($$select set_telegram_notification('new_material', false)$$, 'every existing kind still toggles');
select t.throws($$select set_telegram_notification('nope', true)$$, '22023', 'an unknown kind is still refused');
reset role;

-- AC 8: the daily job, with its URL and secret read from Vault on each run.
select t.eq((select schedule from cron.job where jobname = 'photo-deletion'), '17 3 * * *', 'AC8 the job runs once a day');
select t.ok((select command ~ 'photo_deletion_url' and command ~ 'photo_deletion_secret' and command ~ 'x-cron-secret'
  from cron.job where jobname = 'photo-deletion'), 'AC8 it reads its URL and secret from Vault');
