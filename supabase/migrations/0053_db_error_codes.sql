-- ARU-111 (Russian version, part 5): every message a database function or trigger raises for users gets a stable
-- code, so the app can show it in the user's language (AC 1, AC 2). The English message is unchanged (older app
-- versions show it as before, AC 6) and every errcode stays the same (the app branches on P0002, 42501, 23505).
--   hint   = 'sham:<code>'                    the catalog text the app shows (src/i18n, ids db.<code>)
--   detail = '{"name": …, "count": …}'        the values of a message that has them (AC 3), as JSON
-- Each function below is the latest definition from an earlier migration, recreated with `create or replace` and the
-- same signature, so owners, security definer, search_path and grants are unchanged; only `, hint = …` (and
-- `, detail = …`) is added to its raise statements. No table, column, policy or grant changes; deletes nothing.
-- Not coded (developer-only, stays English): 'Unknown notification type: %' (set_telegram_notification) and the
-- one-off checks inside do-blocks of older migrations. supabase/tests/aru111_db_error_codes.test.sql fails when a
-- function raises a message without a sham: hint.

-- access_requests: latest definition from 0021_account_approval.sql.
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
      order by p.created_at, p.id;
  end $$;

-- change_course_owner: latest definition from 0021_account_approval.sql.
create or replace function change_course_owner(course uuid, new_owner uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    current_owner uuid;
    target_role user_role;
    target_access access_status;
  begin
    if my_role() is null or my_role() not in ('teacher', 'mentor') then
      raise exception 'Only a teacher or mentor can change the owner.' using errcode = '42501', hint = 'sham:owner_change_role';
    end if;
    select created_by into current_owner from courses where id = course for update;
    -- ARU-40: a hidden course is changed only by the teacher, its owner or a mentor listener.
    if not found or course_hidden_from_me(course) then
      raise exception 'Course not found.' using errcode = 'P0002', hint = 'sham:course_not_found';
    end if;
    -- Lock the new owner's profile so a concurrent role change can't leave a student owner (see ARU-13).
    select role, access_status into target_role, target_access from profiles where id = new_owner for share;
    if target_role is null then
      raise exception 'That user does not exist.' using errcode = 'P0002', hint = 'sham:user_not_exists';
    end if;
    if target_access <> 'approved' then
      raise exception 'Only an accepted account can own a course.' using errcode = '23514', hint = 'sham:owner_not_accepted';
    end if;
    if target_role not in ('teacher', 'mentor') then
      raise exception 'Only a teacher or mentor can own a course.' using errcode = '23514', hint = 'sham:owner_role';
    end if;
    if current_owner = new_owner then
      return;
    end if;
    if exists (select 1 from course_members m where m.course_id = course and m.user_id = new_owner) then
      raise exception 'This person is a listener of the course. Remove them first.' using errcode = '23514', hint = 'sham:owner_is_listener';
    end if;
    update courses set created_by = new_owner where id = course;
  end $$;

-- course_homework_photos: latest definition from 0041_delete_course.sql.
create or replace function course_homework_photos(course uuid)
  returns table (photo_path text)
  language plpgsql stable security definer set search_path = public
  as $$
begin
  if my_role() is distinct from 'teacher' then
    raise exception 'Only the teacher can delete a course.' using errcode = '42501', hint = 'sham:only_teacher_delete_course';
  end if;
  if not exists (select 1 from courses c where c.id = course) then
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

-- course_payment_proofs: latest definition from 0047_payment_requests.sql.
create or replace function course_payment_proofs(course uuid)
  returns table (proof_path text)
  language plpgsql stable security definer set search_path = public
  as $$
begin
  if my_role() is distinct from 'teacher' then
    raise exception 'Only the teacher can delete a course.' using errcode = '42501', hint = 'sham:only_teacher_delete_course';
  end if;
  if not exists (select 1 from courses c where c.id = course) then
    raise exception 'Course not found.' using errcode = 'P0002', hint = 'sham:course_not_found';
  end if;
  return query
    select r.proof_path
    from course_payment_requests r
    where r.course_id = course
      and exists (select 1 from storage.objects o where o.bucket_id = 'payment-proofs' and o.name = r.proof_path);
end $$;

-- courses_owner_is_staff: latest definition from 0007_course_owner.sql.
create or replace function courses_owner_is_staff() returns trigger
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
      raise exception 'A course owner must be a teacher or mentor.' using errcode = '23514', hint = 'sham:course_owner_staff';
    end if;
    return new;
  end $$;

-- create_telegram_link_code: latest definition from 0023_telegram_links.sql.
create or replace function create_telegram_link_code() returns text
  language plpgsql volatile security definer set search_path = public
  as $$
  declare
    new_code text;
  begin
    if auth.uid() is null or not is_approved() then
      raise exception 'Only accepted accounts can connect Telegram.' using errcode = '42501', hint = 'sham:telegram_not_accepted';
    end if;
    delete from telegram_link_codes c where c.user_id = auth.uid() and c.used_at is null;
    -- 64 hex characters from two random UUIDs (about 244 random bits).
    new_code := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into telegram_link_codes (code, user_id) values (new_code, auth.uid());
    return new_code;
  end $$;

-- delete_course: latest definition from 0041_delete_course.sql.
create or replace function delete_course(course uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
begin
  if my_role() is distinct from 'teacher' then
    raise exception 'Only the teacher can delete a course.' using errcode = '42501', hint = 'sham:only_teacher_delete_course';
  end if;
  -- Lock the row so a concurrent change (owner, discipline) waits for the delete.
  perform 1 from courses c where c.id = course for update;
  if not found then
    raise exception 'Course not found.' using errcode = 'P0002', hint = 'sham:course_not_found';
  end if;
  delete from homework h
  where h.course_id = course
     or h.assignment_id in (select a.id from homework_assignments a where a.course_id = course);
  delete from courses c where c.id = course;
end $$;

-- delete_discipline: latest definition from 0042_delete_discipline.sql.
create or replace function delete_discipline(discipline uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
declare
  c record;
begin
  if my_role() is distinct from 'teacher' then
    raise exception 'Only the teacher can delete a discipline.' using errcode = '42501', hint = 'sham:only_teacher_delete_discipline';
  end if;
  -- Locking the row makes a concurrent "set this course's discipline" (its foreign key check) wait for the delete,
  -- so no course can join the discipline halfway through.
  perform 1 from disciplines d where d.id = discipline for update;
  if not found then
    raise exception 'Discipline not found.' using errcode = 'P0002', hint = 'sham:discipline_not_found';
  end if;
  for c in select id from courses where discipline_id = discipline for update loop
    perform delete_course(c.id);
  end loop;
  delete from disciplines d where d.id = discipline;
end $$;

-- discipline_homework_photos: latest definition from 0042_delete_discipline.sql.
create or replace function discipline_homework_photos(discipline uuid)
  returns table (photo_path text)
  language plpgsql stable security definer set search_path = public
  as $$
begin
  if my_role() is distinct from 'teacher' then
    raise exception 'Only the teacher can delete a discipline.' using errcode = '42501', hint = 'sham:only_teacher_delete_discipline';
  end if;
  if not exists (select 1 from disciplines d where d.id = discipline) then
    raise exception 'Discipline not found.' using errcode = 'P0002', hint = 'sham:discipline_not_found';
  end if;
  return query
    select distinct p.photo_path
    from courses c
    cross join lateral course_homework_photos(c.id) p
    where c.discipline_id = discipline;
end $$;

-- discipline_payment_proofs: latest definition from 0047_payment_requests.sql.
create or replace function discipline_payment_proofs(discipline uuid)
  returns table (proof_path text)
  language plpgsql stable security definer set search_path = public
  as $$
begin
  if my_role() is distinct from 'teacher' then
    raise exception 'Only the teacher can delete a discipline.' using errcode = '42501', hint = 'sham:only_teacher_delete_discipline';
  end if;
  if not exists (select 1 from disciplines d where d.id = discipline) then
    raise exception 'Discipline not found.' using errcode = 'P0002', hint = 'sham:discipline_not_found';
  end if;
  return query
    select p.proof_path
    from courses c
    cross join lateral course_payment_proofs(c.id) p
    where c.discipline_id = discipline;
end $$;

-- disconnect_telegram: latest definition from 0023_telegram_links.sql.
create or replace function disconnect_telegram() returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    if auth.uid() is null then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    delete from telegram_links where user_id = auth.uid();
  end $$;

-- homework_assignments_before_insert: latest definition from 0019_hidden_courses.sql.
create or replace function homework_assignments_before_insert() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
  begin
    -- A caller without a profile (signed out) has my_role() = null; without the null check the condition would be
    -- null, the raise skipped, and the meeting's state revealed by the next check (ARU-36).
    if my_role() is null then
      raise exception 'Only the course owner or the teacher can assign homework.' using errcode = '42501', hint = 'sham:assign_homework_role';
    end if;
    -- ARU-40: a hidden course the caller can't see looks like a missing meeting.
    if course_hidden_from_me(new.course_id) then
      raise exception 'Meeting not found.' using errcode = 'P0002', hint = 'sham:meeting_not_found';
    end if;
    if not (owns_course(new.course_id) or my_role() = 'teacher') then
      raise exception 'Only the course owner or the teacher can assign homework.' using errcode = '42501', hint = 'sham:assign_homework_role';
    end if;
    select * into m from course_meetings where id = new.meeting_id;
    if not found or m.course_id <> new.course_id then
      raise exception 'Meeting not found.' using errcode = 'P0002', hint = 'sham:meeting_not_found';
    end if;
    if m.status <> 'completed' then
      raise exception 'Homework can be assigned only to completed meetings.' using errcode = '23514', hint = 'sham:assign_homework_completed';
    end if;
    if exists (select 1 from homework_assignments a where a.meeting_id = new.meeting_id and a.id <> new.id) then
      raise exception 'This meeting already has homework.' using errcode = '23505', hint = 'sham:meeting_has_homework';
    end if;
    if new.due_at is not null and new.due_at <= now() then
      raise exception 'The deadline must be in the future.' using errcode = '23514', hint = 'sham:deadline_past';
    end if;
    new.title := btrim(new.title);
    new.description := btrim(coalesce(new.description, ''));
    if char_length(new.title) = 0 then
      raise exception 'Enter a title.' using errcode = '23514', hint = 'sham:title_empty';
    end if;
    if char_length(new.title) > 200 then
      raise exception 'The title can be at most 200 characters.' using errcode = '23514', hint = 'sham:title_too_long';
    end if;
    new.created_at := now();
    return new;
  end $$;

-- listener_homework_photos: latest definition from 0019_hidden_courses.sql.
create or replace function listener_homework_photos(course uuid, member uuid)
  returns table (id uuid, photo_path text)
  language plpgsql stable security definer set search_path = public
  as $$
begin
  if my_role() is null or my_role() not in ('teacher', 'mentor') then
    raise exception 'Only a teacher or mentor can do this.' using errcode = '42501', hint = 'sham:staff_only';
  end if;
  if course_hidden_from_me(course) then
    raise exception 'Course not found.' using errcode = 'P0002', hint = 'sham:course_not_found';
  end if;
  return query
    select h.id, h.photo_path
    from homework h
    where h.course_id = course
      and h.student_id = member
      and exists (select 1 from course_members m where m.course_id = course and m.user_id = member);
end $$;

-- mark_attendance: latest definition from 0022_attendance_from_start.sql.
create or replace function mark_attendance(meeting uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
  begin
    select * into m from course_meetings where id = meeting;
    if not found or course_hidden_from_me(m.course_id) then
      raise exception 'Meeting not found.' using errcode = 'P0002', hint = 'sham:meeting_not_found';
    end if;
    if not is_member(m.course_id) then
      raise exception 'Only listeners of this course can mark attendance.' using errcode = '42501', hint = 'sham:attendance_listeners_only';
    end if;
    if m.status = 'canceled' then
      raise exception 'Attendance can''t be changed for a canceled meeting.' using errcode = '23514', hint = 'sham:attendance_canceled';
    end if;
    if m.starts_at > now() then
      raise exception 'Attendance can be marked once the meeting has started.' using errcode = '23514', hint = 'sham:attendance_not_started';
    end if;
    insert into meeting_attendance (meeting_id, user_id) values (meeting, auth.uid())
      on conflict (meeting_id, user_id) do nothing;
  end $$;

-- mark_chat_read: latest definition from 0016_chat_read_positions.sql.
create or replace function mark_chat_read(course uuid, upto uuid) returns timestamptz
  language plpgsql security invoker set search_path = public
  as $$
  declare
    msg_at timestamptz;
    result timestamptz;
  begin
    if auth.uid() is null then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    if not in_course_chat(course) then
      raise exception 'You are not in this course chat.' using errcode = '42501', hint = 'sham:not_in_chat';
    end if;
    select created_at into msg_at from course_messages where id = upto and course_id = course;
    if msg_at is null then
      raise exception 'Message not found.' using errcode = 'P0002', hint = 'sham:message_not_found';
    end if;
    insert into course_chat_reads (course_id, user_id, last_read_at) values (course, auth.uid(), msg_at)
      on conflict (course_id, user_id) do update set last_read_at = excluded.last_read_at -- the trigger keeps the later
      returning last_read_at into result;
    return result;
  end $$;

-- mark_general_chat_read: latest definition from 0034_general_chat_reads.sql.
create or replace function mark_general_chat_read(upto uuid) returns timestamptz
  language plpgsql security invoker set search_path = public
  as $$
  declare
    msg_at timestamptz;
    result timestamptz;
  begin
    if auth.uid() is null then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    if not is_approved() then
      raise exception 'Your account is not approved.' using errcode = '42501', hint = 'sham:not_approved';
    end if;
    select created_at into msg_at from general_messages where id = upto;
    if msg_at is null then
      raise exception 'Message not found.' using errcode = 'P0002', hint = 'sham:message_not_found';
    end if;
    insert into general_chat_reads (user_id, last_read_at) values (auth.uid(), msg_at)
      on conflict (user_id) do update set last_read_at = excluded.last_read_at -- the trigger keeps the later
      returning last_read_at into result;
    return result;
  end $$;

-- profiles_before_delete: latest definition from 0040_delete_account.sql.
create or replace function profiles_before_delete() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    problem text := account_deletion_problem(old.id);
  begin
    if problem is not null then
      raise exception '%', problem using errcode = 'P0001', hint = case when problem like 'You own courses:%' then 'sham:delete_owns_courses' else 'sham:delete_teacher' end, detail = case when problem like 'You own courses:%' then json_build_object('titles', substring(problem from '^You own courses: (.*)\. Ask the teacher'))::text else '' end;
    end if;
    return old;
  end $$;

-- profiles_name_not_blank: latest definition from 0027_profile_name_unicode_blank.sql.
create or replace function profiles_name_not_blank() returns trigger
  language plpgsql set search_path = public
  as $$
  declare
    -- The characters JavaScript's String.prototype.trim() removes.
    spaces constant text := E' \t\n\v\f\r' || chr(160) || chr(5760)
      || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197)
      || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202)
      || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279);
  begin
    if new.full_name is distinct from old.full_name and btrim(coalesce(new.full_name, ''), spaces) = '' then
      raise exception 'Name can''t be blank.' using errcode = '23514', hint = 'sham:name_blank';
    end if;
    return new;
  end $$;

-- profiles_owner_stays_staff: latest definition from 0007_course_owner.sql.
create or replace function profiles_owner_stays_staff() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare n int;
  begin
    if new.role = 'student' and old.role is distinct from 'student' then
      select count(*) into n from courses where created_by = new.id;
      if n > 0 then
        raise exception '% owns % course(s). Reassign them first', new.full_name, n using errcode = '23514', hint = 'sham:owner_owns_courses', detail = json_build_object('name', new.full_name, 'count', n)::text;
      end if;
    end if;
    return new;
  end $$;

-- profiles_teacher_locked: latest definition from 0009_roles_screen.sql.
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
    if new.role = 'teacher' and exists (select 1 from profiles where role = 'teacher' and id <> new.id) then
      raise exception 'There is already a teacher; nobody else can become one' using errcode = '42501', hint = 'sham:teacher_exists';
    end if;
    return new;
  end $$;

-- remove_listener: latest definition from 0019_hidden_courses.sql.
create or replace function remove_listener(course uuid, member uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
declare
  removed boolean;
begin
  if my_role() is null or my_role() not in ('teacher', 'mentor') then
    raise exception 'Only a teacher or mentor can do this.' using errcode = '42501', hint = 'sham:staff_only';
  end if;
  -- ARU-40: someone who can't see a hidden course changes nothing in it (checked before any delete).
  if course_hidden_from_me(course) then
    return;
  end if;
  -- Membership first: if it is already gone (never a listener, or removed by someone else), stop here.
  delete from course_members m where m.course_id = course and m.user_id = member;
  removed := found;
  if not removed then
    return;
  end if;
  delete from homework h where h.course_id = course and h.student_id = member;
end $$;

-- set_access_status: latest definition from 0021_account_approval.sql.
create or replace function set_access_status(target uuid, new_status access_status) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    old_status access_status;
    target_role user_role;
  begin
    if auth.uid() is not null and not is_approved() then
      raise exception 'Your account is waiting for the teacher''s approval.' using errcode = '42501', hint = 'sham:waiting_approval';
    end if;
    if my_role() is distinct from 'teacher' then
      raise exception 'Only the teacher can accept or decline requests.' using errcode = '42501', hint = 'sham:only_teacher_requests_action';
    end if;
    if new_status is null or new_status not in ('approved', 'rejected') then
      raise exception 'A request can only be accepted or declined.' using errcode = '22023', hint = 'sham:request_accept_decline';
    end if;
    select access_status, role into old_status, target_role from profiles where id = target for update;
    if not found then
      raise exception 'User not found' using errcode = 'P0002', hint = 'sham:user_not_found';
    end if;
    if target_role = 'teacher' then
      raise exception 'The teacher''s access can''t be changed.' using errcode = '42501', hint = 'sham:teacher_access_locked';
    end if;
    if old_status = new_status then
      return; -- already done: safe retry
    end if;
    if new_status = 'rejected' and old_status = 'approved' then
      raise exception 'Only requests that are waiting can be declined.' using errcode = '23514', hint = 'sham:decline_only_waiting';
    end if;
    update profiles
      set access_status = new_status, access_changed_by = auth.uid(), access_changed_at = now()
      where id = target;
  end $$;

-- set_accountant: latest definition from 0032_accountant.sql.
create or replace function set_accountant(target uuid, on_off boolean) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    p profiles%rowtype;
  begin
    if my_role() is distinct from 'teacher' then
      raise exception 'Only the teacher can turn Accountant on or off.' using errcode = '42501', hint = 'sham:only_teacher_accountant';
    end if;
    if on_off is null then
      raise exception 'Choose on or off.' using errcode = '22023', hint = 'sham:choose_on_off';
    end if;
    select * into p from profiles where id = target for update;
    if not found then
      raise exception 'User not found' using errcode = 'P0002', hint = 'sham:user_not_found';
    end if;
    if p.access_status <> 'approved' then
      raise exception 'Accept % first.', p.full_name using errcode = '23514', hint = 'sham:accept_first', detail = json_build_object('name', p.full_name)::text;
    end if;
    if p.role <> 'mentor' then
      raise exception 'Only mentors can be accountants.' using errcode = '23514', hint = 'sham:accountant_mentor_only';
    end if;
    if p.is_accountant = on_off then
      return;
    end if;
    update profiles set is_accountant = on_off where id = target;
  end $$;

-- set_course_discipline: latest definition from 0033_teacher_sets_any_course_discipline.sql.
create or replace function set_course_discipline(course uuid, discipline uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    c courses%rowtype;
  begin
    select * into c from courses where id = course for update;
    -- course_hidden_from_me() is false for the teacher, so the teacher reaches hidden courses too.
    if not found or course_hidden_from_me(c.id) then
      raise exception 'Course not found.' using errcode = 'P0002', hint = 'sham:course_not_found';
    end if;
    if not is_approved() or (c.created_by is distinct from auth.uid() and my_role() is distinct from 'teacher') then
      raise exception 'Only the course owner can change its discipline.' using errcode = '42501', hint = 'sham:discipline_owner_only';
    end if;
    if discipline is not distinct from c.discipline_id then
      return; -- unchanged: always allowed, safe retry
    end if;
    -- The teacher sees hidden disciplines, so they can pick them; a mentor can't.
    if discipline is not null and not discipline_visible_to_me(discipline) then
      raise exception 'Discipline not found.' using errcode = 'P0002', hint = 'sham:discipline_not_found';
    end if;
    update courses set discipline_id = discipline where id = course;
  end $$;

-- set_meeting_homework_checked: latest definition from 0028_meeting_homework_checked.sql.
create or replace function set_meeting_homework_checked(meeting uuid, checked boolean) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
    caller_role user_role := my_role();
  begin
    select * into m from course_meetings where id = meeting for update;
    -- A meeting the caller can't see (unknown, or in a hidden course) gets the same answer as "not allowed".
    if not found or course_hidden_from_me(m.course_id) then
      raise exception 'You can''t mark homework checked on this meeting.' using errcode = '42501', hint = 'sham:homework_checked_not_allowed';
    end if;
    if not (
      coalesce(caller_role = 'teacher', false)
      or (coalesce(caller_role = 'mentor', false) and not is_member(m.course_id))
    ) then
      raise exception 'Only the teacher or a mentor who isn''t a listener of this course can mark homework checked.'
        using errcode = '42501', hint = 'sham:homework_checked_role';
    end if;
    if m.status <> 'completed' then
      raise exception 'Homework can be marked checked only on completed meetings.' using errcode = '23514', hint = 'sham:homework_checked_completed';
    end if;
    if checked then
      if m.homework_checked_at is not null then
        return; -- already checked: keep the first mark
      end if;
      update course_meetings set homework_checked_at = now(), homework_checked_by = auth.uid() where id = meeting;
    else
      update course_meetings set homework_checked_at = null, homework_checked_by = null where id = meeting;
    end if;
  end $$;

-- set_meeting_notes: latest definition from 0021_account_approval.sql.
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
      raise exception 'Meeting not found.' using errcode = 'P0002', hint = 'sham:meeting_not_found';
    end if;
    if not (owns_course(m.course_id) or coalesce(my_role() = 'teacher', false)) then
      raise exception 'Only the course owner or the teacher can edit notes.' using errcode = '42501', hint = 'sham:notes_role';
    end if;
    if m.status <> 'completed' then
      raise exception 'Notes can be added only to completed meetings.' using errcode = '23514', hint = 'sham:notes_completed';
    end if;
    if char_length(cleaned) > 10000 then
      raise exception 'Notes can be at most 10,000 characters.' using errcode = '22001', hint = 'sham:notes_too_long';
    end if;
    update course_meetings set
      notes = cleaned,
      notes_updated_by = auth.uid(),
      notes_updated_at = now()
    where id = meeting;
  end $$;

-- set_meeting_status: latest definition from 0021_account_approval.sql.
create or replace function set_meeting_status(meeting uuid, new_status meeting_status) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
  begin
    select * into m from course_meetings where id = meeting for update;
    if not found or course_hidden_from_me(m.course_id) then
      raise exception 'Meeting not found.' using errcode = 'P0002', hint = 'sham:meeting_not_found';
    end if;
    if not (owns_course(m.course_id) or coalesce(my_role() = 'teacher', false)) then
      raise exception 'Only the course owner or the teacher can change a meeting''s status.' using errcode = '42501', hint = 'sham:meeting_status_role';
    end if;
    if new_status = m.status and new_status <> 'scheduled' then
      return; -- already done: safe retry
    end if;
    if m.status <> 'scheduled' then
      raise exception 'This meeting is already %; its status can''t change.', m.status using errcode = '23514', hint = 'sham:meeting_already_status', detail = json_build_object('status', m.status)::text;
    end if;
    if new_status = 'scheduled' then
      raise exception 'A meeting can only be marked completed or canceled.' using errcode = '22023', hint = 'sham:meeting_status_values';
    end if;
    if new_status = 'completed' and m.starts_at > now() then
      raise exception 'A meeting can be marked completed only after it has started.' using errcode = '23514', hint = 'sham:complete_before_start';
    end if;
    update course_meetings
      set status = new_status, status_changed_by = auth.uid(), status_changed_at = now()
      where id = meeting;
  end $$;

-- set_telegram_notification: latest definition from 0048_new_material_notifications.sql.
create or replace function set_telegram_notification(kind text, enabled boolean) returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    if auth.uid() is null then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    if enabled is null then
      raise exception 'Choose on or off.' using errcode = '22023', hint = 'sham:choose_on_off';
    end if;
    case kind
      when 'meeting_started' then
        update telegram_links set notify_meeting_started = enabled where user_id = auth.uid();
      when 'new_homework' then
        update telegram_links set notify_new_homework = enabled where user_id = auth.uid();
      when 'homework_reviewed' then
        update telegram_links set notify_homework_reviewed = enabled where user_id = auth.uid();
      when 'chat_message' then
        update telegram_links set notify_chat_message = enabled where user_id = auth.uid();
      when 'new_account' then
        update telegram_links set notify_new_account = enabled where user_id = auth.uid();
      when 'homework_submitted' then
        update telegram_links set notify_homework_submitted = enabled where user_id = auth.uid();
      when 'general_chat' then
        update telegram_links set notify_general_chat = enabled where user_id = auth.uid();
      when 'new_material' then
        update telegram_links set notify_new_material = enabled where user_id = auth.uid();
      else
        raise exception 'Unknown notification type: %', kind using errcode = '22023';
    end case;
  end $$;

-- set_user_role: latest definition from 0032_accountant.sql.
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
      raise exception 'Only the teacher can change roles' using errcode = '42501', hint = 'sham:only_teacher_roles';
    end if;
    if new_role is null or new_role not in ('student', 'mentor') then
      raise exception 'Users can only be switched between student and mentor' using errcode = '42501', hint = 'sham:roles_student_mentor';
    end if;

    -- Lock the target's profile before counting their courses. ARU-9's change_course_owner() locks the new
    -- owner's profile row too, so the two serialize and can never leave a student owning a course.
    select role, full_name, access_status into old_role, target_name, old_access from profiles where id = target for update;
    if not found then
      raise exception 'User not found' using errcode = 'P0002', hint = 'sham:user_not_found';
    end if;
    if old_access <> 'approved' then
      raise exception 'Accept % first.', target_name using errcode = '23514', hint = 'sham:accept_first', detail = json_build_object('name', target_name)::text;
    end if;
    if old_role not in ('student', 'mentor') then
      raise exception 'The teacher''s role can''t be changed' using errcode = '42501', hint = 'sham:teacher_role_locked';
    end if;
    if old_role = new_role then
      return; -- already done (safe retry)
    end if;

    if new_role = 'student' then
      select count(*), string_agg(title, ', ' order by title) into owned, titles
      from courses where created_by = target;
      if owned > 0 then
        raise exception '% owns % course(s): %. Reassign them first', target_name, owned, titles
          using errcode = '23514', hint = 'sham:owner_owns_courses_titles', detail = json_build_object('name', target_name, 'count', owned, 'titles', titles)::text;
      end if;
    end if;

    update profiles
      set role = new_role, is_accountant = case when new_role = 'mentor' then is_accountant else false end
      where id = target;
  end $$;

-- unmark_attendance: latest definition from 0022_attendance_from_start.sql.
create or replace function unmark_attendance(meeting uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
  begin
    select * into m from course_meetings where id = meeting;
    if not found or course_hidden_from_me(m.course_id) then
      raise exception 'Meeting not found.' using errcode = 'P0002', hint = 'sham:meeting_not_found';
    end if;
    if not is_member(m.course_id) then
      raise exception 'Only listeners of this course can mark attendance.' using errcode = '42501', hint = 'sham:attendance_listeners_only';
    end if;
    if m.status = 'canceled' then
      raise exception 'Attendance can''t be changed for a canceled meeting.' using errcode = '23514', hint = 'sham:attendance_canceled';
    end if;
    -- A meeting rescheduled into the future closes attendance again until its new start.
    if m.starts_at > now() then
      raise exception 'Attendance can be marked once the meeting has started.' using errcode = '23514', hint = 'sham:attendance_not_started';
    end if;
    delete from meeting_attendance where meeting_id = meeting and user_id = auth.uid();
  end $$;

-- update_meeting: latest definition from 0035_meeting_start_notifications.sql.
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
      raise exception 'Meeting not found.' using errcode = 'P0002', hint = 'sham:meeting_not_found';
    end if;
    if not (owns_course(m.course_id) or coalesce(my_role() = 'teacher', false)) then
      raise exception 'Only the course owner or the teacher can edit a meeting.' using errcode = '42501', hint = 'sham:edit_meeting_role';
    end if;
    if m.status <> 'scheduled' then
      raise exception 'This meeting is already %; it can''t be edited.', m.status using errcode = '23514', hint = 'sham:meeting_already_edit', detail = json_build_object('status', m.status)::text;
    end if;
    if new_starts_at is null then
      raise exception 'Pick a date and start time.' using errcode = '22023', hint = 'sham:pick_date';
    end if;
    moved := new_starts_at is distinct from m.starts_at;
    if moved and new_starts_at <= now() then
      raise exception 'Pick a time in the future.' using errcode = '23514', hint = 'sham:pick_future';
    end if;
    update course_meetings set
      starts_at = new_starts_at,
      topic = coalesce(nullif(trim(new_topic), ''), 'Meeting'),
      location = nullif(trim(new_location), ''),
      rescheduled_at = case when moved then now() else m.rescheduled_at end,
      start_notified_at = case when moved then null else m.start_notified_at end
    where id = meeting;
  end $$;
