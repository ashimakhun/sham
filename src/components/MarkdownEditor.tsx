import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, type TextInputInstance, View } from 'react-native';

import { ErrorText, styles } from '@/components/ui';
import { type Edit, insertLink, NOTES_MAX, notesCounter, type Selection, toggleList, toggleWrap } from '@/lib/markdown';
import { colors } from '@/lib/theme';

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
  { key: 'link', label: 'Link', glyph: 'Link', glyphStyle: { textDecorationLine: 'underline' as const } },
] as const;
type Tool = (typeof TOOLS)[number]['key'];

/**
 * Multi-line text editor with a formatting toolbar above it (ARU-28; reusable for ARU-30): Bold, Italic, Bulleted
 * list, Numbered list and Link act on the selection or the current line and store Markdown (src/lib/markdown.ts).
 * Link asks for an http/https URL in an inline field (works on iOS, Android and web). Typing past `maxLength` is
 * blocked, and a counter shows near the limit.
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
  const [linkFor, setLinkFor] = useState<Selection>();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<TextInputInstance>(null);

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
    else if (tool === 'bullets' || tool === 'numbers') apply(toggleList(value, sel, tool));
    else {
      setError(null);
      setUrl('');
      setLinkFor(sel);
    }
  }

  function addLink() {
    if (!linkFor) return;
    const result = insertLink(value, linkFor, url);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setLinkFor(undefined);
    apply(result);
  }

  const counter = notesCounter(value.length);

  return (
    <View style={{ gap: 8, flex: 1 }}>
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
              backgroundColor: pressed || (t.key === 'link' && linkFor) ? colors.primarySoft : colors.card,
            })}>
            <Text style={[{ fontSize: 16, color: colors.text }, t.glyphStyle]}>{t.glyph}</Text>
          </Pressable>
        ))}
      </View>

      {linkFor && (
        <View style={{ gap: 6 }}>
          <TextInput
            accessibilityLabel="Link URL"
            placeholder="https://…"
            placeholderTextColor={colors.muted}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            autoFocus
            onSubmitEditing={addLink}
            style={styles.input}
          />
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Add link" hitSlop={8} onPress={addLink}>
              <Text style={{ color: colors.primary, fontWeight: '600' }}>Add link</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel link"
              hitSlop={8}
              onPress={() => {
                setLinkFor(undefined);
                setError(null);
              }}>
              <Text style={{ color: colors.muted, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}

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
        style={[styles.input, { flex: 1, minHeight: 200 }]}
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
