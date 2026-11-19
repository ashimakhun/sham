-- ARU-167: Sham never stores IP addresses or user agents. Supabase Auth writes both into auth.sessions (ip, user_agent)
-- on every sign-in and token refresh; a before insert or update trigger sets them to null at write time, and the
-- existing rows are cleared below. The columns themselves and Supabase's own functions are left alone (Supabase allows
-- triggers on auth tables). No public table, RLS policy or app change.

create function clear_session_ip() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  begin
    new.ip := null;
    new.user_agent := null;
    return new;
  end;
  $$;

-- Only ever run by its trigger, which doesn't need EXECUTE for the calling role (same pattern as ARU-154).
revoke execute on function clear_session_ip() from public, anon, authenticated;

create trigger clear_session_ip
  before insert or update on auth.sessions
  for each row execute function clear_session_ip();

-- Existing sessions: clear both columns, keep the rows so nobody is signed out.
update auth.sessions set ip = null, user_agent = null where ip is not null or user_agent is not null;
