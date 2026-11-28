-- ARU-180: Delete workspace, part 1. The teacher deletes their account together with their workspace and everything
-- in it; the workspace's other accounts are deactivated, not deleted (they can join another workspace in part 2).
-- Uses the access status "deactivated" that 0076_deactivated_status.sql added (a separate file: see there).
--
-- The deletion is done by the Edge Function `delete-account` (service role), for the teacher only, in this order
-- (AC 11): checks (workspace_deletion_target(): the caller is the teacher; the password; the typed workspace name),
-- then the files (workspace_storage_objects(), removed through the Storage API), then ONE call of delete_workspace(),
-- which does the rest in one transaction:
--   1. re-checks that no Storage object of the workspace's people is left (a late upload): raises, nothing changes;
--   2. deletes every row of the workspace (every table with workspace_id, plus reset codes, photo ZIP links and blocks
--      of its people, AC 6), push devices and notification settings included (AC 8);
--   3. deactivates the other accounts (AC 8): no workspace, status deactivated, no mentor, not an accountant,
--      access_changed_by null / access_changed_at now(), role kept;
--   4. deletes the teacher's Auth user (`delete from auth.users`), so the profile and everything personal cascade in
--      the same transaction (AC 7), then the workspace row and its invite code.
--
-- Also:
--   * profiles.workspace_id is nullable, only together with "deactivated" (check constraint, AC 8);
--   * the restrictive "only my workspace" read rule on profiles also lets an account read its own row, so a
--     deactivated account (no workspace) still sees its own status (AC 9). Nothing else becomes readable;
--   * "edit own profile" also accepts a deactivated account's own update of the columns granted today (full_name,
--     language, device_language). workspace_id, access_status, role, mentor_id and is_accountant stay locked (column
--     grants and profiles_workspace_guard());
--   * profiles_before_delete() lets the teacher go only inside delete_workspace() for the teacher's own workspace (a
--     transaction-local flag); a plain account deletion still refuses the teacher (account_deletion_problem(),
--     unchanged message);
--   * workspace_deletion_summary(): the teacher's workspace name and the number of other accounts, for the app's
--     Delete workspace screen (AC 2).
-- A deactivated account belongs to no workspace: my_workspace() is null, my_role() null, is_approved() false, so every
-- workspace read rule, workspace_guard() (inserts with default_workspace()) and the Storage rules refuse it.
-- Changes no existing data; no grant is widened.

-- 1. A deactivated account has no workspace, and only a deactivated account has none (AC 8).
alter table profiles alter column workspace_id drop not null;
alter table profiles add constraint profiles_deactivated_no_workspace
  check ((workspace_id is null) = (access_status = 'deactivated'));

-- 2. Own profile always readable (also with no workspace: null = null isn't true). Was: 0059.
drop policy "workspace: only my workspace" on profiles;
create policy "workspace: only my workspace" on profiles as restrictive for select to authenticated
  using (workspace_id = (select my_workspace()) or id = auth.uid());

-- Whether the caller's account is deactivated (its workspace was deleted).
create function my_account_deactivated() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from profiles where id = auth.uid() and access_status = 'deactivated') $$;
revoke execute on function my_account_deactivated() from public, anon;
grant execute on function my_account_deactivated() to authenticated;

-- 3. Own updates by a deactivated account (its my_role() is null). Only the granted columns can change anyway, so the
-- role can't. Was: 0001.
drop policy "edit own profile" on profiles;
create policy "edit own profile" on profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and (role = my_role() or my_account_deactivated())); -- cannot promote yourself

-- 4. The teacher's profile may go only while delete_workspace() deletes the teacher's own workspace. Otherwise as 0058.
create or replace function profiles_before_delete() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    problem text := account_deletion_problem(old.id);
  begin
    if problem is not null and old.role = 'teacher' and old.workspace_id is not null
       and current_setting('sham.deleting_workspace', true) = old.workspace_id::text
       and not exists (select 1 from courses where created_by = old.id) then
      problem := null;
    end if;
    if problem is not null then
      raise exception '%', problem using errcode = 'P0001', hint = case when problem like 'You own courses:%' then 'sham:delete_owns_courses' else 'sham:delete_teacher' end, detail = case when problem like 'You own courses:%' then json_build_object('titles', substring(problem from '^You own courses: (.*)\. Ask the teacher'))::text else '' end;
    end if;
    delete from meeting_listener_notes where author_id = old.id and not is_public;
    return old;
  end $$;

-- 5. For the Edge Function (service role only).
-- The workspace `target` is the teacher of, with its name and the number of other accounts (approved, waiting and
-- declined); no row when `target` isn't a teacher.
create function workspace_deletion_target(target uuid)
  returns table (workspace_id uuid, workspace_name text, other_accounts integer)
  language sql stable security definer set search_path = public
  as $$
    select w.id, w.name, (select count(*)::integer from profiles o where o.workspace_id = w.id and o.id <> p.id)
    from profiles p
    join workspaces w on w.id = p.workspace_id
    where p.id = target and p.role = 'teacher'
  $$;
revoke execute on function workspace_deletion_target(uuid) from public, anon, authenticated;
grant execute on function workspace_deletion_target(uuid) to service_role;

-- Every Storage object of the workspace's people (AC 6): their folders (and anything they own) in the homework,
-- materials and payment-proofs buckets, plus anything the teacher owns (their Auth user is deleted). owner_id is read
-- through to_jsonb so this also runs where the column doesn't exist (tests), as account_storage_objects() (0040).
create function workspace_storage_objects(workspace uuid) returns table (bucket_id text, name text)
  language sql stable security definer set search_path = public
  as $$
    with people as (
      select p.id, p.role from profiles p where p.workspace_id = workspace_storage_objects.workspace
    )
    select o.bucket_id, o.name
    from storage.objects o
    where (
        o.bucket_id in ('homework', 'materials', 'payment-proofs')
        and (
          (storage.foldername(o.name))[1] in (select id::text from people)
          or o.owner in (select id from people)
          or (to_jsonb(o) ->> 'owner_id') in (select id::text from people)
        )
      )
      or o.owner in (select id from people where role = 'teacher')
      or (to_jsonb(o) ->> 'owner_id') in (select id::text from people where role = 'teacher')
    order by o.bucket_id, o.name
  $$;
revoke execute on function workspace_storage_objects(uuid) from public, anon, authenticated;
grant execute on function workspace_storage_objects(uuid) to service_role;

-- AC 6-8, 11: the database step, all or nothing.
create function delete_workspace(teacher uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    ws uuid;
    people uuid[];
    tbl text;
  begin
    select p.workspace_id into ws from profiles p where p.id = teacher and p.role = 'teacher' for update;
    if ws is null then
      raise exception 'Only the teacher can delete the workspace.' using errcode = '42501', hint = 'sham:workspace_delete_teacher_only';
    end if;
    -- One deletion at a time; nobody joins or changes while it runs.
    perform 1 from workspaces w where w.id = ws for update;
    select array_agg(p.id) into people from (select id from profiles where workspace_id = ws for update) p;

    -- 1. AC 11: a file uploaded after the Edge Function's files step stops everything; a retry removes it.
    if exists (select 1 from workspace_storage_objects(ws)) then
      raise exception 'Some files are still being removed. Please try again.' using errcode = '55000', hint = 'sham:workspace_delete_files_left';
    end if;

    perform set_config('sham.deleting_workspace', ws::text, true);

    -- 2. AC 6: every row of the workspace, children before parents.
    delete from photo_deletion_warnings where workspace_id = ws;
    delete from homework where workspace_id = ws;
    delete from meeting_attendance where workspace_id = ws;
    delete from meeting_listener_notes where workspace_id = ws;
    delete from homework_assignments where workspace_id = ws;
    delete from course_chat_reads where workspace_id = ws;
    delete from course_feedback where workspace_id = ws;
    delete from course_members where workspace_id = ws;
    delete from course_messages where workspace_id = ws;
    delete from course_billing where workspace_id = ws;
    delete from course_payments where workspace_id = ws;
    delete from course_payment_exemptions where workspace_id = ws;
    delete from course_payment_requests where workspace_id = ws;
    delete from course_meetings where workspace_id = ws;
    delete from material_likes where workspace_id = ws;
    delete from material_files where workspace_id = ws;
    delete from materials where workspace_id = ws;
    delete from courses where workspace_id = ws;
    delete from disciplines where workspace_id = ws;
    delete from general_messages where workspace_id = ws;
    delete from general_chat_reads where workspace_id = ws;
    delete from content_reports where workspace_id = ws;
    -- AC 8: members' devices and settings go too (nothing can be sent to a deactivated account).
    delete from push_devices where workspace_id = ws;
    delete from notification_settings where workspace_id = ws;
    -- Any other table with a workspace (one added later), so no row of the workspace is left.
    for tbl in
      select c.table_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'workspace_id' and c.table_name <> 'profiles'
        and t.table_type = 'BASE TABLE'
      order by c.table_name
    loop
      execute format('delete from public.%I where workspace_id = $1', tbl) using ws;
    end loop;
    -- The workspace's people's rows that have no workspace column.
    delete from reset_codes where user_id = any (people);
    delete from photo_zip_links where user_id = any (people);
    delete from user_blocks where blocker_id = any (people) or blocked_id = any (people);

    -- 3. AC 8: the other accounts are deactivated; they keep their login, username, recovery code and agreements.
    update profiles
      set workspace_id = null, access_status = 'deactivated', mentor_id = null, is_accountant = false,
          access_changed_by = null, access_changed_at = now()
      where workspace_id = ws and id <> teacher;

    -- 4. AC 7: the teacher's Auth user; the profile and everything personal cascade in this transaction.
    delete from auth.users where id = teacher;
    -- The workspace (and its invite code, on delete cascade).
    delete from workspaces where id = ws;
  end $$;
revoke execute on function delete_workspace(uuid) from public, anon, authenticated;
grant execute on function delete_workspace(uuid) to service_role;

-- 6. AC 2: the Delete workspace screen's name and count. No row for anyone but the teacher.
create function workspace_deletion_summary() returns table (name text, other_accounts integer)
  language sql stable security definer set search_path = public
  as $$
    select t.workspace_name, t.other_accounts
    from workspace_deletion_target(auth.uid()) t
    where coalesce(my_role() = 'teacher', false)
  $$;
revoke execute on function workspace_deletion_summary() from public, anon;
grant execute on function workspace_deletion_summary() to authenticated;
