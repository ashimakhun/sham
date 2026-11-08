import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform, Pressable, Text, View } from 'react-native';

import { styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { colors } from '@/lib/theme';

type Props = { label: string; value: Date; onChange: (value: Date) => void };

const withDate = (base: Date, d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), base.getHours(), base.getMinutes());
const withTime = (base: Date, t: Date) =>
  new Date(base.getFullYear(), base.getMonth(), base.getDate(), t.getHours(), t.getMinutes());

/** Date and start time in the device's time zone. iOS: one compact picker. Android: a date dialog, then a time
 *  dialog (the time button opens only the time). @react-native-community/datetimepicker is included in Expo Go.
 *  ARU-109: the shown date and time and the iOS picker follow the app language, not the phone's locale; Android's
 *  dialogs follow the system. */
export function DateTimeField({ label, value, onChange }: Props) {
  const { t, lang, formatWeekdayDate } = useI18n();
  const locale = lang === 'ru' ? 'ru-RU' : 'en-GB';
  if (Platform.OS === 'ios') {
    return (
      <View style={[styles.row, { minHeight: 44 }]}>
        <Text style={styles.label}>{label}</Text>
        <DateTimePicker
          value={value}
          mode="datetime"
          display="compact"
          accentColor={colors.primary}
          locale={locale}
          onValueChange={(_event, date) => onChange(date)}
        />
      </View>
    );
  }

  function pickTime(base: Date) {
    DateTimePickerAndroid.open({
      value: base,
      mode: 'time',
      onValueChange: (_event, time) => onChange(withTime(base, time)),
    });
  }

  function pickDate() {
    DateTimePickerAndroid.open({
      value,
      mode: 'date',
      onValueChange: (_event, date) => {
        const next = withDate(value, date);
        onChange(next);
        pickTime(next); // then the time, in a second dialog
      },
    });
  }

  const box = [styles.input, { flex: 1 }];
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('picker.date')} onPress={pickDate} style={box}>
          {/* "Mon, 12 May 2026" / "пн, 12 мая 2026" */}
          <Text style={styles.body}>{`${formatWeekdayDate(value)} ${value.getFullYear()}`}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('picker.time')}
          onPress={() => pickTime(value)}
          style={box}>
          <Text style={styles.body}>
            {new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value)}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
