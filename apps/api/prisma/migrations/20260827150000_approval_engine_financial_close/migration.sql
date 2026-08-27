ALTER TABLE `financial_close_runs`
  MODIFY `status` ENUM('PREPARING', 'AWAITING_APPROVAL', 'REVIEWED', 'CLOSED') NOT NULL DEFAULT 'PREPARING';

ALTER TABLE `financial_close_runs`
  DROP CONSTRAINT `financial_close_runs_reviewed_chk`,
  ADD CONSTRAINT `financial_close_runs_reviewed_chk` CHECK (
    (`status` IN ('PREPARING', 'AWAITING_APPROVAL') AND `reviewed_by_id` IS NULL AND `reviewed_at` IS NULL)
    OR (`status` IN ('REVIEWED', 'CLOSED') AND `reviewed_by_id` IS NOT NULL AND `reviewed_at` IS NOT NULL)
  );

CREATE TABLE `approval_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `subject_type` ENUM('FINANCIAL_CLOSE_RUN') NOT NULL,
  `subject_id` VARCHAR(80) NOT NULL,
  `subject_version` INT UNSIGNED NOT NULL,
  `subject_snapshot_hash_sha256` BINARY(32) NOT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  `requested_by_id` BIGINT UNSIGNED NOT NULL,
  `maker_checker_required` BOOLEAN NOT NULL DEFAULT TRUE,
  `active_subject_key` VARCHAR(160) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `approval_requests_public_id_key` (`public_id`),
  UNIQUE KEY `approval_requests_id_company_id_key` (`id`, `company_id`),
  UNIQUE KEY `approval_requests_company_active_subject_key` (`company_id`, `active_subject_key`),
  KEY `approval_requests_company_status_created_idx` (`company_id`, `status`, `created_at`),
  KEY `approval_requests_company_subject_created_idx` (`company_id`, `subject_type`, `subject_id`, `created_at`),
  KEY `approval_requests_requested_by_created_idx` (`requested_by_id`, `created_at`),
  CONSTRAINT `approval_requests_active_subject_chk` CHECK (
    (`status` = 'PENDING' AND `active_subject_key` IS NOT NULL)
    OR (`status` <> 'PENDING' AND `active_subject_key` IS NULL)
  ),
  CONSTRAINT `approval_requests_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `approval_requests_requested_by_id_fkey` FOREIGN KEY (`requested_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `approval_decisions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `approval_request_id` BIGINT UNSIGNED NOT NULL,
  `decision` ENUM('APPROVE', 'REJECT') NOT NULL,
  `actor_user_id` BIGINT UNSIGNED NOT NULL,
  `reason` VARCHAR(500) NULL,
  `decided_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `approval_decisions_approval_request_id_key` (`approval_request_id`),
  UNIQUE KEY `approval_decisions_id_company_id_key` (`id`, `company_id`),
  KEY `approval_decisions_company_decided_idx` (`company_id`, `decided_at`),
  KEY `approval_decisions_actor_decided_idx` (`actor_user_id`, `decided_at`),
  CONSTRAINT `approval_decisions_reason_chk` CHECK (
    (`decision` = 'APPROVE' AND `reason` IS NULL)
    OR (`decision` = 'REJECT' AND CHAR_LENGTH(TRIM(`reason`)) BETWEEN 10 AND 500)
  ),
  CONSTRAINT `approval_decisions_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `approval_decisions_request_company_fkey` FOREIGN KEY (`approval_request_id`, `company_id`) REFERENCES `approval_requests` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `approval_decisions_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('approvals.view', 'approvals', 'عرض طلبات وقرارات الموافقة'),
  ('approvals.decide', 'approvals', 'اعتماد أو رفض طلبات الموافقة')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN ('approvals.view', 'approvals.decide')
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE;
