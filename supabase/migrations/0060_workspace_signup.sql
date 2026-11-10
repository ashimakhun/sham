-- ARU-146: workspaces, part 2. At sign-up a user creates a workspace (and becomes its teacher, approved at once) or
-- joins one with its invite code (a student waiting for approval). The teacher reads the code in Manage roles.
--   1. workspace_invite_codes: one code per workspace (AC 7), in its own table that no app user can read (AC 9).
--      Codes: 8 characters from ABCDEFGHJKMNPQRSTUVWXYZ23456789, made by the database when a workspace is created;
--      the existing workspace(s) from ARU-145 get one here.
--   2. my_workspace_invite(): the workspace's name and code, for its approved teacher only (AC 8, AC 9).
--   3. handle_new_user() reads the sign-up's user data (AC 2-5):
--        workspace_name  -> a new workspace with that name (trimmed, 1-80 characters); the user is its teacher, approved;
--        invite_code     -> the workspace with that code (spaces and case ignored); the user is a student, waiting;
--        both            -> refused; neither -> refused for Supabase Auth ("Update the app to create an account").
--      A refusal raises inside the Auth sign-up, so no account is created at all. Admin inserts into auth.users
--      (SQL Editor, the database tests: session user postgres / supabase_admin) with neither still join the oldest
--      workspace (signup_workspace(), ARU-145), as they did before.
-- AC 10: the New accounts notification (0044) fires only for a profile inserted Pending, and its recipient is the
-- teacher of that profile's workspace (0059), so creating a workspace sends nothing and joining notifies one teacher.
-- Nothing is deleted. Numbered 0060: after ARU-145's 0059.

-- 1. Invite codes.
-- Keyed by the workspace's own id (a 1:1 extension of workspaces, like profiles.id for auth.users), not a
-- workspace_id: it holds no workspace-scoped data, so it isn't one of ARU-145's guarded tables.
create table workspace_invite_codes (
  id uuid primary key references workspaces (id) on delete cascade,
  code text not null check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'),
  created_at timestamptz not null default now()
);
create unique index workspace_invite_codes_code_key on workspace_invite_codes (code);
alter table workspace_invite_codes enable row level security;
-- No policy: app users never read or write a code here (a select returns no row); only the functions below do.
revoke all on workspace_invite_codes from public, anon, authenticated;
grant select on workspace_invite_codes to authenticated;

-- 8 random characters from the 30-character alphabet. Bytes from gen_random_uuid() (122 random bits, no extension
-- needed); a byte is used only when it is below 240 (8 x 30), so every character is equally likely.
create function new_invite_code() returns text
  language plpgsql volatile set search_path = public
  as $$
  declare
    alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    bytes bytea;
    b int;
    result text := '';
  begin
    while char_length(result) < 8 loop
      bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
      for i in 0 .. length(bytes) - 1 loop
        -- Bytes 6 and 8 hold the UUID's version and variant bits: skip them.
        continue when i in (6, 8);
        b := get_byte(bytes, i);
        continue when b >= 240;
        result := result || substr(alphabet, b % 30 + 1, 1);
        exit when char_length(result) = 8;
      end loop;
    end loop;
    return result;
  end $$;
revoke execute on function new_invite_code() from public, anon, authenticated;

-- Gives a workspace its code, retrying on the (unlikely) clash with another workspace's code.
create function give_workspace_invite_code(ws uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    loop
      begin
        insert into workspace_invite_codes (id, code) values (ws, new_invite_code())
          on conflict (id) do nothing;
        return;
      exception when unique_violation then
        -- Same code as another workspace: try another one.
      end;
    end loop;
  end $$;
revoke execute on function give_workspace_invite_code(uuid) from public, anon, authenticated;

create function workspaces_invite_code() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  begin
    perform give_workspace_invite_code(new.id);
    return new;
  end $$;
revoke execute on function workspaces_invite_code() from public, anon, authenticated;
create trigger workspaces_invite_code after insert on workspaces
  for each row execute function workspaces_invite_code();

-- The existing workspace(s) from ARU-145 get a code the same way.
select give_workspace_invite_code(id) from workspaces order by created_at, id;

-- 2. AC 8, AC 9: the caller's workspace name and code, only for its approved teacher. Anyone else gets no row.
create function my_workspace_invite() returns table (name text, invite_code text)
  language sql stable security definer set search_path = public
  as $$
    select w.name, c.code
    from profiles p
    join workspaces w on w.id = p.workspace_id
    join workspace_invite_codes c on c.id = w.id
    where p.id = auth.uid() and p.role = 'teacher' and p.access_status = 'approved'
  $$;
revoke execute on function my_workspace_invite() from public, anon;
grant execute on function my_workspace_invite() to authenticated;

-- 3. AC 2-5: the profile of a new account, from the sign-up's choice.
create or replace function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    ws_name text := btrim(meta ->> 'workspace_name');
    entered_code text := upper(btrim(meta ->> 'invite_code'));
    ws uuid;
    account_name text := coalesce(meta ->> 'full_name', new.email);
  begin
    if ws_name is not null and entered_code is not null then
      raise exception 'Choose either a workspace name or an invite code.'
        using errcode = '22023', hint = 'sham:workspace_choice_both';
    end if;

    if ws_name is not null then
      -- AC 2: trimmed, not blank, at most 80 characters (the app's field is capped at 80 too).
      if ws_name = '' or char_length(ws_name) > 80 then
        raise exception 'Enter a workspace name of at most 80 characters.'
          using errcode = '22023', hint = 'sham:workspace_name_invalid';
      end if;
      insert into workspaces (name) values (ws_name) returning id into ws;
      insert into profiles (id, full_name, workspace_id, role, access_status)
      values (new.id, account_name, ws, 'teacher', 'approved');
      return new;
    end if;

    if entered_code is not null then
      -- AC 4: a wrong code, or only spaces, matches nothing.
      select c.id into ws from workspace_invite_codes c where c.code = entered_code;
      if ws is null then
        raise exception 'No workspace has this invite code'
          using errcode = '22023', hint = 'sham:invite_code_unknown';
      end if;
      -- AC 3: a student waiting for approval (the column defaults).
      insert into profiles (id, full_name, workspace_id) values (new.id, account_name, ws);
      return new;
    end if;

    -- AC 5: neither. Supabase Auth (an older build, a direct API call) is refused; an admin insert (SQL Editor,
    -- database tests) keeps ARU-145's rule and joins the oldest workspace.
    if session_user not in ('postgres', 'supabase_admin') then
      raise exception 'Update the app to create an account'
        using errcode = '22023', hint = 'sham:update_app';
    end if;
    insert into profiles (id, full_name, workspace_id) values (new.id, account_name, signup_workspace());
    return new;
  end $$;
revoke execute on function handle_new_user() from public, anon, authenticated;
