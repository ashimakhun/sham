// ARU-38: Materials tab gets a Blog | Knowledge base switch; blog posts are formatted with the ARU-28 Markdown editor,
// shown formatted on details and as plain text in the list preview. No database change.
import { fireEvent, render, screen } from '@testing-library/react-native';

import MaterialsScreen from '@/app/(tabs)/materials';
import MaterialDetailScreen from '@/app/materials/[id]';
import NewMaterialScreen from '@/app/materials/new';
import { markdownToPlainText } from '@/lib/markdown';
import type { Material } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const SHARE = '+ Share material';
const KB_TITLE = 'No books or files yet';
const KB_HINT = 'PDF books will appear here.';
const LIMIT = 'Content can be at most 10,000 characters.';

const mat = (id: string, teacherId: string, body = 'Body', createdAt = '2026-10-20T10:00:00.000Z'): Material => ({
  id,
  teacherId,
  title: `Material ${id}`,
  body,
  createdAt,
});
const tab = (name: 'Blog' | 'Knowledge base') => screen.getByRole('tab', { name });
const titles = () => screen.queryAllByText(/^Material /).map((n) => n.props.children);

beforeEach(() => jest.clearAllMocks());

describe('markdownToPlainText (AC 9)', () => {
  it.each([
    ['', ''],
    ['plain text', 'plain text'],
    ['**bold** and _italic_ and *star*', 'bold and italic and star'],
    ['**bold _nested_ text**', 'bold nested text'],
    ['see [the docs](https://example.com) now', 'see the docs now'],
    ['- one\n- two\n\n1. first\n2. second', 'one two first second'],
    ['line one\nline two\n\n\npara two', 'line one line two para two'],
    ['**unclosed and _open', '**unclosed and _open'],
    ['[ftp](ftp://x.org) stays', '[ftp](ftp://x.org) stays'],
    ['  - **Bold** item with [link](http://a.b)  ', 'Bold item with link'],
  ])('%j → %j', (source, expected) => {
    expect(markdownToPlainText(source)).toBe(expected);
  });
});

describe('Blog | Knowledge base switch (AC 1–4)', () => {
  it.each(['S1', 'M', 'T'] as const)('%s sees the switch with Blog selected', async (who) => {
    setStore(fakeStore(who, { materials: [mat('t1', 'T')] }));
    await render(<MaterialsScreen />);
    expect(tab('Blog').props.accessibilityState).toEqual({ selected: true });
    expect(tab('Knowledge base').props.accessibilityState).toEqual({ selected: false });
    expect(titles()).toEqual(['Material t1']);
  });

  it('Knowledge base shows only its placeholder: no share button, chips or posts, even for a teacher', async () => {
    setStore(fakeStore('T', { materials: [mat('t1', 'T'), mat('m1', 'M')] }));
    await render(<MaterialsScreen />);
    await fireEvent.press(tab('Knowledge base'));
    expect(tab('Knowledge base').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByText(KB_TITLE)).toBeTruthy();
    expect(screen.getByText(KB_HINT)).toBeTruthy();
    expect(screen.queryByRole('button', { name: SHARE })).toBeNull();
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull();
    expect(titles()).toEqual([]);
    expect(screen.queryByText('No materials yet')).toBeNull();
  });

  it('back to Blog keeps the chosen author chip (minor note 1)', async () => {
    setStore(fakeStore('S1', { materials: [mat('t1', 'T'), mat('m1', 'M', 'Body', '2026-10-21T10:00:00.000Z')] }));
    await render(<MaterialsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Mentor Max' }));
    await fireEvent.press(tab('Knowledge base'));
    await fireEvent.press(tab('Blog'));
    expect(screen.getByRole('button', { name: 'Mentor Max' }).props.accessibilityState).toEqual({ selected: true });
    expect(titles()).toEqual(['Material m1']);
  });

  it('a live update while on Knowledge base keeps the selection and shows up on Blog (AC 10)', async () => {
    setStore(fakeStore('S1', { materials: [mat('t1', 'T')] }));
    await render(<MaterialsScreen />);
    await fireEvent.press(tab('Knowledge base'));
    setStore(fakeStore('S1', { materials: [mat('t1', 'T'), mat('t2', 'T', 'New', '2026-10-25T10:00:00.000Z')] }));
    await screen.rerender(<MaterialsScreen />);
    expect(tab('Knowledge base').props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(tab('Blog'));
    expect(titles()).toEqual(['Material t2', 'Material t1']);
  });

  it('Blog card preview has no Markdown symbols (AC 9)', async () => {
    setStore(fakeStore('S1', { materials: [mat('x', 'T', '**Read** _this_:\n- [chapter 2](https://a.b)\n1. notes')] }));
    await render(<MaterialsScreen />);
    expect(screen.getByText('Read this: chapter 2 notes')).toBeTruthy();
  });
});

describe('Share material with the Markdown editor (AC 5–6)', () => {
  it('Content is the formatting editor labelled "Content"; sharing sends the Markdown', async () => {
    const store = fakeStore('M');
    setStore(store);
    await render(<NewMaterialScreen />);
    for (const name of ['Bold', 'Italic', 'Bulleted list', 'Numbered list', 'Link'])
      expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.getByText('Content')).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Lesson 3: Decimals'), 'Lesson');
    await fireEvent.changeText(screen.getByLabelText('Content'), '**Read** chapter 2');
    await fireEvent.press(screen.getByRole('button', { name: 'Share with class' }));
    expect(store.addMaterial).toHaveBeenCalledWith({ title: 'Lesson', body: '**Read** chapter 2', link: '' });
  });

  it('typing or pasting past 10,000 keeps what fits and shows the Content message', async () => {
    setStore(fakeStore('T'));
    await render(<NewMaterialScreen />);
    await fireEvent.changeText(screen.getByLabelText('Content'), 'a'.repeat(10_050));
    expect(screen.getByText(LIMIT)).toBeTruthy();
    expect(screen.queryByText(/Notes can be at most/)).toBeNull();
    expect(screen.getByText('10,000 / 10,000')).toBeTruthy();
    expect(screen.getByLabelText('Content').props.value).toHaveLength(10_000);
  });

  it('a toolbar edit past the limit shows the Content message', async () => {
    setStore(fakeStore('T'));
    await render(<NewMaterialScreen />);
    await fireEvent.changeText(screen.getByLabelText('Content'), 'a'.repeat(9_999));
    expect(screen.queryByText(LIMIT)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Bold' }));
    expect(screen.getByText(LIMIT)).toBeTruthy();
  });
});

describe('Details (AC 7–8)', () => {
  it('renders the body formatted, with a tappable link', async () => {
    params.id = 'x';
    setStore(fakeStore('S1', { materials: [mat('x', 'T', '**Bold** see [docs](https://a.b)\n- item')] }));
    await render(<MaterialDetailScreen />);
    expect(screen.queryByText(/\*\*/)).toBeNull();
    expect(screen.getByRole('link', { name: 'docs' })).toBeTruthy();
    expect(screen.getByText('item')).toBeTruthy();
  });

  it('an old plain-text post keeps its text and line breaks', async () => {
    params.id = 'x';
    setStore(fakeStore('S1', { materials: [mat('x', 'T', 'Line one\nLine two\n\nPara two')] }));
    await render(<MaterialDetailScreen />);
    expect(screen.getByText('Line one\nLine two')).toBeTruthy();
    expect(screen.getByText('Para two')).toBeTruthy();
  });
});
