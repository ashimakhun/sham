-- ARU-181: Delete workspace, part 2. A deactivated account (its workspace was deleted, ARU-180) joins another
-- workspace with its invite code (as a waiting student, AC 3) or creates its own (as its approved teacher, AC 5), from
-- the "Your workspace was deleted" screen. The account keeps its login, username, recovery code, agreements and
-- language (AC 7); nothing of the deleted workspace comes back.
--
--   * rejoin_workspace(invite_code) and create_my_workspace(name): security definer, authenticated only, acting only on
--     auth.uid(). Same code and name rules and error codes as handle_new_user() (0075). Both lock the caller's profile
--     first (`for update`), so two parallel calls (two devices, a retry after a lost response) run one after the
--     other and the second gets the new "You already belong to a workspace." (sham:workspace_already_member, AC 9,
--     AC 10). The join also locks the target workspace (`for share`): a workspace deleted meanwhile reads as an
--     unknown code (AC 4), never a raw foreign key error.
--   * profiles_workspace_guard() (0059) still refuses every app change of workspace_id, except inside these two
--     functions (transaction-local flag sham.rejoining = the caller's id) for the caller's own deactivated row with
--     no workspace. workspace_id, role and access_status change in one update (profiles_deactivated_no_workspace).
--   * AC 6: the join (deactivated -> pending) sends the same "new account" notification as a sign-up: an update
--     trigger running the unchanged notify_new_account() (0044); new_account_notification() finds the new teacher.
-- No table, column, policy or grant on a table changes; no existing row changes.

-- 1. The guard, as 0059, plus the one exception.
create or replace function profiles_workspace_guard() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    app boolean := coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon');
  begin
    if tg_op = 'DELETE' then
      if app and old.workspace_id is distinct from my_workspace() then
        raise exception 'This belongs to another workspace.' using errcode = '42501', hint = 'sham:workspace_mismatch';
      end if;
      return old;
    end if;
    if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
      -- ARU-181: only rejoin_workspace() / create_my_workspace(), only the caller's own deactivated row.
      if app and not (
        coalesce(current_setting('sham.rejoining', true), '') = new.id::text
        and new.id = auth.uid()
        and old.id = new.id
        and old.workspace_id is null
        and old.access_status = 'deactivated'
      ) then
        raise exception 'An account''s workspace can''t be changed.' using errcode = '42501', hint = 'sham:workspace_locked';
      end if;
    elsif tg_op = 'UPDATE' and app and old.workspace_id is distinct from my_workspace() then
      raise exception 'This belongs to another workspace.' using errcode = '42501', hint = 'sham:workspace_mismatch';
    end if;
    if new.mentor_id is not null and (tg_op = 'INSERT' or new.mentor_id is distinct from old.mentor_id)
       and (select workspace_id from profiles where id = new.mentor_id) is distinct from new.workspace_id then
      raise exception 'This belongs to another workspace.' using errcode = '42501', hint = 'sham:workspace_mismatch';
    end if;
    return new;
  end $$;
revoke execute on function profiles_workspace_guard() from public, anon, authenticated;

-- The caller's profile, locked; refuses anything but a deactivated account (AC 10). Internal helper.
create function rejoin_lock_me() returns uuid
  language plpgsql security definer set search_path = public
  as $$
  declare
    me uuid := auth.uid();
    st access_status;
  begin
    if me is null then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    select p.access_status into st from profiles p where p.id = me for update;
    if not found then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    if st is distinct from 'deactivated' then
      raise exception 'You already belong to a workspace.' using errcode = '55000', hint = 'sham:workspace_already_member';
    end if;
    return me;
  end $$;
revoke execute on function rejoin_lock_me() from public, anon, authenticated;

-- 2. AC 3, AC 4: join with an invite code (trimmed, any case) as a student waiting for approval.
create function rejoin_workspace(invite_code text) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    me uuid := rejoin_lock_me();
    wanted text := upper(regexp_replace(coalesce(rejoin_workspace.invite_code, ''), '^\s+|\s+$', '', 'g'));
    ws uuid;
  begin
    select c.workspace into ws from workspace_invite_codes c where c.code = wanted;
    if ws is not null then
      -- A workspace being deleted right now: wait for it; gone afterwards means no workspace has the code.
      perform 1 from workspaces w where w.id = ws for share;
      if not found then
        ws := null;
      end if;
    end if;
    if ws is null then
      raise exception 'No workspace has this invite code.' using errcode = 'P0002', hint = 'sham:invite_code_unknown';
    end if;
    perform set_config('sham.rejoining', me::text, true);
    update profiles
      set workspace_id = ws, role = 'student', access_status = 'pending',
          access_changed_by = null, access_changed_at = now()
      where id = me;
    perform set_config('sham.rejoining', '', true);
  end $$;
revoke execute on function rejoin_workspace(text) from public, anon;
grant execute on function rejoin_workspace(text) to authenticated;

-- 3. AC 5: a new workspace (its invite code comes from the workspaces_invite_code trigger, 0060); the caller becomes
-- its approved teacher.
create function create_my_workspace(name text) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    me uuid := rejoin_lock_me();
    ws_name text := regexp_replace(coalesce(create_my_workspace.name, ''), '^\s+|\s+$', '', 'g');
    ws uuid;
  begin
    if char_length(ws_name) not between 1 and 80 then
      raise exception 'Workspace name must be 1 to 80 characters.' using errcode = '23514', hint = 'sham:workspace_name_length';
    end if;
    insert into workspaces (name) values (ws_name) returning id into ws;
    perform set_config('sham.rejoining', me::text, true);
    update profiles
      set workspace_id = ws, role = 'teacher', access_status = 'approved',
          access_changed_by = null, access_changed_at = now()
      where id = me;
    perform set_config('sham.rejoining', '', true);
  end $$;
revoke execute on function create_my_workspace(text) from public, anon;
grant execute on function create_my_workspace(text) to authenticated;

-- 4. AC 6: the join notifies the new workspace's teacher like a sign-up (same function, same switch).
create trigger profiles_notify_rejoined_account after update of access_status on profiles
  for each row
  when (old.access_status = 'deactivated' and new.access_status = 'pending')
  execute function notify_new_account();
