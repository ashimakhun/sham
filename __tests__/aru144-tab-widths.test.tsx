// ARU-144: tab switches size each tab to its label (same side padding), share the leftover row space equally, and
// let a long label wrap instead of being cut. Applies to every switch that uses the shared `styles.segment`.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import { Segmented, styles } from '@/components/ui';
import { I18nContext, make } from '@/i18n/context';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const fs = jest.requireActual<{ readFileSync: (f: string, e: 'utf8') => string }>('fs');
const flat = (s: unknown) =>
  StyleSheet.flatten((typeof s === 'function' ? s({ pressed: false }) : s) as never) as Record<string, unknown>;
const ru = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;

describe('the shared tab style (AC 2, 3, 8, 9)', () => {
  it('is content-sized with shared leftover space, the same side padding, and can shrink', () => {
    expect(flat(styles.segment)).toMatchObject({
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 'auto',
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 8,
    });
    expect(flat(styles.segment).flex).toBeUndefined(); // no longer equal shares
  });

  it('keeps the text style (upper case, 12, Medium) and centres a wrapped label', () => {
    expect(flat(styles.segmentText)).toMatchObject({ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' });
  });
});

describe('Segmented (Homework filters, Materials, sign-in)', () => {
  const options = [
    { value: 'new', label: 'Новые (1)' },
    { value: 'submitted', label: 'В ожидании (2)' },
    { value: 'checked', label: 'Проверено' },
  ];

  it('AC 1 / AC 4 / AC 8: each tab uses the shared style, labels are never limited to one line, a tap switches', async () => {
    const onChange = jest.fn();
    await render(<Segmented options={options} value="new" onChange={onChange} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) expect(flat(tab.props.style)).toMatchObject({ flexGrow: 1, flexBasis: 'auto', paddingHorizontal: 10 });
    for (const o of options) expect(screen.getByText(o.label).props.numberOfLines).toBeUndefined();
    expect(tabs[0].props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(tabs[1]);
    expect(onChange).toHaveBeenCalledWith('submitted');
  });
});

describe('the Homework tab switches (AC 1, 7)', () => {
  const ownB = { ...courseB, createdById: 'M2' };
  const members = [member('A', 'S1'), member('A', 'M2')];

  it('a student in Russian sees «В ожидании» in a content-sized tab', async () => {
    setStore(fakeStore('S1', { courseMembers: [member('A', 'S1')] }));
    await render(ru(<HomeworkScreen />));
    const waiting = screen.getByRole('tab', { name: /^В ожидании/ });
    expect(flat(waiting.props.style)).toMatchObject({ flexGrow: 1, flexBasis: 'auto', paddingHorizontal: 10 });
  });

  it('the mentor Owner / Listener switch uses the same side padding (no override)', async () => {
    setStore(fakeStore('M2', { courses: [ownB, courseA], courseMembers: members }));
    await render(<HomeworkScreen />);
    for (const name of [/^Owner/, /^Listener/]) {
      const style = flat(screen.getByRole('tab', { name }).props.style);
      expect(style).toMatchObject({ flexGrow: 1, flexBasis: 'auto', paddingHorizontal: 10, flexDirection: 'row' });
    }
  });
});

it('AC 7 / AC 8: the Courses and Language switches use the shared style; the Language labels may wrap', () => {
  expect(fs.readFileSync('src/app/(tabs)/courses.tsx', 'utf8')).toMatch(/styles\.segment\b/);
  const language = fs.readFileSync('src/components/LanguageSwitch.tsx', 'utf8');
  expect(language).toMatch(/styles\.segment\b/);
  expect(language).not.toMatch(/numberOfLines/);
});
