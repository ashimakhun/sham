-- ARU-146: workspaces, part 2. At sign-up a user creates a workspace (and becomes its teacher) or joins one with its
-- invite code; the teacher sees the code in Manage roles.
--   1. workspace_invite_codes: one code per workspace, 8 characters from ABCDEFGHJKMNPQRSTUVWXYZ23456789, unique,
--      made by the database when a workspace is created (AC 7). The existing workspace(s) get one here. A table of
--      its own, closed to the app (RLS on and no policy, so an app user reads no row; no write grant): members read their workspace's row in `workspaces`,
--      so a column there would show them the code (AC 9). Its key is `workspace`, not `workspace_id`: it isn't a
--      workspace-scoped table of ARU-145 (no app user reads or writes it).
--   2. my_workspace_invite(): the workspace's name and code, for its teacher only (AC 8, AC 9).
--   3. handle_new_user() reads the sign-up's user data (sent with auth.signUp, so it also works with email
--      confirmation on):
--        * workspace_name: a new workspace with that name (trimmed, 1–80 characters); the account is its teacher,
--          Approved at once (AC 2). No "new account" notification: that trigger (0044) fires for Pending only (AC 10).
--        * invite_code: the workspace with that code (spaces around it and letter case ignored); the account is a
--          student there, Pending, so the request and the New accounts notification go to that workspace's teacher
--          (AC 3, AC 10). An unknown code refuses the sign-up (AC 4).
--        * neither (an older app, a direct Auth API call) or both: refused (AC 5). This replaces part 1's rule that
--          every sign-up joins the oldest workspace.
--      A refusal raises inside the Auth sign-up, so no account is created. Only an admin (SQL Editor, session user
--      postgres or supabase_admin) may still add an auth user without either; it joins the oldest workspace
--      (signup_workspace(), as in 0059), so the SQL Editor and the test fixtures keep working. Supabase Auth runs
--      as supabase_auth_admin, so every real sign-up needs a choice.
--      An existing email never reaches this trigger (Supabase Auth answers it first), so no workspace is made (AC 6).
-- Nothing is deleted. Numbered 0060: after ARU-145's 0059. Needs my_workspace(), signup_workspace() (0059),
-- my_role() and is_approved() (0021).

-- 1. Invite codes.
create table workspace_invite_codes (
  workspace uuid primary key references workspaces (id) on delete cascade,
  code text not null check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$')
);
create unique index workspace_invite_codes_code on workspace_invite_codes (code);
alter table workspace_invite_codes enable row level security;
revoke insert, update, delete, truncate, references, trigger on workspace_invite_codes from public, anon, authenticated;

-- 8 characters, each equally likely, from gen_random_uuid()'s random bytes (cryptographically random; the version
-- and variant bytes are skipped, and bytes from 248 up are dropped so every one of the 31 characters is as likely).
create function new_invite_code() returns text
  language plpgsql volatile set search_path = public
  as $$
  declare
    alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    n constant int := char_length(alphabet);
    bytes bytea;
    b int;
    result text := '';
  begin
    while char_length(result) < 8 loop
      bytes := uuid_send(gen_random_uuid());
      for i in 0..15 loop
        continue when i in (6, 8);
        b := get_byte(bytes, i);
        continue when b >= 256 - 256 % n;
        result := result || substr(alphabet, b % n + 1, 1);
        exit when char_length(result) = 8;
      end loop;
    end loop;
    return result;
  end $$;
revoke execute on function new_invite_code() from public, anon, authenticated;

-- Gives a workspace its code; draws again if another workspace already has it.
create function give_invite_code(ws uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    loop
      begin
        insert into workspace_invite_codes (workspace, code) values (ws, new_invite_code())
          on conflict (workspace) do nothing;
        return;
      exception when unique_violation then
        null; -- the code is taken: try another
      end;
    end loop;
  end $$;
revoke execute on function give_invite_code(uuid) from public, anon, authenticated;

create function workspaces_invite_code() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  begin
    perform give_invite_code(new.id);
    return null;
  end $$;
revoke execute on function workspaces_invite_code() from public, anon, authenticated;
create trigger workspaces_invite_code after insert on workspaces
  for each row execute function workspaces_invite_code();

-- AC 7: the workspace(s) of part 1.
select give_invite_code(id) from workspaces order by created_at, id;

-- 2. AC 8 / AC 9: the teacher's own workspace name and code; no row for anyone else.
create function my_workspace_invite() returns table (name text, invite_code text)
  language sql stable security definer set search_path = public
  as $$
    select w.name, c.code
    from workspaces w
    join workspace_invite_codes c on c.workspace = w.id
    where w.id = my_workspace() and is_approved() and coalesce(my_role() = 'teacher', false)
  $$;
revoke execute on function my_workspace_invite() from public, anon;
grant execute on function my_workspace_invite() to authenticated;

-- 3. Sign-up: create or join a workspace.
create or replace function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    ws_name text := meta ->> 'workspace_name';
    invite text := meta ->> 'invite_code';
    ws uuid;
    creates boolean := false;
  begin
    if ws_name is not null and invite is not null then
      raise exception 'Update the app to create an account.' using errcode = '22023', hint = 'sham:signup_update_app';
    elsif ws_name is not null then
      ws_name := regexp_replace(ws_name, '^\s+|\s+$', '', 'g');
      if char_length(ws_name) not between 1 and 80 then
        raise exception 'Workspace name must be 1 to 80 characters.' using errcode = '23514', hint = 'sham:workspace_name_length';
      end if;
      insert into workspaces (name) values (ws_name) returning id into ws;
      creates := true;
    elsif invite is not null then
      select c.workspace into ws from workspace_invite_codes c
        where c.code = upper(regexp_replace(invite, '^\s+|\s+$', '', 'g'));
      if ws is null then
        raise exception 'No workspace has this invite code.' using errcode = 'P0002', hint = 'sham:invite_code_unknown';
      end if;
    elsif session_user in ('postgres', 'supabase_admin') then
      ws := signup_workspace();
    else
      raise exception 'Update the app to create an account.' using errcode = '22023', hint = 'sham:signup_update_app';
    end if;

    insert into profiles (id, full_name, workspace_id, role, access_status)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
      ws,
      case when creates then 'teacher' else 'student' end::user_role,
      case when creates then 'approved' else 'pending' end::access_status
    );
    return new;
  end $$;
