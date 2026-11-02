-- ARU-63: disciplines. The teacher creates disciplines and can hide them; a course's current owner puts the course
-- into one (or none). Adds a table, a course column and two functions; deletes nothing. Existing courses get no
-- discipline, so they all show under "No discipline" on release.
-- Numbered 0031: 0028 is ARU-60's and 0029-0030 are ARU-61/ARU-67's (open PR); this file doesn't depend on them.
-- Read access to courses doesn't change (0019/0021); only what the app's Courses list shows does.

create table disciplines (
  id uuid primary key default gen_random_uuid(),
  -- Stored trimmed (trigger below); 1-100 characters after trimming.
  name text not null check (char_length(name) between 1 and 100 and name = btrim(name)),
  hidden boolean not null default false,
  created_by uuid not null default auth.uid() references profiles (id),
  created_at timestamptz not null default now()
);

-- One discipline per name, ignoring case and surrounding spaces. A retry of a create that went through hits this.
create unique index disciplines_name_key on disciplines (lower(btrim(name)));

-- Trim the name before the checks run, so "  Math " is stored as "Math" (and "   " fails the length check).
create function disciplines_trim_name() returns trigger
  language plpgsql set search_path = public
  as $$
  begin
    new.name := btrim(new.name);
    return new;
  end $$;
create trigger disciplines_trim_name before insert on disciplines
  for each row execute function disciplines_trim_name();
revoke execute on function disciplines_trim_name() from public, anon, authenticated;

alter table disciplines enable row level security;

-- Approved accounts read disciplines; hidden ones only the teacher (my_role() is null for unapproved accounts).
create policy "disciplines readable by approved users" on disciplines for select to authenticated
  using (is_approved());
create policy "hidden disciplines: teacher only" on disciplines as restrictive for select to authenticated
  using (not hidden or coalesce(my_role() = 'teacher', false));
-- Only the teacher creates, and only as themselves.
create policy "teacher creates disciplines" on disciplines for insert to authenticated
  with check (coalesce(my_role() = 'teacher', false) and created_by = auth.uid());
-- Only the teacher hides / unhides; the name can't change (renaming is out of scope). No delete policy.
create policy "teacher hides disciplines" on disciplines for update to authenticated
  using (coalesce(my_role() = 'teacher', false))
  with check (coalesce(my_role() = 'teacher', false));
revoke insert, update on disciplines from anon, authenticated;
grant insert (id, name, hidden) on disciplines to authenticated;
grant update (hidden) on disciplines to authenticated;

-- True when the caller can see the discipline (it exists, and is visible or they're the teacher). Security definer,
-- so course policies can use it without the discipline's own policies.
create function discipline_visible_to_me(discipline uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select is_approved() and exists (
      select 1 from disciplines d where d.id = discipline and (not d.hidden or my_role() = 'teacher')
    )
  $$;
revoke execute on function discipline_visible_to_me(uuid) from public, anon;
grant execute on function discipline_visible_to_me(uuid) to authenticated;

alter table courses add column discipline_id uuid references disciplines (id);

-- A new course may name only a discipline its creator can see. Required: foreign keys skip RLS, so without it a
-- mentor could create a course pointing at a hidden discipline.
create policy "courses: only visible disciplines" on courses as restrictive for insert to authenticated
  with check (discipline_id is null or discipline_visible_to_me(discipline_id));

-- The current owner sets, changes or clears the discipline. Courses have no update policy, so this is the only way.
-- The target may be null, a discipline the caller can see, or the course's current value (so an owner whose
-- discipline was hidden later can save it unchanged).
create function set_course_discipline(course uuid, discipline uuid) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    c courses%rowtype;
  begin
    select * into c from courses where id = course for update;
    if not found or course_hidden_from_me(c.id) then
      raise exception 'Course not found.' using errcode = 'P0002';
    end if;
    if not is_approved() or c.created_by is distinct from auth.uid() then
      raise exception 'Only the course owner can change its discipline.' using errcode = '42501';
    end if;
    if discipline is not distinct from c.discipline_id then
      return; -- unchanged: always allowed, safe retry
    end if;
    if discipline is not null and not discipline_visible_to_me(discipline) then
      raise exception 'Discipline not found.' using errcode = 'P0002';
    end if;
    update courses set discipline_id = discipline where id = course;
  end $$;
revoke execute on function set_course_discipline(uuid, uuid) from public, anon;
grant execute on function set_course_discipline(uuid, uuid) to authenticated;

-- Live: a new or unhidden discipline reaches everyone; hiding reaches only the teacher (RLS applies to realtime,
-- ARU-63 AC 12). Course changes already arrive through courses (0003).
alter publication supabase_realtime add table disciplines;
