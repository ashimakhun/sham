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

// ARU-166: expo-notifications has no native module under Jest. Permission, channel, token and handler calls are
// jest.fn()s; a test sets the permission with require('expo-notifications').__setPermission({ status, ios }) and what
// asking answers with __setAnswer(...), and reads the calls from the mocks.
jest.mock('expo-notifications', () => {
  const state = { permission: { status: 'undetermined', granted: false, canAskAgain: true }, answer: null };
  const IosAuthorizationStatus = { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 };
  return {
    IosAuthorizationStatus,
    AndroidImportance: { UNKNOWN: 0, UNSPECIFIED: 1, NONE: 2, MIN: 3, LOW: 4, DEFAULT: 5, HIGH: 6, MAX: 7 },
    getPermissionsAsync: jest.fn(async () => state.permission),
    requestPermissionsAsync: jest.fn(async () => {
      state.permission = state.answer ?? { status: 'granted', granted: true, canAskAgain: true };
      return state.permission;
    }),
    setNotificationChannelAsync: jest.fn(async (id, channel) => ({ id, ...channel })),
    getExpoPushTokenAsync: jest.fn(async () => ({ type: 'expo', data: 'ExponentPushToken[test-token]' })),
    setNotificationHandler: jest.fn(),
    __setPermission: (p) => {
      state.permission = { granted: p.status === 'granted', canAskAgain: true, ...p };
    },
    __setAnswer: (p) => {
      state.answer = p ? { granted: p.status === 'granted', canAskAgain: true, ...p } : null;
    },
    __reset: () => {
      state.permission = { status: 'undetermined', granted: false, canAskAgain: true };
      state.answer = null;
    },
  };
});
