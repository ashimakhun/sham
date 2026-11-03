// ARU-81: course cards on the Courses tab no longer show the "Listener" / "Owner" tag; the section headings say it.
// M owns A and is a listener of B; N owns B and C; S1 in A and B; T owns nothing.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import CoursesScreen from '@/app/(tabs)/courses';
import type { Course, Discipline } from '@/lib/types';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const courseC: Course = { id: 'C', title: 'Chemistry', description: '', createdById: 'N', createdAt: '2026-10-03T10:00:00.000Z' };
const D: Discipline = { id: 'D', name: 'Sciences', hidden: false, createdById: 'T', createdAt: '2026-10-01T10:00:00.000Z' };
const inD = [courseC, courseB, courseA].map((c) => ({ ...c, disciplineId: 'D' }));
const courseMembers = [member('A', 'S1'), member('B', 'S1'), member('B', 'M')];
const counts = (c: Record<string, number>) => (id: string) => c[id] ?? 0;

const headings = () => screen.queryAllByText(/^(COURSES I|NO DISCIPLINE)/).map((t) => t.props.children);
const titles = () => screen.queryAllByText(/^(Algebra|Biology|Chemistry)$/).map((t) => t.props.children);
const noTags = () => {
  expect(screen.queryByText('Listener', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByText('Owner', { includeHiddenElements: true })).toBeNull();
};

type Node = { type?: unknown; props: Record<string, unknown>; children?: (Node | string)[] | null };
/** All text strings under a node, in reading order. */
const texts = (n: Node | string): string[] =>
  typeof n === 'string' ? [n] : (n.children ?? []).flatMap((c) => texts(c as Node | string));
/** The nearest ancestor of a title that is a button: the card (or its content column when it has a chat icon). */
const cardOf = (title: string) => {
  let n = screen.getByText(title) as unknown as { parent: unknown; props: Record<string, unknown> } | null;
  while (n && n.props?.accessibilityRole !== 'button' && n.props?.onClick === undefined && !('onPress' in (n.props ?? {})))
    n = n.parent as typeof n;
  return n as unknown as Node;
};

beforeEach(() => jest.clearAllMocks());

describe('AC 1–AC 3: no tag, sections unchanged', () => {
  it('a student: COURSES I\'M IN without a Listener pill; the title is the first line', async () => {
    setStore(fakeStore('S1', { courses: inD, courseMembers, disciplines: [D] }));
    await render(<CoursesScreen />);
    expect(headings()).toEqual(["COURSES I'M IN"]);
    expect(titles()).toEqual(['Biology', 'Algebra']);
    noTags();
    for (const t of ['Biology', 'Algebra']) expect(texts(cardOf(t))[0]).toBe(t);
  });

  it('a mentor who owns A and attends B: both sections, no tags', async () => {
    setStore(fakeStore('M', { courses: inD, courseMembers, disciplines: [D] }));
    await render(<CoursesScreen />);
    expect(headings()).toEqual(["COURSES I'M IN", 'COURSES I OWN']);
    expect(titles()).toEqual(['Biology', 'Algebra']);
    noTags();
    for (const t of ['Biology', 'Algebra']) expect(texts(cardOf(t))[0]).toBe(t);
  });

  it('an owner: COURSES I OWN without an Owner pill', async () => {
    setStore(fakeStore('N', { courses: inD, courseMembers, disciplines: [D] }));
    await render(<CoursesScreen />);
    expect(headings()).toEqual(['COURSES I OWN']);
    expect(titles()).toEqual(['Chemistry', 'Biology']);
    noTags();
  });

  it('the teacher: NO DISCIPLINE courses, still without tags', async () => {
    setStore(fakeStore('T', { courses: [courseC, courseB, courseA], courseMembers }));
    await render(<CoursesScreen />);
    expect(headings()).toEqual(['NO DISCIPLINE']);
    noTags();
  });
});

describe('AC 4 / AC 5: the rest of the card', () => {
  it('a hidden owned course keeps its Hidden badge, the title first', async () => {
    const H: Course = { ...courseA, hidden: true };
    setStore(fakeStore('M', { courses: [H], courseMembers: [] }));
    await render(<CoursesScreen />);
    noTags();
    expect(screen.getByText('Hidden')).toBeTruthy();
    expect(texts(cardOf('Algebra')).slice(0, 2)).toEqual(['Algebra', 'Hidden']);
  });

  it('a listener card with the chat icon: content read without a tag, chat keeps its label and badge, taps work', async () => {
    setStore(fakeStore('S1', { courses: [courseA], courseMembers: [member('A', 'S1')], unreadCount: counts({ A: 4 }) }));
    await render(<CoursesScreen />);
    noTags();
    const content = cardOf('Algebra');
    expect(content.props.accessibilityLabel).toBeUndefined(); // read from its text, which no longer has a tag
    expect(texts(content)).toEqual(expect.arrayContaining(['Algebra', 'Equations and more']));
    expect(texts(content)).not.toContain('Listener');
    expect(screen.getByRole('button', { name: 'Open chat for Algebra, 4 new messages' })).toBeTruthy();
    await fireEvent.press(screen.getByText('Algebra'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]', params: { id: 'A' } });
  });
});
