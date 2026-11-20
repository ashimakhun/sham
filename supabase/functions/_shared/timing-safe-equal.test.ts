/**
 * @jest-environment node
 */
// The secret comparison every notification Edge Function uses (moved out of the Telegram bot file by ARU-171).
import { timingSafeEqual } from './timing-safe-equal';

describe('timingSafeEqual', () => {
  it('equal strings match', () => {
    expect(timingSafeEqual('s3cret', 's3cret')).toBe(true);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('a different string of the same length, a prefix or a longer string does not match', () => {
    expect(timingSafeEqual('s3cret', 's3creT')).toBe(false);
    expect(timingSafeEqual('s3cret', 's3cre')).toBe(false);
    expect(timingSafeEqual('s3cre', 's3cret')).toBe(false);
    expect(timingSafeEqual('', 'x')).toBe(false);
  });
});
