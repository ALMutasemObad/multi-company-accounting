-- Destructive rollback is safe only before the first use of project planning.
-- Once a budget, stage, task, dependency, or task-linked time entry exists,
-- retain the operational history and deploy a compatible forward migration.
SET @professional_planning_stage_count = (SELECT COUNT(*) FROM `professional_project_stages`);
SET @professional_planning_task_count = (SELECT COUNT(*) FROM `professional_project_tasks`);
SET @professional_planning_dependency_count = (SELECT COUNT(*) FROM `professional_task_dependencies`);
SET @professional_planning_time_link_count = (
  SELECT COUNT(*) FROM `professional_time_entries` WHERE `task_id` IS NOT NULL
);
SET @professional_planning_project_use_count = (
  SELECT COUNT(*)
  FROM `professional_projects`
  WHERE `time_budget_minutes` IS NOT NULL OR `planning_version` <> 0
);
SET @professional_planning_rollback_sql = IF(
  @professional_planning_stage_count = 0
    AND @professional_planning_task_count = 0
    AND @professional_planning_dependency_count = 0
    AND @professional_planning_time_link_count = 0
    AND @professional_planning_project_use_count = 0,
  'SELECT 1',
  'SELECT * FROM professional_planning_rollback_refused_retain_work_breakdown_and_time_history'
);
PREPARE professional_planning_rollback_statement FROM @professional_planning_rollback_sql;
EXECUTE professional_planning_rollback_statement;
DEALLOCATE PREPARE professional_planning_rollback_statement;

DELETE `role_permissions`
FROM `role_permissions`
JOIN `permissions` ON `permissions`.`id` = `role_permissions`.`permission_id`
WHERE `permissions`.`code` IN (
  'professional_planning.view',
  'professional_planning.manage',
  'professional_tasks.progress'
);

DELETE FROM `permissions`
WHERE `code` IN (
  'professional_planning.view',
  'professional_planning.manage',
  'professional_tasks.progress'
);

ALTER TABLE `professional_time_entries`
  DROP FOREIGN KEY `professional_time_entries_task_fkey`,
  DROP INDEX `professional_time_entries_company_task_date_idx`,
  DROP COLUMN `task_id`;

DROP TABLE `professional_task_dependencies`;
DROP TABLE `professional_project_tasks`;
DROP TABLE `professional_project_stages`;

ALTER TABLE `professional_projects`
  DROP CONSTRAINT `professional_projects_time_budget_chk`,
  DROP COLUMN `planning_version`,
  DROP COLUMN `time_budget_minutes`;
