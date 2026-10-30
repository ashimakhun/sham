// ARU-23: mentors get Owner | Listener tabs on the Homework tab. Owner = homework they can check (everyone's but
// their own): To check / Checked. Listener = their own homework. Changed by ARU-32: Listener is New / Waiting /
// Checked and opens on New; there is no "+ Add homework" button (homework is sent from a New card). The teacher has
// the Owner view only. No database change.
// TEST DESIGN users mapped onto the fixtures: M2 = listener-mentor M1 (in A, 1 submitted + 1 checked of their own);
// S1 student in A (2 submitted + 1 checked); N = M3 (no course, no homework); M = M4 (no course, 1 earlier checked).
import { fireEvent, render, screen } from '@testing-library/react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import type { Homework } from '@/lib/types';

import { fakeStore, hw, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const HOMEWORK: Homework[] = [
  hw({ id: 's1a', courseId: 'A', studentId: 'S1', title: 'S1 waiting 1' }),
  hw({ id: 's1b', courseId: 'A', studentId: 'S1', title: 'S1 waiting 2' }),
  hw({ id: 's1c', courseId: 'A', studentId: 'S1', title: 'S1 checked', status: 'checked', checkedById: 'M' }),
  hw({ id: 'm2a', courseId: 'A', studentId: 'M2', title: 'Mo waiting' }),
  hw({ id: 'm2b', courseId: 'A', studentId: 'M2', title: 'Mo checked', status: 'checked', checkedById: 'M' }),
  hw({ id: 'mxa', courseId: 'B', studentId: 'M', title: 'Max earlier', status: 'checked', checkedById: 'N' }),
];
const members = [member('A', 'S1'), member('A', 'M2')];
const FILTER = /^(New \(\d+\)|Waiting \(\d+\)|To check \(\d+\)|Checked|All|My homework)$/;
const filterRow = (n: number) => screen.getAllByText(FILTER).slice(0, n).map((t) => t.props.children);
const titles = () => screen.queryAllByText(/^(S1 |Mo |Max )/).map((t) => t.props.children);
const tab = (name: 'Owner' | 'Listener') => screen.queryByRole('tab', { name });
const addButton = () => screen.queryByRole('button', { name: '+ Add homework' });

beforeEach(() => jest.clearAllMocks());

describe('Listener-mentor', () => {
  const open = async (over = {}) => {
    setStore(fakeStore('M2', { courseMembers: members, visibleHomework: HOMEWORK, ...over }));
    return render(<HomeworkScreen />);
  };

  it('AC1/AC2/AC3: Owner | Listener with Owner selected; To check (2) / Checked; no All, My homework or button', async () => {
    await open();
    expect(tab('Owner')).toBeTruthy();
    expect(tab('Owner')!.props.accessibilityState).toEqual({ selected: true });
    expect(filterRow(2)).toEqual(['To check (2)', 'Checked']);
    expect(screen.queryByText('All')).toBeNull();
    expect(screen.queryByText('My homework')).toBeNull();
    expect(addButton()).toBeNull();
    expect(titles()).toEqual(['S1 waiting 1', 'S1 waiting 2']); // never my own, never Max's checked one
    await fireEvent.press(screen.getAllByText('Checked')[0]);
    expect(titles()).toEqual(['S1 checked', 'Max earlier']);
  });

  it('AC4/AC5: Listener shows New (0) / Waiting (1) / Checked over my own homework, opening on New; no button', async () => {
    await open();
    await fireEvent.press(tab('Listener')!);
    expect(filterRow(3)).toEqual(['New (0)', 'Waiting (1)', 'Checked']);
    expect(screen.queryByText('All')).toBeNull();
    expect(titles()).toEqual([]);
    await fireEvent.press(screen.getByText('Waiting (1)'));
    expect(titles()).toEqual(['Mo waiting']);
    await fireEvent.press(screen.getAllByText('Checked')[0]);
    expect(titles()).toEqual(['Mo checked']);
    expect(addButton()).toBeNull();
  });

  it('AC9: each tab opens on its default filter, even after picking Checked', async () => {
    await open();
    await fireEvent.press(screen.getAllByText('Checked')[0]); // Owner / Checked
    await fireEvent.press(tab('Listener')!);
    expect(screen.getByText('No new homework')).toBeTruthy(); // Listener / New (ARU-32)
    await fireEvent.press(screen.getAllByText('Checked')[0]);
    await fireEvent.press(tab('Owner')!);
    expect(titles()).toEqual(['S1 waiting 1', 'S1 waiting 2']); // Owner / To check
  });

  it('AC10: a live update (my homework checked, a new submission) updates both tabs', async () => {
    const view = await open();
    await fireEvent.press(tab('Listener')!);
    const updated = HOMEWORK.map((h) => (h.id === 'm2a' ? { ...h, status: 'checked' as const } : h)).concat(
      hw({ id: 's1d', courseId: 'A', studentId: 'S1', title: 'S1 waiting 3' }),
    );
    setStore(fakeStore('M2', { courseMembers: members, visibleHomework: updated }));
    await view.rerender(<HomeworkScreen />);
    expect(screen.getByText('Waiting (0)')).toBeTruthy();
    await fireEvent.press(tab('Owner')!);
    expect(screen.getByText('To check (3)')).toBeTruthy();
  });

  it('AC11: empty Listener / Waiting shows "No homework sent yet"', async () => {
    await open({ visibleHomework: HOMEWORK.filter((h) => h.id !== 'm2a') });
    await fireEvent.press(tab('Listener')!);
    await fireEvent.press(screen.getByText('Waiting (0)'));
    expect(screen.getByText('No homework sent yet')).toBeTruthy();
    expect(screen.getByText('Homework you send will appear here.')).toBeTruthy();
  });

  it('AC11: empty Owner lists use the mentor empty state', async () => {
    await open({ visibleHomework: HOMEWORK.filter((h) => h.studentId === 'M2') });
    expect(screen.getByText('Nothing to check')).toBeTruthy();
  });
});

describe('Mentor without a course', () => {
  it('AC6/AC11: with earlier homework, Listener lists it, has no button and shows the no-course hint', async () => {
    setStore(fakeStore('M', { courseMembers: members, visibleHomework: HOMEWORK }));
    await render(<HomeworkScreen />);
    expect(tab('Listener')).toBeTruthy();
    await fireEvent.press(tab('Listener')!);
    expect(filterRow(3)).toEqual(['New (0)', 'Waiting (0)', 'Checked']);
    expect(addButton()).toBeNull();
    expect(screen.getByText('You are not in any course yet — ask your teacher or mentor to add you.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Waiting (0)'));
    expect(screen.getByText('No homework sent yet')).toBeTruthy();
    await fireEvent.press(screen.getAllByText('Checked')[0]);
    expect(titles()).toEqual(['Max earlier']);
  });

  it('AC7: no course and no homework → no switcher, only the Owner view', async () => {
    setStore(fakeStore('N', { courseMembers: members, visibleHomework: HOMEWORK }));
    await render(<HomeworkScreen />);
    expect(tab('Owner')).toBeNull();
    expect(tab('Listener')).toBeNull();
    expect(filterRow(2)).toEqual(['To check (3)', 'Checked']);
    expect(addButton()).toBeNull();
    expect(screen.queryByText('All')).toBeNull();
  });
});

describe('Edge: membership changes while on screen', () => {
  it('losing the switcher while on Listener returns to Owner / To check', async () => {
    const own = HOMEWORK.filter((h) => h.studentId !== 'M2');
    setStore(fakeStore('M2', { courseMembers: members, visibleHomework: own }));
    const view = await render(<HomeworkScreen />);
    await fireEvent.press(tab('Listener')!);
    await fireEvent.press(screen.getAllByText('Checked')[0]);
    // Removed from A and has no homework of their own → no switcher.
    setStore(fakeStore('M2', { courseMembers: [member('A', 'S1')], visibleHomework: own }));
    await view.rerender(<HomeworkScreen />);
    expect(tab('Listener')).toBeNull();
    expect(addButton()).toBeNull();
    expect(titles()).toEqual(['S1 waiting 1', 'S1 waiting 2']); // Owner / To check, not a stale Checked filter
  });

  it('becoming a listener shows the switcher with Owner still selected', async () => {
    setStore(fakeStore('N', { courseMembers: members, visibleHomework: HOMEWORK }));
    const view = await render(<HomeworkScreen />);
    expect(tab('Owner')).toBeNull();
    setStore(fakeStore('N', { courseMembers: [...members, member('A', 'N')], visibleHomework: HOMEWORK }));
    await view.rerender(<HomeworkScreen />);
    expect(tab('Owner')!.props.accessibilityState).toEqual({ selected: true });
  });
});

it('AC8: the teacher sees no switcher and no button; To check (default) / Checked, no All, mentors\' homework included', async () => {
  setStore(fakeStore('T', { courseMembers: members, visibleHomework: HOMEWORK }));
  await render(<HomeworkScreen />);
  expect(tab('Owner')).toBeNull();
  expect(addButton()).toBeNull();
  expect(filterRow(2)).toEqual(['To check (3)', 'Checked']);
  expect(screen.queryByText('All')).toBeNull();
  expect(titles()).toEqual(['S1 waiting 1', 'S1 waiting 2', 'Mo waiting']);
});

// Changed by ARU-32: students get New / Waiting / Checked (default New), no All and no button.
it('AC12: students have no switcher (New / Waiting / Checked)', async () => {
  setStore(fakeStore('S1', { courseMembers: members, visibleHomework: HOMEWORK.filter((h) => h.studentId === 'S1') }));
  await render(<HomeworkScreen />);
  expect(tab('Owner')).toBeNull();
  expect(filterRow(3)).toEqual(['New (0)', 'Waiting (2)', 'Checked']);
  expect(addButton()).toBeNull();
});
