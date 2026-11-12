// ARU-156: on the homework details screen, a photo whose loaded link has expired asks once for a fresh link before
// showing "Photo unavailable".
import { act, render, screen } from '@testing-library/react-native';

import HomeworkDetailScreen from '@/app/homework/[id]';

import { fakeStore, hw, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const item = hw({ id: 'h1', courseId: 'A', photoPath: 'S1/h1.jpg', photoUrl: 'https://signed.example/expired' });
const members = [member('A', 'S1')];
const fail = () => act(async () => screen.getByTestId('homework-photo').props.onError?.({ nativeEvent: { error: '403' } }));

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'h1';
});

it('an expired link: asks once for a fresh one and shows the photo with it', async () => {
  const store = fakeStore('M', { courseMembers: members, visibleHomework: [item] });
  store.getPhotoUrl = jest.fn(async () => 'https://signed.example/fresh');
  setStore(store);
  await render(<HomeworkDetailScreen />);
  await fail();
  expect(store.getPhotoUrl).toHaveBeenCalledTimes(1);
  expect(store.getPhotoUrl).toHaveBeenCalledWith('S1/h1.jpg');
  expect(screen.getByTestId('homework-photo').props.source).toEqual({ uri: 'https://signed.example/fresh' });
  expect(screen.queryByTestId('homework-photo-unavailable')).toBeNull();
});

it('the fresh link fails too: "Photo unavailable", and no more retries', async () => {
  const store = fakeStore('M', { courseMembers: members, visibleHomework: [item] });
  store.getPhotoUrl = jest.fn(async () => 'https://signed.example/fresh');
  setStore(store);
  await render(<HomeworkDetailScreen />);
  await fail();
  await fail();
  expect(screen.getByTestId('homework-photo-unavailable')).toBeTruthy();
  expect(store.getPhotoUrl).toHaveBeenCalledTimes(1);
});

it('no fresh link can be made (file gone, offline): "Photo unavailable"', async () => {
  const store = fakeStore('M', { courseMembers: members, visibleHomework: [item] });
  store.getPhotoUrl = jest.fn(async () => {
    throw new Error('Object not found');
  });
  setStore(store);
  await render(<HomeworkDetailScreen />);
  await fail();
  expect(screen.getByTestId('homework-photo-unavailable')).toBeTruthy();
});
