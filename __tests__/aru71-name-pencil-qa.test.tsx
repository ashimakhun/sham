// QA ARU-71: gaps in aru71-name-pencil.test.tsx: after a rename the pencil sits next to the new name, a failed save
// followed by Cancel brings the pencil back next to the old name, a long unbroken Cyrillic name is never cut, the
// ARU-55 checks still work through the pencil, and only the name card has the pencil.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import { EDIT_NAME_ICON } from '@/components/ProfileNameCard';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

beforeEach(() => jest.clearAllMocks());

const pencil = () => screen.getByRole('button', { name: 'Edit name' });
const save = () => screen.getByRole('button', { name: /^(Save|Saving…)$/ });
/** The row holding the name: the name text, then the pencil, and nothing else. */
const rowOf = (name: string) => screen.getByText(name).parent!.parent!;

it('AC 4: after a rename, the pencil sits right after the new name', async () => {
  const store = fakeStore('S1');
  setStore(store);
  const view = await render(<ProfileScreen />);
  await fireEvent.press(pencil());
  await fireEvent.changeText(screen.getByDisplayValue(users.S1.name), 'Dana Serikova');
  await fireEvent.press(save());
  await waitFor(() => expect(store.updateMyName).toHaveBeenCalledWith('Dana Serikova'));
  setStore(fakeStore('S1', { currentUser: { ...users.S1, name: 'Dana Serikova' } }));
  await view.rerender(<ProfileScreen />);
  const row = rowOf('Dana Serikova');
  expect(within(row).getByRole('button', { name: 'Edit name' })).toBeTruthy();
  expect(within(row).getByTestId(`icon-${EDIT_NAME_ICON}`)).toBeTruthy();
});

it('AC 4: a failed save, then Cancel: the pencil comes back next to the old name', async () => {
  const updateMyName = jest.fn(async () => {
    throw new Error('Network request failed');
  });
  setStore(fakeStore('M', { updateMyName }));
  await render(<ProfileScreen />);
  await fireEvent.press(pencil());
  await fireEvent.changeText(screen.getByDisplayValue(users.M.name), 'Max M');
  await fireEvent.press(save());
  expect(await screen.findByText('Network request failed')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Edit name' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(within(rowOf(users.M.name)).getByRole('button', { name: 'Edit name' })).toBeTruthy();
  expect(screen.queryByText('Network request failed')).toBeNull();
});

it('AC 6: a long unbroken Cyrillic name is never cut, and the pencil is still there', async () => {
  const long = 'Жантөреқызыгүлназиранұрбибі'.repeat(3);
  setStore(fakeStore('T', { currentUser: { ...users.T, name: long } }));
  await render(<ProfileScreen />);
  const name = screen.getByText(long);
  expect(name.props.numberOfLines).toBeUndefined();
  expect(within(rowOf(long)).getByRole('button', { name: 'Edit name' })).toBeTruthy();
});

it('AC 8: the ARU-55 checks work as before through the pencil (blank, too long, unchanged)', async () => {
  const store = fakeStore('S1');
  setStore(store);
  await render(<ProfileScreen />);
  await fireEvent.press(pencil());
  const field = () => screen.getByDisplayValue(/.*/);
  expect(save()).toBeDisabled(); // unchanged
  await fireEvent.changeText(field(), '   ');
  expect(save()).toBeDisabled();
  await fireEvent.changeText(field(), 'x'.repeat(81));
  expect(screen.getByText('Name must be 80 characters or fewer')).toBeTruthy();
  expect(save()).toBeDisabled();
  await fireEvent.changeText(field(), '  Sam S  ');
  await fireEvent.press(save());
  await waitFor(() => expect(store.updateMyName).toHaveBeenCalledWith('Sam S'));
});

it('AC 1: there is exactly one pencil on the Profile tab, in the name row', async () => {
  setStore(fakeStore('T'));
  await render(<ProfileScreen />);
  expect(screen.getAllByTestId(`icon-${EDIT_NAME_ICON}`)).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Edit name' })).toHaveLength(1);
});
