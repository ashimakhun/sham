-- ARU-191: a homework has up to 10 photos instead of one. Numbered 0081 (0080 is ARU-189's).
--
--   1. homework_files (homework_id, path, position, kind 'photo', workspace_id): the homework's photos in the order
--      picked. ARU-192 (a PDF as homework) widens `kind` later. Existing photo_path values are copied in as position 1
--      (AC 8). Readable exactly when its homework row is (the homework policies, hidden courses included) and only in
--      my workspace (restrictive policy + zz_workspace_guard, as every table in 0059).
--   2. Writes (AC 5, AC 11, AC 12): app users can't update or delete rows, so nothing changes after sending; only the
--      security definer clean-ups below (and cascades from homework) can. They add rows only through
--      submit_homework(), which saves the homework and all its photos in one transaction: the "homework submitted"
--      notification (0045) fires on the homework insert and listeners can't delete homework, so a send that fails
--      half-way must leave nothing. submit_homework() is security invoker: the homework insert goes through the
--      unchanged homework policies. Each path must be in the sender's `<uid>/<homework id>/` folder. At most 10
--      photos per homework (sham:homework_too_many_photos; also unique (homework_id, position) with position 1..10).
--   3. homework.photo_path stays while older app builds are in use. A trigger copies a photo_path set on insert into
--      the list (an older build's one photo counts toward the 10) and follows later changes of it (admin fixes, the
--      deletion job). New homework fills photo_path with its first photo, so an older build still shows that one. New
--      code reads only the list. Dropping the column is a later story.
--   4. Every reader of photo_path reads the list instead, with the same access: the storage read policy (0005), the
--      hidden-course storage helper (0019), the leftover-photo helper (0049), the listener-removal helpers (0004,
--      0008), the course / discipline clean-up (0041, 0042), the ZIP (0050) and the deletion job (0054). Account and
--      workspace deletion (0040, 0078) find files by their first folder, so `<uid>/<homework id>/<n>.jpg` is covered.
--   5. The deletion job (AC 9): due_homework_photos() lists photos (the batch limit counts photos);
--      mark_homework_photos_removed() drops the rows of the deleted files and sets photo_removed_at only on homework
--      with no photo left, so a homework whose deletes partly failed is finished the next day.
--   6. ZIP (AC 10): homework_photos_for_zip() returns one row per photo with its position and the homework's photo
--      count; photo_zip_links remembers the exact photos of a link (a homework's photos may be split over two parts).
-- No new Edge Function or cron job. The photo-deletion and homework-photos-zip functions change (redeploy them).

-- 1. The list. ---------------------------------------------------------------------------------------------------------
create table homework_files (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references homework (id) on delete cascade,
  path text not null unique,
  position smallint not null check (position between 1 and 10),
  kind text not null default 'photo' check (kind in ('photo')),
  created_at timestamptz not null default now(),
  workspace_id uuid not null default default_workspace() references workspaces (id),
  unique (homework_id, position)
);
create index homework_files_workspace_idx on homework_files (workspace_id);

-- AC 8: existing photos, position 1 (before the triggers below; one row per path, the oldest homework keeps it).
insert into homework_files (homework_id, path, position, workspace_id)
  select distinct on (h.photo_path) h.id, h.photo_path, 1, h.workspace_id
  from homework h
  where h.photo_path is not null
  order by h.photo_path, h.created_at, h.id;

alter table homework_files enable row level security;
revoke all on homework_files from anon, authenticated;
grant select on homework_files to authenticated;
grant insert (homework_id, path, position) on homework_files to authenticated;

-- AC 11: readable exactly when the homework row is (goes through the homework policies, hidden courses included).
create policy "homework photos readable with their homework" on homework_files for select to authenticated
  using (exists (select 1 from homework h where h.id = homework_id));

-- Only inside submit_homework() (transaction-local flag, as sham.rejoining in 0079), for the homework being sent in
-- this same transaction (created_at is the transaction's now()), by its sender, in the sender's folder for it.
create policy "senders add photos while sending their homework" on homework_files for insert to authenticated
  with check (
    coalesce(current_setting('sham.submitting_homework', true), '') = homework_id::text
    and path like auth.uid()::text || '/' || homework_id::text || '/%'
    and exists (
      select 1 from homework h
      where h.id = homework_id and h.student_id = auth.uid() and h.status = 'submitted' and h.created_at = now()
    )
  );

create policy "workspace: only my workspace" on homework_files as restrictive for select to authenticated
  using (workspace_id = (select my_workspace()));
create trigger zz_workspace_guard before insert or update or delete on homework_files
  for each row execute function workspace_guard('homework_id');

-- Every reader below goes through this view: the list, plus a photo_path that has no row (a homework written with
-- triggers off, e.g. an admin import in replica mode). Normally photo_path is always in the list. Security invoker, so
-- an app user sees only the photos of homework they can read (the policies of both tables apply).
create view homework_photo_paths with (security_invoker = true) as
  select f.homework_id, f.path, f.position::integer as position
  from homework_files f
  union all
  select h.id, h.photo_path, 1
  from homework h
  where h.photo_path is not null and not exists (select 1 from homework_files f where f.homework_id = h.id);
revoke all on homework_photo_paths from anon, authenticated;
grant select on homework_photo_paths to authenticated;

-- AC 12: the 11th photo is refused with a readable message (the position check is the backstop).
create function homework_files_limit() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  begin
    -- One add at a time per homework, so two parallel adds can't both see 9.
    perform 1 from homework where id = new.homework_id for update;
    if (select count(*) from homework_files where homework_id = new.homework_id) >= 10 then
      raise exception 'You can attach up to 10 photos.' using errcode = '23514', hint = 'sham:homework_too_many_photos';
    end if;
    return new;
  end $$;
revoke execute on function homework_files_limit() from public, anon, authenticated;
create trigger homework_files_limit before insert on homework_files
  for each row execute function homework_files_limit();

-- 3. photo_path → the list: on insert (an older build's one photo; a new build's first photo) and on later changes.
create function homework_photo_path_to_files() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    app boolean := coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon');
  begin
    if tg_op = 'INSERT' then
      if new.photo_path is null then
        return null;
      end if;
      -- Note 2: an app user may only point at a file in their own folder (closes the gap of the single photo_path).
      if app and (storage.foldername(new.photo_path))[1] is distinct from new.student_id::text then
        raise exception 'A homework photo must be in your own folder.' using errcode = '42501',
          hint = 'sham:homework_photo_not_yours';
      end if;
      insert into homework_files (homework_id, path, position) values (new.id, new.photo_path, 1);
      return null;
    end if;
    if old.photo_path is not distinct from new.photo_path then
      return null;
    end if;
    if new.photo_path is null then
      delete from homework_files where homework_id = new.id and path = old.photo_path;
    elsif old.photo_path is not null
      and exists (select 1 from homework_files where homework_id = new.id and path = old.photo_path) then
      update homework_files set path = new.photo_path where homework_id = new.id and path = old.photo_path;
    else
      insert into homework_files (homework_id, path, position)
        values (new.id, new.photo_path,
                coalesce((select max(position) from homework_files where homework_id = new.id), 0) + 1);
    end if;
    return null;
  end $$;
revoke execute on function homework_photo_path_to_files() from public, anon, authenticated;
create trigger homework_photo_path_to_files after insert or update of photo_path on homework
  for each row execute function homework_photo_path_to_files();

-- 2. Send a homework with its photos in one transaction (AC 4, AC 5). Security invoker: the homework insert is checked
-- by the homework policies exactly as a direct insert. A duplicate id or a second homework for the assignment fails
-- with 23505, as before.
create function submit_homework(
  homework_id uuid,
  course_id uuid,
  assignment_id uuid,
  title text,
  description text,
  photo_paths text[] default '{}'
) returns void
  language plpgsql security invoker set search_path = public
  as $$
  declare
    me text := auth.uid()::text;
    paths text[] := coalesce(submit_homework.photo_paths, '{}');
  begin
    if cardinality(paths) > 10 then
      raise exception 'You can attach up to 10 photos.' using errcode = '23514', hint = 'sham:homework_too_many_photos';
    end if;
    if exists (select 1 from unnest(paths) p where p is null or p not like me || '/' || submit_homework.homework_id::text || '/%') then
      raise exception 'A homework photo must be in your own folder.' using errcode = '42501',
        hint = 'sham:homework_photo_not_yours';
    end if;
    -- Position 1 is copied from photo_path by homework_photo_path_to_files().
    insert into homework (id, student_id, course_id, assignment_id, title, description, photo_path)
      values (submit_homework.homework_id, auth.uid(), submit_homework.course_id, submit_homework.assignment_id,
              submit_homework.title, coalesce(submit_homework.description, ''), paths[1]);
    perform set_config('sham.submitting_homework', submit_homework.homework_id::text, true);
    insert into homework_files (homework_id, path, position)
      select submit_homework.homework_id, p.path, p.n
      from unnest(paths) with ordinality as p (path, n)
      where p.n > 1;
    perform set_config('sham.submitting_homework', '', true);
  end $$;
revoke execute on function submit_homework(uuid, uuid, uuid, text, text, text[]) from public, anon;
grant execute on function submit_homework(uuid, uuid, uuid, text, text, text[]) to authenticated;

-- 4. Readers. ----------------------------------------------------------------------------------------------------------
-- 0005: photos readable when the homework row is (through homework_photo_paths, which goes through the homework row).
drop policy "homework photos readable with their homework" on storage.objects;
create policy "homework photos readable with their homework" on storage.objects for select to authenticated using (
  bucket_id = 'homework'
  and exists (
    select 1 from homework_photo_paths f
    join homework h on h.id = f.homework_id
    where f.path = storage.objects.name
      and (h.student_id = auth.uid() or my_role() in ('teacher', 'mentor'))
  )
);

-- 0019 (restrictive storage policies).
create or replace function homework_photo_hidden_from_me(object_name text) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select exists (
      select 1 from homework_photo_paths f
      join homework h on h.id = f.homework_id
      where f.path = object_name and course_hidden_from_me(h.course_id)
    )
  $$;

-- 0049 (a sender's leftover photos).
create or replace function homework_photo_in_use(object_name text) returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from homework_photo_paths f where f.path = object_name) $$;

-- 0004 (teachers and mentors read / delete a current listener's homework photos).
create or replace function is_listener_homework_photo(object_name text) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select exists (
      select 1 from homework_photo_paths f
      join homework h on h.id = f.homework_id
      join course_members m on m.course_id = h.course_id and m.user_id = h.student_id
      where f.path = object_name
    )
  $$;

-- 0008 / 0053: one row per photo (a homework without photos: one row with a null path), as before for one photo.
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
      select h.id, f.path
      from homework h
      left join homework_photo_paths f on f.homework_id = h.id
      where h.course_id = course
        and h.student_id = member
        and exists (select 1 from course_members m where m.course_id = course and m.user_id = member)
      order by h.created_at, h.id, f.position;
  end $$;

-- 0041 / 0053 / 0059 (discipline_homework_photos() reads this one).
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
      select distinct f.path
      from homework h
      join homework_photo_paths f on f.homework_id = h.id
      where (h.course_id = course
             or h.assignment_id in (select a.id from homework_assignments a where a.course_id = course))
        and exists (select 1 from storage.objects o where o.bucket_id = 'homework' and o.name = f.path);
  end $$;

-- 5. The deletion job (0054). ------------------------------------------------------------------------------------------
create or replace function leftover_homework_photos(max_files integer) returns table (name text)
  language sql stable security definer set search_path = public
  as $$
    select o.name
    from storage.objects o
    where o.bucket_id = 'homework'
      and o.created_at < now() - interval '24 hours'
      and not exists (select 1 from homework_photo_paths f where f.path = o.name)
    order by o.created_at, o.name
    limit max_files
  $$;

-- One row per photo (max_photos counts photos), most overdue first, a homework's photos in order.
create or replace function due_homework_photos(max_photos integer) returns table (homework_id uuid, photo_path text)
  language sql stable security definer set search_path = public
  as $$
    select f.homework_id, f.path
    from homework_photo_paths f
    join homework h on h.id = f.homework_id
    where photo_deletion_date(h.checked_at) <= (now() at time zone 'utc')::date
    order by photo_deletion_date(h.checked_at), h.checked_at, h.id, f.position
    limit max_photos
  $$;

-- After the files were deleted from Storage (or were already missing): drops their rows, then clears photo_path and
-- stores the removal time on each of those homework that has no photo left. Only rows that still point at a deleted
-- file change. Returns how many photos were marked.
create or replace function mark_homework_photos_removed(homework_ids uuid[], photo_paths text[]) returns integer
  language plpgsql volatile security definer set search_path = public
  as $$
  declare
    n integer;
    legacy integer;
    done uuid[];
    only_path uuid[];
  begin
    -- A photo_path with no list row at all (see homework_photo_paths): marked by its photo_path, as before.
    select coalesce(array_agg(h.id), '{}') into only_path
    from homework h
    join unnest(homework_ids, photo_paths) as d (id, path) on h.id = d.id and h.photo_path = d.path
    where not exists (select 1 from homework_files f where f.homework_id = h.id);
    with gone as (
      delete from homework_files f
      using unnest(homework_ids, photo_paths) as d (id, path)
      where f.homework_id = d.id and f.path = d.path
      returning f.homework_id
    )
    select count(*), coalesce(array_agg(distinct homework_id), '{}') into n, done from gone;
    -- Only homework with no photo left (a part that failed stays for the next run).
    update homework h set photo_path = null, photo_removed_at = now()
    where (h.id = any (done) or h.id = any (only_path))
      and not exists (select 1 from homework_files f where f.homework_id = h.id);
    legacy := cardinality(only_path);
    return n + legacy;
  end $$;

-- 0054 / 0072: no longer called (the warnings are phone reminders), kept correct: counts photos.
create or replace function claim_photo_deletion_warnings()
  returns table (user_id uuid, photo_count integer, earliest date)
  language sql volatile security definer set search_path = public
  as $$
    with today as (select (now() at time zone 'utc')::date as d),
    candidates as (
      select h.id, h.student_id, photo_deletion_date(h.checked_at) as del
      from homework h
      where h.checked_at is not null and exists (select 1 from homework_photo_paths f where f.homework_id = h.id)
    ),
    reached as (
      select c.id, c.student_id, c.del, m.mark
      from candidates c, today, (values (30::smallint), (7::smallint)) as m (mark)
      where c.del is not null and c.del > today.d and c.del - today.d <= m.mark
    ),
    inserted as (
      insert into photo_deletion_warnings (homework_id, mark, user_id, deletion_date)
      select id, mark, student_id, del from reached
      on conflict (homework_id, mark) do nothing
      returning homework_id, user_id, deletion_date
    ),
    per_homework as (select distinct i.homework_id, i.user_id, i.deletion_date from inserted i)
    select u.user_id,
           sum((select count(*) from homework_photo_paths f where f.homework_id = u.homework_id))::integer,
           min(u.deletion_date)
    from per_homework u
    join profiles p on p.id = u.user_id and p.access_status = 'approved' and p.role in ('student', 'mentor')
    group by u.user_id
  $$;

-- 6. ZIP (0050). -------------------------------------------------------------------------------------------------------
alter table photo_zip_links add column photo_paths text[];

drop function homework_photos_for_zip(uuid);
create function homework_photos_for_zip(target uuid)
  returns table (
    homework_id uuid,
    photo_path text,
    course_id uuid,
    course_title text,
    homework_title text,
    assignment_title text,
    sent_at timestamptz,
    "position" integer,
    photo_count integer
  )
  language sql stable security definer set search_path = public
  as $$
    select h.id, f.path, h.course_id, c.title, h.title, a.title, h.created_at, f.position::integer,
           (select count(*)::integer from homework_photo_paths f2 where f2.homework_id = h.id)
    from homework h
    join homework_photo_paths f on f.homework_id = h.id
    join profiles p on p.id = target and p.access_status = 'approved'
    join courses c on c.id = h.course_id
    left join homework_assignments a on a.id = h.assignment_id
    where h.student_id = target
      and exists (select 1 from storage.objects o where o.bucket_id = 'homework' and o.name = f.path)
      and (
        not coalesce(c.hidden, false)
        or c.created_by = target
        or p.role = 'teacher'
        or exists (select 1 from course_members m where m.course_id = c.id and m.user_id = target)
      )
    order by h.created_at, h.id, f.position
  $$;

drop function claim_photo_zip_link(text);
create function claim_photo_zip_link(hash text) returns table (user_id uuid, homework_ids uuid[], photo_paths text[])
  language sql volatile security definer set search_path = public
  as $$
    update photo_zip_links l set used_at = now()
    where l.token_hash = hash and l.used_at is null and l.expires_at > now()
    returning l.user_id, l.homework_ids, l.photo_paths
  $$;

revoke execute on function homework_photos_for_zip(uuid) from public, anon, authenticated;
revoke execute on function claim_photo_zip_link(text) from public, anon, authenticated;
grant execute on function homework_photos_for_zip(uuid) to service_role;
grant execute on function claim_photo_zip_link(text) to service_role;
