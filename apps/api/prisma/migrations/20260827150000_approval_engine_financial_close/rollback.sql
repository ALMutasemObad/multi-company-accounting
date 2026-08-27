-- Operational rollback is application-first: deploy the previous binary while
-- retaining approval history. This destructive rollback is only safe before
-- the first request is created and while no close run awaits approval.
SET @approval_request_count = (SELECT COUNT(*) FROM `approval_requests`);
SET @awaiting_close_count = (SELECT COUNT(*) FROM `financial_close_runs` WHERE `status` = 'AWAITING_APPROVAL');
SET @approval_rollback_sql = IF(
  @approval_request_count = 0 AND @awaiting_close_count = 0,
  'SELECT 1',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''Refusing destructive approval rollback; retain approval history and use application rollback'''
);
PREPARE approval_rollback_statement FROM @approval_rollback_sql;
EXECUTE approval_rollback_statement;
DEALLOCATE PREPARE approval_rollback_statement;

DELETE `role_permissions`
FROM `role_permissions`
JOIN `permissions` ON `permissions`.`id` = `role_permissions`.`permission_id`
WHERE `permissions`.`code` IN ('approvals.view', 'approvals.decide');

DELETE FROM `permissions` WHERE `code` IN ('approvals.view', 'approvals.decide');

DROP TABLE `approval_decisions`;
DROP TABLE `approval_requests`;

ALTER TABLE `financial_close_runs`
  DROP CONSTRAINT `financial_close_runs_reviewed_chk`;

ALTER TABLE `financial_close_runs`
  MODIFY `status` ENUM('PREPARING', 'REVIEWED', 'CLOSED') NOT NULL DEFAULT 'PREPARING';

ALTER TABLE `financial_close_runs`
  ADD CONSTRAINT `financial_close_runs_reviewed_chk` CHECK (
    (`status` = 'PREPARING') OR (`reviewed_by_id` IS NOT NULL AND `reviewed_at` IS NOT NULL)
  );
