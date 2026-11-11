-- QA ARU-146: gaps in aru146_workspace_signup.test.sql (0060). Sign-ups are made as Supabase Auth makes them (an insert
-- into auth.users under session authorization supabase_auth_admin). Covered here: codes with look-alike or extra
-- characters, a code with a space inside, "both" with an empty name, a JSON null name, tab/newline-only names,
-- multibyte limits, role / status / workspace sent in the user data (ignored), a new teacher seeing nothing of
-- another workspace, the other teacher unable to accept the joiner, the New accounts call queued only for a join, and
-- the code helpers and the workspaces table closed to app users.
select t.seed();

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare code text; msg text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics code = returned_sqlstate, msg = message_text;
  return code;
end $$;
create function pg_temp.u(who text) returns uuid language sql immutable as $$ select md5('aru146qa' || who)::uuid $$;
create function pg_temp.signup(who text, meta jsonb) returns text language plpgsql as $$
declare code text; hint text; result text := 'ok';
begin
  execute 'set session authorization supabase_auth_admin';
  begin
    insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.u(who), who || '@qa.test', meta);
  exception when others then
    get stacked diagnostics code = returned_sqlstate, hint = pg_exception_hint;
    result := concat_ws(' | ', code, hint);
  end;
  execute 'reset session authorization';
  return result;
end $$;
create function pg_temp.login(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(who), 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
create function pg_temp.ws_of(who text) returns uuid language sql as $$
  select workspace_id from public.profiles where id = pg_temp.u(who) $$;
create function pg_temp.state(who text) returns text language sql as $$
  select role::text || '/' || access_status::text from public.profiles where id = pg_temp.u(who) $$;
create function pg_temp.made(whos text[]) returns bigint language sql as $$
  select (select count(*) from auth.users where id = any (array(select pg_temp.u(w) from unnest(whos) w)))
       + (select count(*) from public.profiles where id = any (array(select pg_temp.u(w) from unnest(whos) w))) $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

select code as sham_code from workspace_invite_codes where workspace = signup_workspace() \gset
select count(*) as ws_before from workspaces \gset

-- AC 4 / AC 7: only exact codes from the alphabet join. Look-alikes (O for 0, I/L for 1) and a space inside are not
-- ignored (only spaces around the code are); a code with one extra character is refused.
select t.eq(pg_temp.signup('o1', format('{"invite_code":"%s"}', left(:'sham_code', 7) || 'O')::jsonb),
  'P0002 | sham:invite_code_unknown', 'AC4 a code ending in the letter O (not in the alphabet) is refused');
select t.eq(pg_temp.signup('o2', format('{"invite_code":"%s"}', left(:'sham_code', 4) || ' ' || right(:'sham_code', 4))::jsonb),
  'P0002 | sham:invite_code_unknown', 'AC4 a space inside the code is not ignored');
select t.eq(pg_temp.signup('o3', format('{"invite_code":"%sA"}', :'sham_code')::jsonb),
  'P0002 | sham:invite_code_unknown', 'AC4 nine characters (the code plus one) is refused');
select t.eq(pg_temp.signup('o4', '{"invite_code":12345678}'), 'P0002 | sham:invite_code_unknown',
  'AC4 a number instead of a text code is refused');
select t.eq(pg_temp.signup('o5', format(E'{"invite_code":"\\t%s\\n"}', :'sham_code')::jsonb), 'ok',
  'AC4 a tab and a line break around the code are ignored like spaces');
select t.eq(pg_temp.ws_of('o5'), signup_workspace(), 'AC3 that sign-up joined "Sham"');
select t.eq(pg_temp.made(array['o1', 'o2', 'o3', 'o4']), 0::bigint, 'AC4 refused codes: no auth user, no profile');

-- AC 5: "both" also when the name is empty; a JSON null counts as not sent.
select t.eq(pg_temp.signup('b1', format('{"workspace_name":"","invite_code":"%s"}', :'sham_code')::jsonb),
  '22023 | sham:signup_update_app', 'AC5 an empty name next to a valid code is still "both": refused');
select t.eq(pg_temp.signup('b2', format('{"workspace_name":null,"invite_code":"%s"}', :'sham_code')::jsonb), 'ok',
  'AC5 a JSON null name counts as not sent: the code joins');
select t.eq(pg_temp.state('b2'), 'student/pending', 'AC3 the JSON-null-name sign-up is a waiting student');
select t.eq(pg_temp.signup('b3', '{"workspace_name":null,"invite_code":null}'), '22023 | sham:signup_update_app',
  'AC5 both null: refused');
select t.eq(pg_temp.made(array['b1', 'b3']), 0::bigint, 'AC5 refused: no auth user, no profile');

-- AC 2: names of tabs and line breaks only are blank; limits count characters, not bytes.
select t.eq(pg_temp.signup('n1', format('{"workspace_name":"%s"}', E'\\t\\n  \\r')::jsonb),
  '23514 | sham:workspace_name_length', 'AC2 a name of tabs and line breaks only is refused');
select t.eq(pg_temp.signup('n2', format('{"workspace_name":"%s"}', repeat('ш', 81))::jsonb),
  '23514 | sham:workspace_name_length', 'AC2 81 Cyrillic characters are refused');
select t.eq(pg_temp.signup('n3', format('{"workspace_name":"  %s  "}', repeat('ш', 80))::jsonb), 'ok',
  'AC2 80 Cyrillic characters with spaces around are accepted (spaces don''t count)');
select t.eq(char_length((select name from workspaces where id = pg_temp.ws_of('n3'))), 80, 'AC2 stored trimmed: 80');
select t.eq(pg_temp.made(array['n1', 'n2']), 0::bigint, 'AC2 refused names: no auth user, no profile');

-- Security: role, status or workspace in the user data never decide them.
select t.eq(pg_temp.signup('x1', format('{"invite_code":"%s","role":"teacher","access_status":"approved","workspace_id":"%s"}',
  :'sham_code', gen_random_uuid())::jsonb), 'ok', 'a join that also sends role/status/workspace is accepted');
select t.eq(pg_temp.state('x1'), 'student/pending', 'role and status sent in the user data are ignored: a waiting student');
select t.eq(pg_temp.ws_of('x1'), signup_workspace(), 'the workspace comes from the code, not from the user data');
select t.eq((select count(*) from profiles where role = 'teacher' and workspace_id = signup_workspace()), 1::bigint,
  '"Sham" still has exactly one teacher');

-- AC 2: a new workspace and its teacher.
select t.eq(pg_temp.signup('ta', '{"full_name":"Tara","workspace_name":"Second school"}'), 'ok', 'AC2 TA creates "Second school"');
select code as ta_code from workspace_invite_codes where workspace = pg_temp.ws_of('ta') \gset

-- AC 10: the New accounts call is queued for a join, never for a create.
insert into vault.decrypted_secrets (name, decrypted_secret) values
  ('new_account_notify_url', 'https://x.test/functions/v1/new-account-notifications'),
  ('new_account_notify_secret', 'k3y');
select count(*) as calls_before from net.requests \gset
select t.eq(pg_temp.signup('tb', '{"full_name":"Tobi","workspace_name":"Third school"}'), 'ok', 'AC2 TB creates "Third school"');
select t.eq((select count(*) from net.requests), :calls_before::bigint, 'AC10 creating a workspace queues no New accounts call');
select t.eq(pg_temp.signup('j1', format('{"full_name":"Jay","invite_code":"%s"}', lower(:'ta_code'))::jsonb), 'ok',
  'AC3 J1 joins "Second school"');
select t.eq((select count(*) from net.requests), :calls_before::bigint + 1, 'AC10 the join queues one New accounts call');
select t.eq((select body ->> 'user_id' from net.requests order by id desc limit 1), pg_temp.u('j1')::text,
  'AC10 the call carries only the new account''s id');
select t.eq((select array_agg(user_id) from new_account_notification(pg_temp.u('j1'))), array[pg_temp.u('ta')],
  'AC10 its recipients: only TA (not T, not TB)');

-- AC 2: the new teacher sees nothing of another workspace.
select pg_temp.login('ta');
select t.eq((select count(*) from profiles), 2::bigint, 'AC2 TA sees only their workspace''s accounts (TA and J1)');
select t.eq((select count(*) from profiles where id = t.id('T')), 0::bigint, 'AC2 TA doesn''t see "Sham"''s teacher');
select t.eq((select count(*) from courses) + (select count(*) from homework) + (select count(*) from general_messages)
  + (select count(*) from disciplines) + (select count(*) from materials), 0::bigint, 'AC2 TA sees no courses, homework, chat, disciplines or materials');
select t.eq((select array_agg(name) from workspaces), array['Second school'], 'AC2 TA sees only their own workspace');
select t.eq((select array_agg(id) from access_requests()), array[pg_temp.u('j1')], 'AC3 TA''s requests: only J1');
select t.eq((select invite_code from my_workspace_invite()), :'ta_code', 'AC8 TA reads their own code');
reset role;

-- AC 3: only that workspace's teacher can accept the joiner.
select t.login('T');
select t.eq((select count(*) from access_requests() where id = pg_temp.u('j1')), 0::bigint, 'AC3 T doesn''t see J1''s request');
select pg_temp.err(format('select set_access_status(%L, ''approved'')', pg_temp.u('j1')));
reset role;
select t.eq(pg_temp.state('j1'), 'student/pending', 'AC3 T can''t accept J1: still waiting');
select pg_temp.login('tb');
select pg_temp.err(format('select set_access_status(%L, ''approved'')', pg_temp.u('j1')));
reset role;
select t.eq(pg_temp.state('j1'), 'student/pending', 'AC3 TB can''t accept J1 either');
select pg_temp.login('ta');
select set_access_status(pg_temp.u('j1'), 'approved');
reset role;
select t.eq(pg_temp.state('j1'), 'student/approved', 'AC3 TA accepts J1');

-- AC 9: the accepted student of "Second school" and app users in general can't reach codes or make workspaces.
select pg_temp.login('j1');
select t.eq((select count(*) from my_workspace_invite()), 0::bigint, 'AC9 J1 (approved student) gets no code');
select t.eq((select count(*) from workspace_invite_codes), 0::bigint, 'AC9 J1 reads no row of the codes table');
select t.eq(pg_temp.err('select new_invite_code()'), '42501', 'app users can''t call new_invite_code()');
select t.eq(pg_temp.err(format('select give_invite_code(%L)', pg_temp.ws_of('j1'))), '42501', 'app users can''t call give_invite_code()');
select t.eq(pg_temp.err('insert into workspaces (name) values (''Mine'')'), '42501', 'app users can''t create a workspace directly');
select t.eq(pg_temp.err(format('update workspace_invite_codes set code = ''ZZZZZZZZ'' where workspace = %L', pg_temp.ws_of('j1'))),
  '42501', 'app users can''t change a code');
reset role;
select t.eq((select code from workspace_invite_codes where workspace = pg_temp.ws_of('ta')), :'ta_code', 'the code is unchanged');

-- Every workspace made here has exactly one code, and only sign-ups that chose "create" made one.
select t.eq((select count(*) from workspaces), :ws_before::bigint + 3, 'exactly three workspaces were made (n3, TA, TB)');
select t.eq((select count(*) from workspaces w where (select count(*) from workspace_invite_codes c where c.workspace = w.id) <> 1),
  0::bigint, 'AC7 every workspace has exactly one code');
