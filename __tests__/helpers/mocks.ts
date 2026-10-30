// Shared jest.mock factories. Each test file calls:
//   jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
//   jest.mock('@/lib/store', () => require('./helpers/mocks').store);
// and then sets the signed-in store with setStore(fakeStore('S1', {...})).
import type { useStore } from '@/lib/store';

type Store = ReturnType<typeof useStore>;

let current: Store | null = null;
export function setStore(s: Store) {
  current = s;
}

export const store = {
  useStore: () => {
    if (!current) throw new Error('setStore() was not called');
    return current;
  },
};

export const params: { id?: string; meetingId?: string; edit?: string; assignmentId?: string } = {};

// The latest focus effect a screen registered, so a test can simulate the screen gaining focus again.
let focusEffect: (() => void | (() => void)) | null = null;
/** Simulates the screen losing and regaining focus (switching tabs, or coming back from a pushed screen). */
export async function refocus() {
  const { act } = require('@testing-library/react-native');
  await act(async () => {
    focusEffect?.();
  });
}

export const expoRouter = {
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => params,
  // Runs once on mount, like a screen gaining focus the first time; refocus() runs it again.
  useFocusEffect: (effect: () => void | (() => void)) => {
    focusEffect = effect;
    return require('react').useEffect(effect, []);
  },
  // The unsaved-changes prompt (ARU-28) is tested through the callback the screen passes.
  usePreventRemove: jest.fn(),
  Stack: { Screen: () => null },
};
