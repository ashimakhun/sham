-- ARU-52: likes on Blog posts. Rules under test: supabase/migrations/0024_material_likes.sql.
-- Fixture (t.seed): approved T, M, N, M2, S1, S2, S3. P is a new, pending account; R is rejected.
select t.seed();
insert into materials (id, teacher_id, title, body) values
  ('00000000-0000-0000-0000-0000000052a1', t.id('T'), 'Post A', 'x'),
  ('00000000-0000-0000-0000-0000000052a2', t.id('M'), 'Post B', 'y');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000052b1', 'p@x.test', '{"full_name":"Pending Pat"}'),
  ('00000000-0000-0000-0000-0000000052b2', 'r@x.test', '{"full_name":"Rejected Rae"}');
update profiles set access_status = 'rejected' where id = '00000000-0000-0000-0000-0000000052b2';

create function t.a() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000052a1'::uuid $$;
create function t.b() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000052a2'::uuid $$;
grant execute on function t.a(), t.b() to anon, authenticated;
create function t.login_new(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
grant execute on function t.login_new(uuid) to anon, authenticated;

-- Data checks.
select t.ok((select relrowsecurity from pg_class where oid = 'public.material_likes'::regclass), 'data: RLS on');
select t.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'material_likes'),
  'AC6 data: likes are in realtime');
select t.eq((select count(*) from pg_policies where tablename = 'material_likes' and cmd in ('UPDATE', 'ALL')), 0::bigint,
  'data: no update policy');

-- AC 1 / AC 5: every role likes, the author too; user_id defaults to the caller.
select t.login('S1');
select t.lives($$insert into material_likes (material_id) values (t.a())$$, 'AC1 a student likes a post');
select t.login('M');
select t.lives($$insert into material_likes (material_id, user_id) values (t.a(), auth.uid())$$, 'AC1 a mentor likes it');
select t.lives($$insert into material_likes (material_id) values (t.b())$$, 'AC5 the author likes their own post');
select t.login('T');
select t.lives($$insert into material_likes (material_id) values (t.a())$$, 'AC1 the teacher likes it');

-- AC 2: once per user and post.
select t.throws($$insert into material_likes (material_id) values (t.a())$$, '23505', 'AC2 a second like is refused');

-- AC 3: everyone approved reads all likes.
select t.login('S2');
select t.eq((select count(*) from material_likes where material_id = t.a()), 3::bigint, 'AC3 another student sees every like of A');
select t.eq((select count(*) from material_likes), 4::bigint, 'AC3 all likes are readable');

-- AC 7: only one's own like.
select t.throws($$insert into material_likes (material_id, user_id) values (t.b(), t.id('S1'))$$, '42501',
  'AC7 liking for someone else is refused');
select t.eq(t.affected($$delete from material_likes where user_id = t.id('S1')$$), 0::bigint, 'AC7 removing someone else''s like does nothing');
select t.throws($$update material_likes set created_at = now() where true$$, '42501', 'AC7 no updates');
select t.throws($$insert into material_likes (material_id, created_at) values (t.b(), now() - interval '1 year')$$, '42501',
  'the like time is the server''s');

-- AC 2: unlike.
select t.login('S1');
select t.eq(t.affected($$delete from material_likes where material_id = t.a() and user_id = auth.uid()$$), 1::bigint,
  'AC2 the student removes their like');
select t.eq(t.affected($$delete from material_likes where material_id = t.a() and user_id = auth.uid()$$), 0::bigint,
  'AC10 removing it again affects nothing (no error)');
select t.lives($$insert into material_likes (material_id) values (t.a())$$, 'AC2 and can like again');

-- AC 8: pending, rejected and anon accounts see and do nothing.
reset role;
select t.login_new('00000000-0000-0000-0000-0000000052b1');
select t.eq((select count(*) from material_likes), 0::bigint, 'AC8 a pending account reads no likes');
select t.throws($$insert into material_likes (material_id) values (t.a())$$, '42501', 'AC8 a pending account cannot like');
reset role;
select t.login_new('00000000-0000-0000-0000-0000000052b2');
select t.eq((select count(*) from material_likes), 0::bigint, 'AC8 a rejected account reads no likes');
select t.throws($$insert into material_likes (material_id) values (t.a())$$, '42501', 'AC8 a rejected account cannot like');
reset role;
select t.login(null);
select t.eq((select count(*) from material_likes), 0::bigint, 'AC8 anon reads no likes');
select t.throws($$insert into material_likes (material_id, user_id) values (t.a(), t.id('S1'))$$, '42501', 'AC8 anon cannot like');

-- AC 9: deleting a post deletes its likes; deleting a profile deletes its likes.
select t.login('T');
select t.eq(t.affected($$delete from materials where id = t.a()$$), 1::bigint, 'AC9 the author deletes post A');
reset role;
select t.eq((select count(*) from material_likes where material_id = t.a()), 0::bigint, 'AC9 its likes are gone');
select t.eq((select count(*) from material_likes where material_id = t.b()), 1::bigint, 'AC9 other posts keep theirs');
select t.login('S2');
select t.lives($$insert into material_likes (material_id) values (t.b())$$, 'S2 likes post B');
reset role;
delete from auth.users where id = t.id('S2');
select t.eq((select count(*) from material_likes where user_id = t.id('S2')), 0::bigint, 'a deleted account''s likes go with it');
select t.eq((select count(*) from material_likes where material_id = t.b()), 1::bigint, 'others'' likes stay');
