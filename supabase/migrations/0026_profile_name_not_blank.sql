-- Users edit their own name (ARU-55): a name changed through an update can't be blank or only whitespace.
-- Run after 0025_course_feedback.sql. Adds one trigger; changes no policy, grant or existing row.
--
-- Who may update is unchanged: "edit own profile" (0001) limits updates to the own row, the 0021 column grant allows
-- only full_name, and my_role() is null for pending or rejected accounts, so their update fails the policy check.
--
-- A before-update trigger rather than a check constraint: even a NOT VALID check constraint applies to new inserts,
-- so a direct API sign-up with a blank name would make handle_new_user() fail and the whole Auth sign-up fail.
-- Sign-up stays as it was. Only updates that change full_name are checked, so existing rows (blank or long names
-- included) and updates of other columns (role, access status) are never refused because of an old name.
-- The 80-character limit is enforced in the app only.

create function profiles_name_not_blank() returns trigger
  language plpgsql set search_path = public
  as $$
  begin
    if new.full_name is distinct from old.full_name and coalesce(new.full_name, '') !~ '\S' then
      raise exception 'Name can''t be blank.' using errcode = '23514';
    end if;
    return new;
  end $$;
create trigger profiles_name_not_blank before update of full_name on profiles
  for each row execute function profiles_name_not_blank();
revoke execute on function profiles_name_not_blank() from public, anon, authenticated;
