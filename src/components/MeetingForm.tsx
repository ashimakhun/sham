import { useState } from 'react';

import { Text } from '@/components/AppText';

import { DateTimeField } from '@/components/DateTimeField';
import { KeyboardForm } from '@/components/KeyboardForm';
import { Button, ErrorText, Field } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { colors } from '@/lib/theme';
import { useNow } from '@/lib/useNow';

/** No topic (ARU-129): a meeting is named by its date and time. */
export type MeetingFormValues = { startsAt: Date; location: string };
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

/** Date and start time and link/place of a meeting: "Schedule meeting" (ARU-10) and "Edit meeting"
 *  (ARU-15). The start must be in the future (device clock here; the database checks again with its own); when
 *  editing, only if it was changed. */
export function MeetingForm({ initial, submitTitle, busyTitle, busy, error, onSubmit, checkTimeOnlyWhenChanged }: Props) {
  const { t } = useI18n();
  const [startsAt, setStartsAt] = useState(initial.startsAt);
  const [location, setLocation] = useState(initial.location);
  const now = useNow(15_000);
  const timeChanged = startsAt.getTime() !== initial.startsAt.getTime();
  const timeOk = (checkTimeOnlyWhenChanged && !timeChanged) || startsAt.getTime() > now;

  return (
    <KeyboardForm>
      <DateTimeField label={t('meetings.dateTimeLabel')} value={startsAt} onChange={setStartsAt} />
      {!timeOk && <Text style={{ color: colors.warning, fontSize: 14 }}>{t('meetings.pickFuture')}</Text>}
      <Field
        label={t('meetings.locationLabel')}
        placeholder={t('meetings.locationPlaceholder')}
        value={location}
        onChangeText={setLocation}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={500}
      />
      <ErrorText error={error} />
      <Button
        title={busy ? busyTitle : submitTitle}
        onPress={() => onSubmit({ startsAt, location, timeChanged })}
        disabled={!timeOk || busy}
      />
    </KeyboardForm>
  );
}
