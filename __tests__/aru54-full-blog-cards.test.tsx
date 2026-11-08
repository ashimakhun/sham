// ARU-54: Blog list cards show the whole post body, formatted as on the post screen (MarkdownText); links in the body
// open their URL, and the rest of the card still opens the post.
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Linking } from 'react-native';

import MaterialsScreen from '@/app/(tabs)/materials';
import type { Material, MaterialLike } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';
import { font } from '@/lib/fonts';

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
const FORMATTED = '**Read** _this_:\n- [chapter 2](https://a.b)\n- second\n1. notes\n2. more';
const LONG = Array.from({ length: 40 }, (_, i) => `Sentence number ${i + 1} of a long post.`).join(' ') + ' THE END.';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});

const card = () => within(screen.getByTestId('markdown'));

it('AC1: the whole body is shown, with no line limit', async () => {
  setStore(fakeStore('S1', { materials: [post('A', `First paragraph.\n\nSecond paragraph.\n\n${LONG}`)] }));
  await render(<MaterialsScreen />);
  const long = screen.getByText(LONG);
  expect(long.props.numberOfLines).toBeUndefined();
  expect(screen.getByText('First paragraph.')).toBeTruthy();
  expect(screen.getByText('Second paragraph.')).toBeTruthy();
});

it('AC2: bold, italic, bullets, numbers and links are formatted; no raw Markdown', async () => {
  setStore(fakeStore('S1', { materials: [post('A', FORMATTED)] }));
  await render(<MaterialsScreen />);
  expect(card().getByText('Read').props.style).toEqual(font(600)); // ARU-119: bold is Inter SemiBold 600
  expect(card().getByText('this').props.style).toEqual(font(300, true)); // ARU-119: italic is Inter Light Italic
  expect(card().getAllByText('•')).toHaveLength(2);
  expect(card().getByText('1.')).toBeTruthy();
  expect(card().getByText('2.')).toBeTruthy();
  expect(card().getByRole('link', { name: 'chapter 2' })).toBeTruthy();
  expect(screen.queryByText(/\*\*|\]\(|^- |^1\. /)).toBeNull();
});

it('AC3: an old plain-text post keeps its line breaks', async () => {
  setStore(fakeStore('S1', { materials: [post('A', 'line one\nline two\n\npara two')] }));
  await render(<MaterialsScreen />);
  expect(screen.getByText('line one\nline two')).toBeTruthy();
  expect(screen.getByText('para two')).toBeTruthy();
});

it('AC4: tapping a link opens the URL, not the post', async () => {
  const { router } = require('expo-router');
  setStore(fakeStore('S1', { materials: [post('A', FORMATTED)] }));
  await render(<MaterialsScreen />);
  await fireEvent.press(card().getByRole('link', { name: 'chapter 2' }));
  expect(Linking.openURL).toHaveBeenCalledWith('https://a.b');
  expect(router.push).not.toHaveBeenCalled();
});

it('AC4: an unsafe link is plain text, not a link', async () => {
  setStore(fakeStore('S1', { materials: [post('A', 'See [this](javascript:alert(1)) now')] }));
  await render(<MaterialsScreen />);
  expect(screen.queryByRole('link')).toBeNull();
});

it.each([
  ['the title', () => screen.getByRole('button', { name: 'Post A' })],
  ['body text', () => screen.getByText('second')],
  ['the author line', () => screen.getByText(/Teacher Tess · /)],
])('AC5: tapping %s opens the post', async (_what, target) => {
  const { router } = require('expo-router');
  setStore(fakeStore('S1', { materials: [post('A', FORMATTED)] }));
  await render(<MaterialsScreen />);
  await fireEvent.press(target());
  expect(router.push).toHaveBeenCalledWith({ pathname: '/materials/[id]', params: { id: 'A' } });
});

it('AC6: title above the body; author · date, link marker and likes below it', async () => {
  const likes: MaterialLike[] = [{ materialId: 'A', userId: 'S1', createdAt: '2026-10-25T10:00:00.000Z' }];
  setStore(fakeStore('S1', { materials: [post('A', 'Body', { link: 'https://x.y' })], materialLikes: likes }));
  await render(<MaterialsScreen />);
  // Matches come back in screen order.
  const order = screen.getAllByText(/^(Post A|Body)$|^Teacher Tess · /);
  expect(order).toEqual([screen.getByText('Post A'), screen.getByText('Body'), screen.getByText(/^Teacher Tess · /)]);
  expect(screen.getByText(/Teacher Tess · .* · 🔗 link/)).toBeTruthy();
  expect(screen.getByLabelText('1 like')).toBeTruthy();
});

it('AC8: the title is its own button and links are separate elements (the card is not grouped)', async () => {
  setStore(fakeStore('S1', { materials: [post('A', FORMATTED)] }));
  await render(<MaterialsScreen />);
  expect(screen.getByRole('button', { name: 'Post A' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'chapter 2' })).toBeTruthy();
});
