-- Destructive rollback is safe only before the first use of the new subject.
-- Once used, keep the immutable submission and approval history and deploy a
-- compatibility release followed by a forward migration.
SET @professional_timesheet_count = (SELECT COUNT(*) FROM `professional_timesheets`);
SET @professional_timesheet_submission_count = (SELECT COUNT(*) FROM `professional_timesheet_submissions`);
SET @professional_timesheet_approval_count = (
  SELECT COUNT(*) FROM `approval_requests` WHERE `subject_type` = 'PROFESSIONAL_TIMESHEET'
);
SET @professional_timesheet_rollback_sql = IF(
  @professional_timesheet_count = 0
    AND @professional_timesheet_submission_count = 0
    AND @professional_timesheet_approval_count = 0,
  'SELECT 1',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''Refusing destructive timesheet rollback; retain submissions and approval history'''
);
PREPARE professional_timesheet_rollback_statement FROM @professional_timesheet_rollback_sql;
EXECUTE professional_timesheet_rollback_statement;
DEALLOCATE PREPARE professional_timesheet_rollback_statement;

DELETE `role_permissions`
FROM `role_permissions`
JOIN `permissions` ON `permissions`.`id` = `role_permissions`.`permission_id`
WHERE `permissions`.`code` IN ('professional_timesheets.view', 'professional_timesheets.submit');

DELETE FROM `permissions`
WHERE `code` IN ('professional_timesheets.view', 'professional_timesheets.submit');

DROP TABLE `professional_timesheet_submissions`;
DROP TABLE `professional_timesheets`;

ALTER TABLE `approval_requests`
  MODIFY `subject_type` ENUM('FINANCIAL_CLOSE_RUN') NOT NULL;
