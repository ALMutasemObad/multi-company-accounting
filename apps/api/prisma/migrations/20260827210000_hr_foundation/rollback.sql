-- Expand-only operational rollback.
-- Deploy the previous application binary and retain HR structure, employee,
-- contract, permission, and sequence history. The previous binary does not
-- reference these tables. Destructive removal requires an explicit retention
-- review and a later forward migration.
SELECT
  (SELECT COUNT(*) FROM `hr_departments`) AS `retained_hr_departments`,
  (SELECT COUNT(*) FROM `hr_positions`) AS `retained_hr_positions`,
  (SELECT COUNT(*) FROM `employees`) AS `retained_employees`,
  (SELECT COUNT(*) FROM `employment_contracts`) AS `retained_employment_contracts`;
