-- ARU-75: a student or mentor (also a waiting or declined account) deletes their own account.
--
-- The deletion itself is done by the Edge Function `delete-account` (service role): it checks the password, asks
-- account_deletion_problem() whether the caller may be deleted (not the teacher, owns no course), removes the caller's
-- Storage files (account_storage_objects()), then deletes the Auth user. Deleting auth.users cascades to profiles,
-- and from there, in the same transaction, to everything personal (homework, memberships, attendance, feedback,
-- likes, Blog posts, Knowledge base PDFs, chat read positions, Telegram link): those foreign keys already cascade.
--
-- This migration:
--   1. turns every other reference to profiles into "on delete set null" (and nullable), so shared content stays
--      with no one as its author / actor (the app shows "Deleted account"): chat messages, checked homework,
--      meetings, notes, assignments, listener additions, paid-course selections, disciplines, profiles.mentor_id.
--      courses.created_by keeps blocking: a course owner can't be deleted (AC 6).
--      If 0039_accountant_payments.sql (ARU-66) is applied, its references are handled too: a listener's payment
--      marks and exemptions are deleted with them; the accountant who made them becomes null.
--   2. a before-delete trigger on profiles that refuses the teacher and course owners (the database's own check);
--   3. account_deletion_problem() and account_storage_objects() for the Edge Function (service role only);
--   4. null-safe comparisons in the unread counters and the notification recipient functions (0016, 0034, 0036, 0038).
-- Existing rows are not changed. No policy is added or relaxed: every insert policy still requires the author / actor
-- to be auth.uid(), so clients can never write a null reference.

-- 1. References that must not block the deletion -------------------------------------------------------------------
do $$
declare
  ref record;
  con text;
begin
  for ref in
    select * from (values
      ('profiles', 'mentor_id', 'set null'),
      ('homework', 'checked_by', 'set null'),
      ('course_members', 'added_by', 'set null'),
      ('course_messages', 'author_id', 'set null'),
      ('general_messages', 'author_id', 'set null'),
      ('course_meetings', 'created_by', 'set null'),
      ('course_meetings', 'status_changed_by', 'set null'),
      ('course_meetings', 'notes_updated_by', 'set null'),
      ('homework_assignments', 'created_by', 'set null'),
      ('course_billing', 'selected_by', 'set null'),
      ('disciplines', 'created_by', 'set null'),
      -- ARU-66 (0039), only where it exists.
      ('course_payments', 'user_id', 'cascade'),
      ('course_payments', 'marked_by', 'set null'),
      ('course_payment_exemptions', 'user_id', 'cascade'),
      ('course_payment_exemptions', 'set_by', 'set null')
    ) as v (tbl, col, action)
  loop
    continue when to_regclass('public.' || ref.tbl) is null;
    continue when not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = ref.tbl and column_name = ref.col
    );
    -- The existing single-column foreign key to profiles on this column (whatever its name).
    for con in
      select c.conname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f'
        and c.conrelid = ('public.' || ref.tbl)::regclass
        and c.confrelid = 'public.profiles'::regclass
        and array_length(c.conkey, 1) = 1
        and a.attname = ref.col
    loop
      execute format('alter table public.%I drop constraint %I', ref.tbl, con);
    end loop;
    if ref.action = 'set null' then
      execute format('alter table public.%I alter column %I drop not null', ref.tbl, ref.col);
    end if;
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.profiles (id) on delete %s',
      ref.tbl, ref.tbl || '_' || ref.col || '_fkey', ref.col, ref.action
    );
  end loop;
end $$;

-- 3a. Why `target` can't be deleted, or null when it can (AC 6, Roles and access). The same message the app shows.
create function account_deletion_problem(target uuid) returns text
  language plpgsql stable security definer set search_path = public
  as $$
  declare
    titles text;
  begin
    if exists (select 1 from profiles where id = target and role = 'teacher') then
      return 'The teacher''s account can''t be deleted.';
    end if;
    select string_agg(title, ', ' order by title, id) into titles from courses where created_by = target;
    if titles is not null then
      return 'You own courses: ' || titles || '. Ask the teacher or a mentor to change their owner first.';
    end if;
    return null;
  end $$;
revoke execute on function account_deletion_problem(uuid) from public, anon, authenticated;
grant execute on function account_deletion_problem(uuid) to service_role;

-- 2. The database refuses the deletion too, whoever asks (AC 6, teacher). Runs inside the Auth user's deletion, so
-- that whole step fails and nothing is deleted.
create function profiles_before_delete() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    problem text := account_deletion_problem(old.id);
  begin
    if problem is not null then
      raise exception '%', problem using errcode = 'P0001';
    end if;
    return old;
  end $$;
revoke execute on function profiles_before_delete() from public, anon, authenticated;
create trigger profiles_before_delete before delete on profiles
  for each row execute function profiles_before_delete();

-- 3b. Every Storage object the account owns or that lies in its own folder of `homework` or `materials` (AC 12 b).
-- Supabase refuses to delete an Auth user who still owns objects, so the Edge Function removes these first (through
-- the Storage API). owner_id is read through to_jsonb so this also runs where the column doesn't exist (tests).
create function account_storage_objects(target uuid) returns table (bucket_id text, name text)
  language sql stable security definer set search_path = public
  as $$
    select o.bucket_id, o.name
    from storage.objects o
    where o.owner = target
       or (to_jsonb(o) ->> 'owner_id') = target::text
       or (o.bucket_id in ('homework', 'materials') and (storage.foldername(o.name))[1] = target::text)
    order by o.bucket_id, o.name
  $$;
revoke execute on function account_storage_objects(uuid) from public, anon, authenticated;
grant execute on function account_storage_objects(uuid) to service_role;

-- 4. A deleted author is null: "<>" would drop those rows, so use "is distinct from" (analysis note 1). -----------

-- 0016: messages from a deleted author still count as new.
create or replace function chat_unread_counts() returns table (course_id uuid, unread bigint)
  language sql stable security invoker set search_path = public
  as $$
    select m.course_id, count(*)
    from course_messages m
    left join course_chat_reads r on r.course_id = m.course_id and r.user_id = auth.uid()
    where m.author_id is distinct from auth.uid()
      and (r.last_read_at is null or m.created_at > r.last_read_at)
    group by m.course_id
  $$;

-- 0034: the same for the general chat.
create or replace function general_chat_unread_count() returns bigint
  language sql stable security invoker set search_path = public
  as $$
    select count(*)
    from general_messages m
    left join general_chat_reads r on r.user_id = auth.uid()
    where m.author_id is distinct from auth.uid()
      and (r.last_read_at is null or m.created_at > r.last_read_at)
  $$;

-- 0036: rule (d) still sees a deleted author's unread older message, so a batch is notified once.
create or replace function chat_message_recipients(message uuid)
  returns table (course_title text, recipient_ids uuid[])
  language sql stable security definer set search_path = public
  as $$
    select
      c.title,
      array(
        select p.id
        from profiles p
        left join course_chat_reads r on r.course_id = m.course_id and r.user_id = p.id
        where p.id is distinct from m.author_id
          and p.access_status = 'approved'
          and (
            p.role = 'teacher'
            or c.created_by = p.id
            or exists (select 1 from course_members cm where cm.course_id = m.course_id and cm.user_id = p.id)
          )
          and (r.last_read_at is null or r.last_read_at < m.created_at)
          and not exists (
            select 1 from course_messages o
            where o.course_id = m.course_id
              and o.author_id is distinct from p.id
              and (r.last_read_at is null or o.created_at > r.last_read_at)
              and (o.created_at, o.id) < (m.created_at, m.id)
          )
        order by p.id
      )
    from course_messages m
    join courses c on c.id = m.course_id
    where m.id = message
  $$;

-- 0038: an assignment whose assigner was deleted still reaches its listeners.
create or replace function new_homework_recipients(assignment uuid)
  returns table (course_title text, user_id uuid)
  language sql stable security definer set search_path = public
  as $$
    select c.title, cm.user_id
    from homework_assignments a
    join courses c on c.id = a.course_id
    join course_members cm on cm.course_id = a.course_id
    join profiles p on p.id = cm.user_id
    where a.id = assignment
      and p.access_status = 'approved'
      and p.role in ('student', 'mentor')
      and cm.user_id is distinct from a.created_by
      and cm.user_id <> c.created_by
    order by cm.user_id
  $$;
