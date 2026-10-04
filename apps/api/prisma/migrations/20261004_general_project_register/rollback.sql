-- Only unused, unentitled local candidates may be dropped. Otherwise keep data and roll forward.
SET @general_project_rows := (SELECT COUNT(*) FROM `general_projects`) + (SELECT COUNT(*) FROM `general_project_members`);
SET @general_project_replays := (SELECT COUNT(*) FROM `idempotency_records` WHERE `operation` IN (
  'CREATE_GENERAL_PROJECT', 'UPDATE_GENERAL_PROJECT', 'TRANSITION_GENERAL_PROJECT',
  'ASSIGN_GENERAL_PROJECT_MEMBER', 'UNASSIGN_GENERAL_PROJECT_MEMBER'
));
SET @general_project_entitlements := (
  SELECT COUNT(*) FROM `platform_plan_entitlements` entitlement
  JOIN `platform_modules` module_row ON module_row.`id` = entitlement.`module_id`
  WHERE module_row.`code` = 'GENERAL_PROJECTS'
) + (
  SELECT COUNT(*) FROM `platform_subscription_entitlements` entitlement
  JOIN `platform_modules` module_row ON module_row.`id` = entitlement.`module_id`
  WHERE module_row.`code` = 'GENERAL_PROJECTS'
) + (
  SELECT COUNT(*) FROM `platform_subscription_change_modules` selection
  JOIN `platform_modules` module_row ON module_row.`id` = selection.`module_id`
  WHERE module_row.`code` = 'GENERAL_PROJECTS'
);
SET @general_project_rollback_sql := IF(
  @general_project_rows = 0 AND @general_project_replays = 0 AND @general_project_entitlements = 0,
  'SELECT 1',
  'SELECT * FROM general_project_rollback_blocked_non_empty_or_entitled'
);
PREPARE general_project_rollback_stmt FROM @general_project_rollback_sql;
EXECUTE general_project_rollback_stmt;
DEALLOCATE PREPARE general_project_rollback_stmt;

DELETE FROM `role_permissions` WHERE `permission_id` IN (
  SELECT `id` FROM `permissions` WHERE `code` IN ('general_projects.view', 'general_projects.manage')
);
DELETE FROM `permissions` WHERE `code` IN ('general_projects.view', 'general_projects.manage');
DELETE FROM `master_data_code_sequences` WHERE `entity_type` = 'GENERAL_PROJECT';
DELETE FROM `platform_module_dependencies` WHERE `module_id` IN (
  SELECT `id` FROM `platform_modules` WHERE `code` = 'GENERAL_PROJECTS'
);
DELETE FROM `platform_modules` WHERE `code` = 'GENERAL_PROJECTS';
DROP TABLE `general_project_members`;
DROP TABLE `general_projects`;
