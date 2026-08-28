-- Safe only before the first restricted matter or access-grant mutation.
SET @professional_access_grant_count = (SELECT COUNT(*) FROM `professional_project_access_grants`);
SET @professional_access_project_use_count = (
  SELECT COUNT(*) FROM `professional_projects`
  WHERE `access_mode` <> 'COMPANY' OR `access_version` <> 0
);
SET @professional_access_rollback_sql = IF(
  @professional_access_grant_count = 0 AND @professional_access_project_use_count = 0,
  'SELECT 1',
  'SELECT * FROM professional_access_rollback_refused_retain_confidentiality_history'
);
PREPARE professional_access_rollback_statement FROM @professional_access_rollback_sql;
EXECUTE professional_access_rollback_statement;
DEALLOCATE PREPARE professional_access_rollback_statement;

DELETE `role_permissions`
FROM `role_permissions`
JOIN `permissions` ON `permissions`.`id` = `role_permissions`.`permission_id`
WHERE `permissions`.`code` = 'professional_access.manage';

DELETE FROM `permissions` WHERE `code` = 'professional_access.manage';

DROP TABLE `professional_project_access_grants`;

ALTER TABLE `professional_projects`
  DROP COLUMN `access_version`,
  DROP COLUMN `access_mode`;
