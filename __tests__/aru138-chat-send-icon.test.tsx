// ARU-138: the chat composer's "Send" / "Отправить" text button becomes a 44 × 44 indigo button with a white paper
// plane, in the General chat and every course chat. Sending, disabled, "…" and error states behave as before.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import CourseChatScreen from '@/app/courses/[id]/chat';
import GeneralChatScreen from '@/app/general-chat';
import { I18nContext, make } from '@/i18n/context';
import { colors } from '@/lib/theme';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const ru = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;
const members = [member('A', 'S1'), member('A', 'M2')];
const hidden = { includeHiddenElements: true };
const sendStyle = () => {
  const style = screen.getByTestId('chat-send').props.style;
  return StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false }) : style);
};
// jest.setup.js renders Ionicons as an element with testID `icon-<name>`; it's hidden from screen readers.
const iconOf = () => screen.queryAllByTestId('icon-send', hidden);

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

type Chat = { name: string; screen: () => React.ReactElement; store: (send: jest.Mock) => ReturnType<typeof fakeStore> };
const chats: Chat[] = [
  { name: 'General chat', screen: () => <GeneralChatScreen />, store: (send) => fakeStore('S1', { sendGeneralMessage: send }) },
  {
    name: 'course chat',
    screen: () => <CourseChatScreen />,
    store: (send) => fakeStore('S1', { courseMembers: members, sendMessage: send }),
  },
];

describe.each(chats)('AC9: $name', ({ screen: Screen, store }) => {
  it('AC1/AC3: an indigo 44 × 44 button with a white send icon and no "Send" text', async () => {
    setStore(store(jest.fn(async () => {})));
    await render(<Screen />);
    const s = sendStyle();
    expect(s).toMatchObject({ width: 44, height: 44, borderRadius: 10, backgroundColor: colors.primary });
    const [icon] = iconOf();
    expect(icon.props.color).toBe('#fff');
    expect(icon.props.size).toBeGreaterThanOrEqual(22);
    expect(icon.props.size).toBeLessThanOrEqual(24);
    expect(screen.queryByText('Send', hidden)).toBeNull();
  });

  it('AC2/AC8: in Russian the same icon only, labelled "Отправить"', async () => {
    setStore(store(jest.fn(async () => {})));
    await render(ru(<Screen />));
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeTruthy();
    expect(screen.queryByText('Отправить', hidden)).toBeNull();
    expect(iconOf()).toHaveLength(1);
  });

  it('AC5: faded and disabled while empty or blank', async () => {
    setStore(store(jest.fn(async () => {})));
    await render(<Screen />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(sendStyle().opacity).toBe(0.4);
    await fireEvent.changeText(screen.getByLabelText('Message'), '  \n ');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Message'), 'a');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('AC4/AC6/AC8: while sending it shows "…", is disabled and still labelled "Send"; then the icon returns', async () => {
    let finish: () => void = () => {};
    const send = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    setStore(store(send));
    await render(<Screen />);
    await fireEvent.changeText(screen.getByLabelText('Message'), 'Hello');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByText('…', hidden)).toBeTruthy();
    expect(iconOf()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(sendStyle()).toMatchObject({ width: 44, height: 44 });
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await waitFor(() => expect(screen.getByLabelText('Message').props.value).toBe(''));
    expect(screen.queryByText('…', hidden)).toBeNull();
    expect(iconOf()).toHaveLength(1);
  });

  it('AC7: a failed send shows the error, keeps the text and the button can be tapped again', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('Network request failed')).mockResolvedValueOnce(undefined);
    setStore(store(send));
    await render(<Screen />);
    await fireEvent.changeText(screen.getByLabelText('Message'), 'Hi');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(screen.getByLabelText('Message').props.value).toBe('Hi');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(iconOf()).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  });
});
