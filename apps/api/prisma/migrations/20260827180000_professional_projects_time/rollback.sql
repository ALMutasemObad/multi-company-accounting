-- Expand-only operational rollback.
-- Deploy the previous application binary and keep these tables, permissions,
-- sequences, and all professional-project history in place. The previous
-- binary does not reference them, and dropping the schema would make time and
-- membership history unrecoverable.
--
-- A later forward migration may archive or remove an unused schema only after
-- an explicit retention review. This rollback intentionally performs no DDL
-- and no data mutation on both empty and used databases.
SELECT
  (SELECT COUNT(*) FROM `professional_projects`) AS `retained_professional_projects`,
  (SELECT COUNT(*) FROM `professional_project_members`) AS `retained_professional_project_members`,
  (SELECT COUNT(*) FROM `professional_time_entries`) AS `retained_professional_time_entries`;
