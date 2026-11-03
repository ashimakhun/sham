// ARU-64: the formatting toolbar offers only Bold, Italic, Bulleted list and Numbered list; Link and its URL field
// are gone. Saved or hand-typed `[text](url)` links still render through MarkdownText.
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { useState } from 'react';
import { Linking } from 'react-native';

import { MarkdownEditor } from '@/components/MarkdownEditor';
import { MarkdownText } from '@/components/MarkdownText';

function Harness({ initial = '' }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return <MarkdownEditor value={v} onChange={setV} />;
}

const FOUR = ['Bold', 'Italic', 'Bulleted list', 'Numbered list'];

describe('ARU-64 formatting toolbar', () => {
  it('has exactly four buttons in order, each at least 44 pt, and no Link', async () => {
    await render(<Harness />);
    const toolbar = screen.getByLabelText('Formatting');
    const buttons = within(toolbar).getAllByRole('button');
    expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual(FOUR);
    for (const b of buttons) expect(b.props.style).toMatchObject({ minWidth: 44, height: 44 });
    expect(screen.queryByRole('button', { name: 'Link' })).toBeNull();
  });

  it('pressing every tool never shows the Link URL field or Add link / Cancel', async () => {
    await render(<Harness initial="hello" />);
    const notes = screen.getByLabelText('Notes');
    for (const name of FOUR) {
      await fireEvent(notes, 'selectionChange', { nativeEvent: { selection: { start: 0, end: 5 } } });
      await fireEvent.press(screen.getByRole('button', { name }));
      expect(screen.queryByLabelText('Link URL')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add link' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Cancel link' })).toBeNull();
    }
  });

  it('Bold still wraps the selection', async () => {
    await render(<Harness initial="hello" />);
    const notes = screen.getByLabelText('Notes');
    await fireEvent(notes, 'selectionChange', { nativeEvent: { selection: { start: 0, end: 5 } } });
    await fireEvent.press(screen.getByRole('button', { name: 'Bold' }));
    expect(screen.getByLabelText('Notes').props.value).toBe('**hello**');
  });

  it('keeps existing link markup as plain text in the field', async () => {
    await render(<Harness initial="see [docs](https://x.io)" />);
    expect(screen.getByLabelText('Notes').props.value).toBe('see [docs](https://x.io)');
  });

  it('saved links still render and open', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    await render(<MarkdownText source="see [docs](https://x.io)" />);
    await fireEvent.press(screen.getByText('docs'));
    expect(open).toHaveBeenCalledWith('https://x.io');
  });
});
