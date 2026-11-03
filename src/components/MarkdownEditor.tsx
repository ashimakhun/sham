import { useRef, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, type TextInputInstance, useWindowDimensions, View } from 'react-native';

import { ErrorText, styles } from '@/components/ui';
import { type Edit, NOTES_MAX, notesCounter, type Selection, toggleList, toggleWrap } from '@/lib/markdown';
import { colors } from '@/lib/theme';
import { useKeyboardHeight } from '@/lib/useKeyboardHeight';

type Props = {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
  /** What the screen reader calls the text field (ARU-38: "Content" on Share material). */
  accessibilityLabel?: string;
  /** Shown when an edit would go past `maxLength`; defaults to the meeting-notes wording. */
  limitMessage?: string;
};

const TOOLS = [
  { key: 'bold', label: 'Bold', glyph: 'B', glyphStyle: { fontWeight: '800' as const } },
  { key: 'italic', label: 'Italic', glyph: 'I', glyphStyle: { fontStyle: 'italic' as const, fontFamily: 'serif' } },
  { key: 'bullets', label: 'Bulleted list', glyph: '•', glyphStyle: { fontSize: 22 } },
  { key: 'numbers', label: 'Numbered list', glyph: '1.', glyphStyle: {} },
] as const;
type Tool = (typeof TOOLS)[number]['key'];

/** Room for everything but the field with the keyboard open: header, topic line, toolbar, gaps and padding, Save. */
const OTHER_CONTENT = 300;
/** The field never gets shorter than about four lines. */
const MIN_OPEN = 96;

/**
 * Multi-line text editor with a formatting toolbar above it (ARU-28; reusable for ARU-30): Bold, Italic, Bulleted
 * list and Numbered list act on the selection or the current line and store Markdown (src/lib/markdown.ts). There is
 * no Link tool (ARU-64); links typed by hand as `[text](url)` are kept as plain text and still render when viewed.
 * Typing past `maxLength` is blocked, and a counter shows near the limit.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  maxLength = NOTES_MAX,
  accessibilityLabel = 'Notes',
  limitMessage,
}: Props) {
  const tooLong = limitMessage ?? `Notes can be at most ${maxLength.toLocaleString('en-US')} characters.`;
  const selection = useRef<Selection>({ start: value.length, end: value.length });
  // Set only right after a toolbar edit, so the cursor lands where the edit put it; cleared on the next change.
  const [forced, setForced] = useState<Selection>();
  const [error, setError] = useState<string | null>(null);
  const input = useRef<TextInputInstance>(null);
  // Bounded, so the field never pushes Save off screen; longer text scrolls inside it (ARU-58). While the keyboard is
  // open, the field only takes the room left above it after the header, toolbar and Save, so a 4-line note
  // on an iPhone still leaves Save and some form to drag (which closes the keyboard) above the keyboard.
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const closedMax = Math.round(windowHeight * 0.4);
  const maxHeight =
    keyboardHeight > 0
      ? Math.min(closedMax, Math.max(MIN_OPEN, windowHeight - keyboardHeight - OTHER_CONTENT))
      : Math.max(160, closedMax);
  const minHeight = Math.min(160, maxHeight);

  function apply(edit: Edit) {
    if (edit.text.length > maxLength) {
      setError(tooLong);
      return;
    }
    setError(null);
    selection.current = edit.selection;
    setForced(edit.selection);
    onChange(edit.text);
    input.current?.focus();
  }

  function onTool(tool: Tool) {
    const sel = selection.current;
    if (tool === 'bold') apply(toggleWrap(value, sel, '**'));
    else if (tool === 'italic') apply(toggleWrap(value, sel, '_'));
    else apply(toggleList(value, sel, tool));
  }

  const counter = notesCounter(value.length);

  return (
    <View style={{ gap: 8 }}>
      <View
        accessibilityRole="toolbar"
        accessibilityLabel="Formatting"
        style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {TOOLS.map((t) => (
          <Pressable
            key={t.key}
            accessibilityRole="button"
            accessibilityLabel={t.label}
            onPress={() => onTool(t.key)}
            style={({ pressed }) => ({
              minWidth: 44,
              height: 44,
              paddingHorizontal: 10,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.primarySoft : colors.card,
            })}>
            <Text style={[{ fontSize: 16, color: colors.text }, t.glyphStyle]}>{t.glyph}</Text>
          </Pressable>
        ))}
        {/* Return adds a line in a multiline field, so this is the explicit way out while typing (ARU-58). */}
        {keyboardHeight > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Hide keyboard"
            onPress={() => Keyboard.dismiss()}
            style={({ pressed }) => ({
              height: 44,
              paddingHorizontal: 12,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 'auto',
              backgroundColor: pressed ? colors.primarySoft : 'transparent',
            })}>
            <Text style={{ fontSize: 16, color: colors.primary, fontWeight: '600' }}>Done</Text>
          </Pressable>
        )}
      </View>

      <TextInput
        ref={input}
        accessibilityLabel={accessibilityLabel}
        multiline
        value={value}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        maxLength={maxLength}
        selection={forced}
        onSelectionChange={(e) => {
          selection.current = e.nativeEvent.selection;
          if (forced) setForced(undefined);
        }}
        onChangeText={(text) => {
          if (forced) setForced(undefined);
          // Typing or pasting past the limit: keep what fits and say why the rest was not added (ARU-38). The native
          // maxLength already cuts on iOS / Android; this also covers web and reaching the limit exactly.
          const hitLimit = text.length > maxLength || (text.length === maxLength && text.length > value.length);
          setError(hitLimit ? tooLong : null);
          onChange(text.length > maxLength ? text.slice(0, maxLength) : text);
        }}
        scrollEnabled
        textAlignVertical="top"
        style={[styles.input, { minHeight, maxHeight }]}
      />
      {counter && (
        <Text
          accessibilityLabel={`${value.length} of ${maxLength} characters`}
          style={[
            styles.muted,
            { textAlign: 'right', color: value.length >= maxLength ? colors.danger : colors.muted },
          ]}>
          {counter}
        </Text>
      )}
      <ErrorText error={error} />
    </View>
  );
}
