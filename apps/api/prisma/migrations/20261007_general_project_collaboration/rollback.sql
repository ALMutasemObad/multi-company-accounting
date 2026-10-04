-- Refuse to discard collaboration history, even if there are no current followers.
SET @gp_collaboration_rows := (SELECT (SELECT COUNT(*) FROM `general_project_followers`) +
  (SELECT COUNT(*) FROM `general_project_comments`));
SET @gp_collaboration_replays := (SELECT COUNT(*) FROM `idempotency_records` WHERE `operation` IN
  ('FOLLOW_GENERAL_PROJECT', 'UNFOLLOW_GENERAL_PROJECT', 'COMMENT_GENERAL_PROJECT'));
SET @gp_collaboration_rollback_sql := IF(@gp_collaboration_rows = 0 AND @gp_collaboration_replays = 0,
  'SELECT 1', 'SELECT * FROM gp_collaboration_rollback_blocked_non_empty');
PREPARE gp_collaboration_rollback_stmt FROM @gp_collaboration_rollback_sql;
EXECUTE gp_collaboration_rollback_stmt;
DEALLOCATE PREPARE gp_collaboration_rollback_stmt;

DELETE FROM `role_permissions` WHERE `permission_id` IN (
  SELECT `id` FROM `permissions` WHERE `code` IN ('general_projects.follow', 'general_projects.comment')
);
DELETE FROM `permissions` WHERE `code` IN ('general_projects.follow', 'general_projects.comment');
DROP TABLE `general_project_comments`;
DROP TABLE `general_project_followers`;
