-- ARU-110 (Russian version, part 4): the phone language the app saved for a user, so Telegram notifications follow it
-- when the user never chose a language in Profile (AC 1, AC 2). 'en' or 'ru'; null = not known yet (English).
-- Not a choice: profiles.language (0051) always wins. The app writes it at start for users with no choice; Edge
-- Functions read both columns with the service role. Users change only their own row: the "edit own profile" policy
-- (0001) limits updates to id = auth.uid(), and the column joins the column grant next to full_name and language
-- (0021, 0051). Readable like the rest of profiles. No other policy changes; existing rows get null; deletes nothing.
-- Renumbered from 0051 after ARU-108's migration became 0051_profile_language.sql (ARU-115).

alter table profiles add column device_language text check (device_language in ('en', 'ru'));

comment on column profiles.device_language is
  'ARU-110: the phone language the app last saved (en / ru); used for Telegram messages when language is null.';

grant update (full_name, language, device_language) on profiles to authenticated;
