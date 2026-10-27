-- Send live changes of homework and materials to the app (row-level security still applies).
alter publication supabase_realtime add table homework, materials;
