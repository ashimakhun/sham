-- Offensive word list (ARU-163). Run these in the Supabase SQL Editor (it runs as admin, so row-level security does not
-- block it). The app can't read or change this list.
--
-- Chat messages (course and general), meeting notes and Blog posts (title and text) that contain a listed word are
-- refused with "This text contains words that aren't allowed. Please change it." A change takes effect for the next
-- send / save; no app update is needed. Existing messages, notes and posts are never changed or hidden.
--
-- How words match:
--   * one global list for every workspace;
--   * whole words only: "ass" matches "you ass!" and "ass-thing" but not "class" or "assignment";
--   * case doesn't matter (Latin and Cyrillic). Words are stored lower-case: a trigger on blocked_words lower-cases
--     every word you add or change, so 'WORD' is saved as 'word';
--   * one word per row, no spaces (phrases aren't supported). List every form you want refused ("fuck", "fucking" …);
--   * ё and е are different letters: add both spellings when needed ('ёбаный' and 'ебаный').

-- 1. List the words, by language.
select language, word, created_at from blocked_words order by language, word;

-- 2. Add words (language is 'en' or 'ru'). A word already on the list is skipped.
insert into blocked_words (word, language) values
  ('exampleword', 'en'),
  ('примерслово', 'ru')
on conflict (word) do nothing;

-- 3. Remove words.
delete from blocked_words where word in ('exampleword', 'примерслово');

-- 4. Check a text against the list (true = it would be refused).
select text_has_blocked_word('Text to check');
