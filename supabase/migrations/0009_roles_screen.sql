-- ARU-13: the teacher switches users between student and mentor in the app.
--   * Exactly one teacher: nobody else can become a teacher and the teacher can't stop being one
--     (trigger + partial unique index). The only allowed change involving 'teacher' is making the first
--     teacher while none exists (supabase/manage-roles.sql).
--   * Roles change only through set_user_role(), which only the teacher may call and which only switches
--     student <-> mentor. A mentor who owns courses can't become a student until they are reassigned.
--   * The "edit own profile" policy (0001) still stops anyone changing their own role.
--   * profiles is NOT added to realtime: a user sees their new role after a refresh or restart.

-- 1. Stop with a clear message if the data already breaks the one-teacher rule.
do $$
declare
  names text;
begin
  select string_agg(full_name, ', ' order by full_name) into names
  from profiles where role = 'teacher'
  having count(*) > 1;
  if names is not null then
    raise exception 'More than one teacher exists: %; make all but one a mentor first', names;
  end if;
end $$;

-- 2. At most one teacher, even under concurrent inserts.
create unique index profiles_one_teacher on profiles ((true)) where role = 'teacher';

-- 3. No change of role to or from teacher once a teacher exists, even from the SQL editor.
--    errcode 42501 matches what RLS returns when an app user tries to change their own role.
create function profiles_teacher_locked() returns trigger
  language plpgsql set search_path = public
  as $$
  begin
    if tg_op = 'UPDATE' then
      if old.role is not distinct from new.role then
        return new;
      end if;
      if old.role = 'teacher' then
        raise exception 'The teacher can''t stop being the teacher' using errcode = '42501';
      end if;
    end if;
    if new.role = 'teacher' and exists (select 1 from profiles where role = 'teacher' and id <> new.id) then
      raise exception 'There is already a teacher; nobody else can become one' using errcode = '42501';
    end if;
    return new;
  end $$;

create trigger profiles_teacher_locked before insert or update of role on profiles
  for each row execute function profiles_teacher_locked();

-- 4. The only way the app changes roles.
create function set_user_role(target uuid, new_role user_role) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    old_role user_role;
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
    select role, full_name into old_role, target_name from profiles where id = target for update;
    if not found then
      raise exception 'User not found' using errcode = 'P0002';
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

revoke execute on function set_user_role(uuid, user_role) from public, anon;
grant execute on function set_user_role(uuid, user_role) to authenticated;
