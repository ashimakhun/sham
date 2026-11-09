// ARU-119: the app font, Inter, in three weights: titles SemiBold 600, buttons and labels Medium 500, text Light 300.
// Each weight (and italic) is its own fontFamily name, loaded once in the root layout with useFonts. One family chosen
// by fontWeight would load only its default face on Android below API 29 (expo-font), so weights pick a family here.
// Style text with font(weight) instead of fontWeight; plain text gets Light 300 from <Text> in components/AppText.
// One import per face, so only these five files are bundled (the package's index would bundle all 18).
import { Inter_300Light } from '@expo-google-fonts/inter/300Light';
import { Inter_300Light_Italic } from '@expo-google-fonts/inter/300Light_Italic';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_600SemiBold_Italic } from '@expo-google-fonts/inter/600SemiBold_Italic';

export type FontWeight = 300 | 500 | 600;

const FAMILY: Record<FontWeight, { normal: string; italic: string }> = {
  300: { normal: 'Inter_300Light', italic: 'Inter_300Light_Italic' },
  // No Medium italic in the app; italic Medium text uses the closest face.
  500: { normal: 'Inter_500Medium', italic: 'Inter_300Light_Italic' },
  600: { normal: 'Inter_600SemiBold', italic: 'Inter_600SemiBold_Italic' },
};

/** Every face the app uses, for useFonts in src/app/_layout.tsx (bundled with the app, never downloaded). */
export const INTER_FONTS = {
  Inter_300Light,
  Inter_300Light_Italic,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_600SemiBold_Italic,
};

/**
 * The style for Inter at `weight` (and italic). Only a fontFamily: no fontWeight or fontStyle, so no platform draws
 * a fake bold or slant on top of the real face. If the fonts couldn't load, the system font is used (AC 6).
 */
export function font(weight: FontWeight, italic = false): { fontFamily: string } {
  return { fontFamily: FAMILY[weight][italic ? 'italic' : 'normal'] };
}
