// ARU-90: on the Homework tab's Checked list, cards show "<checker>: <comment>" (or "Checked without a comment")
// instead of the green Checked badge. HomeworkCard with default props (used elsewhere) keeps the badge. UI only.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import HomeworkScreen from '@/app/(tabs)/homework';
import { commentPreview, HomeworkCard } from '@/components/HomeworkCard';
import type { Homework } from '@/lib/types';

import { fakeStore, hw, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';
import { font } from '@/lib/fonts';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const LONG = 'Very long feedback. '.repeat(40);
const HOMEWORK: Homework[] = [
  hw({ id: 'c1', courseId: 'A', studentId: 'S1', title: 'HW commented', status: 'checked', checkedById: 'M', mentorComment: 'Good work,\n\nfix question 3' }),
  hw({ id: 'c2', courseId: 'A', studentId: 'S1', title: 'HW blank', status: 'checked', checkedById: 'N' }),
  hw({ id: 'c3', courseId: 'A', studentId: 'S1', title: 'HW spaces', status: 'checked', checkedById: 'N', mentorComment: '   \n ' }),
  hw({ id: 'c4', courseId: 'A', studentId: 'S1', title: 'HW gone', status: 'checked', checkedById: 'GONE', mentorComment: 'Nice' }),
  hw({ id: 'c5', courseId: 'A', studentId: 'S1', title: 'HW long', status: 'checked', checkedById: 'M', mentorComment: LONG }),
  hw({ id: 'w1', courseId: 'A', studentId: 'S1', title: 'HW waiting' }),
  hw({ id: 'm1', courseId: 'A', studentId: 'M2', title: 'HW mo', status: 'checked', checkedById: 'T', mentorComment: 'Mo ok' }),
];
const members = [member('A', 'S1'), member('A', 'M2')];

const previews = () =>
  screen.queryAllByTestId('homework-comment-preview').map((n) => {
    type Json = { children?: (Json | string)[] | null } | string | null;
    const text = (j: Json): string => (!j ? '' : typeof j === 'string' ? j : (j.children ?? []).map(text).join(''));
    return text(n as unknown as Json);
  });
const badge = (label: string) => screen.queryAllByText(label).filter((n) => n.props.accessibilityRole !== 'tab');

const openChecked = async (who: 'S1' | 'M2' | 'T', visibleHomework: Homework[]) => {
  setStore(fakeStore(who, { courseMembers: members, visibleHomework }));
  await render(<HomeworkScreen />);
  await fireEvent.press(screen.getByText('Checked'));
};
const S1_ONLY = HOMEWORK.filter((h) => h.studentId === 'S1');

beforeEach(() => jest.clearAllMocks());

describe('commentPreview', () => {
  it('collapses whitespace and treats blank as no comment', () => {
    expect(commentPreview('a\n\nb')).toBe('a b');
    expect(commentPreview('  x  ')).toBe('x');
    expect(commentPreview('   ')).toBeNull();
    expect(commentPreview('')).toBeNull();
    expect(commentPreview(undefined)).toBeNull();
    expect(commentPreview('🎉')).toBe('🎉');
  });
});

describe('AC1-AC4: the Checked list', () => {
  it('student: no Checked badge; comment, no-comment and Unknown lines', async () => {
    await openChecked('S1', S1_ONLY);
    // The only "Checked" text left is the filter tab itself.
    expect(screen.getAllByText('Checked')).toHaveLength(1);
    expect(previews()).toEqual([
      'Mentor Max: Good work, fix question 3',
      'Checked without a comment',
      'Checked without a comment',
      'Unknown: Nice',
      `Mentor Max: ${LONG.trim()}`,
    ]);
  });

  it('AC2: two lines max with an ellipsis; the name is semibold', async () => {
    await openChecked('S1', S1_ONLY);
    const [first] = screen.getAllByTestId('homework-comment-preview');
    expect(first.props.numberOfLines).toBe(2);
    expect(first.props.ellipsizeMode).toBe('tail');
    expect(screen.getAllByText('Mentor Max:')[0].props.style).toEqual(font(500)); // ARU-119: SemiBold 600 became Inter Medium 500
  });

  it.each(['T', 'M2'] as const)('%s (checker view): comment preview, no badge, never their own', async (who) => {
    await openChecked(who, HOMEWORK);
    expect(screen.getAllByText('Checked')).toHaveLength(1);
    const p = previews();
    expect(p).toContain('Mentor Max: Good work, fix question 3');
    if (who === 'M2') expect(p).not.toContain('Teacher Tess: Mo ok');
  });

  it('mentor on Listener: comment on their own homework', async () => {
    setStore(fakeStore('M2', { courseMembers: members, visibleHomework: HOMEWORK }));
    await render(<HomeworkScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: /^Listener/ }));
    await fireEvent.press(screen.getByText('Checked'));
    expect(previews()).toEqual(['Teacher Tess: Mo ok']);
    expect(screen.getAllByText('Checked')).toHaveLength(1);
  });

  it('AC5: tapping a card opens details', async () => {
    await openChecked('S1', S1_ONLY);
    await fireEvent.press(screen.getByText('HW commented'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/homework/[id]', params: { id: 'c1' } });
  });

  it('AC7: Waiting cards get no comment line (their badge is ARU-91)', async () => {
    setStore(fakeStore('S1', { courseMembers: members, visibleHomework: S1_ONLY }));
    await render(<HomeworkScreen />);
    await fireEvent.press(screen.getByText(/^Waiting/));
    expect(previews()).toEqual([]);
  });
});

describe('AC10: HomeworkCard default props keep the badge', () => {
  it('a checked card shows Checked and no preview', async () => {
    setStore(fakeStore('S1'));
    await render(<HomeworkCard item={HOMEWORK[0]} />);
    expect(badge('Checked')).toHaveLength(1);
    expect(previews()).toEqual([]);
  });
});
