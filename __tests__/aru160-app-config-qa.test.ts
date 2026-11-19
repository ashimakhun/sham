/**
 * @jest-environment node
 */
// QA ARU-160: App Store prep. Guards the app config so the microphone and camera permissions, iPad support and the
// Russian photo permission text can't silently come back or go missing. The generated native projects were checked by
// hand with `npx expo prebuild --clean --no-install` (outside the repo); this test pins the inputs that produce them.
// Paths are relative to the repo root (Jest's working directory), as in aru74-migration-numbers-qa.test.ts.
const fs = jest.requireActual<{ readFileSync: (file: string, encoding: 'utf8') => string }>('fs');

type Plugin = string | [string, Record<string, unknown>];
const { expo } = JSON.parse(fs.readFileSync('app.json', 'utf8')) as {
  expo: {
    ios: { supportsTablet?: boolean; infoPlist?: Record<string, unknown> };
    android: { permissions?: string[]; blockedPermissions?: string[] };
    plugins: Plugin[];
    locales?: Record<string, string>;
  };
};

const pluginEntries = (name: string) => expo.plugins.filter((p) => (Array.isArray(p) ? p[0] : p) === name);
const pluginOptions = (name: string) => {
  const [entry] = pluginEntries(name);
  return Array.isArray(entry) ? entry[1] : {};
};

const EN_PHOTO = 'Sham uses your photos so you can attach pictures of your homework.';
const RU_PHOTO = 'Sham использует ваши фото, чтобы вы могли прикрепить снимки домашнего задания.';

describe('AC 1–2: Android asks for no microphone and no camera', () => {
  it('RECORD_AUDIO and CAMERA are not requested and are blocked, so no library can add them back', () => {
    expect(expo.android.permissions ?? []).not.toContain('android.permission.RECORD_AUDIO');
    expect(expo.android.permissions ?? []).not.toContain('android.permission.CAMERA');
    expect(expo.android.blockedPermissions).toEqual(
      expect.arrayContaining(['android.permission.RECORD_AUDIO', 'android.permission.CAMERA']),
    );
  });

  it('expo-image-picker is configured once, with camera and microphone turned off (it adds RECORD_AUDIO by default)', () => {
    expect(pluginEntries('expo-image-picker')).toHaveLength(1);
    expect(pluginOptions('expo-image-picker')).toMatchObject({ cameraPermission: false, microphonePermission: false });
  });

  it('no plugin that records audio or video is in the config', () => {
    for (const name of ['expo-av', 'expo-audio', 'expo-camera', 'expo-video']) expect(pluginEntries(name)).toHaveLength(0);
  });
});

describe('AC 3: iOS keeps only the photo permission text', () => {
  it('the English photo text is unchanged, byte for byte', () => {
    expect(pluginOptions('expo-image-picker').photosPermission).toBe(EN_PHOTO);
  });

  it('no microphone or camera usage text is set anywhere in the config', () => {
    const infoPlist = expo.ios.infoPlist ?? {};
    expect(infoPlist).not.toHaveProperty('NSMicrophoneUsageDescription');
    expect(infoPlist).not.toHaveProperty('NSCameraUsageDescription');
    const picker = pluginOptions('expo-image-picker');
    expect(typeof picker.cameraPermission).not.toBe('string');
    expect(typeof picker.microphonePermission).not.toBe('string');
  });
});

describe('AC 4: iPhone-only', () => {
  it('supportsTablet is false (TARGETED_DEVICE_FAMILY = 1 at prebuild)', () => {
    expect(expo.ios.supportsTablet).toBe(false);
  });
});

describe('AC 5: the photo permission text is in Russian too', () => {
  it('the ru locale file holds exactly the Russian photo text and nothing else', () => {
    expect(expo.locales?.ru).toBeDefined();
    const ru = JSON.parse(fs.readFileSync(expo.locales!.ru.replace(/^\.\//, ''), 'utf8'));
    expect(ru).toEqual({ ios: { NSPhotoLibraryUsageDescription: RU_PHOTO } });
  });

  it('iOS declares en and ru (CFBundleLocalizations) and allows mixed localizations, via one expo-localization entry', () => {
    expect(pluginEntries('expo-localization')).toHaveLength(1);
    expect(pluginOptions('expo-localization')).toEqual({ supportedLocales: { ios: ['en', 'ru'] } });
    expect(expo.ios.infoPlist?.CFBundleAllowMixedLocalizations).toBe(true);
  });
});
