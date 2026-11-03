-- QA ARU-49: gaps in aru49_homework_reviewed_notifications.test.sql: the recipient is only ever the sender (never the
-- checker, the course owner or the teacher); the trigger still reads Vault when Vault is closed to the app roles (as
-- on Supabase); one call per row of a multi-row update; no call for an insert that is already checked, for checked ->
-- submitted, for a delete, for an empty secret, or for an update RLS refuses (the sender themselves, another
-- student).
select t.seed();
insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('B'), t.id('S2'), t.id('N'));

create function t.qid(name text) returns uuid language sql immutable as $$ select md5('aru49qa-' || name)::uuid $$;
grant execute on function t.qid(text) to anon, authenticated, service_role;
create function t.calls() returns bigint language sql security definer as $$ select count(*) from net.requests $$;
grant execute on function t.calls() to anon, authenticated, service_role;
create function t.who(hw uuid) returns text language plpgsql as $$
declare
  result text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
  select coalesce(string_agg(coalesce(
           (select k from unnest(array['S1','S2','S3','M','M2','N','T']) k where t.id(k) = r.user_id), '?'), ','), '')
    into result from homework_reviewed_recipient(hw) r;
  reset role;
  return result;
end $$;
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

-- The recipient is the sender only, whoever checked it.
update homework set checked_by = t.id('T') where id = t.id('HW_A2');
select t.eq(t.who(t.id('HW_A2')), 'S1', 'checked by the teacher: only the sender (not T, not owner M)');
update homework set checked_by = t.id('M') where id = t.id('HW_A2');
select t.eq(t.who(t.id('HW_A2')), 'S1', 'checked by the owner: only the sender');
select t.eq(t.who(null), '', 'a null id: nothing');

-- Vault closed to the app roles, as on Supabase: the trigger (security definer) still reads it.
revoke all on vault.decrypted_secrets from public, anon, authenticated, service_role;
revoke usage on schema vault from public, anon, authenticated, service_role;
insert into vault.decrypted_secrets values
  ('homework_reviewed_notify_url', 'https://example.supabase.co/functions/v1/homework-reviewed-notifications'),
  ('homework_reviewed_notify_secret', 's3cret');
select t.login('M');
select t.throws('select * from vault.decrypted_secrets', '42501', 'the mentor can''t read Vault directly');
select t.lives(format('update homework set status = ''checked'', checked_by = %L, checked_at = now() where id = %L',
  t.id('M'), t.id('HW_A1')), 'the mentor checks HW_A1');
reset role;
select t.eq(t.calls(), 1::bigint, 'Vault closed to authenticated: the call is still queued');
select t.eq((select headers ->> 'Authorization' from net.requests order by id desc limit 1), 'Bearer s3cret',
  'with the Vault secret');

-- RLS-refused updates queue nothing.
select t.login('S1');
select t.eq(t.affected(format('update homework set status = ''checked'' where id = %L', t.id('HW_B1'))), 0::bigint,
  'the sender can''t check their own homework');
select t.login('S2');
select t.eq(t.affected(format('update homework set status = ''checked'', checked_by = %L where id = %L',
  t.id('S2'), t.id('HW_B1'))), 0::bigint, 'another student can''t check it');
reset role;
select t.eq((select status::text from homework where id = t.id('HW_B1')), 'submitted', 'HW_B1 still submitted');
select t.eq(t.calls(), 1::bigint, 'refused updates: no call');

-- One statement, several rows -> one call per row.
insert into homework (id, student_id, course_id, title, status) values
  (t.qid('p'), t.id('S1'), t.id('A'), 'p', 'submitted'),
  (t.qid('q'), t.id('S1'), t.id('A'), 'q', 'submitted'),
  (t.qid('r'), t.id('S1'), t.id('A'), 'r', 'checked');
select t.eq(t.calls(), 1::bigint, 'an insert that is already checked: no call');
select t.login('M');
select t.eq(t.affected(format('update homework set status = ''checked'', checked_by = %L, checked_at = now() where id in (%L, %L, %L)',
  t.id('M'), t.qid('p'), t.qid('q'), t.qid('r'))), 3::bigint, 'one statement updates p, q and r');
reset role;
select t.eq(t.calls(), 3::bigint, 'p and q queued one call each; r was already checked');
select t.eq((select string_agg(body ->> 'homework_id', ',' order by body ->> 'homework_id') from net.requests where id > 1),
  (select string_agg(x::text, ',' order by x::text) from unnest(array[t.qid('p'), t.qid('q')]) x), 'the calls carry p and q');

-- checked -> submitted, and a delete: no call.
update homework set status = 'submitted' where id = t.qid('p');
delete from homework where id = t.qid('q');
select t.eq(t.calls(), 3::bigint, 'checked -> submitted and a delete: no call');
select t.eq(t.who(t.qid('q')), '', 'deleted before the function runs: nothing to send');

-- An empty secret counts as missing.
update vault.decrypted_secrets set decrypted_secret = '' where name = 'homework_reviewed_notify_secret';
update homework set status = 'checked' where id = t.qid('p');
select t.eq(t.calls(), 3::bigint, 'empty secret in Vault: no call');
update vault.decrypted_secrets set decrypted_secret = 's3cret' where name = 'homework_reviewed_notify_secret';
update vault.decrypted_secrets set decrypted_secret = '' where name = 'homework_reviewed_notify_url';
update homework set status = 'submitted' where id = t.qid('p');
update homework set status = 'checked' where id = t.qid('p');
select t.eq(t.calls(), 3::bigint, 'empty URL in Vault: no call');
