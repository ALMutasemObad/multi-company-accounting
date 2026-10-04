-- Refuse a destructive rollback after any plan data or command replay exists.
SET @gp_plan_rows := (SELECT COUNT(*) FROM `general_project_phases`)
  + (SELECT COUNT(*) FROM `general_project_tasks`)
  + (SELECT COUNT(*) FROM `general_project_task_assignments`);
SET @gp_plan_replays := (SELECT COUNT(*) FROM `idempotency_records` WHERE `operation` LIKE '%GENERAL_PROJECT_PHASE%'
  OR `operation` LIKE '%GENERAL_PROJECT_TASK%');
SET @gp_plan_rollback_sql := IF(@gp_plan_rows = 0 AND @gp_plan_replays = 0,
  'SELECT 1', 'SELECT * FROM gp_plan_rollback_blocked_non_empty');
PREPARE gp_plan_rollback_stmt FROM @gp_plan_rollback_sql;
EXECUTE gp_plan_rollback_stmt;
DEALLOCATE PREPARE gp_plan_rollback_stmt;

DELETE FROM `role_permissions` WHERE `permission_id` IN (
  SELECT `id` FROM `permissions` WHERE `code` = 'general_projects.progress'
);
DELETE FROM `permissions` WHERE `code` = 'general_projects.progress';
DROP TABLE `general_project_task_assignments`;
DROP TABLE `general_project_tasks`;
DROP TABLE `general_project_phases`;
