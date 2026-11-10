-- ARU-145: workspaces, part 1. Every account and its data belong to a workspace; nothing is shared between
-- workspaces, and every existing rule applies within the caller's workspace ("the teacher" is the teacher of that
-- workspace). With one workspace the app behaves exactly as before. No UI change (part 2, ARU-146, adds sign-up).
--   1. workspaces (id, name, created_at) with one workspace "Sham"; profiles.workspace_id (not null) for everyone.
--   2. my_workspace() and signup_workspace() (the oldest workspace: where a sign-up lands until ARU-146).
--   3. A workspace_id on every workspace-scoped table (filled with the first workspace), with:
--        * a restrictive policy: app users read and write only rows of their own workspace (AC 5);
--        * workspace_guard(), a trigger that runs last on every insert, update and delete: a row's workspace comes from
--          its course / meeting / parent (or the author's profile) and never changes; an app call (the role is
--          authenticated or anon, also inside security definer functions) can't write a row of another workspace,
--          and no row can link profiles, courses or disciplines of two workspaces (AC 6, 7). Admin (SQL Editor),
--          service role and cron are not app calls; they keep the "same workspace" link checks.
--   4. profiles: the same read rule and guard; workspace_id can only be changed outside the app (AC 3).
--   5. One teacher per workspace (0009's index and trigger, per workspace; AC 2).
--   6. Functions: course_hidden_from_me() treats another workspace's course as hidden (so every function that uses
--      it says "not found"), access_requests() lists only my workspace (AC 9), and the delete course / discipline
--      helpers and every notification recipient function stay in the event's workspace (AC 6, 10).
--   7. Storage: homework photos, materials and payment proofs (paths start with a profile id) only within the
--      caller's workspace (AC 6).
-- Global, no workspace (AC 11): app_settings, telegram_link_codes, photo_zip_links, the cron jobs and the bot.
-- Nothing is deleted. Numbered 0059: after ARU-143's 0058.

-- 1. Workspaces.
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);
alter table workspaces enable row level security;
revoke all on workspaces from anon, authenticated;
insert into workspaces (name) values ('Sham');

-- 2. Profiles: the workspace column first (the helpers below read it).
alter table profiles add column workspace_id uuid references workspaces (id);
alter table profiles disable trigger user;
update profiles set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table profiles enable trigger user;
alter table profiles alter column workspace_id set not null;
create index profiles_workspace_idx on profiles (workspace_id);

-- 3. Helpers. The caller's workspace (also for a waiting or declined account: it's where its request goes).
create function my_workspace() returns uuid
  language sql stable security definer set search_path = public
  as $$ select workspace_id from profiles where id = auth.uid() $$;
revoke execute on function my_workspace() from public, anon;
grant execute on function my_workspace() to authenticated;

-- AC 4 (until ARU-146): a new account joins the oldest workspace. The one place that decides it.
create function signup_workspace() returns uuid
  language sql stable security definer set search_path = public
  as $$ select id from workspaces order by created_at, id limit 1 $$;
revoke execute on function signup_workspace() from public, anon, authenticated;
alter table profiles alter column workspace_id set default signup_workspace();

-- The default workspace of a new row: the caller's; with no caller (SQL Editor, service role) the oldest one.
-- workspace_guard() then sets the row's real workspace from its course or parent.
create function default_workspace() returns uuid
  language sql stable security definer set search_path = public
  as $$ select coalesce(my_workspace(), signup_workspace()) $$;
revoke execute on function default_workspace() from public, anon;
grant execute on function default_workspace() to authenticated;

-- An accepted app user reads only their own workspace (a waiting account reads nothing but its profile, ARU-43).
create policy "my workspace" on workspaces for select to authenticated using (id = (select my_workspace()) and is_approved());
grant select on workspaces to authenticated;

-- 4. Profiles: read only my workspace's accounts. A waiting or declined account still reads its own profile: it's in its own workspace.
create policy "workspace: only my workspace" on profiles as restrictive for select to authenticated
  using (workspace_id = (select my_workspace()));

-- The workspace of a parent row, for workspace_guard(). src is 'course_id', 'meeting_id', 'material_id',
-- 'homework_id' or 'profile:<column>'; row is the new row as jsonb.
create function workspace_of(src text, row_data jsonb) returns uuid
  language plpgsql stable security definer set search_path = public
  as $$
  declare
    v text := case when src like 'profile:%' then row_data ->> substr(src, 9) else row_data ->> src end;
  begin
    if v is null then
      return null;
    end if;
    return case
      when src = 'course_id' then (select workspace_id from courses where id = v::uuid)
      when src = 'meeting_id' then (select workspace_id from course_meetings where id = v::uuid)
      when src = 'material_id' then (select workspace_id from materials where id = v::uuid)
      when src = 'homework_id' then (select workspace_id from homework where id = v::uuid)
      when src like 'profile:%' then (select workspace_id from profiles where id = v::uuid)
    end;
  end $$;
revoke execute on function workspace_of(text, jsonb) from public, anon, authenticated;

-- AC 6 / 7: the guard on every workspace-scoped table (see the header). tg_argv[0]: where the workspace comes from
-- ('a|b': the first that gives one); tg_argv[1..]: profile columns that must be in the row's workspace. courses also
-- checks its discipline.
create function workspace_guard() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    app boolean := coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon');
    mine uuid := case when app then my_workspace() end;
    r jsonb;
    o jsonb;
    ws uuid;
    src text;
    col text;
    i int;
  begin
    if tg_op = 'DELETE' then
      if app and old.workspace_id is distinct from mine then
        raise exception 'This belongs to another workspace.' using errcode = '42501', hint = 'sham:workspace_mismatch';
      end if;
      return old;
    end if;
    r := to_jsonb(new);
    if tg_op = 'UPDATE' then
      -- A row never moves to another workspace.
      new.workspace_id := old.workspace_id;
      o := to_jsonb(old);
    else
      foreach src in array string_to_array(tg_argv[0], '|') loop
        ws := workspace_of(src, r);
        exit when ws is not null;
      end loop;
      if ws is not null then
        -- An app write can't send another workspace than the row's own.
        if app and new.workspace_id is distinct from ws then
          raise exception 'This belongs to another workspace.' using errcode = '42501', hint = 'sham:workspace_mismatch';
        end if;
        new.workspace_id := ws;
      end if;
    end if;
    if app and new.workspace_id is distinct from mine then
      raise exception 'This belongs to another workspace.' using errcode = '42501', hint = 'sham:workspace_mismatch';
    end if;
    -- No link to a profile (or, for courses, a discipline) of another workspace. Unchanged columns aren't rechecked.
    for i in 1 .. coalesce(array_length(tg_argv, 1), 1) - 1 loop
      col := tg_argv[i];
      if r ->> col is not null and (o is null or o ->> col is distinct from r ->> col)
         and (select workspace_id from profiles where id = (r ->> col)::uuid) is distinct from new.workspace_id then
        raise exception 'This belongs to another workspace.' using errcode = '42501', hint = 'sham:workspace_mismatch';
      end if;
    end loop;
    if tg_table_name = 'courses' and r ->> 'discipline_id' is not null
       and (o is null or o ->> 'discipline_id' is distinct from r ->> 'discipline_id')
       and (select workspace_id from disciplines where id = (r ->> 'discipline_id')::uuid) is distinct from new.workspace_id then
      raise exception 'This belongs to another workspace.' using errcode = '42501', hint = 'sham:workspace_mismatch';
    end if;
    return new;
  end $$;
revoke execute on function workspace_guard() from public, anon, authenticated;

-- Profiles: an account joins one workspace for good (AC 3). An app call can't touch another workspace's account
-- (accept, decline, roles, Accountant: AC 7, 9), and its mentor is in its workspace. The SQL Editor and the service
-- role can still move an account.
create function profiles_workspace_guard() returns trigger
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
      if app then
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
create trigger zz_workspace_guard before insert or update or delete on profiles
  for each row execute function profiles_workspace_guard();

-- 6. AC 2: at most one teacher per workspace (was: in the whole database). Same messages and codes as 0053.
drop index profiles_one_teacher;
create unique index profiles_one_teacher on profiles (workspace_id) where role = 'teacher';
create or replace function profiles_teacher_locked() returns trigger
  language plpgsql set search_path = public
  as $$
  begin
    if tg_op = 'UPDATE' then
      if old.role is not distinct from new.role then
        return new;
      end if;
      if old.role = 'teacher' then
        raise exception 'The teacher can''t stop being the teacher' using errcode = '42501', hint = 'sham:teacher_locked';
      end if;
    end if;
    if new.role = 'teacher' and exists (
      select 1 from profiles where role = 'teacher' and id <> new.id and workspace_id = new.workspace_id
    ) then
      raise exception 'There is already a teacher; nobody else can become one' using errcode = '42501', hint = 'sham:teacher_exists';
    end if;
    return new;
  end $$;

-- 5. Every workspace-scoped table: a workspace column (the first workspace for existing rows), its index, the read
--    rule (a restrictive select policy; course and meeting tables already have one through
--    course_hidden_from_me(), see 7) and the write guard. Triggers are off while the existing rows are filled in,
--    so no notification fires.

alter table courses add column workspace_id uuid references workspaces (id);
alter table courses disable trigger user;
update courses set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table courses enable trigger user;
alter table courses alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index courses_workspace_idx on courses (workspace_id);
create policy "workspace: only my workspace" on courses as restrictive for select to authenticated
  using (workspace_id = (select my_workspace()));
create trigger zz_workspace_guard before insert or update or delete on courses
  for each row execute function workspace_guard('profile:created_by', 'created_by');

alter table disciplines add column workspace_id uuid references workspaces (id);
alter table disciplines disable trigger user;
update disciplines set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table disciplines enable trigger user;
alter table disciplines alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index disciplines_workspace_idx on disciplines (workspace_id);
create policy "workspace: only my workspace" on disciplines as restrictive for select to authenticated
  using (workspace_id = (select my_workspace()));
create trigger zz_workspace_guard before insert or update or delete on disciplines
  for each row execute function workspace_guard('profile:created_by', 'created_by');

alter table course_members add column workspace_id uuid references workspaces (id);
alter table course_members disable trigger user;
update course_members set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table course_members enable trigger user;
alter table course_members alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index course_members_workspace_idx on course_members (workspace_id);
create trigger zz_workspace_guard before insert or update or delete on course_members
  for each row execute function workspace_guard('course_id', 'user_id', 'added_by');

alter table course_messages add column workspace_id uuid references workspaces (id);
alter table course_messages disable trigger user;
update course_messages set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table course_messages enable trigger user;
alter table course_messages alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index course_messages_workspace_idx on course_messages (workspace_id);
create trigger zz_workspace_guard before insert or update or delete on course_messages
  for each row execute function workspace_guard('course_id', 'author_id');

alter table course_chat_reads add column workspace_id uuid references workspaces (id);
alter table course_chat_reads disable trigger user;
update course_chat_reads set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table course_chat_reads enable trigger user;
alter table course_chat_reads alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index course_chat_reads_workspace_idx on course_chat_reads (workspace_id);
create trigger zz_workspace_guard before insert or update or delete on course_chat_reads
  for each row execute function workspace_guard('course_id', 'user_id');

alter table course_meetings add column workspace_id uuid references workspaces (id);
alter table course_meetings disable trigger user;
update course_meetings set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table course_meetings enable trigger user;
alter table course_meetings alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index course_meetings_workspace_idx on course_meetings (workspace_id);
create trigger zz_workspace_guard before insert or update or delete on course_meetings
  for each row execute function workspace_guard('course_id', 'created_by', 'status_changed_by', 'notes_updated_by', 'homework_checked_by');

alter table meeting_attendance add column workspace_id uuid references workspaces (id);
alter table meeting_attendance disable trigger user;
update meeting_attendance set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table meeting_attendance enable trigger user;
alter table meeting_attendance alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index meeting_attendance_workspace_idx on meeting_attendance (workspace_id);
create trigger zz_workspace_guard before insert or update or delete on meeting_attendance
  for each row execute function workspace_guard('meeting_id', 'user_id');

alter table meeting_listener_notes add column workspace_id uuid references workspaces (id);
alter table meeting_listener_notes disable trigger user;
update meeting_listener_notes set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table meeting_listener_notes enable trigger user;
alter table meeting_listener_notes alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index meeting_listener_notes_workspace_idx on meeting_listener_notes (workspace_id);
create trigger zz_workspace_guard before insert or update or delete on meeting_listener_notes
  for each row execute function workspace_guard('course_id', 'author_id');

alter table homework_assignments add column workspace_id uuid references workspaces (id);
alter table homework_assignments disable trigger user;
update homework_assignments set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table homework_assignments enable trigger user;
alter table homework_assignments alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index homework_assignments_workspace_idx on homework_assignments (workspace_id);
create trigger zz_workspace_guard before insert or update or delete on homework_assignments
  for each row execute function workspace_guard('course_id', 'created_by');

alter table homework add column workspace_id uuid references workspaces (id);
alter table homework disable trigger user;
update homework set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table homework enable trigger user;
alter table homework alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index homework_workspace_idx on homework (workspace_id);
create trigger zz_workspace_guard before insert or update or delete on homework
  for each row execute function workspace_guard('course_id|profile:student_id', 'student_id', 'checked_by');

alter table photo_deletion_warnings add column workspace_id uuid references workspaces (id);
alter table photo_deletion_warnings disable trigger user;
update photo_deletion_warnings set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table photo_deletion_warnings enable trigger user;
alter table photo_deletion_warnings alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index photo_deletion_warnings_workspace_idx on photo_deletion_warnings (workspace_id);
create policy "workspace: only my workspace" on photo_deletion_warnings as restrictive for select to authenticated
  using (workspace_id = (select my_workspace()));
create trigger zz_workspace_guard before insert or update or delete on photo_deletion_warnings
  for each row execute function workspace_guard('homework_id', 'user_id');

alter table course_feedback add column workspace_id uuid references workspaces (id);
alter table course_feedback disable trigger user;
update course_feedback set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table course_feedback enable trigger user;
alter table course_feedback alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index course_feedback_workspace_idx on course_feedback (workspace_id);
create trigger zz_workspace_guard before insert or update or delete on course_feedback
  for each row execute function workspace_guard('course_id', 'user_id');

alter table course_billing add column workspace_id uuid references workspaces (id);
alter table course_billing disable trigger user;
update course_billing set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table course_billing enable trigger user;
alter table course_billing alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index course_billing_workspace_idx on course_billing (workspace_id);
create trigger zz_workspace_guard before insert or update or delete on course_billing
  for each row execute function workspace_guard('course_id', 'selected_by');

alter table course_payments add column workspace_id uuid references workspaces (id);
alter table course_payments disable trigger user;
update course_payments set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table course_payments enable trigger user;
alter table course_payments alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index course_payments_workspace_idx on course_payments (workspace_id);
create trigger zz_workspace_guard before insert or update or delete on course_payments
  for each row execute function workspace_guard('course_id', 'user_id', 'marked_by');

alter table course_payment_exemptions add column workspace_id uuid references workspaces (id);
alter table course_payment_exemptions disable trigger user;
update course_payment_exemptions set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table course_payment_exemptions enable trigger user;
alter table course_payment_exemptions alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index course_payment_exemptions_workspace_idx on course_payment_exemptions (workspace_id);
create trigger zz_workspace_guard before insert or update or delete on course_payment_exemptions
  for each row execute function workspace_guard('course_id', 'user_id', 'set_by');

alter table course_payment_requests add column workspace_id uuid references workspaces (id);
alter table course_payment_requests disable trigger user;
update course_payment_requests set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table course_payment_requests enable trigger user;
alter table course_payment_requests alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index course_payment_requests_workspace_idx on course_payment_requests (workspace_id);
create trigger zz_workspace_guard before insert or update or delete on course_payment_requests
  for each row execute function workspace_guard('course_id', 'user_id');

alter table general_messages add column workspace_id uuid references workspaces (id);
alter table general_messages disable trigger user;
update general_messages set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table general_messages enable trigger user;
alter table general_messages alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index general_messages_workspace_idx on general_messages (workspace_id);
create policy "workspace: only my workspace" on general_messages as restrictive for select to authenticated
  using (workspace_id = (select my_workspace()));
create trigger zz_workspace_guard before insert or update or delete on general_messages
  for each row execute function workspace_guard('profile:author_id', 'author_id');

alter table general_chat_reads add column workspace_id uuid references workspaces (id);
alter table general_chat_reads disable trigger user;
update general_chat_reads set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table general_chat_reads enable trigger user;
alter table general_chat_reads alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index general_chat_reads_workspace_idx on general_chat_reads (workspace_id);
create policy "workspace: only my workspace" on general_chat_reads as restrictive for select to authenticated
  using (workspace_id = (select my_workspace()));
create trigger zz_workspace_guard before insert or update or delete on general_chat_reads
  for each row execute function workspace_guard('profile:user_id', 'user_id');

alter table materials add column workspace_id uuid references workspaces (id);
alter table materials disable trigger user;
update materials set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table materials enable trigger user;
alter table materials alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index materials_workspace_idx on materials (workspace_id);
create policy "workspace: only my workspace" on materials as restrictive for select to authenticated
  using (workspace_id = (select my_workspace()));
create trigger zz_workspace_guard before insert or update or delete on materials
  for each row execute function workspace_guard('profile:teacher_id', 'teacher_id');

alter table material_likes add column workspace_id uuid references workspaces (id);
alter table material_likes disable trigger user;
update material_likes set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table material_likes enable trigger user;
alter table material_likes alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index material_likes_workspace_idx on material_likes (workspace_id);
create policy "workspace: only my workspace" on material_likes as restrictive for select to authenticated
  using (workspace_id = (select my_workspace()));
create trigger zz_workspace_guard before insert or update or delete on material_likes
  for each row execute function workspace_guard('material_id', 'user_id');

alter table material_files add column workspace_id uuid references workspaces (id);
alter table material_files disable trigger user;
update material_files set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table material_files enable trigger user;
alter table material_files alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index material_files_workspace_idx on material_files (workspace_id);
create policy "workspace: only my workspace" on material_files as restrictive for select to authenticated
  using (workspace_id = (select my_workspace()));
create trigger zz_workspace_guard before insert or update or delete on material_files
  for each row execute function workspace_guard('course_id|profile:author_id', 'author_id');

alter table telegram_links add column workspace_id uuid references workspaces (id);
alter table telegram_links disable trigger user;
update telegram_links set workspace_id = (select id from workspaces order by created_at, id limit 1);
alter table telegram_links enable trigger user;
alter table telegram_links alter column workspace_id set not null, alter column workspace_id set default default_workspace();
create index telegram_links_workspace_idx on telegram_links (workspace_id);
create policy "workspace: only my workspace" on telegram_links as restrictive for select to authenticated
  using (workspace_id = (select my_workspace()));
create trigger zz_workspace_guard before insert or update or delete on telegram_links
  for each row execute function workspace_guard('profile:user_id', 'user_id');

-- 7. Functions.
-- A course of another workspace is hidden from me: every function and policy that asks course_hidden_from_me()
-- (meetings, notes, homework, listeners, counts, photos …) answers "not found" or nothing for it (AC 6).
create or replace function course_hidden_from_me(course uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select exists (
      select 1 from courses c
      where c.id = course
        and (
          c.workspace_id is distinct from my_workspace()
          or (
            c.hidden
            and c.created_by is distinct from auth.uid()
            and my_role() is distinct from 'teacher'
            and not exists (select 1 from course_members m where m.course_id = c.id and m.user_id = auth.uid())
          )
        )
    )
  $$;

-- AC 9: the teacher sees the requests of their own workspace only. Otherwise as 0053.
create or replace function access_requests()
  returns table (id uuid, full_name text, email text, created_at timestamptz, access_status access_status)
  language plpgsql stable security definer set search_path = public
  as $$
  begin
    if my_role() is distinct from 'teacher' then
      raise exception 'Only the teacher can see requests.' using errcode = '42501', hint = 'sham:only_teacher_requests';
    end if;
    return query
      select p.id, p.full_name, u.email::text, p.created_at, p.access_status
      from profiles p
      join auth.users u on u.id = p.id
      where p.access_status <> 'approved'
        and p.workspace_id = my_workspace()
      order by p.created_at, p.id;
  end $$;

-- AC 6: the files of a course / discipline being deleted, only in my workspace. Otherwise as 0053.
create or replace function course_homework_photos(course uuid)
  returns table (photo_path text)
  language plpgsql stable security definer set search_path = public
  as $$
begin
  if my_role() is distinct from 'teacher' then
    raise exception 'Only the teacher can delete a course.' using errcode = '42501', hint = 'sham:only_teacher_delete_course';
  end if;
  if not exists (select 1 from courses c where c.id = course and c.workspace_id = my_workspace()) then
    raise exception 'Course not found.' using errcode = 'P0002', hint = 'sham:course_not_found';
  end if;
  return query
    select distinct h.photo_path
    from homework h
    where (h.course_id = course
           or h.assignment_id in (select a.id from homework_assignments a where a.course_id = course))
      and h.photo_path is not null
      and exists (select 1 from storage.objects o where o.bucket_id = 'homework' and o.name = h.photo_path);
end $$;

create or replace function course_payment_proofs(course uuid)
  returns table (proof_path text)
  language plpgsql stable security definer set search_path = public
  as $$
begin
  if my_role() is distinct from 'teacher' then
    raise exception 'Only the teacher can delete a course.' using errcode = '42501', hint = 'sham:only_teacher_delete_course';
  end if;
  if not exists (select 1 from courses c where c.id = course and c.workspace_id = my_workspace()) then
    raise exception 'Course not found.' using errcode = 'P0002', hint = 'sham:course_not_found';
  end if;
  return query
    select r.proof_path
    from course_payment_requests r
    where r.course_id = course
      and exists (select 1 from storage.objects o where o.bucket_id = 'payment-proofs' and o.name = r.proof_path);
end $$;

create or replace function discipline_homework_photos(discipline uuid)
  returns table (photo_path text)
  language plpgsql stable security definer set search_path = public
  as $$
begin
  if my_role() is distinct from 'teacher' then
    raise exception 'Only the teacher can delete a discipline.' using errcode = '42501', hint = 'sham:only_teacher_delete_discipline';
  end if;
  if not exists (select 1 from disciplines d where d.id = discipline and d.workspace_id = my_workspace()) then
    raise exception 'Discipline not found.' using errcode = 'P0002', hint = 'sham:discipline_not_found';
  end if;
  return query
    select distinct p.photo_path
    from courses c
    cross join lateral course_homework_photos(c.id) p
    where c.discipline_id = discipline;
end $$;

create or replace function discipline_payment_proofs(discipline uuid)
  returns table (proof_path text)
  language plpgsql stable security definer set search_path = public
  as $$
begin
  if my_role() is distinct from 'teacher' then
    raise exception 'Only the teacher can delete a discipline.' using errcode = '42501', hint = 'sham:only_teacher_delete_discipline';
  end if;
  if not exists (select 1 from disciplines d where d.id = discipline and d.workspace_id = my_workspace()) then
    raise exception 'Discipline not found.' using errcode = 'P0002', hint = 'sham:discipline_not_found';
  end if;
  return query
    select p.proof_path
    from courses c
    cross join lateral course_payment_proofs(c.id) p
    where c.discipline_id = discipline;
end $$;

-- AC 10: notification recipients stay in the event's workspace (the service role calls these). Course chat: the
-- teacher of the course's workspace. General chat, new materials, new accounts: the workspace of the message,
-- material or account. Otherwise as 0046 / 0048 / 0044. The other recipient functions only reach a course's owner
-- and listeners, who are in the course's workspace.
create or replace function chat_message_recipients(message uuid)
  returns table (course_title text, recipient_ids uuid[])
  language sql stable security definer set search_path = public
  as $$
    select
      c.title,
      array(
        select p.id
        from profiles p
        where p.id is distinct from m.author_id
          and p.access_status = 'approved'
          and p.workspace_id = c.workspace_id
          and (
            p.role = 'teacher'
            or c.created_by = p.id
            or exists (select 1 from course_members cm where cm.course_id = m.course_id and cm.user_id = p.id)
          )
        order by p.id
      )
    from course_messages m
    join courses c on c.id = m.course_id
    where m.id = message
  $$;

create or replace function general_message_recipients(message uuid)
  returns table (recipient_ids uuid[])
  language sql stable security definer set search_path = public
  as $$
    select array(
      select p.id
      from profiles p
      where p.id is distinct from m.author_id
        and p.access_status = 'approved'
        and p.workspace_id = m.workspace_id
      order by p.id
    )
    from general_messages m
    where m.id = message
  $$;

create or replace function new_material_recipients(type text, item uuid)
  returns table (user_id uuid, author_name text, item_title text)
  language sql stable security definer set search_path = public
  as $$
    with m as (
      select b.teacher_id as author_id, b.title as title, false as course_only, null::uuid as course_id, b.workspace_id
        from materials b
        where new_material_recipients.type = 'blog' and b.id = new_material_recipients.item
      union all
      select f.author_id, f.name, f.course_only, f.course_id, f.workspace_id
        from material_files f
        where new_material_recipients.type = 'file' and f.id = new_material_recipients.item
    )
    select p.id, a.full_name, m.title
    from m
    join profiles a on a.id = m.author_id
    join profiles p on p.id <> m.author_id and p.access_status = 'approved' and p.workspace_id = m.workspace_id
    join telegram_links l on l.user_id = p.id and l.notify_new_material
    where not m.course_only
       or m.course_id is null
       or p.role = 'teacher'
       or exists (select 1 from courses c where c.id = m.course_id and c.created_by = p.id)
       or exists (select 1 from course_members cm where cm.course_id = m.course_id and cm.user_id = p.id)
    order by p.id
  $$;

create or replace function new_account_notification(account uuid)
  returns table (account_name text, user_id uuid)
  language sql stable security definer set search_path = public
  as $$
    select p.full_name, t.id
    from profiles p
    join profiles t on t.role = 'teacher' and t.access_status = 'approved' and t.workspace_id = p.workspace_id
    where p.id = new_account_notification.account
      and p.access_status = 'pending'
      and p.id <> t.id
  $$;

-- 8. AC 6: files in the homework, materials and payment-proofs buckets start with their owner's profile id; app
-- users reach only those of their own workspace (on top of each bucket's own rules).
create function storage_object_in_my_workspace(object_name text) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select exists (
      select 1 from profiles p
      where p.id::text = (storage.foldername(object_name))[1] and p.workspace_id = my_workspace()
    )
  $$;
revoke execute on function storage_object_in_my_workspace(text) from public, anon;
grant execute on function storage_object_in_my_workspace(text) to authenticated;
create policy "workspace: only my workspace's files" on storage.objects as restrictive for all to authenticated
  using (bucket_id not in ('homework', 'materials', 'payment-proofs') or storage_object_in_my_workspace(name))
  with check (bucket_id not in ('homework', 'materials', 'payment-proofs') or storage_object_in_my_workspace(name));
