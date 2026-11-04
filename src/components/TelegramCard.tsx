/**
 * ARU-101: the collapsible Telegram card (ARU-79) is gone; Telegram lives in src/components/Telegram.tsx. This
 * no-op stays only because QA's aru100-profile-chat-top-qa.test.tsx still calls it in its setup; with no card there is
 * no collapsed-choice cache to clear. Delete this file once that test no longer imports it.
 */
export function resetTelegramCardCollapsedCache() {}
