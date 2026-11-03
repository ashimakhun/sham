-- ARU-65: Accountant. The teacher turns Accountant on for a mentor (a feature of the mentor role, not a new role);
-- accountants select paid courses and give each a monthly payment period. Adds a profile column, a table, two
-- functions and a new body for set_user_role(); deletes nothing. Existing profiles get is_accountant = false.
-- Run after 0031.

-- Only mentors can be accountants. Clients can update only full_name on profiles (0021), so the flag changes only
-- through set_accountant() below (and set_user_role(), which clears it).
alter table profiles add column is_accountant boolean not null default false;
alter table profiles add constraint profiles_accountant_is_mentor check (not is_accountant or role = 'mentor');

-- True when the caller is an approved mentor with Accountant on.
create function is_accountant() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from profiles where id = auth.uid() and access_status = 'approved' and role = 'mentor' and is_accountant) $$;
revoke execute on function is_accountant() from public, anon;
grant execute on function is_accountant() to authenticated;

-- Teacher only. The target must be an approved mentor; setting the same value again is a no-op (safe retry).
create function set_accountant(target uuid, on_off boolean) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    p profiles%rowtype;
  begin
    if my_role() is distinct from 'teacher' then
      raise exception 'Only the teacher can turn Accountant on or off.' using errcode = '42501';
    end if;
    if on_off is null then
      raise exception 'Choose on or off.' using errcode = '22023';
    end if;
    select * into p from profiles where id = target for update;
    if not found then
      raise exception 'User not found' using errcode = 'P0002';
    end if;
    if p.access_status <> 'approved' then
      raise exception 'Accept % first.', p.full_name using errcode = '23514';
    end if;
    if p.role <> 'mentor' then
      raise exception 'Only mentors can be accountants.' using errcode = '23514';
    end if;
    if p.is_accountant = on_off then
      return;
    end if;
    update profiles set is_accountant = on_off where id = target;
  end $$;
revoke execute on function set_accountant(uuid, boolean) from public, anon;
grant execute on function set_accountant(uuid, boolean) to authenticated;

-- Same body as 0021, plus: a mentor who becomes a student stops being an accountant, in the same update.
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

    update profiles
      set role = new_role, is_accountant = case when new_role = 'mentor' then is_accountant else false end
      where id = target;
  end $$;

-- Paid courses: one row per course, shared by all accountants (no per-accountant ownership). The payment period
-- repeats every month; the deadline is end_day.
create table course_billing (
  course_id uuid primary key references courses (id) on delete cascade,
  start_day smallint not null check (start_day between 1 and 28),
  end_day smallint not null check (end_day between 1 and 28),
  selected_by uuid not null default auth.uid() references profiles (id),
  selected_at timestamptz not null default now(),
  check (start_day <= end_day)
);

alter table course_billing enable row level security;

-- Accountants and the teacher read paid courses. my_role() is null for unapproved accounts (0021).
create policy "billing readable by accountants and the teacher" on course_billing for select to authenticated
  using (is_accountant() or coalesce(my_role() = 'teacher', false));
-- Accountants select (insert) and unselect (delete) any course; the teacher doesn't (AC 6).
create policy "accountants select paid courses" on course_billing for insert to authenticated
  with check (is_accountant() and selected_by = auth.uid());
create policy "accountants unselect paid courses" on course_billing for delete to authenticated
  using (is_accountant());
-- Accountants and the teacher change the period (only start_day / end_day, column grant below).
create policy "accountants and the teacher change periods" on course_billing for update to authenticated
  using (is_accountant() or coalesce(my_role() = 'teacher', false))
  with check (is_accountant() or coalesce(my_role() = 'teacher', false));

-- Hidden courses (ARU-40): billing of a hidden course is only for its participants and the teacher, as in 0019.
create policy "hidden courses: billing readable by participants and the teacher" on course_billing as restrictive
  for select to authenticated using (not course_hidden_from_me(course_id));
create policy "hidden courses: billing selected by participants and the teacher" on course_billing as restrictive
  for insert to authenticated with check (not course_hidden_from_me(course_id));
create policy "hidden courses: billing changed by participants and the teacher" on course_billing as restrictive
  for update to authenticated using (not course_hidden_from_me(course_id));
create policy "hidden courses: billing unselected by participants and the teacher" on course_billing as restrictive
  for delete to authenticated using (not course_hidden_from_me(course_id));

-- Only the period can change; course_id, selected_by and selected_at can't be rewritten.
revoke insert, update on course_billing from anon, authenticated;
grant insert (course_id, start_day, end_day) on course_billing to authenticated;
grant update (start_day, end_day) on course_billing to authenticated;

alter publication supabase_realtime add table course_billing;
