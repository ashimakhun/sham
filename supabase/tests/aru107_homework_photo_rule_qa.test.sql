-- QA ARU-107: gaps in aru107_homework_photo_rule.test.sql: the teacher's check gets the server time; a client that
-- un-checks while sending a checked_at still gets null; the service role's own check without a time gets now(); more
-- month-end cases and the start-date floor's edges; a mentor sending as a listener gets their own photos and the
-- course owner (the checker) gets none of the listener's; a declined (rejected) account gets nothing; a hidden course the sender
-- is still in is kept; oldest first with the sent time; a claim marks the link used; account deletion removes its
-- links (ARU-75); and nothing schedules a job or deletes a file (AC 10).
-- Fixture (t.seed): course A owned by M, B by N; teacher T; S1 has HW_A1 (A, photo), HW_A2 (A, no photo, checked),
-- HW_B1 (B, photo).
select t.seed();
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;
create function pg_temp.id(name text) returns uuid language sql immutable as $$ select md5('aru107qa-' || name)::uuid $$;
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')), (t.id('A'), t.id('M2'), t.id('M')), (t.id('A'), t.id('S3'), t.id('M'));

-- AC 1: the teacher checks; the server's clock wins over the client's value.
select t.login('T');
select t.eq(t.affected(format($$update homework set status = 'checked', checked_by = %L, checked_at = '2031-01-01' where id = %L$$,
  t.id('T'), t.id('HW_B1'))), 1::bigint, 'AC1 T checks HW_B1, sending 2031-01-01');
reset role;
select t.ok((select checked_at between now() - interval '1 minute' and now() + interval '1 second' from homework
  where id = t.id('HW_B1')), 'AC1 the teacher''s check gets the server time');

-- AC 1: un-checking while sending a checked_at still clears it.
select t.login('M');
select t.eq(t.affected(format($$update homework set status = 'submitted', checked_at = '2031-01-01' where id = %L$$, t.id('HW_A2'))),
  1::bigint, 'AC1 M sets HW_A2 back to submitted, sending a checked_at');
reset role;
select t.ok((select checked_at is null from homework where id = t.id('HW_A2')), 'AC1 checked_at is null once status leaves checked');

-- AC 1: the service role checking without a time gets now() (ARU-112 or an admin fix doesn't leave it null).
set role service_role;
update homework set status = 'checked' where id = t.id('HW_A2');
reset role;
select t.ok((select checked_at > now() - interval '1 minute' from homework where id = t.id('HW_A2')),
  'AC1 a service-role check without a time gets now()');

-- AC 3: more month-end cases and the floor's edges.
update app_settings set photo_deletion_start = '2026-01-01';
select t.eq(photo_deletion_date('2027-03-31T12:00:00Z'), '2027-09-30'::date, 'AC3 31 Mar -> 30 Sep');
select t.eq(photo_deletion_date('2028-02-29T12:00:00Z'), '2028-08-29'::date, 'AC3 29 Feb -> 29 Aug');
select t.eq(photo_deletion_date('2026-12-31T23:59:59Z'), '2027-06-30'::date, 'AC3 31 Dec 23:59 UTC -> 30 Jun');
select t.eq(photo_deletion_date('2027-01-01T00:30:00+01:00'), '2027-06-30'::date, 'AC3 00:30 in UTC+1 is still 31 Dec in UTC');
update app_settings set photo_deletion_start = '2027-05-12';
select t.eq(photo_deletion_date('2026-11-12T10:00:00Z'), '2027-05-12'::date, 'AC3 start date equal to the 6-month date');
select t.eq(photo_deletion_date('2026-11-13T10:00:00Z'), '2027-05-13'::date, 'AC3 a later 6-month date wins over the start date');
select t.login('S1');
select t.eq(photo_deletion_date('2026-11-13T10:00:00Z'), '2027-05-13'::date, 'AC3 a signed-in student gets the same date');
select t.login(null);
select t.ok(photo_deletion_date('2026-11-13T10:00:00Z') is null, 'AC2 signed out: no start date readable, so no date');
reset role;
update app_settings set photo_deletion_start = null;

-- AC 5 / AC 7: a mentor sending as a listener gets their own photo; the course owner gets none of the listeners'.
insert into homework (id, student_id, course_id, title, photo_path, created_at) values
  (pg_temp.id('M2HW'), t.id('M2'), t.id('A'), 'Mentor work', t.id('M2') || '/m2.jpg', now() - interval '3 days'),
  (pg_temp.id('S3old'), t.id('S3'), t.id('A'), 'Older', t.id('S3') || '/old.jpg', now() - interval '2 days'),
  (pg_temp.id('S3new'), t.id('S3'), t.id('A'), 'Newer', t.id('S3') || '/new.jpg', now() - interval '1 day');
insert into storage.objects (bucket_id, name, owner) values
  ('homework', t.id('M2') || '/m2.jpg', t.id('M2')),
  ('homework', t.id('S3') || '/old.jpg', t.id('S3')),
  ('homework', t.id('S3') || '/new.jpg', t.id('S3'));
set role service_role;
select t.eq((select array_agg(homework_id) from homework_photos_for_zip(t.id('M2'))), array[pg_temp.id('M2HW')],
  'AC5 a mentor listener gets their own photo only');
select t.eq((select count(*) from homework_photos_for_zip(t.id('M'))), 0::bigint, 'AC7 the course owner gets none of the listeners'' photos');
select t.eq((select array_agg(homework_id) from homework_photos_for_zip(t.id('S3'))), array[pg_temp.id('S3old'), pg_temp.id('S3new')],
  'AC6 oldest first, so the parts of a course are stable');
select t.ok((select sent_at < now() - interval '36 hours' from homework_photos_for_zip(t.id('S3')) where homework_id = pg_temp.id('S3old')),
  'AC5 sent_at is the time the homework was sent (for the file name)');
select t.ok((select assignment_title is null and homework_title = 'Older' from homework_photos_for_zip(t.id('S3'))
  where homework_id = pg_temp.id('S3old')), 'AC5 homework without an assignment has its title and no assignment title');
reset role;

-- AC 7: a declined (rejected) account gets nothing; a hidden course the sender is still in is kept.
update courses set hidden = true where id = t.id('A');
set role service_role;
select t.eq((select count(*) from homework_photos_for_zip(t.id('S3'))), 2::bigint, 'AC7 hidden course the sender is still in: kept');
reset role;
update profiles set access_status = 'rejected' where id = t.id('S3');
set role service_role;
select t.eq((select count(*) from homework_photos_for_zip(t.id('S3'))), 0::bigint, 'AC7 a declined (rejected) account gets nothing');
reset role;

-- AC 5: a claim marks the link used; an anon or signed-in caller can't claim one.
insert into photo_zip_links (token_hash, user_id, homework_ids, expires_at) values
  ('qa-good', t.id('S1'), array[t.id('HW_A1')], now() + interval '60 seconds');
select t.login(null);
select t.throws($$select * from claim_photo_zip_link('qa-good')$$, '42501', 'AC7 signed out can''t claim a link');
reset role;
set role service_role;
select t.eq((select homework_ids from claim_photo_zip_link('qa-good')), array[t.id('HW_A1')], 'AC5 the claim returns the link''s homework');
reset role;
select t.ok((select used_at is not null from photo_zip_links where token_hash = 'qa-good'), 'AC5 the claimed link is marked used');

-- ARU-75: deleting an account removes its links with it.
delete from profiles where id = t.id('S1');
select t.eq((select count(*) from photo_zip_links where user_id = t.id('S1')), 0::bigint, 'ARU-75 account deletion removes its links');

-- AC 10: nothing schedules a job; no file was removed by this story.
select t.eq((select count(*) from cron.job where command ~* 'photo|homework'), 0::bigint, 'AC10 no job scheduled for photos');
select t.eq((select count(*) from storage.objects where bucket_id = 'homework' and owner in (t.id('M2'), t.id('S3'))), 3::bigint,
  'AC10 every photo file is still there');
