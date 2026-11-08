// ARU-131: after merging the Russian version, ARU-123's RatingSummary (the indigo ★) must stay in the app's language.
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { RatingSummary } from '@/components/RatingSummary';
import { I18nContext, make } from '@/i18n/context';
import { ratingSummary, ratingSummaryLabel } from '@/lib/feedback';
import { colors } from '@/lib/theme';
import type { CourseFeedback } from '@/lib/types';

const review = (id: string, rating: number): CourseFeedback => ({
  id,
  courseId: 'A',
  userId: id,
  rating,
  body: '',
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
});
const items = [review('a', 4), review('b', 5)];

it.each(['ru', 'en'] as const)('in %s: the summary text and label are the translated ones, with the star in colors.star', async (lang) => {
  await render(
    <I18nContext.Provider value={make(lang)}>
      <RatingSummary items={items} style={{ fontSize: 13 }} />
    </I18nContext.Provider>,
  );
  const label = ratingSummaryLabel(items, lang)!;
  const el = screen.getByLabelText(label);
  expect([el.props.children].flat().map((c: unknown) => (typeof c === 'string' ? c : '★')).join('')).toBe(ratingSummary(items, lang));
  expect(StyleSheet.flatten(screen.getByTestId('rating-summary-star').props.style)).toMatchObject({ color: colors.star });
  if (lang === 'ru') {
    expect(label).toMatch(/^Оценка .* из 5, 2 отзыва$/);
    expect(ratingSummary(items, 'ru')).toMatch(/отзыва$/);
  }
});
