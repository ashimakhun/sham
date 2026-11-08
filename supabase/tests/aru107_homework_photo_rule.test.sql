-- ARU-107 (part a): server-set checked_at, the deletion start date and date, and the ZIP functions.
-- Rules under test: supabase/migrations/0049_homework_photo_rule.sql.
-- Fixture (t.seed): S1 has HW_A1 (A, photo S1/a1.jpg, submitted), HW_A2 (A, no photo, checked by M) and HW_B1
-- (B, photo S1/b1.jpg, submitted). Below S1 is a listener of A; S2 is a listener of A with one photo.
select t.seed();
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;
insert into course_members (course_id, user_id, added_by) values (t.id('A'), t.id('S1'), t.id('M')), (t.id('A'), t.id('S2'), t.id('M'));
create function pg_temp.id(name text) returns uuid language sql immutable as $$ select md5('aru107-' || name)::uuid $$;
insert into homework (id, student_id, course_id, title, photo_path) values
  (pg_temp.id('S2HW'), t.id('S2'), t.id('A'), 'S2 work', t.id('S2') || '/s2.jpg');
insert into storage.objects (bucket_id, name, owner) values ('homework', t.id('S2') || '/s2.jpg', t.id('S2'));

-- AC 1: the migration's backfill and the trigger.
select t.ok((select checked_at is not null from homework where id = t.id('HW_A2')), 'AC1 checked homework has a checked_at');

select t.login('M');
select t.eq(t.affected(format($$update homework set status = 'checked', checked_by = %L, checked_at = '2020-01-01', mentor_comment = 'ok' where id = %L$$,
  t.id('M'), t.id('HW_A1'))), 1::bigint, 'AC1 M checks HW_A1 (an old app still sending checked_at works)');
reset role;
select t.ok((select checked_at > now() - interval '1 minute' from homework where id = t.id('HW_A1')),
  'AC1 checked_at is the server''s time, not the client''s 2020-01-01');
update homework set checked_at = '2026-08-31T10:00:00Z' where id = t.id('HW_A1'); -- admin may set it (fixtures, ARU-112)
select t.eq((select checked_at from homework where id = t.id('HW_A1')), '2026-08-31T10:00:00Z'::timestamptz, 'admin sets checked_at');

select t.login('M');
select t.eq(t.affected(format($$update homework set checked_at = '2030-01-01' where id = %L$$, t.id('HW_A1'))), 1::bigint,
  'AC1 a client update of checked_at alone runs');
select t.eq(t.affected(format($$update homework set mentor_comment = 'better' where id = %L$$, t.id('HW_A1'))), 1::bigint,
  'AC1 a comment edit runs');
reset role;
select t.eq((select checked_at from homework where id = t.id('HW_A1')), '2026-08-31T10:00:00Z'::timestamptz,
  'AC1 neither moves checked_at (still checked: the first check time stays)');

select t.login('M');
select t.eq(t.affected(format($$update homework set status = 'submitted', checked_by = %L where id = %L$$, t.id('M'), t.id('HW_A1'))),
  1::bigint, 'AC1 status back to submitted through the API');
reset role;
select t.ok((select checked_at is null from homework where id = t.id('HW_A1')), 'AC1 checked_at is cleared when status leaves checked');
select t.login('M');
select t.eq(t.affected(format($$update homework set status = 'checked', checked_by = %L where id = %L$$, t.id('M'), t.id('HW_A1'))),
  1::bigint, 'AC1 checked again');
reset role;
select t.ok((select checked_at > now() - interval '1 minute' from homework where id = t.id('HW_A1')), 'AC1 a new checked_at on the next check');

-- A client insert can't bring its own checked_at.
select t.make_assignments(t.id('A'));
select t.login('S1');
select t.lives(format($$insert into homework (student_id, course_id, assignment_id, title, checked_at) values (%L, %L, %L, 'x', '2020-01-01')$$,
  t.id('S1'), t.id('A'), t.assignment(t.id('A'))), 'S1 sends homework with a checked_at');
reset role;
select t.ok((select checked_at is null from homework where title = 'x'), 'the insert''s checked_at is dropped');

-- AC 2: the start date row.
select t.eq((select count(*) from app_settings), 1::bigint, 'AC2 one settings row');
select t.ok((select photo_deletion_start is null from app_settings), 'AC2 the start date is empty');
select t.login('S1');
select t.eq((select count(*) from app_settings), 1::bigint, 'AC2 S1 reads the settings');
select t.throws($$update app_settings set photo_deletion_start = '2026-01-01'$$, '42501', 'AC2 S1 can''t change it');
select t.throws($$insert into app_settings (id) values (true)$$, '42501', 'AC2 nobody inserts a second row');
select t.login('T');
select t.throws($$update app_settings set photo_deletion_start = '2026-01-01'$$, '42501', 'AC2 the teacher can''t change it');
select t.login(null);
select t.eq((select count(*) from app_settings), 0::bigint, 'AC2 signed out reads nothing');

-- AC 3: the deletion date.
reset role;
select t.ok(photo_deletion_date('2026-11-12T10:00:00Z') is null, 'AC3 no date while the start date is empty');
update app_settings set photo_deletion_start = '2026-01-01';
select t.eq(photo_deletion_date('2026-11-12T10:00:00Z'), '2027-05-12'::date, 'AC3 12 Nov -> 12 May');
select t.eq(photo_deletion_date('2026-08-31T10:00:00Z'), '2027-02-28'::date, 'AC3 31 Aug -> 28 Feb');
select t.eq(photo_deletion_date('2027-08-31T10:00:00Z'), '2028-02-29'::date, 'AC3 31 Aug -> 29 Feb in a leap year');
select t.eq(photo_deletion_date('2026-11-12T23:30:00Z'), '2027-05-12'::date, 'AC3 23:30 UTC stays on its UTC day');
select t.eq(photo_deletion_date('2026-11-12T23:30:00-05:00'), '2027-05-13'::date, 'AC3 the UTC day decides (04:30 UTC next day)');
select t.ok(photo_deletion_date(null) is null, 'AC3 not checked: no date');
update app_settings set photo_deletion_start = '2027-12-01';
select t.eq(photo_deletion_date('2026-11-12T10:00:00Z'), '2027-12-01'::date, 'AC3 never before the start date');
update app_settings set photo_deletion_start = null;

-- AC 5–7: the ZIP functions are the service role's only.
select t.login('S1');
select t.throws(format('select * from homework_photos_for_zip(%L)', t.id('S1')), '42501', 'AC7 S1 can''t call homework_photos_for_zip');
select t.throws($$select * from claim_photo_zip_link('x')$$, '42501', 'AC7 S1 can''t claim a link');
select t.eq((select count(*) from photo_zip_links), 0::bigint, 'AC7 S1 reads no links');
select t.throws(format($$insert into photo_zip_links (token_hash, user_id, homework_ids, expires_at) values ('h', %L, '{}', now() + interval '1 hour')$$, t.id('S1')),
  '42501', 'AC7 S1 can''t create a link');

reset role;
set role service_role;
select t.eq((select array_agg(homework_id order by homework_id) from homework_photos_for_zip(t.id('S1'))),
  array[t.id('HW_A1'), t.id('HW_B1')]::uuid[] , 'AC5 S1''s stored photos only (no photo-less homework, no S2 photo)');
select t.eq((select course_title || ' / ' || homework_title from homework_photos_for_zip(t.id('S1')) where homework_id = t.id('HW_A1')),
  'Algebra / A one', 'AC5 course and homework titles for the file names');
select t.eq((select count(*) from homework_photos_for_zip(t.id('T'))), 0::bigint, 'AC7 the teacher gets none of the students'' photos');
reset role;
delete from storage.objects where name = t.id('S1') || '/b1.jpg';
set role service_role;
select t.eq((select count(*) from homework_photos_for_zip(t.id('S1'))), 1::bigint, 'edge: a missing file is left out');
reset role;
update courses set hidden = true where id = t.id('A');
delete from course_members where user_id = t.id('S1');
set role service_role;
select t.eq((select count(*) from homework_photos_for_zip(t.id('S1'))), 0::bigint, 'AC7 guard: homework in a hidden course they left is left out');
reset role;
update profiles set access_status = 'pending' where id = t.id('S2');
set role service_role;
select t.eq((select count(*) from homework_photos_for_zip(t.id('S2'))), 0::bigint, 'AC7 a waiting account gets nothing');

-- AC 5: a link works once and only before it expires.
reset role;
insert into photo_zip_links (token_hash, user_id, homework_ids, expires_at) values
  ('good', t.id('S1'), array[t.id('HW_A1')], now() + interval '60 seconds'),
  ('old', t.id('S1'), array[t.id('HW_A1')], now() - interval '1 second');
set role service_role;
select t.eq((select user_id from claim_photo_zip_link('good')), t.id('S1'), 'AC5 a fresh link is claimed');
select t.eq((select count(*) from claim_photo_zip_link('good')), 0::bigint, 'AC5 a used link returns nothing');
select t.eq((select count(*) from claim_photo_zip_link('old')), 0::bigint, 'AC5 an expired link returns nothing');
select t.eq((select count(*) from claim_photo_zip_link('forged')), 0::bigint, 'AC5 an unknown link returns nothing');

-- AC 10: nothing was deleted by the rule (only the fixture's own delete above).
reset role;
select t.eq((select count(*) from storage.objects where bucket_id = 'homework'), 2::bigint, 'AC10 the other photos are all still there');
select t.ok((select photo_path is not null from homework where id = t.id('HW_A1')), 'AC10 photo paths are unchanged');
