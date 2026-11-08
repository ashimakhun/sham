-- QA ARU-102: gaps in aru102_new_material_notifications.test.sql: empty Vault values send nothing; a multi-row insert
-- queues one call per row, each with its own id; the call body never carries the post body, link, file description
-- or storage path; a course-only PDF follows the course's current owner (ownership moved) and reaches a mentor
-- listener; a link with only other switches off still gets it, a link with New materials off doesn't; the function
-- settings (security definer, search_path) and the trigger shape (after insert, per row).
-- Fixture (t.seed): teacher T; mentors M (owns A), N (owns B), M2; students S1, S2. A has listeners S1 and M2.
select t.seed();
create function t.mid(name text) returns uuid language sql immutable as $$ select md5('aru102qa-' || name)::uuid $$;
grant execute on function t.mid(text) to anon, authenticated, service_role;
grant usage on schema t to service_role;

insert into course_members (course_id, user_id, added_by) values
  (t.id('A'), t.id('S1'), t.id('M')),
  (t.id('A'), t.id('M2'), t.id('M'));
insert into telegram_links (user_id, chat_id) values
  (t.id('T'), 4001), (t.id('M'), 4002), (t.id('N'), 4003), (t.id('M2'), 4004), (t.id('S1'), 4005), (t.id('S2'), 4006);

-- Recipients as "a,b,c" (fixture names, sorted), as the service role.
create function t.who(kind text, item uuid) returns text language plpgsql as $$
declare
  result text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
  select coalesce(string_agg(k, ',' order by k), '') into result
    from unnest(array['T','M','N','M2','S1','S2','S3']) k
    where t.id(k) in (select r.user_id from new_material_recipients(kind, item) r);
  reset role;
  return result;
end $$;
grant execute on all functions in schema t to service_role;

create function t.calls() returns bigint language sql security definer as $$ select count(*) from net.requests $$;
grant execute on function t.calls() to anon, authenticated, service_role;

-- Function settings and trigger shape.
select t.ok((select prosecdef and proconfig @> array['search_path=public'] from pg_proc
  where oid = 'new_material_recipients(text,uuid)'::regprocedure), 'recipients: security definer, search_path=public');
select t.ok((select bool_and(prosecdef) from pg_proc where proname in
  ('queue_new_material_notification', 'notify_new_blog_post', 'notify_new_material_file')), 'trigger functions: security definer');
select t.ok(not has_function_privilege('authenticated', 'queue_new_material_notification(text,uuid)', 'execute'),
  'app users can''t queue a call themselves');
select t.eq((select count(*) from pg_trigger where tgname in ('materials_notify_new', 'material_files_notify_new')
  and tgtype & 1 = 1 and tgtype & 4 = 4 and tgtype & 16 = 0 and tgtype & 8 = 0), 2::bigint,
  'both triggers: after insert, for each row, not on update or delete');

-- Empty Vault values are treated as missing.
insert into vault.decrypted_secrets (name, decrypted_secret) values ('new_material_notify_url', ''), ('new_material_notify_secret', '');
select t.login('M');
select t.lives(format('insert into materials (id, teacher_id, title, body) values (%L, %L, %L, %L)',
  t.mid('e1'), t.id('M'), 'Empty secrets', 'b'), 'AC8 a post with empty Vault values is saved');
reset role;
select t.eq(t.calls(), 0::bigint, 'AC8 empty URL and secret: no call');
update vault.decrypted_secrets set decrypted_secret = 'https://x.supabase.co/functions/v1/new-material-notifications'
  where name = 'new_material_notify_url';
select t.login('M');
select t.lives(format('insert into materials (id, teacher_id, title, body) values (%L, %L, %L, %L)',
  t.mid('e2'), t.id('M'), 'Empty secret', 'b'), 'AC8 a post with an empty secret is saved');
reset role;
select t.eq(t.calls(), 0::bigint, 'AC8 URL set, secret empty: no call');
update vault.decrypted_secrets set decrypted_secret = 'mat-secret' where name = 'new_material_notify_secret';

-- A multi-row insert: one call per row, each with its own id; nothing private in the body.
select t.login('M');
select t.lives(format(
  'insert into materials (id, teacher_id, title, body, link) values (%L, %L, %L, %L, %L), (%L, %L, %L, %L, %L)',
  t.mid('p1'), t.id('M'), 'One', 'SECRET BODY', 'https://private.example/1',
  t.mid('p2'), t.id('M'), 'Two', 'SECRET BODY', 'https://private.example/2'), 'AC9 two posts in one insert');
select t.lives(format(
  'insert into material_files (id, author_id, name, description, course_id, course_only, storage_path, size_bytes) '
  'values (%L, %L, %L, %L, %L, true, %L, 10)',
  t.mid('f1'), t.id('M'), 'Course notes.pdf', 'SECRET DESCRIPTION', t.id('A'), t.id('M')::text || '/' || t.mid('f1')::text || '.pdf'), 'AC9 a course-only PDF');
reset role;
select t.eq(t.calls(), 3::bigint, 'AC9 three rows: three calls');
select t.eq((select array_agg(body ->> 'id' order by body ->> 'id') from net.requests),
  (select array_agg(x::text order by x::text) from unnest(array[t.mid('p1'), t.mid('p2'), t.mid('f1')]) x),
  'AC9 each call carries its own id');
select t.eq((select count(*) from net.requests where body ->> 'type' = 'blog'), 2::bigint, 'AC9 type blog for posts');
select t.eq((select count(*) from net.requests where body ->> 'type' = 'file'), 1::bigint, 'AC9 type file for the PDF');
select t.ok(not exists (select 1 from net.requests where body::text ~ '(SECRET|private\.example|\.pdf)'),
  'AC2 privacy: the call has no body, link, description or storage path');
select t.eq((select count(*) from net.requests where headers ->> 'Authorization' = 'Bearer mat-secret'
  and timeout_milliseconds > 0), 3::bigint, 'AC9 every call: bearer secret and an explicit timeout');

-- Course-only PDF on A: teacher, owner M (author, left out), listeners S1 and M2 (a mentor listener).
select t.eq(t.who('file', t.mid('f1')), 'M2,S1,T', 'AC3 course-only: teacher and listeners (incl. a mentor listener); author left out');
-- Ownership moves from M to N: N (the current owner) is in; M is still the author and stays out.
update courses set created_by = t.id('N') where id = t.id('A');
select t.eq(t.who('file', t.mid('f1')), 'M2,N,S1,T', 'AC3 the course''s current owner is a recipient');

-- Switches: other switches off still get it; New materials off doesn't.
update telegram_links set notify_chat_message = false, notify_general_chat = false where user_id = t.id('S2');
update telegram_links set notify_new_material = false where user_id = t.id('N');
select t.eq(t.who('blog', t.mid('p1')), 'M2,S1,S2,T', 'AC5 only New materials matters: S2 in, N (switched off) out');

-- set_telegram_notification for a user without a link: no error, nothing created.
select t.login('S3');
select t.lives($$select set_telegram_notification('new_material', false)$$, 'AC5 no link: the switch call is a no-op');
reset role;
select t.eq((select count(*) from telegram_links where user_id = t.id('S3')), 0::bigint, 'AC5 no link row is created');
