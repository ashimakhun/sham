-- ARU-166: notifications on the phone, part 1. Every notification Telegram sends today goes out as a push instead
-- (sent by the notification Edge Functions through Expo's push service). Adds:
--   * push_devices: one row per phone (a random install id, the Expo push token, the platform, the time). Nothing else:
--     no name, email, phone number or device model. Readable by its owner only; written only through the functions
--     below (and by the service role, which deletes tokens Expo reports as no longer valid).
--   * notification_settings: one row per account with a switch per notification kind. No row means every switch on
--     (for the app and for sending). Readable by its owner only; written only through set_notification().
--     Existing Telegram switch values are copied (AC 8).
--   * register_push_device(), unregister_push_device(), set_notification().
--   * new_material_recipients() and meeting_notes_recipients() without the telegram_links join (latest: 0066, with
--     ARU-162's block filter kept). The switch is now checked in one place only: the push sender.
-- Both tables follow the 0059 workspace pattern. Deletes no data; telegram_links is left as it is (ARU-171 removes it).

-- 1. push_devices.
create table push_devices (
  user_id uuid not null references profiles (id) on delete cascade,
  device_id text not null check (char_length(device_id) between 1 and 100),
  token text not null unique check (token ~ '^ExponentPushToken\[[^\]]+\]$' and char_length(token) <= 200),
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now(),
  workspace_id uuid not null default default_workspace() references workspaces (id),
  primary key (user_id, device_id)
);
create index push_devices_workspace_idx on push_devices (workspace_id);
alter table push_devices enable row level security;
revoke all on push_devices from anon, authenticated;
grant select on push_devices to authenticated;
create policy "push devices: read own" on push_devices for select to authenticated using (user_id = auth.uid());
create policy "workspace: only my workspace" on push_devices as restrictive for select to authenticated
  using (workspace_id = (select my_workspace()));
-- Insert and update only: nobody in the app can delete a row directly (no grant), and the one app path that deletes,
-- register_push_device() moving a phone's token to the account now signed in on it, has to delete a row of another
-- account, maybe in another workspace (AC 2). Account deletion (cascade) and the Edge Functions run as the service role.
create trigger zz_workspace_guard before insert or update on push_devices
  for each row execute function workspace_guard('profile:user_id', 'user_id');

-- 2. notification_settings.
create table notification_settings (
  user_id uuid primary key references profiles (id) on delete cascade,
  notify_meeting_started boolean not null default true,
  notify_new_homework boolean not null default true,
  notify_homework_reviewed boolean not null default true,
  notify_photo_deletion boolean not null default true,
  notify_homework_submitted boolean not null default true,
  notify_chat_message boolean not null default true,
  notify_general_chat boolean not null default true,
  notify_new_material boolean not null default true,
  notify_meeting_notes boolean not null default true,
  notify_new_account boolean not null default true,
  updated_at timestamptz not null default now(),
  workspace_id uuid not null default default_workspace() references workspaces (id)
);
create index notification_settings_workspace_idx on notification_settings (workspace_id);
alter table notification_settings enable row level security;
revoke all on notification_settings from anon, authenticated;
grant select on notification_settings to authenticated;
create policy "notification settings: read own" on notification_settings for select to authenticated
  using (user_id = auth.uid());
create policy "workspace: only my workspace" on notification_settings as restrictive for select to authenticated
  using (workspace_id = (select my_workspace()));
create trigger zz_workspace_guard before insert or update or delete on notification_settings
  for each row execute function workspace_guard('profile:user_id', 'user_id');

-- AC 8: an account that had Telegram connected keeps its switch values.
insert into notification_settings (
  user_id, notify_meeting_started, notify_new_homework, notify_homework_reviewed, notify_photo_deletion,
  notify_homework_submitted, notify_chat_message, notify_general_chat, notify_new_material, notify_meeting_notes,
  notify_new_account
)
select l.user_id, l.notify_meeting_started, l.notify_new_homework, l.notify_homework_reviewed, l.notify_photo_deletion,
  l.notify_homework_submitted, l.notify_chat_message, l.notify_general_chat, l.notify_new_material,
  l.notify_meeting_notes, l.notify_new_account
from telegram_links l
join profiles p on p.id = l.user_id
on conflict (user_id) do nothing;

-- 3. Functions (security definer, search_path = public; signed-out visitors can't run them, as in 0063).

-- AC 2 / AC 5: registers this phone for the caller (Approved only). The same token is never stored twice and one phone
-- (device id) belongs to one account: a row of another account or another device with this token, or of another
-- account with this device id, is deleted and the caller's row is inserted (or its token replaced). Rows are never
-- moved by updating user_id: the workspace guard keeps a row in its workspace.
create function register_push_device(device text, token text, platform text) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    me uuid := auth.uid();
  begin
    if me is null then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    if not exists (select 1 from profiles where id = me and access_status = 'approved') then
      raise exception 'Only accepted accounts can get notifications.' using errcode = '42501',
        hint = 'sham:notifications_not_accepted';
    end if;
    if device is null or char_length(device) not between 1 and 100 then
      raise exception 'This phone could not be registered for notifications.' using errcode = '22023',
        hint = 'sham:push_device_invalid';
    end if;
    if token is null or char_length(token) > 200 or token !~ '^ExponentPushToken\[[^\]]+\]$' then
      raise exception 'This push token is not valid.' using errcode = '22023', hint = 'sham:push_token_invalid';
    end if;
    if platform is null or platform not in ('ios', 'android') then
      raise exception 'Notifications work only on iOS and Android.' using errcode = '22023',
        hint = 'sham:push_platform_invalid';
    end if;
    delete from push_devices d
      where (d.token = register_push_device.token
             and not (d.user_id = me and d.device_id = register_push_device.device))
         or (d.device_id = register_push_device.device and d.user_id <> me);
    insert into push_devices (user_id, device_id, token, platform, updated_at)
      values (me, register_push_device.device, register_push_device.token, register_push_device.platform, now())
      on conflict (user_id, device_id) do update
        set token = excluded.token, platform = excluded.platform, updated_at = excluded.updated_at;
  end $$;
revoke execute on function register_push_device(text, text, text) from public, anon;
grant execute on function register_push_device(text, text, text) to authenticated;

-- AC 3 / AC 4 / AC 5: removes this phone's registration of the caller (any signed-in account, waiting ones too).
-- No error when there is none.
create function unregister_push_device(device text) returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    if auth.uid() is null then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    delete from push_devices d where d.user_id = auth.uid() and d.device_id = unregister_push_device.device;
  end $$;
revoke execute on function unregister_push_device(text) from public, anon;
grant execute on function unregister_push_device(text) to authenticated;

-- AC 8: turns one kind on or off for the caller (Approved only, known kinds only). The first call creates the row
-- (every other switch on).
create function set_notification(kind text, enabled boolean) returns void
  language plpgsql security definer set search_path = public
  as $$
  declare
    me uuid := auth.uid();
  begin
    if me is null then
      raise exception 'Please sign in again.' using errcode = '42501', hint = 'sham:sign_in_again';
    end if;
    if not exists (select 1 from profiles where id = me and access_status = 'approved') then
      raise exception 'Only accepted accounts can get notifications.' using errcode = '42501',
        hint = 'sham:notifications_not_accepted';
    end if;
    if enabled is null then
      raise exception 'Choose on or off.' using errcode = '22023', hint = 'sham:choose_on_off';
    end if;
    if kind is null or kind not in ('meeting_started', 'new_homework', 'homework_reviewed', 'photo_deletion',
        'homework_submitted', 'chat_message', 'general_chat', 'new_material', 'meeting_notes', 'new_account') then
      raise exception 'Unknown notification type.' using errcode = '22023', hint = 'sham:notification_kind_unknown';
    end if;
    insert into notification_settings (user_id) values (me) on conflict (user_id) do nothing;
    execute format('update notification_settings set %I = $1, updated_at = now() where user_id = $2', 'notify_' || kind)
      using enabled, me;
  end $$;
revoke execute on function set_notification(text, boolean) from public, anon;
grant execute on function set_notification(text, boolean) to authenticated;

-- 4. AC 9: the recipients of new materials and meeting notes no longer depend on a Telegram link (latest: 0066).
-- Every other rule is kept: Approved, same workspace, not the author, course rules, not someone who blocked the author
-- (ARU-162). Grants are kept by create or replace (service_role only).
create or replace function new_material_recipients(type text, item uuid)
  returns table (user_id uuid, author_name text, item_title text)
  language sql stable security definer set search_path = public
  as $$
    with m as (
      select b.teacher_id as author_id, b.title as title, false as course_only, null::uuid as course_id, b.workspace_id
        from materials b
        where new_material_recipients.type = 'blog' and b.id = new_material_recipients.item
      union all
      select f.author_id, f.name, f.course_only, f.course_id, f.workspace_id
        from material_files f
        where new_material_recipients.type = 'file' and f.id = new_material_recipients.item
    )
    select p.id, a.full_name, m.title
    from m
    join profiles a on a.id = m.author_id
    join profiles p on p.id <> m.author_id and p.access_status = 'approved' and p.workspace_id = m.workspace_id
    where (
        not m.course_only
        or m.course_id is null
        or p.role = 'teacher'
        or exists (select 1 from courses c where c.id = m.course_id and c.created_by = p.id)
        or exists (select 1 from course_members cm where cm.course_id = m.course_id and cm.user_id = p.id)
      )
      and not exists (select 1 from user_blocks b where b.blocker_id = p.id and b.blocked_id = m.author_id)
    order by p.id
  $$;

create or replace function meeting_notes_recipients(note uuid)
  returns table (user_id uuid, author_name text, course_title text)
  language sql stable security definer set search_path = public
  as $$
    select p.id, a.full_name, c.title
    from meeting_listener_notes n
    join courses c on c.id = n.course_id
    join profiles a on a.id = n.author_id
    join profiles p on p.id <> n.author_id and p.access_status = 'approved' and p.workspace_id = c.workspace_id
    where n.id = meeting_notes_recipients.note
      and n.is_public
      and (
        p.role = 'teacher'
        or c.created_by = p.id
        or exists (select 1 from course_members cm where cm.course_id = c.id and cm.user_id = p.id)
      )
      and not exists (select 1 from user_blocks b where b.blocker_id = p.id and b.blocked_id = n.author_id)
    order by p.id
  $$;
