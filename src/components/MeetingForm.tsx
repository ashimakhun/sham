import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';

import { DateTimeField } from '@/components/DateTimeField';
import { Button, ErrorText, Field, styles } from '@/components/ui';
import { colors } from '@/lib/theme';
import { useNow } from '@/lib/useNow';

export type MeetingFormValues = { startsAt: Date; topic: string; location: string };
export type MeetingFormResult = MeetingFormValues & { timeChanged: boolean };

type Props = {
  initial: MeetingFormValues;
  submitTitle: string;
  busyTitle: string;
  busy: boolean;
  error: string | null;
  onSubmit: (values: MeetingFormResult) => void;
  /** Edit (ARU-15): the future-time rule applies only when the date or time was changed. */
  checkTimeOnlyWhenChanged?: boolean;
};

/** The next full hour: the default start of a new meeting (always in the future). */
export function nextFullHour(now = new Date()) {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/** Date and start time, topic and link/place of a meeting: "Schedule meeting" (ARU-10) and "Edit meeting"
 *  (ARU-15). The start must be in the future (device clock here; the database checks again with its own); when
 *  editing, only if it was changed. */
export function MeetingForm({ initial, submitTitle, busyTitle, busy, error, onSubmit, checkTimeOnlyWhenChanged }: Props) {
  const [startsAt, setStartsAt] = useState(initial.startsAt);
  const [topic, setTopic] = useState(initial.topic);
  const [location, setLocation] = useState(initial.location);
  const now = useNow(15_000);
  const timeChanged = startsAt.getTime() !== initial.startsAt.getTime();
  const timeOk = (checkTimeOnlyWhenChanged && !timeChanged) || startsAt.getTime() > now;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { gap: 16 }]}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic">
        <DateTimeField label="Date and start time" value={startsAt} onChange={setStartsAt} />
        {!timeOk && <Text style={{ color: colors.warning, fontSize: 14 }}>Pick a time in the future</Text>}
        <Field label="Topic (optional)" placeholder="Meeting" value={topic} onChangeText={setTopic} maxLength={200} />
        <Field
          label="Link or place (optional)"
          placeholder="https://… or Room 12"
          value={location}
          onChangeText={setLocation}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={500}
        />
        <ErrorText error={error} />
        <Button
          title={busy ? busyTitle : submitTitle}
          onPress={() => onSubmit({ startsAt, topic, location, timeChanged })}
          disabled={!timeOk || busy}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
