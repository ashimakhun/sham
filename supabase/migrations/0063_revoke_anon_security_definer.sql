-- ARU-154: signed-out visitors (anon, and public) can execute no security definer function in public.
-- These four were the last ones the security advisor flagged ("Public Can Execute SECURITY DEFINER Function").
-- No RLS policy changes, no data changes.

-- Trigger functions: only ever run by their triggers, which don't need EXECUTE for the calling role.
revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function homework_assignments_before_insert() from public, anon, authenticated;

-- Helpers the RLS policies call as the querying role: signed-in users keep them.
revoke execute on function my_role() from public, anon;
grant execute on function my_role() to authenticated;
revoke execute on function is_my_student(uuid) from public, anon;
grant execute on function is_my_student(uuid) to authenticated;
