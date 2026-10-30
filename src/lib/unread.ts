/** How a new-message count reads on a badge (ARU-31): "99+" above 99. */
export function formatUnread(count: number) {
  return count > 99 ? '99+' : String(count);
}

/** Adds the count to a screen-reader label, e.g. "Open chat for Algebra, 3 new messages"; unchanged at 0 (ARU-31). */
export function withUnreadLabel(label: string, count: number) {
  if (count <= 0) return label;
  return `${label}, ${formatUnread(count)} new ${count === 1 ? 'message' : 'messages'}`;
}
