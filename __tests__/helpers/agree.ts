import { fireEvent, screen } from '@testing-library/react-native';

/** ARU-159 AC 4: Create account also needs the "I'm 13 or older … I agree" box ticked. Ticks it if it isn't yet. */
export async function tickAgree() {
  const box = screen.getByTestId('legal-agree-checkbox');
  if (!box.props.accessibilityState?.checked) await fireEvent.press(box);
}
