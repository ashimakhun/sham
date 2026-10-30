-- ARU-36: a signed-out caller assigning homework got the meeting's state ("already has homework", "only completed
-- meetings", "not found") instead of the permission error, because my_role() is null for them and the permission
-- check in homework_assignments_before_insert() (0014) evaluated to null. Run after 0014_homework_assignments.sql.
-- Replaces that trigger function only (same body, plus the null check); 0014 is not edited, nothing is deleted.

create or replace function homework_assignments_before_insert() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    m course_meetings%rowtype;
  begin
    -- A caller without a profile (signed out) has my_role() = null; without the null check the condition would be
    -- null, the raise skipped, and the meeting's state revealed by the next check (ARU-36).
    if my_role() is null or not (owns_course(new.course_id) or my_role() = 'teacher') then
      raise exception 'Only the course owner or the teacher can assign homework.' using errcode = '42501';
    end if;
    select * into m from course_meetings where id = new.meeting_id;
    if not found or m.course_id <> new.course_id then
      raise exception 'Meeting not found.' using errcode = 'P0002';
    end if;
    if m.status <> 'completed' then
      raise exception 'Homework can be assigned only to completed meetings.' using errcode = '23514';
    end if;
    if exists (select 1 from homework_assignments a where a.meeting_id = new.meeting_id and a.id <> new.id) then
      raise exception 'This meeting already has homework.' using errcode = '23505';
    end if;
    if new.due_at is not null and new.due_at <= now() then
      raise exception 'The deadline must be in the future.' using errcode = '23514';
    end if;
    new.title := btrim(new.title);
    new.description := btrim(coalesce(new.description, ''));
    if char_length(new.title) = 0 then
      raise exception 'Enter a title.' using errcode = '23514';
    end if;
    if char_length(new.title) > 200 then
      raise exception 'The title can be at most 200 characters.' using errcode = '23514';
    end if;
    new.created_at := now();
    return new;
  end $$;
