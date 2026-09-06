CREATE TABLE `organization_idempotency_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `operation` VARCHAR(100) NOT NULL,
  `key_hash` BINARY(32) NOT NULL,
  `request_fingerprint` BINARY(32) NOT NULL,
  `status` ENUM('IN_PROGRESS', 'COMPLETED') NOT NULL,
  `response_status` SMALLINT UNSIGNED NULL,
  `response_body` JSON NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `org_idempotency_scope_key` (`organization_id`, `user_id`, `operation`, `key_hash`),
  INDEX `org_idempotency_expiry` (`expires_at`),
  CONSTRAINT `org_idempotency_organization_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `org_idempotency_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
