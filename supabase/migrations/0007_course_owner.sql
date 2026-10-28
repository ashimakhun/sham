-- Course owner (ARU-9): the creator owns a course; the teacher or any mentor can reassign the owner.
-- A student can never own a course, by any path (app, RPC or SQL editor). Run after 0006_course_chat.sql.

comment on column courses.created_by is
  'Current owner of the course (always a teacher or mentor); the creator by default, changeable with change_course_owner().';

-- Stop if existing data already breaks the rule, so the guards below never start out violated.
do $$
declare bad text;
begin
  select string_agg(format('%s (owner %s)', c.title, coalesce(p.full_name, c.created_by::text)), ', ')
    into bad
  from courses c left join profiles p on p.id = c.created_by
  where p.role is distinct from 'teacher' and p.role is distinct from 'mentor';
  if bad is not null then
    raise exception 'Courses owned by a student: %; reassign them first', bad;
  end if;
end $$;

-- Guard 1: a course's owner must be an existing teacher or mentor (insert and owner change).
create function courses_owner_is_staff() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare owner_role user_role;
  begin
    -- App callers who aren't staff (students, signed-out) can't insert or update courses at all: leave that
    -- rejection to RLS (permission error). current_setting('role') is the caller's API role even in here.
    if current_setting('role', true) in ('anon', 'authenticated')
       and coalesce(my_role()::text, '') not in ('teacher', 'mentor') then
      return new;
    end if;
    -- Lock the profile so a concurrent switch to student waits for this change (and then sees it).
    select role into owner_role from profiles where id = new.created_by for share;
    if owner_role is null or owner_role not in ('teacher', 'mentor') then
      raise exception 'A course owner must be a teacher or mentor.' using errcode = '23514';
    end if;
    return new;
  end $$;

create trigger courses_owner_is_staff before insert or update of created_by on courses
  for each row execute function courses_owner_is_staff();

-- Guard 2: a user who owns courses can't become a student.
create function profiles_owner_stays_staff() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare n int;
  begin
    if new.role = 'student' and old.role is distinct from 'student' then
      select count(*) into n from courses where created_by = new.id;
      if n > 0 then
        raise exception '% owns % course(s). Reassign them first', new.full_name, n using errcode = '23514';
      end if;
    end if;
    return new;
  end $$;

create trigger profiles_owner_stays_staff before update of role on profiles
  for each row execute function profiles_owner_stays_staff();

-- Reassign the owner. Teacher or any mentor (also a mentor who is a listener of the course); the new owner must be
-- a teacher or mentor who isn't a listener of the course. Same owner again: no change, no error (safe retry).
create function change_course_owner(course uuid, new_owner uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    current_owner uuid;
    target_role user_role;
  begin
    if my_role() is null or my_role() not in ('teacher', 'mentor') then
      raise exception 'Only a teacher or mentor can change the owner.' using errcode = '42501';
    end if;
    select created_by into current_owner from courses where id = course for update;
    if not found then
      raise exception 'Course not found.' using errcode = 'P0002';
    end if;
    -- Lock the new owner's profile so a concurrent role change can't leave a student owner (see ARU-13).
    select role into target_role from profiles where id = new_owner for share;
    if target_role is null then
      raise exception 'That user does not exist.' using errcode = 'P0002';
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

revoke execute on function change_course_owner(uuid, uuid) from public, anon;
grant execute on function change_course_owner(uuid, uuid) to authenticated;
-- Trigger functions are not meant to be called directly.
revoke execute on function courses_owner_is_staff() from public, anon, authenticated;
revoke execute on function profiles_owner_stays_staff() from public, anon, authenticated;
