-- Durable post-commit delivery for registration verification email and future
-- internal integration events. The envelope deliberately stores neither email,
-- verification tokens, nor provider credentials.
ALTER TABLE `registration_requests`
  ADD COLUMN `delivery_generation` SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER `delivery_attempts`;

CREATE TABLE `outbox_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id` CHAR(36) NOT NULL,
  `event_type` VARCHAR(100) NOT NULL,
  `schema_version` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `aggregate_type` VARCHAR(80) NOT NULL,
  `aggregate_id` VARCHAR(80) NOT NULL,
  `company_id` BIGINT UNSIGNED NULL,
  `payload` JSON NOT NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `status` ENUM('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `attempt_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `max_attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 8,
  `locked_at` DATETIME(3) NULL,
  `lock_token` CHAR(36) NULL,
  `last_error_code` VARCHAR(80) NULL,
  `last_error_at` DATETIME(3) NULL,
  `processed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `outbox_events_event_id_key` (`event_id`),
  INDEX `outbox_events_status_available_at_id_idx` (`status`, `available_at`, `id`),
  INDEX `outbox_events_status_locked_at_idx` (`status`, `locked_at`),
  INDEX `outbox_events_aggregate_type_aggregate_id_created_at_idx` (`aggregate_type`, `aggregate_id`, `created_at`),
  INDEX `outbox_events_processed_at_idx` (`processed_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Preserve pre-deployment pending registrations. UUID and JSON_OBJECT are
-- supported by both target engines (MySQL 8.4 and MariaDB 10.11).
INSERT INTO `outbox_events` (
  `event_id`, `event_type`, `schema_version`, `aggregate_type`, `aggregate_id`,
  `company_id`, `payload`, `occurred_at`, `status`, `available_at`,
  `attempt_count`, `max_attempts`, `updated_at`
)
SELECT
  UUID(), 'RegistrationVerificationRequested', 1, 'RegistrationRequest', `public_id`,
  NULL, JSON_OBJECT('deliveryGeneration', `delivery_generation`), `updated_at`, 'PENDING', CURRENT_TIMESTAMP(3),
  0, 8, CURRENT_TIMESTAMP(3)
FROM `registration_requests`
WHERE `status` = 'PENDING_EMAIL';
