-- Refuse to lose dependency history or replay evidence.
SET @gp_dep_rows := (SELECT COUNT(*) FROM `general_project_task_dependencies`);
SET @gp_dep_replays := (SELECT COUNT(*) FROM `idempotency_records` WHERE `operation` IN
  ('ADD_GENERAL_PROJECT_TASK_DEPENDENCY', 'REMOVE_GENERAL_PROJECT_TASK_DEPENDENCY'));
SET @gp_dep_rollback_sql := IF(@gp_dep_rows = 0 AND @gp_dep_replays = 0,
  'SELECT 1', 'SELECT * FROM gp_dependency_rollback_blocked_non_empty');
PREPARE gp_dep_rollback_stmt FROM @gp_dep_rollback_sql;
EXECUTE gp_dep_rollback_stmt;
DEALLOCATE PREPARE gp_dep_rollback_stmt;

DROP TABLE `general_project_task_dependencies`;
