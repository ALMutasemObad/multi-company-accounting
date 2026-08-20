CREATE TABLE `security_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `session_id` BIGINT UNSIGNED NULL,
  `event_type` VARCHAR(80) NOT NULL,
  `severity` ENUM('INFO', 'WARNING', 'HIGH', 'CRITICAL') NOT NULL,
  `email_snapshot` VARCHAR(320) NULL,
  `ip_address` VARCHAR(64) NULL,
  `user_agent` VARCHAR(500) NULL,
  `details` JSON NULL,
  `acknowledged_at` DATETIME(3) NULL,
  `acknowledged_by_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `security_events_company_id_created_at_idx` (`company_id`, `created_at`),
  INDEX `security_events_company_id_severity_acknowledged_at_idx` (`company_id`, `severity`, `acknowledged_at`),
  INDEX `security_events_user_id_created_at_idx` (`user_id`, `created_at`),
  INDEX `security_events_session_id_idx` (`session_id`),
  CONSTRAINT `security_events_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `security_events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `security_events_acknowledged_by_id_fkey` FOREIGN KEY (`acknowledged_by_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`code`, `module`, `description_ar`) VALUES
  ('security_events.view', 'security', 'عرض سجل الأمان والتنبيهات'),
  ('security_events.acknowledge', 'security', 'الإقرار بتنبيهات سجل الأمان')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `r`.`id`, `p`.`id`
FROM `roles` `r`
JOIN `permissions` `p` ON `p`.`code` IN ('security_events.view', 'security_events.acknowledge')
WHERE `r`.`code` = 'ADMINISTRATOR';
