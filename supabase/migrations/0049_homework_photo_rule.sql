-- ARU-107 (part a): the 6-month rule for homework photos, without deleting anything yet (ARU-112 is the daily job).
--   * homework.checked_at is set by the server: a trigger sets it when status becomes 'checked', keeps it while the
--     homework stays checked and clears it when status leaves 'checked' (AC 1). Any value a client sends is
--     overwritten. Checked homework without a checked_at gets this migration's time.
--   * app_settings: one row with photo_deletion_start (null until ARU-112's job first runs) (AC 2).
--   * photo_deletion_date(checked_at): the UTC calendar date of checked_at + 6 months, never before
--     photo_deletion_start; null while the start date is empty (AC 3). The app mirrors it in src/lib/photoRetention.ts.
--   * photo_zip_links + homework_photos_for_zip() + claim_photo_zip_link(): the one-time ZIP links of
--     "Download my photos" (AC 5–7), used only by the homework-photos-zip Edge Function (service role).
-- Deletes no file and no row (AC 10). Renumber to the next free number if another 0049 lands first.

-- AC 1: existing checked homework keeps its time; checked rows without one get now(). Before the trigger exists.
update homework set checked_at = now() where status = 'checked' and checked_at is null;

create function homework_set_checked_at() returns trigger
  language plpgsql set search_path = public
  as $$
  begin
    -- The database owner and the service role (admin fixes, tests, ARU-112's job) may set checked_at themselves.
    if current_user not in ('anon', 'authenticated') then
      if tg_op = 'INSERT' and new.checked_at is not null then return new; end if;
      if tg_op = 'UPDATE' and new.checked_at is distinct from old.checked_at then return new; end if;
    end if;
    if tg_op = 'INSERT' then
      new.checked_at := case when new.status = 'checked' then now() end;
    elsif new.status = 'checked' and old.status is distinct from 'checked' then
      new.checked_at := now();
    elsif new.status is distinct from 'checked' then
      new.checked_at := null;
    else
      -- Still checked (for example a re-check with a new comment): the first check time stays.
      new.checked_at := old.checked_at;
    end if;
    return new;
  end $$;

create trigger homework_set_checked_at before insert or update on homework
  for each row execute function homework_set_checked_at();

-- checked_at stays in the update grant (0005) on purpose: app versions released before this change still send it
-- when checking, and refusing the column would make their Check fail. The trigger above overwrites whatever a client
-- sends, so no client can set or change it.

-- AC 2: app-wide settings, one row. Approved users read it; only the service role writes (ARU-112).
create table app_settings (
  id boolean primary key default true check (id),
  photo_deletion_start date
);
insert into app_settings default values;
alter table app_settings enable row level security;
-- Approved accounts only, like every other open read rule since ARU-43 (0021).
create policy "app settings readable" on app_settings for select to authenticated using (is_approved());
revoke insert, update, delete, truncate on app_settings from anon, authenticated;

-- AC 3: the one deletion-date rule, for the app and ARU-112's job. `date + interval '6 months'` keeps the day, or takes
-- the month's last day when it doesn't exist (31 Aug -> 28/29 Feb).
create function photo_deletion_date(checked timestamptz) returns date
  language sql stable set search_path = public
  as $$
    select case
      when checked is null or s.photo_deletion_start is null then null
      else greatest(((checked at time zone 'utc')::date + interval '6 months')::date, s.photo_deletion_start)
    end
    from app_settings s
  $$;
grant execute on function photo_deletion_date(timestamptz) to authenticated, service_role;

-- AC 5: one-time download links. Only a hash of the token is kept, with its owner, the homework it covers and a
-- 60-second expiry; no ZIP is stored. No policies: app users can't read or write it, only the service role.
create table photo_zip_links (
  token_hash text primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  homework_ids uuid[] not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
-- RLS on with no policy: app users read nothing and can't write (an empty result, like every table they can't see).
alter table photo_zip_links enable row level security;

-- AC 5–7: the stored homework photos `target` sent and can still read. Approved accounts only; homework whose photo
-- is no longer in Storage is left out; a hidden course counts only for its owner, listeners and the teacher (a guard:
-- no such case exists today). Oldest first, so the parts of a large course are stable.
create function homework_photos_for_zip(target uuid)
  returns table (
    homework_id uuid,
    photo_path text,
    course_id uuid,
    course_title text,
    homework_title text,
    assignment_title text,
    sent_at timestamptz
  )
  language sql stable security definer set search_path = public
  as $$
    select h.id, h.photo_path, h.course_id, c.title, h.title, a.title, h.created_at
    from homework h
    join profiles p on p.id = target and p.access_status = 'approved'
    join courses c on c.id = h.course_id
    left join homework_assignments a on a.id = h.assignment_id
    where h.student_id = target
      and h.photo_path is not null
      and exists (select 1 from storage.objects o where o.bucket_id = 'homework' and o.name = h.photo_path)
      and (
        not coalesce(c.hidden, false)
        or c.created_by = target
        or p.role = 'teacher'
        or exists (select 1 from course_members m where m.course_id = c.id and m.user_id = target)
      )
    order by h.created_at, h.id
  $$;

-- AC 5: uses a link once. Returns its owner and homework while it is unused and unexpired, and marks it used.
create function claim_photo_zip_link(hash text) returns table (user_id uuid, homework_ids uuid[])
  language sql volatile security definer set search_path = public
  as $$
    update photo_zip_links l set used_at = now()
    where l.token_hash = hash and l.used_at is null and l.expires_at > now()
    returning l.user_id, l.homework_ids
  $$;

revoke execute on function homework_photos_for_zip(uuid) from public, anon, authenticated;
revoke execute on function claim_photo_zip_link(text) from public, anon, authenticated;
grant execute on function homework_photos_for_zip(uuid) to service_role;
grant execute on function claim_photo_zip_link(text) to service_role;
