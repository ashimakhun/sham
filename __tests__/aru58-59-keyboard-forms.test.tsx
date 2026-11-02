// ARU-58 / ARU-59: on iPhone the keyboard covered the submit button on form screens and couldn't be closed.
// Every form with a text field now scrolls in KeyboardForm: iOS adds the keyboard as a bottom inset (correct inside
// page-sheet modals), and a drag or a tap outside a field closes the keyboard. Multiline fields have a height cap.
import { render, screen } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';

import MeetingNotesScreen from '@/app/courses/[id]/meetings/[meetingId]/notes';
import NewHomeworkScreen from '@/app/homework/new';
import { KeyboardForm } from '@/components/KeyboardForm';
import type { HomeworkAssignment, Meeting } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

const HOUR = 60 * 60 * 1000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const C: Meeting = {
  id: 'C',
  courseId: 'A',
  startsAt: at(-30),
  topic: 'Done',
  status: 'completed',
  createdById: 'M',
  createdAt: at(-100),
};
const a1: HomeworkAssignment = {
  id: 'a1',
  courseId: 'A',
  meetingId: 'C',
  title: 'Exercises',
  description: '',
  createdById: 'M',
  createdAt: '2026-10-20T10:00:00.000Z',
};
const members = [member('A', 'S1')];
type Node = ReturnType<typeof screen.getByTestId>;
// The repo has no Node typings; jest runs in Node, so read source files through it.
const fs = jest.requireActual<{ readFileSync: (file: string, encoding: 'utf8') => string }>('fs');

/** The nearest KeyboardForm scroll view above an element, or null when it isn't in one. */
function formOf(node: Node) {
  for (let n: Node | null = node; n; n = n.parent) {
    if (n.props.testID === 'keyboard-form') return n;
  }
  return null;
}

function expectKeyboardForm(form: Node | null) {
  expect(form).not.toBeNull();
  expect(form!.props.automaticallyAdjustKeyboardInsets).toBe(true);
  expect(form!.props.keyboardShouldPersistTaps).toBe('handled');
  expect(form!.props.keyboardDismissMode).toBe(Platform.OS === 'ios' ? 'interactive' : 'on-drag');
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(params, { id: 'A', meetingId: undefined, edit: undefined, assignmentId: undefined });
});

describe('KeyboardForm', () => {
  it('closes the keyboard on drag (interactive on iOS) and insets for the keyboard on iOS', async () => {
    await render(
      <KeyboardForm>
        <></>
      </KeyboardForm>,
    );
    expectKeyboardForm(screen.getByTestId('keyboard-form'));
  });
});

describe('ARU-58: meeting notes editor', () => {
  it.each(['M', 'T'] as const)('%s: Save is inside the scrolling form, and the notes field has a height cap', async (who) => {
    Object.assign(params, { meetingId: 'C', edit: '1' });
    setStore(fakeStore(who, { courseMembers: members, meetings: [C] }));
    await render(<MeetingNotesScreen />);
    expectKeyboardForm(formOf(screen.getByRole('button', { name: 'Save' })));
    const field = StyleSheet.flatten(screen.getByLabelText('Notes').props.style);
    expect(field.flex).toBeUndefined();
    expect(field.maxHeight).toBeGreaterThanOrEqual(160);
    expect(field.minHeight).toBeLessThanOrEqual(field.maxHeight as number);
  });
});

describe('ARU-59: Add homework', () => {
  it('Attach a photo and Send to mentor are inside the scrolling form; Description has a height cap', async () => {
    params.assignmentId = 'a1';
    setStore(fakeStore('S1', { courseMembers: members, meetings: [C], assignments: [a1] }));
    await render(<NewHomeworkScreen />);
    expectKeyboardForm(formOf(screen.getByRole('button', { name: 'Attach a photo' })));
    expectKeyboardForm(formOf(screen.getByRole('button', { name: 'Send to mentor' })));
    const description = screen.getByPlaceholderText('What did you do? Any questions for your mentor?');
    expect(StyleSheet.flatten(description.props.style).maxHeight).toBeGreaterThan(0);
  });
});

describe('ARU-59: every form screen uses KeyboardForm', () => {
  const forms = [
    'app/courses/new.tsx',
    'app/courses/[id]/feedback.tsx',
    'components/MeetingForm.tsx', // meetings/new and meetings/[meetingId] (edit)
    'app/courses/[id]/meetings/[meetingId]/assign-homework.tsx',
    'app/courses/[id]/meetings/[meetingId]/notes.tsx',
    'app/homework/new.tsx',
    'app/homework/[id].tsx',
    'app/materials/new.tsx',
    'app/materials/files/new.tsx',
    'app/materials/files/[id]/edit.tsx',
  ];
  it.each(forms)('%s', (file) => {
    const source = fs.readFileSync(`src/${file}`, 'utf8');
    expect(source).toContain('<KeyboardForm');
    expect(source).not.toContain('KeyboardAvoidingView');
  });
});
