ALTER TABLE `approval_requests`
  MODIFY `subject_type` ENUM('FINANCIAL_CLOSE_RUN', 'PROFESSIONAL_TIMESHEET') NOT NULL;

CREATE TABLE `professional_timesheets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `period_start` DATE NOT NULL,
  `period_end` DATE NOT NULL,
  `status` ENUM('OPEN', 'AWAITING_APPROVAL', 'APPROVED') NOT NULL DEFAULT 'OPEN',
  `last_submission_number` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `active_submission_number` SMALLINT UNSIGNED NULL,
  `active_snapshot_hash_sha256` BINARY(32) NULL,
  `submitted_at` DATETIME(3) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `professional_timesheets_public_id_key` (`public_id`),
  UNIQUE KEY `professional_timesheets_company_user_period_key` (`company_id`, `user_id`, `period_start`),
  UNIQUE KEY `professional_timesheets_id_company_key` (`id`, `company_id`),
  KEY `professional_timesheets_company_status_period_idx` (`company_id`, `status`, `period_start`, `id`),
  KEY `professional_timesheets_company_user_period_range_idx` (`company_id`, `user_id`, `period_start`, `period_end`),
  CONSTRAINT `professional_timesheets_week_chk` CHECK (
    DAYOFWEEK(`period_start`) = 1 AND `period_end` = DATE_ADD(`period_start`, INTERVAL 6 DAY)
  ),
  CONSTRAINT `professional_timesheets_state_chk` CHECK (
    (`status` = 'OPEN' AND `active_submission_number` IS NULL AND `active_snapshot_hash_sha256` IS NULL AND `submitted_at` IS NULL)
    OR (`status` IN ('AWAITING_APPROVAL', 'APPROVED') AND `active_submission_number` IS NOT NULL AND `active_snapshot_hash_sha256` IS NOT NULL AND `submitted_at` IS NOT NULL)
  ),
  CONSTRAINT `professional_timesheets_submission_number_chk` CHECK (
    (`active_submission_number` IS NULL OR `active_submission_number` <= `last_submission_number`)
  ),
  CONSTRAINT `professional_timesheets_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_timesheets_assignment_fkey` FOREIGN KEY (`user_id`, `company_id`) REFERENCES `user_companies` (`user_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `professional_timesheet_submissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `timesheet_id` BIGINT UNSIGNED NOT NULL,
  `submission_number` SMALLINT UNSIGNED NOT NULL,
  `entry_references` JSON NOT NULL,
  `snapshot_hash_sha256` BINARY(32) NOT NULL,
  `submitted_by_id` BIGINT UNSIGNED NOT NULL,
  `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `professional_timesheet_submissions_timesheet_number_key` (`timesheet_id`, `submission_number`),
  UNIQUE KEY `professional_timesheet_submissions_id_company_key` (`id`, `company_id`),
  KEY `professional_timesheet_submissions_company_submitted_idx` (`company_id`, `submitted_at`, `id`),
  KEY `professional_timesheet_submissions_submitter_idx` (`submitted_by_id`, `submitted_at`),
  CONSTRAINT `professional_timesheet_submissions_number_chk` CHECK (`submission_number` > 0),
  CONSTRAINT `professional_timesheet_submissions_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_timesheet_submissions_timesheet_company_fkey` FOREIGN KEY (`timesheet_id`, `company_id`) REFERENCES `professional_timesheets` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_timesheet_submissions_submitter_fkey` FOREIGN KEY (`submitted_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('professional_timesheets.view', 'professional_projects', 'عرض فترات الوقت الأسبوعية وحالات اعتمادها'),
  ('professional_timesheets.submit', 'professional_projects', 'إنشاء فترة الوقت الشخصية وإرسالها للموافقة')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN ('professional_timesheets.view', 'professional_timesheets.submit')
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE;
