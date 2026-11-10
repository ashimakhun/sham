// QA ARU-129: gaps in aru129-meeting-no-topic.test.tsx and aru129-store-meeting-topic.test.tsx. The dev tests check the
// titles and confirmations in English and the store calls; here: the real Schedule and Edit meeting screens have no
// Topic field for the owner and the teacher, Schedule sends no topic, Edit sends the stored topic unchanged when only
// the time or only the place changes (AC 6), a student and a non-owner mentor still can't open either form (AC 7);
// in Russian the tile title and every confirmation use the Russian date and time and the form has no Topic (AC 1–3);
// "Rescheduled" has its own small grey line (AC 4); two meetings at the same time both show; the catalog has no Topic
// texts and no {topic} placeholder left.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert, StyleSheet } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import EditMeetingScreen from '@/app/courses/[id]/meetings/[meetingId]';
import ScheduleMeetingScreen from '@/app/courses/[id]/meetings/new';
import en from '@/i18n/en.json';
import { formatDateTimeIn } from '@/i18n';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import notes from '@/i18n/notes.json';
import ru from '@/i18n/ru.json';
import { colors, formatDateTime } from '@/lib/theme';
import { font } from '@/lib/fonts';
import type { Meeting, User } from '@/lib/types';

import { fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageTag: 'en-GB', languageCode: 'en' }]) }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// The date and time field as a plain input: an ISO string in, a Date out.
jest.mock('@/components/DateTimeField', () => {
  const { TextInput } = require('react-native');
  return {
    DateTimeField: ({ value, onChange }: { value: Date; onChange: (d: Date) => void }) => (
      <TextInput testID="when" value={value.toISOString()} onChangeText={(t: string) => onChange(new Date(t))} />
    ),
  };
});

const HOUR = 3600_000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const wholeMinute = (h: number) => {
  const d = new Date(Date.now() + h * HOUR);
  d.setSeconds(0, 0);
  return d.toISOString();
};
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: 'A',
  startsAt: at(24),
  topic: 'Old topic text',
  location: 'Room 12',
  status: 'scheduled',
  createdById: 'M',
  createdAt: at(-100),
  ...over,
});
const members = [member('A', 'S1')];
const inApp = (ui: React.ReactElement) => <LanguageProvider>{ui}</LanguageProvider>;
const as = (who: keyof typeof users, language: 'en' | 'ru', over = {}) => {
  const me: User = { ...users[who], language };
  setStore(fakeStore(who, { currentUser: me, courseMembers: members, ...over }));
};
const flush = () => act(async () => {});
const noTopicField = () => {
  expect(screen.queryByText(/Topic/i)).toBeNull();
  expect(screen.queryByText(/Тема/i)).toBeNull();
  expect(screen.queryByPlaceholderText('Meeting')).toBeNull();
};

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
  (params as { meetingId?: string }).meetingId = undefined;
});

describe('AC 1 / AC 6: Schedule meeting', () => {
  it.each(['M', 'T'] as const)('%s: only date, start time and place; Schedule sends no topic', async (who) => {
    const addMeeting = jest.fn(async () => {});
    as(who, 'en', { addMeeting });
    await render(inApp(<ScheduleMeetingScreen />));
    await flush();
    noTopicField();
    expect(screen.getByTestId('when')).toBeTruthy();
    expect(screen.getByText('Link or place (optional)')).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText('https://… or Room 12'), 'Room 7');
    await fireEvent.press(screen.getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(addMeeting).toHaveBeenCalledTimes(1));
    const sent = (addMeeting.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('topic');
    expect(sent).toMatchObject({ courseId: 'A', location: 'Room 7' });
  });

  it('in Russian the form has no Topic field either', async () => {
    as('M', 'ru');
    await render(inApp(<ScheduleMeetingScreen />));
    await flush();
    noTopicField();
  });
});

describe('AC 1 / AC 6: Edit meeting keeps the stored topic', () => {
  const O = meeting({ id: 'O', startsAt: wholeMinute(24), topic: 'Old topic text' });
  beforeEach(() => {
    (params as { meetingId?: string }).meetingId = 'O';
  });

  it('teacher changes only the time: rescheduled to the new start, the old topic sent unchanged', async () => {
    const updateMeeting = jest.fn(async () => {});
    as('T', 'en', { meetings: [O], updateMeeting });
    await render(inApp(<EditMeetingScreen />));
    await flush();
    noTopicField();
    const later = wholeMinute(48);
    await fireEvent.changeText(screen.getByTestId('when'), later);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(updateMeeting).toHaveBeenCalledWith('O', { startsAt: later, topic: 'Old topic text', location: 'Room 12' });
  });

  it('owner changes only the place: the original start and the old topic are sent back', async () => {
    const updateMeeting = jest.fn(async () => {});
    as('M', 'en', { meetings: [O], updateMeeting });
    await render(inApp(<EditMeetingScreen />));
    await flush();
    await fireEvent.changeText(screen.getByDisplayValue('Room 12'), 'Online');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(updateMeeting).toHaveBeenCalledWith('O', { startsAt: O.startsAt, topic: 'Old topic text', location: 'Online' });
  });

  it('a meeting with the default topic "Meeting" sends "Meeting" back', async () => {
    const D = { ...O, id: 'D', topic: 'Meeting' };
    (params as { meetingId?: string }).meetingId = 'D';
    const updateMeeting = jest.fn(async () => {});
    as('M', 'en', { meetings: [D], updateMeeting });
    await render(inApp(<EditMeetingScreen />));
    await flush();
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateMeeting).toHaveBeenCalled());
    expect(updateMeeting).toHaveBeenCalledWith('D', expect.objectContaining({ topic: 'Meeting' }));
  });

  it.each(['S1', 'N'] as const)('AC 7: %s (listener / not the owner) still gets "Not allowed" on both forms', async (who) => {
    const updateMeeting = jest.fn(async () => {});
    const addMeeting = jest.fn(async () => {});
    as(who, 'en', { meetings: [O], updateMeeting, addMeeting });
    const view = await render(inApp(<EditMeetingScreen />));
    await flush();
    expect(screen.getByText(/Not allowed/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    await view.unmount();
    (params as { meetingId?: string }).meetingId = undefined;
    await render(inApp(<ScheduleMeetingScreen />));
    await flush();
    expect(screen.getByText(/Not allowed/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Schedule' })).toBeNull();
  });
});

describe('AC 2 / AC 3 in Russian', () => {
  it('the tile title is the Russian date and time; the old topic is not shown', async () => {
    const F = meeting({ id: 'F', startsAt: at(5) });
    as('S1', 'ru', { meetings: [F] });
    await render(inApp(<CourseDetailScreen />));
    await flush();
    const tile = within(screen.getByTestId('meeting-F'));
    expect(tile.getByText(formatDateTimeIn('ru', F.startsAt))).toBeTruthy();
    expect(formatDateTimeIn('ru', F.startsAt)).not.toBe(formatDateTimeIn('en', F.startsAt));
    expect(screen.queryByText(/Old topic text/)).toBeNull();
  });

  it('the confirmations use the Russian texts with the Russian date and time, no topic', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const P = meeting({ id: 'P', startsAt: at(-1) });
    const C = meeting({ id: 'C', startsAt: at(-30), status: 'completed' });
    const setMeetingStatus = jest.fn(async () => {});
    as('M', 'ru', { meetings: [P, C], setMeetingStatus });
    await render(inApp(<CourseDetailScreen />));
    await flush();
    const when = (m: Meeting) => formatDateTimeIn('ru', m.startsAt);
    const pill = (id: string, name: string) =>
      within(screen.getByTestId(`meeting-${id}`)).getByRole('button', { name: new RegExp(name, 'i') });
    // Each dialog is answered "Не сейчас" (Not now), so the next action is free again and nothing changes.
    const notNow = async () => {
      const buttons = (alert.mock.calls.at(-1)![2] ?? []) as { text?: string; onPress?: () => void }[];
      const cancel = buttons.find((b) => b.text === ru['meetings.notNow']);
      expect(cancel).toBeTruthy();
      await act(async () => cancel!.onPress?.());
    };
    await fireEvent.press(pill('P', ru['meetings.markCompleted']));
    expect(alert.mock.calls.at(-1)![1]).toBe(`Отметить встречу ${when(P)} как завершённую?`);
    await notNow();
    await fireEvent.press(pill('P', ru['meetings.cancelMeeting']));
    expect(alert.mock.calls.at(-1)![1]).toBe(`Отметить встречу ${when(P)} как отменённую?`);
    await notNow();
    await fireEvent.press(pill('C', ru['meetings.markHomeworkChecked']));
    expect(alert.mock.calls.at(-1)![1]).toBe(`Отметить домашнее задание по встрече ${when(C)} как проверенное?`);
    await notNow();
    expect(setMeetingStatus).not.toHaveBeenCalled();
    for (const call of alert.mock.calls) expect(String(call[1])).not.toMatch(/Old topic text/);
  });
});

describe('AC 4: tile layout', () => {
  it('"Rescheduled" is its own small grey line under the title, only on a rescheduled meeting', async () => {
    const R = meeting({ id: 'R', startsAt: at(30), rescheduledAt: at(-2) });
    const F = meeting({ id: 'F', startsAt: at(5) });
    as('S1', 'en', { meetings: [R, F] });
    await render(inApp(<CourseDetailScreen />));
    await flush();
    const line = screen.getByTestId('rescheduled-R');
    expect([line.props.children].flat().join('')).toBe('Rescheduled');
    const s = StyleSheet.flatten(line.props.style);
    expect(s).toMatchObject({ fontSize: 12, color: colors.muted });
    const title = within(screen.getByTestId('meeting-R')).getByText(formatDateTime(R.startsAt));
    expect([title.props.children].flat().join('')).not.toMatch(/Rescheduled/);
    expect(StyleSheet.flatten(title.props.style)).toMatchObject({ fontSize: 14, ...font(600) });
    expect(screen.queryByTestId('rescheduled-F')).toBeNull();
    // The separate date line is gone: the date and time appears once per tile.
    expect(within(screen.getByTestId('meeting-F')).getAllByText(formatDateTime(F.startsAt))).toHaveLength(1);
  });

  it('edge: two meetings at the same date and time both show the same title, each in its own tile', async () => {
    const t = at(6);
    as('S1', 'en', { meetings: [meeting({ id: 'X1', startsAt: t }), meeting({ id: 'X2', startsAt: t })] });
    await render(inApp(<CourseDetailScreen />));
    await flush();
    expect(within(screen.getByTestId('meeting-X1')).getByText(formatDateTime(t))).toBeTruthy();
    expect(within(screen.getByTestId('meeting-X2')).getByText(formatDateTime(t))).toBeTruthy();
  });
});

describe('catalog', () => {
  it('no Topic texts and no {topic} placeholder are left in English, Russian or the notes', () => {
    for (const cat of [en, ru, notes] as Record<string, string>[]) {
      expect(Object.keys(cat).filter((k) => /topic/i.test(k))).toEqual([]);
      expect(Object.entries(cat).filter(([, v]) => v.includes('{topic}'))).toEqual([]);
    }
  });
});
