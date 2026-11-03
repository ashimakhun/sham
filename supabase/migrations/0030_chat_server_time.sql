-- ARU-67 (bug in ARU-61): a client could set created_at when posting a chat message, e.g. date it 2099 so it stays
-- pinned as the newest message at the bottom for everyone, or backdate it into the history. The chats order by
-- created_at, and the ARU-31 unread counts (mark_chat_read, 0016) use it too, so the time must be the server's.
-- Same rule as material_likes (0024): app users may give only the columns a message needs; created_at always takes
-- its default now(). An insert that names created_at is refused (42501). Applies to the general chat (0029) and the
-- course chat (0006). Changes insert grants only (updates stay blocked by RLS: no update policy); no table, policy or
-- row is changed. Run after 0029.

revoke insert on general_messages from anon, authenticated;
grant insert (id, author_id, body) on general_messages to authenticated;

revoke insert on course_messages from anon, authenticated;
grant insert (id, course_id, author_id, body) on course_messages to authenticated;
