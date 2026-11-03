// Icon fonts can't load under Jest (expo-font needs the native asset registry), so icons render as a plain
// element named after the glyph. Screens keep their real behaviour; only the glyph drawing is replaced.
jest.mock('@expo/vector-icons/Ionicons', () => {
  const { createElement } = require('react');
  const { Text } = require('react-native');
  const Ionicons = ({ name, ...props }) => createElement(Text, { ...props, testID: `icon-${name}` }, null);
  return { __esModule: true, default: Ionicons };
});

// AsyncStorage has no native module under Jest; use the in-memory mock the package ships (ARU-79 keeps the Telegram
// card's collapsed choice there).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
