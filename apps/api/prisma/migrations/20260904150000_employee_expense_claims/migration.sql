ALTER TABLE `approval_requests`
  MODIFY `subject_type` ENUM(
    'FINANCIAL_CLOSE_RUN',
    'PROFESSIONAL_TIMESHEET',
    'EMPLOYEE_EXPENSE_CLAIM'
  ) NOT NULL;

CREATE TABLE `employee_expense_claims` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `employee_id` BIGINT UNSIGNED NOT NULL,
  `employee_number_snapshot` VARCHAR(40) NOT NULL,
  `employee_name_ar_snapshot` VARCHAR(160) NOT NULL,
  `employee_name_en_snapshot` VARCHAR(160) NULL,
  `currency_code` CHAR(3) NOT NULL,
  `currency_decimals` TINYINT UNSIGNED NOT NULL,
  `purpose` VARCHAR(500) NOT NULL,
  `status` ENUM('DRAFT', 'AWAITING_APPROVAL', 'READY_FOR_PAYMENT') NOT NULL DEFAULT 'DRAFT',
  `total_amount` DECIMAL(19,4) NOT NULL,
  `active_snapshot_hash_sha256` BINARY(32) NULL,
  `submitted_at` DATETIME(3) NULL,
  `approved_at` DATETIME(3) NULL,
  `approved_by_id` BIGINT UNSIGNED NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `employee_expense_claims_public_id_key` (`public_id`),
  UNIQUE KEY `employee_expense_claims_id_company_key` (`id`, `company_id`),
  KEY `employee_expense_claims_company_status_created_idx` (`company_id`, `status`, `created_at`, `id`),
  KEY `employee_expense_claims_company_employee_created_idx` (`company_id`, `employee_id`, `created_at`, `id`),
  KEY `employee_expense_claims_creator_company_created_idx` (`created_by_id`, `company_id`, `created_at`),
  CONSTRAINT `employee_expense_claims_total_chk` CHECK (`total_amount` > 0),
  CONSTRAINT `employee_expense_claims_currency_decimals_chk` CHECK (`currency_decimals` <= 4),
  CONSTRAINT `employee_expense_claims_state_chk` CHECK (
    (`status` = 'DRAFT' AND `active_snapshot_hash_sha256` IS NULL AND `submitted_at` IS NULL AND `approved_at` IS NULL AND `approved_by_id` IS NULL)
    OR (`status` = 'AWAITING_APPROVAL' AND `active_snapshot_hash_sha256` IS NOT NULL AND `submitted_at` IS NOT NULL AND `approved_at` IS NULL AND `approved_by_id` IS NULL)
    OR (`status` = 'READY_FOR_PAYMENT' AND `active_snapshot_hash_sha256` IS NOT NULL AND `submitted_at` IS NOT NULL AND `approved_at` IS NOT NULL AND `approved_by_id` IS NOT NULL)
  ),
  CONSTRAINT `employee_expense_claims_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `employee_expense_claims_employee_company_fkey` FOREIGN KEY (`employee_id`, `company_id`) REFERENCES `employees` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `employee_expense_claims_approved_by_fkey` FOREIGN KEY (`approved_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `employee_expense_claims_created_by_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `employee_expense_claims_updated_by_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `employee_expense_lines` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `claim_id` BIGINT UNSIGNED NOT NULL,
  `line_number` SMALLINT UNSIGNED NOT NULL,
  `incurred_on` DATE NOT NULL,
  `merchant` VARCHAR(160) NOT NULL,
  `description` VARCHAR(500) NOT NULL,
  `receipt_reference` VARCHAR(200) NULL,
  `cost_center_id` BIGINT UNSIGNED NOT NULL,
  `cost_center_code_snapshot` VARCHAR(40) NOT NULL,
  `cost_center_name_snapshot` VARCHAR(160) NOT NULL,
  `cost_center_name_en_snapshot` VARCHAR(160) NULL,
  `amount` DECIMAL(19,4) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `employee_expense_lines_public_id_key` (`public_id`),
  UNIQUE KEY `employee_expense_lines_claim_number_key` (`claim_id`, `line_number`),
  UNIQUE KEY `employee_expense_lines_id_company_key` (`id`, `company_id`),
  KEY `employee_expense_lines_company_cost_date_idx` (`company_id`, `cost_center_id`, `incurred_on`),
  CONSTRAINT `employee_expense_lines_amount_chk` CHECK (`amount` > 0),
  CONSTRAINT `employee_expense_lines_line_number_chk` CHECK (`line_number` > 0),
  CONSTRAINT `employee_expense_lines_claim_company_fkey` FOREIGN KEY (`claim_id`, `company_id`) REFERENCES `employee_expense_claims` (`id`, `company_id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `employee_expense_lines_cost_center_company_fkey` FOREIGN KEY (`cost_center_id`, `company_id`) REFERENCES `cost_centers` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('employee_expenses.view', 'employee_expenses', 'عرض مطالبات المصروفات الشخصية'),
  ('employee_expenses.submit', 'employee_expenses', 'إنشاء مطالبات المصروفات الشخصية وتعديلها وإرسالها'),
  ('employee_expenses.review', 'employee_expenses', 'عرض مطالبات المصروفات على مستوى الشركة')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN (
  'employee_expenses.view',
  'employee_expenses.submit',
  'employee_expenses.review'
)
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE;
