SET @employee_expense_claim_count = (SELECT COUNT(*) FROM `employee_expense_claims`);
SET @employee_expense_approval_count = (
  SELECT COUNT(*) FROM `approval_requests` WHERE `subject_type` = 'EMPLOYEE_EXPENSE_CLAIM'
);
SET @employee_expense_rollback_sql = IF(
  @employee_expense_claim_count = 0 AND @employee_expense_approval_count = 0,
  'SELECT 1',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''Refusing destructive employee expense rollback; retain claims and approval history'''
);
PREPARE employee_expense_rollback_statement FROM @employee_expense_rollback_sql;
EXECUTE employee_expense_rollback_statement;
DEALLOCATE PREPARE employee_expense_rollback_statement;

DELETE `role_permissions`
FROM `role_permissions`
JOIN `permissions` ON `permissions`.`id` = `role_permissions`.`permission_id`
WHERE `permissions`.`code` IN (
  'employee_expenses.view',
  'employee_expenses.submit',
  'employee_expenses.review'
);

DELETE FROM `permissions`
WHERE `code` IN (
  'employee_expenses.view',
  'employee_expenses.submit',
  'employee_expenses.review'
);

DROP TABLE `employee_expense_lines`;
DROP TABLE `employee_expense_claims`;

ALTER TABLE `approval_requests`
  MODIFY `subject_type` ENUM('FINANCIAL_CLOSE_RUN', 'PROFESSIONAL_TIMESHEET') NOT NULL;
