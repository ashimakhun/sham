// ARU-119: Text and TextInput in the app font. React Native has no app-wide default font, so every screen imports
// these instead of react-native's. Outermost text gets Inter Light 300 unless its style sets a font; text nested inside
// other text adds nothing, so it inherits its parent's face as before (bold Markdown inside a paragraph, for example).
import { type ComponentProps, createContext, useContext } from 'react';
import { Text as RNText, TextInput as RNTextInput } from 'react-native';

import { font } from '@/lib/fonts';

const BASE = font(300);
// Light 300 first, then the caller's style unchanged (an array keeps its own items), so their font wins.
const withBase = <S,>(style: S) => (Array.isArray(style) ? [BASE, ...style] : [BASE, style]);
const InsideText = createContext(false);

export function Text({ style, ...props }: ComponentProps<typeof RNText>) {
  const nested = useContext(InsideText);
  if (nested) return <RNText style={style} {...props} />;
  return (
    <InsideText.Provider value>
      <RNText style={withBase(style)} {...props} />
    </InsideText.Provider>
  );
}

// Refs pass through (React 19: ref is a prop), so screens can still focus an input.
export function TextInput({ style, ...props }: ComponentProps<typeof RNTextInput>) {
  return <RNTextInput style={withBase(style)} {...props} />;
}
