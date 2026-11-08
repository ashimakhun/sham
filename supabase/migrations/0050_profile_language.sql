-- ARU-108 (Russian version, part 1): the language a user chose in Profile, kept on the account so it is the same on
-- every device (AC 4). 'en' or 'ru'; null = never chose, follow the phone language (AC 5). Existing accounts get null.
-- Users change only their own row: the existing "edit own profile" policy (0001) limits updates to id = auth.uid(),
-- and the column joins full_name in the column grant (0021). Read like the rest of profiles (0021's policy); part 4
-- (ARU-110) needs it on the server for Telegram messages. No other policy changes; deletes nothing.
-- Renumber to the next free number if another 0050 lands first.

alter table profiles add column language text check (language in ('en', 'ru'));

comment on column profiles.language is
  'ARU-108: the app language the user chose in Profile (en / ru); null = follow the phone language.';

grant update (full_name, language) on profiles to authenticated;
