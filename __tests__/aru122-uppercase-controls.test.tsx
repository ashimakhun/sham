// ARU-122: statuses, buttons, action links and filter tabs are upper case by style (textTransform), Medium 500,
// slightly spaced and 1 pt smaller; the source text and screen reader labels stay as written; titles and course
// names are not upper-cased.
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Button, HiddenBadge, RoleBadge, Segmented, StatusBadge, UnreadBadge, styles } from '@/components/ui';
import { font } from '@/lib/fonts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const flat = (node: { props: { style?: any } }) => StyleSheet.flatten(node.props.style) as Record<string, unknown>;
// ARU-119: Medium 500 is the Inter Medium face.
const caps = { textTransform: 'uppercase', ...font(500), letterSpacing: 0.5 };

describe('ARU-122 shared styles', () => {
  it('buttons: upper case, 14 pt, centred so a long label wraps inside, never cut off', async () => {
    await render(<Button title="Add homework" onPress={() => {}} />);
    const text = screen.getByText('Add homework'); // the source text is unchanged
    expect(flat(text)).toMatchObject({ ...caps, fontSize: 14, textAlign: 'center' });
    expect(text.props.numberOfLines).toBeUndefined();
    // The visible text is what's read: no forced label, so screen readers read the words as written.
    expect(screen.getByRole('button', { name: 'Add homework' }).props.accessibilityLabel).toBeUndefined();
  });

  it('badges: status, role and hidden are upper case at 11 pt', async () => {
    await render(
      <>
        <StatusBadge status="checked" />
        <RoleBadge role="mentor" />
        <HiddenBadge />
      </>,
    );
    for (const label of ['Checked', 'Mentor', 'Hidden']) {
      expect(flat(screen.getByText(label))).toMatchObject({ ...caps, fontSize: 11 });
    }
  });

  it('filter tabs: upper case at 12 pt, the tab label as written', async () => {
    await render(
      <Segmented
        options={[
          { value: 'a', label: 'New (2)' },
          { value: 'b', label: 'Checked' },
        ]}
        value="a"
        onChange={() => {}}
      />,
    );
    expect(flat(screen.getByText('New (2)'))).toMatchObject({ ...caps, fontSize: 12 });
    expect(screen.getByRole('tab', { name: 'New (2)' }).props.accessibilityLabel).toBe('New (2)');
  });

  it('action links have a shared upper-case style, 1 pt under the default', () => {
    expect(StyleSheet.flatten(styles.linkText)).toMatchObject({ ...caps, fontSize: 13 });
  });

  it('stays as written: titles, section and course-name labels, and unread numbers', async () => {
    for (const s of [styles.title, styles.h1, styles.body, styles.label, styles.muted, styles.emptyTitle]) {
      expect((StyleSheet.flatten(s) as Record<string, unknown>).textTransform).toBeUndefined();
    }
    await render(<UnreadBadge count={3} />);
    expect(flat(screen.getByText('3', { includeHiddenElements: true })).textTransform).toBeUndefined();
  });
});
