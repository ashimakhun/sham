-- ARU-163: offensive word filter (App Store guideline 1.2). Text that contains a word from one global list is refused
-- when it is written to a course chat message, a general chat message, a meeting note, or a Blog post's title or text.
--   * blocked_words: the list (word, language en/ru), stored lower-case, edited only by the operator in the SQL Editor
--     (supabase/manage-words.sql). RLS on with no policies: app users of every role can't read or change it.
--   * text_has_blocked_word(text): whole-word, case-insensitive match (Latin and Cyrillic, whatever the collation).
--   * Before insert / update triggers on the four tables raise
--     'This text contains words that aren't allowed. Please change it.' (errcode 23514, hint 'sham:text_not_allowed').
--     The update trigger runs only when the checked column changes, so database flag updates (notes' announced /
--     is_public, back-fills) keep working on existing rows.
-- Existing rows are not changed. No existing policy, function or grant changes.

create table blocked_words (
  word text primary key check (length(word) > 0 and word !~ '\s'),
  language text not null check (language in ('en', 'ru')),
  created_at timestamptz not null default now()
);

-- RLS on with no policies: every app role (and anon) reads no row and can't add, change or delete one.
alter table blocked_words enable row level security;

-- Lower-casing that doesn't depend on the database collation: lower() for Latin, an explicit map for Cyrillic
-- (Russian and Kazakh letters), since lower() leaves non-ASCII letters as they are under the C collation.
create function sham_fold_case(input text) returns text
  language sql immutable parallel safe set search_path = public
  as $$
    select translate(lower(input),
      'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯІЇЄЎӘҒҚҢӨҰҮҺ',
      'абвгдеёжзийклмнопрстуфхцчшщъыьэюяіїєўәғқңөұүһ')
  $$;
revoke execute on function sham_fold_case(text) from public, anon;

-- AC 8 / analysis note 4: every word is stored lower-case (folded on insert / update), so a word the operator types in
-- upper case still matches.
create function blocked_words_before_write() returns trigger
  language plpgsql set search_path = public
  as $$
  begin
    new.word := sham_fold_case(btrim(new.word));
    return new;
  end $$;
revoke execute on function blocked_words_before_write() from public, anon, authenticated;

create trigger blocked_words_before_write before insert or update on blocked_words
  for each row execute function blocked_words_before_write();

-- True when the text contains a listed word as a whole word: the characters right before and after it are not letters
-- (Latin or Cyrillic) or digits, or it is at the start / end of the text. Regex characters in words are escaped.
create function text_has_blocked_word(input text) returns boolean
  language plpgsql stable security definer set search_path = public
  as $$
  declare
    pattern text;
  begin
    if input is null or input = '' then
      return false;
    end if;
    select string_agg(regexp_replace(w.word, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g'), '|')
      into pattern
      from blocked_words w;
    if pattern is null then
      return false;
    end if;
    return sham_fold_case(input) ~
      ('(^|[^0-9a-zA-ZÀ-ɏЀ-ӿ])(' || pattern || ')($|[^0-9a-zA-ZÀ-ɏЀ-ӿ])');
  end $$;
revoke execute on function text_has_blocked_word(text) from public, anon, authenticated;

create function refuse_blocked_words() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  begin
    if TG_TABLE_NAME = 'materials' then
      if text_has_blocked_word(new.title) or text_has_blocked_word(new.body) then
        raise exception 'This text contains words that aren''t allowed. Please change it.'
          using errcode = '23514', hint = 'sham:text_not_allowed';
      end if;
    elsif text_has_blocked_word(new.body) then
      raise exception 'This text contains words that aren''t allowed. Please change it.'
        using errcode = '23514', hint = 'sham:text_not_allowed';
    end if;
    return new;
  end $$;
revoke execute on function refuse_blocked_words() from public, anon, authenticated;

-- Before triggers, so a refused row fires none of the after-insert notifications (0036, 0046, 0048, 0062).
create trigger zy_text_filter_insert before insert on course_messages
  for each row execute function refuse_blocked_words();
create trigger zy_text_filter_update before update of body on course_messages
  for each row when (new.body is distinct from old.body) execute function refuse_blocked_words();

create trigger zy_text_filter_insert before insert on general_messages
  for each row execute function refuse_blocked_words();
create trigger zy_text_filter_update before update of body on general_messages
  for each row when (new.body is distinct from old.body) execute function refuse_blocked_words();

create trigger zy_text_filter_insert before insert on meeting_listener_notes
  for each row execute function refuse_blocked_words();
create trigger zy_text_filter_update before update on meeting_listener_notes
  for each row when (new.body is distinct from old.body) execute function refuse_blocked_words();

create trigger zy_text_filter_insert before insert on materials
  for each row execute function refuse_blocked_words();
create trigger zy_text_filter_update before update on materials
  for each row when (new.title is distinct from old.title or new.body is distinct from old.body)
  execute function refuse_blocked_words();

-- AC 9: the starting list (common English and Russian profanity and slurs), for the product owner to review in the PR.
-- Whole words only, so each form that should be refused is listed. Edit with supabase/manage-words.sql.
insert into blocked_words (word, language) values
  ('fuck', 'en'), ('fucks', 'en'), ('fucked', 'en'), ('fucker', 'en'), ('fuckers', 'en'), ('fucking', 'en'),
  ('fuckin', 'en'), ('motherfucker', 'en'), ('motherfuckers', 'en'), ('motherfucking', 'en'),
  ('shit', 'en'), ('shits', 'en'), ('shitty', 'en'), ('bullshit', 'en'), ('shithead', 'en'),
  ('bitch', 'en'), ('bitches', 'en'), ('cunt', 'en'), ('cunts', 'en'),
  ('asshole', 'en'), ('assholes', 'en'), ('dickhead', 'en'), ('dickheads', 'en'),
  ('bastard', 'en'), ('bastards', 'en'), ('wanker', 'en'), ('wankers', 'en'), ('twat', 'en'), ('twats', 'en'),
  ('whore', 'en'), ('whores', 'en'), ('slut', 'en'), ('sluts', 'en'),
  ('retard', 'en'), ('retards', 'en'), ('retarded', 'en'),
  ('faggot', 'en'), ('faggots', 'en'), ('fag', 'en'), ('fags', 'en'), ('dyke', 'en'),
  ('nigger', 'en'), ('niggers', 'en'), ('nigga', 'en'), ('niggas', 'en'),
  ('chink', 'en'), ('chinks', 'en'), ('spic', 'en'), ('spics', 'en'), ('kike', 'en'), ('kikes', 'en'),
  ('tranny', 'en'),
  ('хуй', 'ru'), ('хуя', 'ru'), ('хую', 'ru'), ('хуем', 'ru'), ('хуе', 'ru'), ('хуи', 'ru'), ('хуёвый', 'ru'),
  ('хуевый', 'ru'), ('хуйня', 'ru'), ('хуйню', 'ru'), ('хуйни', 'ru'), ('нахуй', 'ru'), ('похуй', 'ru'),
  ('пизда', 'ru'), ('пизды', 'ru'), ('пизде', 'ru'), ('пизду', 'ru'), ('пиздой', 'ru'), ('пиздец', 'ru'),
  ('пиздеца', 'ru'), ('пиздить', 'ru'), ('пиздёж', 'ru'), ('пиздеж', 'ru'),
  ('ебать', 'ru'), ('ебал', 'ru'), ('ебала', 'ru'), ('ебали', 'ru'), ('ебаный', 'ru'), ('ёбаный', 'ru'),
  ('ебаная', 'ru'), ('ёбаная', 'ru'), ('ебаное', 'ru'), ('ёбаное', 'ru'), ('ебучий', 'ru'), ('заебал', 'ru'),
  ('заебала', 'ru'), ('заебали', 'ru'), ('уебок', 'ru'), ('уёбок', 'ru'), ('долбоеб', 'ru'), ('долбоёб', 'ru'),
  ('ебло', 'ru'), ('ёб', 'ru'),
  ('блядь', 'ru'), ('бляди', 'ru'), ('блядский', 'ru'), ('бля', 'ru'), ('блять', 'ru'),
  ('сука', 'ru'), ('суки', 'ru'), ('суку', 'ru'), ('сукин', 'ru'),
  ('мудак', 'ru'), ('мудаки', 'ru'), ('мудака', 'ru'), ('мудило', 'ru'),
  ('гандон', 'ru'), ('гондон', 'ru'), ('шлюха', 'ru'), ('шлюхи', 'ru'), ('шалава', 'ru'),
  ('пидор', 'ru'), ('пидоры', 'ru'), ('пидора', 'ru'), ('пидорас', 'ru'), ('пидорасы', 'ru'), ('педик', 'ru'),
  ('дебил', 'ru'), ('дебилы', 'ru'), ('чурка', 'ru'), ('чурки', 'ru'), ('хач', 'ru'), ('хачи', 'ru'),
  ('жид', 'ru'), ('жиды', 'ru'), ('черножопый', 'ru'), ('ниггер', 'ru')
on conflict (word) do nothing;
