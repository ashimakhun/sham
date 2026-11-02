// QA ARU-54: gaps in aru54-full-blog-cards.test.tsx: the card renders exactly what the post screen renders, every
// non-link part of the card opens the post, a 10,000-character post is whole, several cards each get their own body,
// the author filter and the Knowledge base tab are unchanged, and a failing link open doesn't crash.
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Linking } from 'react-native';

import MaterialsScreen from '@/app/(tabs)/materials';
import MaterialDetailScreen from '@/app/materials/[id]';
import type { Material, MaterialFile } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const post = (id: string, body: string, over: Partial<Material> = {}): Material => ({
  id,
  teacherId: 'T',
  title: `Post ${id}`,
  body,
  createdAt: '2026-10-20T10:00:00.000Z',
  ...over,
});
const FORMATTED = '**Read** _this_:\n- [chapter 2](https://a.b)\n- second\n1. notes\n2. more\n\nPlain [bad](javascript:alert(1)) end.';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});

/** The text pieces MarkdownText rendered, as a comparable string. */
const flat = (c: unknown): string =>
  typeof c === 'string' || typeof c === 'number'
    ? String(c)
    : Array.isArray(c)
      ? c.map(flat).join('')
      : c && typeof c === 'object' && 'props' in c
        ? flat((c as { props: { children?: unknown; nodes?: { text?: string }[] } }).props.children ??
            (c as { props: { nodes?: { text?: string }[] } }).props.nodes?.map((x) => x.text ?? '').join(''))
        : '';
const texts = (scope: ReturnType<typeof within>) =>
  JSON.stringify(scope.queryAllByText(/./).map((n) => [flat(n.props.children), JSON.stringify(n.props.style ?? null)]));

it('AC2: the card renders the same formatted body as the post screen', async () => {
  const A = post('A', FORMATTED);
  setStore(fakeStore('S1', { materials: [A] }));
  const list = await render(<MaterialsScreen />);
  const inCard = within(screen.getByTestId('markdown'));
  const cardTexts = texts(inCard);
  const cardLinks = inCard.queryAllByRole('link').map((n) => n.props.children);
  await list.unmount();

  params.id = 'A';
  await render(<MaterialDetailScreen />);
  const onPost = within(screen.getByTestId('markdown'));
  expect(texts(onPost)).toBe(cardTexts);
  expect(onPost.queryAllByRole('link').map((n) => n.props.children)).toEqual(cardLinks);
  expect(cardLinks).toEqual(['chapter 2']);
});

it('AC5: tapping the title, plain body text, a list item or the author line opens the post', async () => {
  setStore(fakeStore('S1', { materials: [post('A', FORMATTED)] }));
  await render(<MaterialsScreen />);
  for (const target of [screen.getByText('Post A'), screen.getByText('second'), screen.getByText('notes'), screen.getByText(/Teacher Tess · /)]) {
    jest.mocked(router.push).mockClear();
    await fireEvent.press(target);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/materials/[id]', params: { id: 'A' } });
  }
});

it('AC4 / edge: the unsafe link text opens the post, not the URL', async () => {
  setStore(fakeStore('S1', { materials: [post('A', FORMATTED)] }));
  await render(<MaterialsScreen />);
  expect(within(screen.getByTestId('markdown')).queryByRole('link', { name: 'bad' })).toBeNull();
  await fireEvent.press(screen.getByText(/bad/));
  expect(Linking.openURL).not.toHaveBeenCalled();
  expect(router.push).toHaveBeenCalledWith({ pathname: '/materials/[id]', params: { id: 'A' } });
});

it('edge offline: a link that fails to open does not crash or open the post', async () => {
  jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('No app to open it'));
  setStore(fakeStore('S1', { materials: [post('A', FORMATTED)] }));
  await render(<MaterialsScreen />);
  await fireEvent.press(screen.getByRole('link', { name: 'chapter 2' }));
  expect(Linking.openURL).toHaveBeenCalledWith('https://a.b');
  expect(router.push).not.toHaveBeenCalled();
  expect(screen.getByText('Post A')).toBeTruthy();
});

it('AC1 / edge: a 10,000-character post is shown whole, last word included', async () => {
  const body = 'x'.repeat(9990) + ' LAST WORD';
  expect(body).toHaveLength(10000);
  setStore(fakeStore('S1', { materials: [post('A', body)] }));
  await render(<MaterialsScreen />);
  const text = screen.getByText(body);
  expect(text.props.numberOfLines).toBeUndefined();
});

it('AC7: each card gets its own body, newest first, and the author filter still works', async () => {
  const A = post('A', 'Body of A', { createdAt: '2026-10-20T10:00:00.000Z' });
  const B = post('B', 'Body of **B**', { teacherId: 'M', createdAt: '2026-10-22T10:00:00.000Z' });
  setStore(fakeStore('S1', { materials: [A, B] }));
  await render(<MaterialsScreen />);
  const bodies = screen.getAllByTestId('markdown');
  expect(bodies).toHaveLength(2);
  expect(within(bodies[0]).getByText('B')).toBeTruthy();
  expect(within(bodies[1]).getByText('Body of A')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: /Mentor Max/ }));
  expect(screen.getAllByTestId('markdown')).toHaveLength(1);
  expect(screen.queryByText('Body of A')).toBeNull();
});

it('AC7: the Knowledge base cards are unchanged (description still cut at 2 lines, no Markdown)', async () => {
  const f: MaterialFile = {
    id: 'f',
    authorId: 'T',
    name: 'Book',
    description: '**Not** formatted here',
    storagePath: 'T/f.pdf',
    sizeBytes: 10,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  };
  setStore(fakeStore('S1', { materials: [post('A', 'x')], materialFiles: [f] }));
  await render(<MaterialsScreen />);
  await fireEvent.press(screen.getByRole('tab', { name: 'Knowledge base' }));
  expect(screen.queryAllByTestId('markdown')).toHaveLength(0);
  expect(screen.getByText('**Not** formatted here').props.numberOfLines).toBe(2);
});
