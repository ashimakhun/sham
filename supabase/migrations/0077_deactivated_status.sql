-- ARU-180 (Delete workspace, part 1), first of two files. A member of a deleted workspace keeps their account but
-- belongs to no workspace: access status "deactivated" (AC 8).
-- Postgres can't use an enum value in the transaction that adds it ("unsafe use of new enum value"), so this file
-- only adds the value; 0078_delete_workspace.sql holds everything that uses it. Changes no data.
alter type access_status add value if not exists 'deactivated';
