-- Account approval (ARU-43): every new account is Pending until the teacher accepts it (Approved) or declines it
-- (Rejected). Only Approved accounts can use the app: Pending and Rejected accounts read only their own profile row
-- and can't write anything. Run after 0020_course_only_material_files.sql.
-- Adds a type, three columns, a trigger and two functions; replaces helper functions and a few policies. Every
-- existing account becomes Approved; nothing is deleted.
--
-- How access is cut off for a non-approved account:
--   my_role()               returns null, so every policy and function that checks the role refuses them.
--   is_member(), owns_course(), in_course_chat(), can_see_material_file()
--                           return false, so every policy and function built on them refuses them.
--   is_approved() (new)     replaces the open read rules that use none of the above:
--     profiles   "profiles readable"                 was true -> own row, approved rows when approved, all for the teacher
--     courses    "courses readable"                  was true -> is_approved()
--     materials  "materials readable"                was true -> is_approved()
--     storage    "students upload own homework photos"           + is_approved()
--     storage    "material files readable by signed-in users"    + is_approved() (its own-folder rule had no check)
-- Policies left as they are, because a non-approved account can't own the rows they let through (it can't be a
-- listener, owner, author or homework sender, see below): the own-row parts of "course members readable",
-- "homework readable", "attendance readable" and "homework photos readable with their homework".
-- Null-safe role checks: set_meeting_status(), update_meeting() and set_meeting_notes() (my_role() is null now).
-- Approved-only targets: adding a listener ("teachers and mentors add listeners"), change_course_owner() and
-- set_user_role() refuse accounts that aren't Approved.
-- The teacher is always Approved (trigger below), and only set_access_status() changes the status.

create type access_status as enum ('pending', 'approved', 'rejected');

-- Existing rows get 'approved' from the first default; only rows inserted from now on default to 'pending'.
alter table profiles add column access_status access_status not null default 'approved';
alter table profiles alter column access_status set default 'pending';
alter table profiles add column access_changed_by uuid references profiles (id) on delete set null;
alter table profiles add column access_changed_at timestamptz;

-- The teacher is always Approved, including the one-time "make the first teacher" step (supabase/manage-roles.sql).
create function profiles_teacher_approved() returns trigger
  language plpgsql set search_path = public
  as $$
  begin
    if new.role = 'teacher' then
      new.access_status := 'approved';
    end if;
    return new;
  end $$;
create trigger profiles_teacher_approved before insert or update of role, access_status on profiles
  for each row execute function profiles_teacher_approved();
revoke execute on function profiles_teacher_approved() from public, anon, authenticated;

-- Only the name can be edited directly ("edit own profile", 0001); role and access only through their functions.
revoke update on profiles from anon, authenticated;
grant update (full_name) on profiles to authenticated;

-- Helpers. Security definer so policies on profiles can use them without recursing.
create function is_approved() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from profiles where id = auth.uid() and access_status = 'approved') $$;
revoke execute on function is_approved() from public, anon;
grant execute on function is_approved() to authenticated;

create or replace function my_role() returns user_role
  language sql stable security definer set search_path = public
  as $$ select role from profiles where id = auth.uid() and access_status = 'approved' $$;

create or replace function is_member(course uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$ select is_approved() and exists (select 1 from course_members where course_id = course and user_id = auth.uid()) $$;

create or replace function owns_course(course uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$ select is_approved() and exists (select 1 from courses where id = course and created_by = auth.uid()) $$;

create or replace function in_course_chat(course uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select is_approved() and (
      exists (select 1 from courses where id = course and created_by = auth.uid())
      or is_member(course)
      or my_role() = 'teacher'
    )
  $$;

create or replace function can_see_material_file(path text) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select is_approved() and exists (
      select 1 from material_files f
      where f.storage_path = path
        and (
          not f.course_only
          or f.course_id is null
          or f.author_id = auth.uid()
          or my_role() = 'teacher'
          or exists (select 1 from courses c where c.id = f.course_id and c.created_by = auth.uid())
          or exists (select 1 from course_members m where m.course_id = f.course_id and m.user_id = auth.uid())
        )
    )
  $$;

-- Open read policies.
drop policy "profiles readable" on profiles;
-- Own row always (the waiting screen needs it). Approved accounts see approved accounts; the teacher sees everyone,
-- so names of people waiting stay private and the app's pickers never offer them.
create policy "profiles readable" on profiles for select to authenticated
  using (id = auth.uid() or (is_approved() and access_status = 'approved') or my_role() = 'teacher');

drop policy "courses readable" on courses;
create policy "courses readable" on courses for select to authenticated using (is_approved());

drop policy "materials readable" on materials;
create policy "materials readable" on materials for select to authenticated using (is_approved());

-- Listeners must be Approved accounts.
drop policy "teachers and mentors add listeners" on course_members;
create policy "teachers and mentors add listeners" on course_members for insert to authenticated with check (
  added_by = auth.uid()
  and my_role() in ('teacher', 'mentor')
  and exists (
    select 1 from profiles p
    where p.id = user_id and p.role in ('student', 'mentor') and p.access_status = 'approved'
  )
  and not exists (select 1 from courses c where c.id = course_id and c.created_by = user_id)
);

-- Storage.
drop policy "students upload own homework photos" on storage.objects;
create policy "students upload own homework photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'homework' and (storage.foldername(name))[1] = auth.uid()::text and is_approved());

drop policy "material files readable by signed-in users" on storage.objects;
create policy "material files readable by signed-in users" on storage.objects for select to authenticated
  using (
    bucket_id = 'materials'
    and is_approved()
    and (can_see_material_file(name) or (storage.foldername(name))[1] = auth.uid()::text)
  );

-- Accept or decline an account: the teacher only. Accept works on Pending and Rejected (changing their mind);
-- Decline only on Pending. The teacher's own account can't change. Setting the current status again is a no-op.
create function set_access_status(target uuid, new_status access_status) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    old_status access_status;
    target_role user_role;
  begin
    if auth.uid() is not null and not is_approved() then
      raise exception 'Your account is waiting for the teacher''s approval.' using errcode = '42501';
    end if;
    if my_role() is distinct from 'teacher' then
      raise exception 'Only the teacher can accept or decline requests.' using errcode = '42501';
    end if;
    if new_status is null or new_status not in ('approved', 'rejected') then
      raise exception 'A request can only be accepted or declined.' using errcode = '22023';
    end if;
    select access_status, role into old_status, target_role from profiles where id = target for update;
    if not found then
      raise exception 'User not found' using errcode = 'P0002';
    end if;
    if target_role = 'teacher' then
      raise exception 'The teacher''s access can''t be changed.' using errcode = '42501';
    end if;
    if old_status = new_status then
      return; -- already done: safe retry
    end if;
    if new_status = 'rejected' and old_status = 'approved' then
      raise exception 'Only requests that are waiting can be declined.' using errcode = '23514';
    end if;
    update profiles
      set access_status = new_status, access_changed_by = auth.uid(), access_changed_at = now()
      where id = target;
  end $$;
revoke execute on function set_access_status(uuid, access_status) from public, anon;
grant execute on function set_access_status(uuid, access_status) to authenticated;

-- Requests and declined accounts for the teacher's Manage roles screen, oldest first, with the sign-up email
-- (profiles has no email column).
create function access_requests()
  returns table (id uuid, full_name text, email text, created_at timestamptz, access_status access_status)
  language plpgsql stable security definer set search_path = public
  as $$
  begin
    if my_role() is distinct from 'teacher' then
      raise exception 'Only the teacher can see requests.' using errcode = '42501';
    end if;
    return query
      select p.id, p.full_name, u.email::text, p.created_at, p.access_status
      from profiles p
      join auth.users u on u.id = p.id
      where p.access_status <> 'approved'
      order by p.created_at, p.id;
  end $$;
revoke execute on function access_requests() from public, anon;
grant execute on function access_requests() to authenticated;

-- Role changes only for Approved accounts (same body as 0009 plus the access check).
create or replace function set_user_role(target uuid, new_role user_role) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    old_role user_role;
    old_access access_status;
    target_name text;
    owned int;
    titles text;
  begin
    if my_role() is distinct from 'teacher' then
      raise exception 'Only the teacher can change roles' using errcode = '42501';
    end if;
    if new_role is null or new_role not in ('student', 'mentor') then
      raise exception 'Users can only be switched between student and mentor' using errcode = '42501';
    end if;

    -- Lock the target's profile before counting their courses. ARU-9's change_course_owner() locks the new
    -- owner's profile row too, so the two serialize and can never leave a student owning a course.
    select role, full_name, access_status into old_role, target_name, old_access from profiles where id = target for update;
    if not found then
      raise exception 'User not found' using errcode = 'P0002';
    end if;
    if old_access <> 'approved' then
      raise exception 'Accept % first.', target_name using errcode = '23514';
    end if;
    if old_role not in ('student', 'mentor') then
      raise exception 'The teacher''s role can''t be changed' using errcode = '42501';
    end if;
    if old_role = new_role then
      return; -- already done (safe retry)
    end if;

    if new_role = 'student' then
      select count(*), string_agg(title, ', ' order by title) into owned, titles
      from courses where created_by = target;
      if owned > 0 then
        raise exception '% owns % course(s): %. Reassign them first', target_name, owned, titles
          using errcode = '23514';
      end if;
    end if;

    update profiles set role = new_role where id = target;
  end $$;

-- Course owners must be Approved accounts (same body as 0019 plus the access check).
create or replace function change_course_owner(course uuid, new_owner uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    current_owner uuid;
    target_role user_role;
    target_access access_status;
  begin
    if my_role() is null or my_role() not in ('teacher', 'mentor') then
      raise exception 'Only a teacher or mentor can change the owner.' using errcode = '42501';
    end if;
    select created_by into current_owner from courses where id = course for update;
    -- ARU-40: a hidden course is changed only by the teacher, its owner or a mentor listener.
    if not found or course_hidden_from_me(course) then
      raise exception 'Course not found.' using errcode = 'P0002';
    end if;
    -- Lock the new owner's profile so a concurrent role change can't leave a student owner (see ARU-13).
    select role, access_status into target_role, target_access from profiles where id = new_owner for share;
    if target_role is null then
      raise exception 'That user does not exist.' using errcode = 'P0002';
    end if;
    if target_access <> 'approved' then
      raise exception 'Only an accepted account can own a course.' using errcode = '23514';
    end if;
    if target_role not in ('teacher', 'mentor') then
      raise exception 'Only a teacher or mentor can own a course.' using errcode = '23514';
    end if;
    if current_owner = new_owner then
      return;
    end if;
    if exists (select 1 from course_members m where m.course_id = course and m.user_id = new_owner) then
      raise exception 'This person is a listener of the course. Remove them first.' using errcode = '23514';
    end if;
    update courses set created_by = new_owner where id = course;
  end $$;

-- Meeting functions (same bodies as 0019): "not (owns_course(..) or my_role() = 'teacher')" was null, not true, for an
-- account without a role (my_role() is null), which skipped the permission check. Now a waiting account gets the
-- permission error (ARU-43 QA).
create or replace function set_meeting_status(meeting uuid, new_status meeting_status) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
  begin
    select * into m from course_meetings where id = meeting for update;
    if not found or course_hidden_from_me(m.course_id) then
      raise exception 'Meeting not found.' using errcode = 'P0002';
    end if;
    if not (owns_course(m.course_id) or coalesce(my_role() = 'teacher', false)) then
      raise exception 'Only the course owner or the teacher can change a meeting''s status.' using errcode = '42501';
    end if;
    if new_status = m.status and new_status <> 'scheduled' then
      return; -- already done: safe retry
    end if;
    if m.status <> 'scheduled' then
      raise exception 'This meeting is already %; its status can''t change.', m.status using errcode = '23514';
    end if;
    if new_status = 'scheduled' then
      raise exception 'A meeting can only be marked completed or canceled.' using errcode = '22023';
    end if;
    if new_status = 'completed' and m.starts_at > now() then
      raise exception 'A meeting can be marked completed only after it has started.' using errcode = '23514';
    end if;
    update course_meetings
      set status = new_status, status_changed_by = auth.uid(), status_changed_at = now()
      where id = meeting;
  end $$;

create or replace function update_meeting(meeting uuid, new_starts_at timestamptz, new_topic text, new_location text)
  returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
    moved boolean;
  begin
    select * into m from course_meetings where id = meeting for update;
    if not found or course_hidden_from_me(m.course_id) then
      raise exception 'Meeting not found.' using errcode = 'P0002';
    end if;
    if not (owns_course(m.course_id) or coalesce(my_role() = 'teacher', false)) then
      raise exception 'Only the course owner or the teacher can edit a meeting.' using errcode = '42501';
    end if;
    if m.status <> 'scheduled' then
      raise exception 'This meeting is already %; it can''t be edited.', m.status using errcode = '23514';
    end if;
    if new_starts_at is null then
      raise exception 'Pick a date and start time.' using errcode = '22023';
    end if;
    moved := new_starts_at is distinct from m.starts_at;
    if moved and new_starts_at <= now() then
      raise exception 'Pick a time in the future.' using errcode = '23514';
    end if;
    update course_meetings set
      starts_at = new_starts_at,
      topic = coalesce(nullif(trim(new_topic), ''), 'Meeting'),
      location = nullif(trim(new_location), ''),
      rescheduled_at = case when moved then now() else m.rescheduled_at end
    where id = meeting;
  end $$;

create or replace function set_meeting_notes(meeting uuid, new_notes text) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
    -- Trims spaces, tabs and line breaks (trim() alone removes only spaces).
    cleaned text := nullif(regexp_replace(new_notes, '^\s+|\s+$', '', 'g'), '');
  begin
    select * into m from course_meetings where id = meeting for update;
    if not found or course_hidden_from_me(m.course_id) then
      raise exception 'Meeting not found.' using errcode = 'P0002';
    end if;
    if not (owns_course(m.course_id) or coalesce(my_role() = 'teacher', false)) then
      raise exception 'Only the course owner or the teacher can edit notes.' using errcode = '42501';
    end if;
    if m.status <> 'completed' then
      raise exception 'Notes can be added only to completed meetings.' using errcode = '23514';
    end if;
    if char_length(cleaned) > 10000 then
      raise exception 'Notes can be at most 10,000 characters.' using errcode = '22001';
    end if;
    update course_meetings set
      notes = cleaned,
      notes_updated_by = auth.uid(),
      notes_updated_at = now()
    where id = meeting;
  end $$;
