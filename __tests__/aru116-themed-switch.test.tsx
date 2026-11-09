// ARU-116: every switch is ON in the theme colour with a white knob, through one shared ThemedSwitch.
import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Platform, StyleSheet, Switch, type SwitchProps } from 'react-native';

import { ThemedSwitch } from '@/components/ui';
import { colors } from '@/lib/theme';

// ThemedSwitch is a plain function component: call it and read the RN Switch element it returns.
let last: ReactElement<SwitchProps> | null = null;
const shallow = (props: SwitchProps) => {
  last = ThemedSwitch(props) as ReactElement<SwitchProps>;
  expect(last.type).toBe(Switch);
  return last;
};
type Fs = {
  readFileSync: (file: string, encoding: 'utf8') => string;
  readdirSync: (dir: string) => string[];
  statSync: (file: string) => { isDirectory: () => boolean };
};
const fs = jest.requireActual<Fs>('fs');

const switchProps = () => last!.props as SwitchProps & { trackColor: NonNullable<SwitchProps['trackColor']> };

describe('ThemedSwitch', () => {
  it('AC 1 / AC 3: ON track is colors.primary and the knob is white', () => {
    shallow({ value: true, accessibilityLabel: 'Hidden course' });
    expect(switchProps().trackColor.true).toBe(colors.primary);
    expect(colors.primary).toBe('#4F46E5');
    expect(switchProps().thumbColor).toBe('#FFFFFF');
  });

  it('AC 2: the OFF track is left to the platform', () => {
    shallow({ value: false });
    expect(switchProps().trackColor.false).toBeUndefined();
    expect(switchProps().ios_backgroundColor).toBeUndefined();
  });

  it('AC 6: a call site cannot bring green back', () => {
    shallow({ value: true, trackColor: { true: 'green' }, thumbColor: 'green' });
    expect(switchProps().trackColor.true).toBe(colors.primary);
    expect(switchProps().thumbColor).toBe('#FFFFFF');
  });

  it('AC 7: other props pass through unchanged', async () => {
    const onValueChange = jest.fn();
    await render(
      <ThemedSwitch value disabled onValueChange={onValueChange} accessibilityLabel="Accountant, Mia" accessibilityHint="hint" />,
    );
    expect(screen.getByRole('switch', { name: 'Accountant, Mia' })).toBeTruthy();
    shallow({ value: true, disabled: true, onValueChange, accessibilityHint: 'hint' });
    expect(switchProps()).toMatchObject({ value: true, disabled: true, onValueChange, accessibilityHint: 'hint' });
  });

  it('AC 5: disabled is dimmed on Android, left to the system on iOS', () => {
    const original = Platform.OS;
    try {
      Platform.OS = 'android';
      shallow({ value: true, disabled: true });
      expect(StyleSheet.flatten(switchProps().style)).toMatchObject({ opacity: 0.5 });
      Platform.OS = 'ios';
      shallow({ value: true, disabled: true });
      expect(StyleSheet.flatten(switchProps().style)?.opacity).toBeUndefined();
    } finally {
      Platform.OS = original;
    }
  });

  it('AC 6: no file in src/ uses the React Native Switch except ui.tsx', () => {
    const files: string[] = [];
    const walk = (dir: string) =>
      fs.readdirSync(dir).forEach((f: string) => {
        const p = `${dir}/${f}`;
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f)) files.push(p);
      });
    walk('src');
    expect(files).toContain('src/components/ui.tsx');
    const offenders = files.filter((f) => {
      if (f === 'src/components/ui.tsx') return false;
      const src = fs.readFileSync(f, 'utf8');
      return /import\s*\{[^}]*\bSwitch\b[^}]*\}\s*from\s*'react-native'/.test(src) || /<Switch[\s>]/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
