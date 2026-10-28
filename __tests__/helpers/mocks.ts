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

export const params: { id?: string } = {};

export const expoRouter = {
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => params,
  // Runs once on mount, like a screen gaining focus the first time.
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, []),
};
