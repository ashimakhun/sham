import { Text, type StyleProp, type TextStyle } from 'react-native';

import { ratingSummary, ratingSummaryLabel } from '@/lib/feedback';
import { colors } from '@/lib/theme';
import type { CourseFeedback } from '@/lib/types';

/**
 * ARU-123: "★ 4.3 · 6 reviews" with the ★ in the shared star colour; the number and count keep `style`.
 * The joined text is still exactly ratingSummary(), and nothing renders without feedback.
 */
export function RatingSummary({ items, style }: { items: CourseFeedback[]; style: StyleProp<TextStyle> }) {
  const summary = ratingSummary(items);
  if (!summary) return null;
  return (
    <Text style={style} accessibilityLabel={ratingSummaryLabel(items)}>
      <Text testID="rating-summary-star" style={{ color: colors.star }}>
        {summary.slice(0, 1)}
      </Text>
      {summary.slice(1)}
    </Text>
  );
}
