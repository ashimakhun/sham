// ARU-38 QA additions to aru38-materials-blog-kb.test.tsx, from the TEST DESIGN: Blog empty states and share button
// per role (AC 3), pull-to-refresh only on Blog (analysis note 7), Share disabled for blank or whitespace Content and
// the text kept on a failed share (AC 5, edge case offline), author-only Delete and "Open link" on details (AC 7),
// unsafe links in a post never tappable (ARU-28 link rule), meeting notes keeping their own limit wording (AC 6),
// and the shared Segmented switch announcing its selected state on the Homework tab too (analysis note 6).
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import HomeworkScreen from '@/app/(tabs)/homework';
import MaterialsScreen from '@/app/(tabs)/materials';
import MaterialDetailScreen from '@/app/materials/[id]';
import NewMaterialScreen from '@/app/materials/new';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import type { Material } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

const SHARE = '+ Share material';
const mat = (id: string, teacherId: string, over: Partial<Material> = {}): Material => ({
  id,
  teacherId,
  title: `Material ${id}`,
  body: 'Body',
  createdAt: '2026-10-20T10:00:00.000Z',
  ...over,
});
const tab = (name: 'Blog' | 'Knowledge base') => screen.getByRole('tab', { name });
const refreshable = (container: Awaited<ReturnType<typeof render>>['container']) =>
  container.queryAll((n) => typeof n.props.onRefresh === 'function');

beforeEach(() => jest.clearAllMocks());

describe('Blog (AC 3)', () => {
  it.each([
    ['T', true, 'Share a lesson, notes or a link with your class.'],
    ['M', true, 'Share a lesson, notes or a link with your class.'],
    ['S1', false, 'Your teacher and mentors have not shared anything yet.'],
  ] as const)('%s: share button %s, empty state with the role hint, no author chips', async (who, share, hint) => {
    setStore(fakeStore(who));
    await render(<MaterialsScreen />);
    expect(!!screen.queryByRole('button', { name: SHARE })).toBe(share);
    expect(screen.getByText('No materials yet')).toBeTruthy();
    expect(screen.getByText(hint)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull();
  });

  it('pull-to-refresh works on Blog and is off on Knowledge base (analysis note 7)', async () => {
    const store = fakeStore('S1', { materials: [mat('a', 'T')] });
    setStore(store);
    const { container } = await render(<MaterialsScreen />);
    const [list] = refreshable(container);
    await act(async () => list.props.onRefresh());
    expect(store.refresh).toHaveBeenCalledTimes(1);
    await fireEvent.press(tab('Knowledge base'));
    expect(refreshable(container)).toHaveLength(0);
    await fireEvent.press(tab('Blog'));
    expect(refreshable(container)).toHaveLength(1);
  });
});

describe('Share material (AC 5, offline edge case)', () => {
  it.each([
    ['blank content', 'Lesson', ''],
    ['whitespace-only content', 'Lesson', '   \n  '],
    ['blank title', '  ', '**Read**'],
  ])('Share stays disabled with %s', async (_label, title, body) => {
    setStore(fakeStore('T'));
    await render(<NewMaterialScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Lesson 3: Decimals'), title);
    await fireEvent.changeText(screen.getByLabelText('Content'), body);
    expect(screen.getByRole('button', { name: 'Share with class' })).toBeDisabled();
  });

  it('a failed share shows the error and keeps Title, Content and Link', async () => {
    const addMaterial = jest.fn().mockRejectedValue(new Error('Network request failed'));
    setStore(fakeStore('M', { addMaterial }));
    await render(<NewMaterialScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Lesson 3: Decimals'), 'Lesson');
    await fireEvent.changeText(screen.getByLabelText('Content'), '- one\n- two');
    await fireEvent.changeText(screen.getByPlaceholderText('https://…'), 'https://a.b');
    await fireEvent.press(screen.getByRole('button', { name: 'Share with class' }));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(screen.getByLabelText('Content').props.value).toBe('- one\n- two');
    expect(screen.getByDisplayValue('Lesson')).toBeTruthy();
    expect(screen.getByDisplayValue('https://a.b')).toBeTruthy();
  });
});

describe('Details (AC 7)', () => {
  const post = mat('x', 'M', { body: '**Read** [notes](https://a.b) and [bad](javascript:alert(1))', link: 'https://x.y' });

  it.each([
    ['M', true],
    ['T', false],
    ['N', false],
    ['S1', false],
  ] as const)('%s: "Open link" shows; Delete only for the author (%s)', async (who, canDelete) => {
    params.id = 'x';
    setStore(fakeStore(who, { materials: [post] }));
    await render(<MaterialDetailScreen />);
    expect(screen.getByRole('button', { name: 'Open link' })).toBeTruthy();
    expect(!!screen.queryByRole('button', { name: 'Delete material' })).toBe(canDelete);
  });

  it('only http/https links are tappable; a javascript: link stays literal text', async () => {
    params.id = 'x';
    setStore(fakeStore('S1', { materials: [post] }));
    await render(<MaterialDetailScreen />);
    expect(screen.getByRole('link', { name: 'notes' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull();
    expect(screen.getByText(/\[bad\]\(javascript:alert\(1\)\)/)).toBeTruthy();
  });
});

describe('Regressions in shared components', () => {
  function NotesEditor() {
    const [value, setValue] = useState('');
    return <MarkdownEditor value={value} onChange={setValue} />;
  }

  it('AC 6: the meeting-notes editor keeps "Notes" and its own limit message when pasting past 10,000', async () => {
    await render(<NotesEditor />);
    await fireEvent.changeText(screen.getByLabelText('Notes'), 'b'.repeat(10_200));
    expect(screen.getByText('Notes can be at most 10,000 characters.')).toBeTruthy();
    expect(screen.queryByText(/Content can be at most/)).toBeNull();
    expect(screen.getByLabelText('Notes').props.value).toHaveLength(10_000);
  });

  it('analysis note 6: each Homework tab switch is a tab list with exactly one selected tab', async () => {
    setStore(fakeStore('M', { courseMembers: [member('B', 'M')] }));
    const { container } = await render(<HomeworkScreen />);
    const lists = container.queryAll((n) => n.props.accessibilityRole === 'tablist');
    expect(lists.length).toBeGreaterThanOrEqual(1);
    for (const list of lists) {
      const tabs = list.queryAll((n) => n.props.accessibilityRole === 'tab');
      expect(tabs.length).toBeGreaterThanOrEqual(2);
      expect(tabs.filter((t) => t.props.accessibilityState?.selected)).toHaveLength(1);
    }
  });
});
