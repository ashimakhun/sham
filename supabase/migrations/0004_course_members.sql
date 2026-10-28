-- Course listeners (ARU-7): teachers and mentors add students and mentors to courses and remove them.
-- Run after 0003_courses.sql. Who sees and checks homework is unchanged here (still profiles.mentor_id);
-- that moves to course ownership in ARU-14.

create table course_members (
  course_id uuid not null references courses (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  added_by uuid not null references profiles (id),
  added_at timestamptz not null default now(),
  primary key (course_id, user_id)
);

create index course_members_user_idx on course_members (user_id);

alter table course_members enable row level security;

-- True when the signed-in user is a listener of the course. Security definer so policies on
-- course_members can use it without querying their own table (that would recurse).
create function is_member(course uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from course_members where course_id = course and user_id = auth.uid()) $$;

-- Students see listeners only of courses they are in; mentors and the teacher see all.
create policy "course members readable" on course_members for select to authenticated using (
  user_id = auth.uid() or is_member(course_id) or my_role() in ('teacher', 'mentor')
);

-- Teachers and mentors add students or mentors, never the teacher or the course's own owner.
-- Unknown users are rejected by the foreign key; duplicates by the primary key.
create policy "teachers and mentors add listeners" on course_members for insert to authenticated with check (
  added_by = auth.uid()
  and my_role() in ('teacher', 'mentor')
  and exists (select 1 from profiles p where p.id = user_id and p.role in ('student', 'mentor'))
  and not exists (select 1 from courses c where c.id = course_id and c.created_by = user_id)
);

-- No delete policy on purpose: removal goes only through remove_listener(), so a listener can never
-- be removed while their homework for the course stays behind.

-- The listener's homework in a course (with photo paths), for the confirmation count and for deleting
-- photos through the Storage API before remove_listener(). The caller may not be able to read this
-- homework under the homework policies (e.g. a mentor who is not the student's mentor).
create function listener_homework_photos(course uuid, member uuid)
  returns table (id uuid, photo_path text)
  language plpgsql stable security definer set search_path = public
  as $$
  begin
    if my_role() is null or my_role() not in ('teacher', 'mentor') then
      raise exception 'Only a teacher or mentor can do this.' using errcode = '42501';
    end if;
    return query select h.id, h.photo_path from homework h where h.course_id = course and h.student_id = member;
  end $$;

-- Removes a listener and all their homework for that course in one transaction.
-- Removing someone who is not a listener does nothing (safe to retry).
create function remove_listener(course uuid, member uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    if my_role() is null or my_role() not in ('teacher', 'mentor') then
      raise exception 'Only a teacher or mentor can do this.' using errcode = '42501';
    end if;
    delete from homework where course_id = course and student_id = member;
    delete from course_members where course_id = course and user_id = member;
  end $$;

-- True when the storage object is the photo of homework submitted for a course by a current listener
-- of that course, i.e. a photo remove_listener() is about to orphan.
create function is_listener_homework_photo(object_name text) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select exists (
      select 1 from homework h
      join course_members m on m.course_id = h.course_id and m.user_id = h.student_id
      where h.photo_path = object_name
    )
  $$;

revoke execute on function is_member(uuid) from public, anon;
revoke execute on function listener_homework_photos(uuid, uuid) from public, anon;
revoke execute on function remove_listener(uuid, uuid) from public, anon;
revoke execute on function is_listener_homework_photo(text) from public, anon;
grant execute on function is_member(uuid) to authenticated;
grant execute on function listener_homework_photos(uuid, uuid) to authenticated;
grant execute on function remove_listener(uuid, uuid) to authenticated;
grant execute on function is_listener_homework_photo(text) to authenticated;

-- Teachers and mentors delete listeners' course homework photos when removing a listener. Storage
-- deletes also need SELECT on the object, so both are granted, limited to those photos. Intentionally
-- no narrower than that: any teacher or mentor may remove any listener and their homework anyway.
create policy "teachers and mentors read listener homework photos" on storage.objects for select to authenticated
  using (bucket_id = 'homework' and my_role() in ('teacher', 'mentor') and is_listener_homework_photo(name));
create policy "teachers and mentors delete listener homework photos" on storage.objects for delete to authenticated
  using (bucket_id = 'homework' and my_role() in ('teacher', 'mentor') and is_listener_homework_photo(name));

-- Live updates for the Listeners section and Profile tab.
alter publication supabase_realtime add table course_members;
