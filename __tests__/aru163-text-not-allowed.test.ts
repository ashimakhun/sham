/**
 * @jest-environment node
 */
// ARU-163 AC 10: the offensive word filter's refusal (hint sham:text_not_allowed) reads in the user's language.
import { dbErrorMessage } from '@/i18n';

const error = {
  message: "This text contains words that aren't allowed. Please change it.",
  code: '23514',
  hint: 'sham:text_not_allowed',
  details: null,
};

describe('ARU-163 refused text', () => {
  it('English shows the server message', () => {
    expect(dbErrorMessage(error, 'en')).toBe("This text contains words that aren't allowed. Please change it.");
  });
  it('Russian shows the catalog text', () => {
    expect(dbErrorMessage(error, 'ru')).toBe('Текст содержит недопустимые слова. Измените его.');
  });
});
