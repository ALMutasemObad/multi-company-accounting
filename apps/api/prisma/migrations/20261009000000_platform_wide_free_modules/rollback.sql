-- Disable only these globally free modules; retain all user data and history.
-- Keep catalog permissions and role grants so rollback does not erase company policy edits.
UPDATE `platform_modules`
SET `is_active` = FALSE,
    `version` = `version` + 1,
    `updated_at` = UTC_TIMESTAMP(3)
WHERE `code` IN ('GENERAL_PROJECTS', 'SERVICE_CATALOG', 'PAYROLL')
  AND `is_active` = TRUE;
