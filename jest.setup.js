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

// ARU-105: expo-image-manipulator has no native module under Jest. This stand-in keeps the uri, applies resize() to
// the dimensions and returns a base64 of the requested size. Tests describe a picked photo with
// require('expo-image-manipulator').__setImage(uri, { width, height, bytes, out, fail }).
jest.mock('expo-image-manipulator', () => {
  const images = new Map();
  const manipulate = jest.fn((uri) => {
    const info = { width: 1, height: 1, bytes: 1200, ...images.get(uri) };
    let width = info.width;
    let height = info.height;
    const ref = () => ({
      width,
      height,
      saveAsync: jest.fn(async () => {
        if (info.fail === 'save') throw new Error('Could not save the image');
        return { uri: info.out ?? uri, width, height, base64: 'A'.repeat(Math.ceil(info.bytes / 3) * 4) };
      }),
    });
    const context = {
      resize: jest.fn((size) => {
        if (size.width) {
          height = Math.round((height * size.width) / width);
          width = size.width;
        } else if (size.height) {
          width = Math.round((width * size.height) / height);
          height = size.height;
        }
        return context;
      }),
      renderAsync: jest.fn(async () => {
        if (info.fail === true || info.fail === 'render') throw new Error('Could not decode the image');
        return ref();
      }),
    };
    return context;
  });
  return {
    ImageManipulator: { manipulate },
    SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
    __setImage: (uri, info) => images.set(uri, info),
    __reset: () => images.clear(),
  };
});

// ARU-119: the Inter faces can't load under Jest (no native font registry). useFonts reports them loaded, so the root
// layout renders; tests that need the startup or failure path override it with
// require('expo-font').useFonts.mockReturnValueOnce([false, null]) (or [false, new Error(...)]).
jest.mock('expo-font', () => ({
  useFonts: jest.fn(() => [true, null]),
  isLoaded: jest.fn(() => true),
  loadAsync: jest.fn(async () => {}),
}));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => true),
  hideAsync: jest.fn(async () => {}),
  hide: jest.fn(),
  setOptions: jest.fn(),
}));
