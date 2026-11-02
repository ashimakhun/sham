-- ARU-56 (bug in ARU-55): the blank-name rule from 0026 let through names made only of non-breaking spaces (U+00A0)
-- and other Unicode spaces, because Postgres' \s doesn't match them. The app's JavaScript trim() removes them, so the
-- database now counts the same characters as blank: ASCII whitespace, U+00A0, U+1680, U+2000–U+200A, U+2028,
-- U+2029, U+202F, U+205F, U+3000 and U+FEFF. Run after 0026_profile_name_not_blank.sql.
-- Replaces one function body; the trigger, policies, grants and existing rows are unchanged.

create or replace function profiles_name_not_blank() returns trigger
  language plpgsql set search_path = public
  as $$
  declare
    -- The characters JavaScript's String.prototype.trim() removes.
    spaces constant text := E' \t\n\v\f\r' || chr(160) || chr(5760)
      || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197)
      || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202)
      || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279);
  begin
    if new.full_name is distinct from old.full_name and btrim(coalesce(new.full_name, ''), spaces) = '' then
      raise exception 'Name can''t be blank.' using errcode = '23514';
    end if;
    return new;
  end $$;
revoke execute on function profiles_name_not_blank() from public, anon, authenticated;
