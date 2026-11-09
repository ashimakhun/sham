import { Fragment } from 'react';
import { Linking, View } from 'react-native';

import { Text } from '@/components/AppText';

import { styles } from '@/components/ui';
import { type Inline, parseMarkdown } from '@/lib/markdown';
import { font } from '@/lib/fonts';
import { colors } from '@/lib/theme';

/** Bold is Inter SemiBold 600 and italic Inter Light Italic (ARU-119); bold italic is SemiBold Italic. Each face is
 *  its own font, so nested marks pass down what is already on. */
type Marks = { bold?: boolean; italic?: boolean };
const face = (m: Marks) => font(m.bold ? 600 : 300, !!m.italic);

function InlineText({ nodes, marks = {} }: { nodes: Inline[]; marks?: Marks }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case 'text':
            return <Fragment key={i}>{n.text}</Fragment>;
          case 'bold': {
            const next = { ...marks, bold: true };
            return (
              <Text key={i} style={face(next)}>
                <InlineText nodes={n.children} marks={next} />
              </Text>
            );
          }
          case 'italic': {
            const next = { ...marks, italic: true };
            return (
              <Text key={i} style={face(next)}>
                <InlineText nodes={n.children} marks={next} />
              </Text>
            );
          }
          case 'link':
            return (
              <Text
                key={i}
                accessibilityRole="link"
                style={{ color: colors.primary, textDecorationLine: 'underline' }}
                onPress={() => Linking.openURL(n.url).catch(() => {})}>
                {n.text}
              </Text>
            );
        }
      })}
    </>
  );
}

/** Shows Markdown-subset text formatted (bold, italic, lists, tappable web links), never as raw Markdown
 *  (ARU-28; reusable for ARU-30). See src/lib/markdown.ts for the supported syntax. */
export function MarkdownText({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <View style={{ gap: 10 }} testID="markdown">
      {blocks.map((b, i) => {
        if (b.type === 'paragraph') {
          return (
            <Text key={i} style={styles.body}>
              {b.lines.map((line, j) => (
                <Fragment key={j}>
                  {j > 0 ? '\n' : null}
                  <InlineText nodes={line} />
                </Fragment>
              ))}
            </Text>
          );
        }
        const items =
          b.type === 'bullets'
            ? b.items.map((content) => ({ mark: '•', content }))
            : b.items.map((it) => ({ mark: `${it.n}.`, content: it.content }));
        return (
          <View key={i} style={{ gap: 4 }} accessibilityRole="list">
            {items.map((it, j) => (
              <View key={j} style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={[styles.body, { minWidth: 18, textAlign: 'right' }]}>{it.mark}</Text>
                <Text style={[styles.body, { flex: 1 }]}>
                  <InlineText nodes={it.content} />
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}
