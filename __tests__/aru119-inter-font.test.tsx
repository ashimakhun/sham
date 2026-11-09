// ARU-119: the whole app in Inter: titles SemiBold 600, buttons and labels Medium 500, text Light 300 (AC 1–2), the
// splash screen kept until the fonts are ready (AC 5), the system font if they fail (AC 6), and Markdown faces.
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import RootLayout from '@/app/_layout';
import { Text, TextInput } from '@/components/AppText';
import { MarkdownText } from '@/components/MarkdownText';
import { Button, EmptyState, ErrorText, styles } from '@/components/ui';
import { font, INTER_FONTS } from '@/lib/fonts';

const fs = jest.requireActual<{
  readFileSync: (file: string, encoding: 'utf8') => string;
  readdirSync: (dir: string) => string[];
  statSync: (file: string) => { isDirectory: () => boolean };
}>('fs');

jest.mock('@/lib/store', () => ({ StoreProvider: ({ children }: { children: unknown }) => children }));
jest.mock('@/i18n/LanguageProvider', () => ({
  LanguageProvider: ({ children }: { children: unknown }) => children,
  useI18n: () => ({ t: (key: string) => key }),
}));
jest.mock('@/components/AccessGate', () => ({ AccessGate: ({ children }: { children: unknown }) => children }));
jest.mock('expo-router', () => {
  const { Text: T } = require('react-native');
  const Stack = ({ screenOptions }: { screenOptions: { headerTitleStyle: unknown } }) => (
    <T testID="stack" style={screenOptions.headerTitleStyle}>
      app
    </T>
  );
  Stack.Screen = () => null;
  return { Stack };
});

const { useFonts } = require('expo-font') as { useFonts: jest.Mock };
const SplashScreen = require('expo-splash-screen') as { preventAutoHideAsync: jest.Mock; hideAsync: jest.Mock };
const flat = (s: unknown) => StyleSheet.flatten(s as never) as Record<string, unknown>;

describe('the faces (AC 2, edge case: one static file per weight)', () => {
  it('maps each weight to its own Inter face, with no fontWeight or fontStyle', () => {
    expect(font(300)).toEqual({ fontFamily: 'Inter_300Light' });
    expect(font(500)).toEqual({ fontFamily: 'Inter_500Medium' });
    expect(font(600)).toEqual({ fontFamily: 'Inter_600SemiBold' });
    expect(font(300, true)).toEqual({ fontFamily: 'Inter_300Light_Italic' });
    expect(font(600, true)).toEqual({ fontFamily: 'Inter_600SemiBold_Italic' });
  });

  it('loads every face the app uses, from the bundle', () => {
    expect(Object.keys(INTER_FONTS).sort()).toEqual(
      ['Inter_300Light', 'Inter_300Light_Italic', 'Inter_500Medium', 'Inter_600SemiBold', 'Inter_600SemiBold_Italic'].sort(),
    );
  });
});

describe('startup (AC 5, AC 6)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders nothing and keeps the splash up while the fonts load', async () => {
    useFonts.mockReturnValueOnce([false, null]);
    await render(<RootLayout />);
    expect(screen.queryByTestId('stack')).toBeNull();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
  });

  it('opens the app and hides the splash once loaded; header titles are SemiBold 600', async () => {
    await render(<RootLayout />);
    expect(screen.getByTestId('stack')).toBeTruthy();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
    expect(flat(screen.getByTestId('stack').props.style)).toMatchObject(font(600));
    expect(useFonts).toHaveBeenCalledWith(INTER_FONTS);
  });

  it('a font error still opens the app, with no error shown', async () => {
    useFonts.mockReturnValueOnce([false, new Error('font failed')]);
    await render(<RootLayout />);
    expect(screen.getByTestId('stack')).toBeTruthy();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
    expect(screen.queryByText(/font failed/)).toBeNull();
  });
});

describe('Text and TextInput (AC 1)', () => {
  it('plain text and inputs (typed text and placeholder) are Light 300', async () => {
    await render(
      <>
        <Text testID="plain">Hello</Text>
        <TextInput testID="input" placeholder="Type" />
      </>,
    );
    expect(flat(screen.getByTestId('plain').props.style)).toMatchObject(font(300));
    expect(flat(screen.getByTestId('input').props.style)).toMatchObject(font(300));
  });

  it("a style's own font wins; nested text inherits its parent's face", async () => {
    await render(
      <Text testID="outer" style={font(600)}>
        Title <Text testID="inner">and more</Text>
      </Text>,
    );
    expect(flat(screen.getByTestId('outer').props.style)).toMatchObject(font(600));
    expect(flat(screen.getByTestId('inner').props.style)?.fontFamily).toBeUndefined();
  });

  it("keeps the caller's style array as it was, after Light 300", async () => {
    const own = [{ color: 'red' }, { flexShrink: 1 }];
    await render(<Text testID="t" style={own}>x</Text>);
    expect(screen.getByTestId('t').props.style).toEqual([font(300), ...own]);
  });

  it('shared pieces: Button Medium 500, h1 SemiBold 600, body / muted / input Light 300, empty state and error text in Inter', async () => {
    await render(
      <>
        <Button title="Save" onPress={() => {}} />
        <Text testID="h1" style={styles.h1}>Title</Text>
        <Text testID="muted" style={styles.muted}>Signed up</Text>
        <EmptyState title="Nothing here" />
        <ErrorText error="Oops" />
      </>,
    );
    expect(flat(screen.getByText('Save').props.style)).toMatchObject(font(500));
    expect(flat(screen.getByTestId('h1').props.style)).toMatchObject(font(600));
    expect(flat(screen.getByTestId('muted').props.style)).toMatchObject(font(300));
    expect(flat(styles.input)).not.toHaveProperty('fontWeight');
    expect(flat(screen.getByText('Nothing here').props.style).fontFamily).toMatch(/^Inter_/);
    expect(flat(screen.getByText('Oops').props.style)).toMatchObject(font(300));
  });
});

describe('Markdown (edge case)', () => {
  it('bold is SemiBold 600, italic is Light Italic, bold inside italic is SemiBold Italic', async () => {
    await render(<MarkdownText source={'Plain **bold** and *italic* and *with **both** inside*'} />);
    expect(screen.getByText('bold').props.style).toEqual(font(600));
    expect(screen.getByText('italic').props.style).toEqual(font(300, true));
    expect(screen.getByText('both').props.style).toEqual(font(600, true));
  });
});

describe('the sweep (AC 1, AC 2, AC 8)', () => {
  const files: string[] = [];
  const walk = (dir: string) =>
    fs.readdirSync(dir).forEach((f: string) => {
      const p = `${dir}/${f}`;
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f)) files.push(p);
    });
  walk('src');

  it('no fontWeight is left in src/: weights are Inter faces', () => {
    expect(files.filter((f) => /fontWeight\s*:/.test(fs.readFileSync(f, 'utf8')))).toEqual([]);
  });

  it("no screen uses react-native's Text or TextInput directly (they would fall back to the system font)", () => {
    const offenders = files.filter((f) => {
      if (f === 'src/components/AppText.tsx') return false;
      const src = fs.readFileSync(f, 'utf8');
      const rn = src.match(/import\s*\{([^}]*)\}\s*from\s*'react-native'/)?.[1] ?? '';
      return /(^|[\s,])(Text|TextInput)\s*(,|$)/.test(rn);
    });
    expect(offenders).toEqual([]);
  });

  it('no expo-font config plugin (Expo Go, no development build)', () => {
    const app = JSON.parse(fs.readFileSync('app.json', 'utf8')) as { expo: { plugins?: unknown[] } };
    expect(JSON.stringify(app.expo.plugins ?? [])).not.toContain('expo-font');
  });
});
