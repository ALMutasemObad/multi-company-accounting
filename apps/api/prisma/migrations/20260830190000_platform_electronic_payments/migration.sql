-- SUB-4: additive electronic-payment and subscription-invoice linkage foundation.
-- This migration does not integrate a commercial provider and stores no cardholder
-- data, provider credentials, request signatures, or webhook bodies.

ALTER TABLE `platform_billing_invoices`
  ADD COLUMN `subscription_id` BIGINT UNSIGNED NULL AFTER `billing_account_id`,
  ADD COLUMN `plan_version_id` BIGINT UNSIGNED NULL AFTER `subscription_id`,
  ADD COLUMN `subscription_change_id` BIGINT UNSIGNED NULL AFTER `plan_version_id`,
  ADD COLUMN `plan_display_name_snapshot` VARCHAR(160) NULL AFTER `subscription_change_id`,
  ADD KEY `platform_billing_invoices_company_subscription_idx`
    (`company_id`, `subscription_id`, `issue_date`, `id`),
  ADD KEY `platform_billing_invoices_plan_version_idx`
    (`plan_version_id`, `issue_date`, `id`),
  ADD KEY `platform_billing_invoices_subscription_change_idx` (`subscription_change_id`),
  ADD CONSTRAINT `platform_billing_invoices_subscription_fkey`
    FOREIGN KEY (`subscription_id`, `company_id`)
    REFERENCES `platform_subscriptions` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `platform_billing_invoices_plan_version_fkey`
    FOREIGN KEY (`plan_version_id`)
    REFERENCES `platform_plan_versions` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `platform_billing_invoices_subscription_change_fkey`
    FOREIGN KEY (`subscription_change_id`, `company_id`)
    REFERENCES `platform_subscription_changes` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE `platform_payment_attempts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `invoice_id` BIGINT UNSIGNED NOT NULL,
  `state` ENUM('CHECKOUT', 'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED') NOT NULL DEFAULT 'CHECKOUT',
  `provider_code` VARCHAR(64) NOT NULL,
  `provider_environment` ENUM('DEVELOPMENT', 'SANDBOX', 'LIVE') NOT NULL,
  `amount` DECIMAL(19,4) NOT NULL,
  `amount_minor` BIGINT UNSIGNED NOT NULL,
  `currency_code` CHAR(3) NOT NULL,
  `request_key_hash` BINARY(32) NOT NULL,
  `request_fingerprint` BINARY(32) NOT NULL,
  `provider_payment_id` VARCHAR(191) NULL,
  `provider_reference` VARCHAR(191) NULL,
  `failure_code` VARCHAR(100) NULL,
  `failure_reason` VARCHAR(500) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `requested_by_id` BIGINT UNSIGNED NOT NULL,
  `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `platform_payment_attempts_public_id_key` (`public_id`),
  UNIQUE KEY `platform_payment_attempts_id_company_key` (`id`, `company_id`),
  UNIQUE KEY `platform_payment_attempts_id_company_invoice_key` (`id`, `company_id`, `invoice_id`),
  UNIQUE KEY `platform_payment_attempts_company_request_key` (`company_id`, `request_key_hash`),
  UNIQUE KEY `platform_payment_attempts_provider_payment_key`
    (`provider_code`, `provider_environment`, `provider_payment_id`),
  KEY `platform_payment_attempts_company_state_idx`
    (`company_id`, `state`, `requested_at`, `id`),
  KEY `platform_payment_attempts_invoice_state_idx`
    (`invoice_id`, `state`, `requested_at`, `id`),
  KEY `platform_payment_attempts_requested_by_idx` (`requested_by_id`),
  CONSTRAINT `platform_payment_attempts_company_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_payment_attempts_invoice_fkey`
    FOREIGN KEY (`invoice_id`, `company_id`)
    REFERENCES `platform_billing_invoices` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_payment_attempts_requested_by_fkey`
    FOREIGN KEY (`requested_by_id`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_payment_attempts_money_chk` CHECK (
    `amount` > 0
    AND `amount_minor` > 0
    AND `amount` * 100 = `amount_minor`
    AND `currency_code` IN ('SAR', 'USD', 'YER')
  ),
  CONSTRAINT `platform_payment_attempts_provider_chk` CHECK (
    CHAR_LENGTH(TRIM(`provider_code`)) > 0
  ),
  CONSTRAINT `platform_payment_attempts_state_chk` CHECK (
    (`state` IN ('CHECKOUT', 'PENDING')
      AND `completed_at` IS NULL
      AND `failure_code` IS NULL
      AND `failure_reason` IS NULL)
    OR (`state` = 'FAILED'
      AND `completed_at` IS NOT NULL
      AND `failure_code` IS NOT NULL)
    OR (`state` IN ('PAID', 'CANCELLED', 'REFUNDED')
      AND `completed_at` IS NOT NULL
      AND `failure_code` IS NULL
      AND `failure_reason` IS NULL)
  ),
  CONSTRAINT `platform_payment_attempts_paid_reference_chk` CHECK (
    `state` NOT IN ('PAID', 'REFUNDED') OR `provider_payment_id` IS NOT NULL
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_checkout_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `payment_attempt_id` BIGINT UNSIGNED NOT NULL,
  `provider_code` VARCHAR(64) NOT NULL,
  `provider_environment` ENUM('DEVELOPMENT', 'SANDBOX', 'LIVE') NOT NULL,
  `provider_checkout_id` VARCHAR(191) NOT NULL,
  `hosted_checkout_url` VARCHAR(2048) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `platform_checkout_sessions_attempt_key` (`payment_attempt_id`),
  UNIQUE KEY `platform_checkout_sessions_attempt_company_key` (`payment_attempt_id`, `company_id`),
  UNIQUE KEY `platform_checkout_sessions_provider_checkout_key`
    (`provider_code`, `provider_environment`, `provider_checkout_id`),
  KEY `platform_checkout_sessions_company_expiry_idx` (`company_id`, `expires_at`, `id`),
  KEY `platform_checkout_sessions_expiry_idx` (`expires_at`, `id`),
  CONSTRAINT `platform_checkout_sessions_company_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_checkout_sessions_attempt_fkey`
    FOREIGN KEY (`payment_attempt_id`, `company_id`)
    REFERENCES `platform_payment_attempts` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_checkout_sessions_provider_chk` CHECK (
    CHAR_LENGTH(TRIM(`provider_code`)) > 0
    AND CHAR_LENGTH(TRIM(`provider_checkout_id`)) > 0
  ),
  CONSTRAINT `platform_checkout_sessions_expiry_chk` CHECK (`expires_at` > `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_payment_transitions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `payment_attempt_id` BIGINT UNSIGNED NOT NULL,
  `from_state` ENUM('CHECKOUT', 'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED') NULL,
  `to_state` ENUM('CHECKOUT', 'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED') NOT NULL,
  `source` ENUM('COMPANY_OWNER', 'PLATFORM_OPERATOR', 'WEBHOOK', 'SYSTEM') NOT NULL,
  `actor_id` BIGINT UNSIGNED NULL,
  `provider_event_id` VARCHAR(191) NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `platform_payment_transitions_attempt_event_key`
    (`payment_attempt_id`, `provider_event_id`),
  KEY `platform_payment_transitions_attempt_time_idx`
    (`company_id`, `payment_attempt_id`, `occurred_at`, `id`),
  KEY `platform_payment_transitions_actor_idx` (`actor_id`),
  CONSTRAINT `platform_payment_transitions_company_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_payment_transitions_attempt_fkey`
    FOREIGN KEY (`payment_attempt_id`, `company_id`)
    REFERENCES `platform_payment_attempts` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_payment_transitions_actor_fkey`
    FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_payment_transitions_source_chk` CHECK (
    (`source` IN ('COMPANY_OWNER', 'PLATFORM_OPERATOR')
      AND `actor_id` IS NOT NULL
      AND `provider_event_id` IS NULL)
    OR (`source` = 'WEBHOOK'
      AND `actor_id` IS NULL
      AND `provider_event_id` IS NOT NULL)
    OR (`source` = 'SYSTEM' AND `actor_id` IS NULL)
  ),
  CONSTRAINT `platform_payment_transitions_state_chk` CHECK (
    (`from_state` IS NULL AND `to_state` = 'CHECKOUT')
    OR (`from_state` = 'CHECKOUT' AND `to_state` IN ('PENDING', 'PAID', 'FAILED', 'CANCELLED'))
    OR (`from_state` = 'PENDING' AND `to_state` IN ('PAID', 'FAILED', 'CANCELLED'))
    OR (`from_state` IN ('FAILED', 'CANCELLED') AND `to_state` = 'PAID' AND `source` = 'WEBHOOK')
    OR (`from_state` = 'PAID' AND `to_state` = 'REFUNDED')
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_webhook_receipts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `provider_code` VARCHAR(64) NOT NULL,
  `provider_environment` ENUM('DEVELOPMENT', 'SANDBOX', 'LIVE') NOT NULL,
  `provider_event_id` VARCHAR(191) NOT NULL,
  `provider_payment_id` VARCHAR(191) NULL,
  `provider_refund_id` VARCHAR(191) NULL,
  `amount_minor` BIGINT UNSIGNED NULL,
  `currency_code` CHAR(3) NULL,
  `payload_hash` BINARY(32) NOT NULL,
  `processing_state` ENUM('APPLIED', 'IGNORED', 'REJECTED') NOT NULL,
  `result_code` VARCHAR(100) NOT NULL,
  `result_detail` VARCHAR(500) NULL,
  `company_id` BIGINT UNSIGNED NULL,
  `payment_attempt_id` BIGINT UNSIGNED NULL,
  `provider_occurred_at` DATETIME(3) NULL,
  `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `processed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `platform_webhook_receipts_provider_event_key`
    (`provider_code`, `provider_environment`, `provider_event_id`),
  KEY `platform_webhook_receipts_state_received_idx`
    (`processing_state`, `received_at`, `id`),
  KEY `platform_webhook_receipts_company_received_idx`
    (`company_id`, `received_at`, `id`),
  KEY `platform_webhook_receipts_attempt_received_idx`
    (`payment_attempt_id`, `received_at`, `id`),
  KEY `platform_webhook_receipts_provider_payment_idx`
    (`provider_code`, `provider_environment`, `provider_payment_id`),
  KEY `platform_webhook_receipts_provider_refund_idx`
    (`provider_code`, `provider_environment`, `provider_refund_id`),
  CONSTRAINT `platform_webhook_receipts_company_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_webhook_receipts_attempt_fkey`
    FOREIGN KEY (`payment_attempt_id`, `company_id`)
    REFERENCES `platform_payment_attempts` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_webhook_receipts_attempt_scope_chk` CHECK (
    `payment_attempt_id` IS NULL OR `company_id` IS NOT NULL
  ),
  CONSTRAINT `platform_webhook_receipts_money_chk` CHECK (
    (`amount_minor` IS NULL AND `currency_code` IS NULL)
    OR (`amount_minor` IS NOT NULL
      AND `amount_minor` > 0
      AND `currency_code` IN ('SAR', 'USD', 'YER'))
  ),
  CONSTRAINT `platform_webhook_receipts_provider_chk` CHECK (
    CHAR_LENGTH(TRIM(`provider_code`)) > 0
    AND CHAR_LENGTH(TRIM(`provider_event_id`)) > 0
  ),
  CONSTRAINT `platform_webhook_receipts_processing_time_chk` CHECK (
    `processed_at` >= `received_at`
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `platform_billing_payments`
  ADD COLUMN `payment_attempt_id` BIGINT UNSIGNED NULL AFTER `invoice_id`,
  ADD COLUMN `source` ENUM('MANUAL', 'ELECTRONIC_PROVIDER') NOT NULL DEFAULT 'MANUAL' AFTER `method`,
  MODIFY `received_by_id` BIGINT UNSIGNED NULL,
  ADD UNIQUE KEY `platform_billing_payments_attempt_key` (`payment_attempt_id`),
  ADD UNIQUE KEY `platform_billing_payments_id_company_attempt_key`
    (`id`, `company_id`, `payment_attempt_id`),
  ADD UNIQUE KEY `platform_billing_payments_attempt_company_invoice_key`
    (`payment_attempt_id`, `company_id`, `invoice_id`),
  ADD CONSTRAINT `platform_billing_payments_attempt_fkey`
    FOREIGN KEY (`payment_attempt_id`, `company_id`, `invoice_id`)
    REFERENCES `platform_payment_attempts` (`id`, `company_id`, `invoice_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `platform_billing_payments_source_actor_chk` CHECK (
    (`source` = 'MANUAL' AND `received_by_id` IS NOT NULL AND `payment_attempt_id` IS NULL)
    OR (`source` = 'ELECTRONIC_PROVIDER' AND `received_by_id` IS NULL AND `payment_attempt_id` IS NOT NULL)
  );

CREATE TABLE `platform_billing_refunds` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `payment_id` BIGINT UNSIGNED NOT NULL,
  `payment_attempt_id` BIGINT UNSIGNED NOT NULL,
  `state` ENUM('PENDING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `amount` DECIMAL(19,4) NOT NULL,
  `amount_minor` BIGINT UNSIGNED NOT NULL,
  `currency_code` CHAR(3) NOT NULL,
  `provider_refund_id` VARCHAR(191) NULL,
  `request_key_hash` BINARY(32) NULL,
  `request_fingerprint` BINARY(32) NULL,
  `failure_code` VARCHAR(100) NULL,
  `failure_reason` VARCHAR(500) NULL,
  `requested_by_id` BIGINT UNSIGNED NULL,
  `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `platform_billing_refunds_public_id_key` (`public_id`),
  UNIQUE KEY `platform_billing_refunds_payment_key` (`payment_id`),
  UNIQUE KEY `platform_billing_refunds_attempt_key` (`payment_attempt_id`),
  UNIQUE KEY `platform_billing_refunds_provider_refund_key` (`provider_refund_id`),
  UNIQUE KEY `platform_billing_refunds_id_company_key` (`id`, `company_id`),
  UNIQUE KEY `platform_billing_refunds_payment_company_attempt_key`
    (`payment_id`, `company_id`, `payment_attempt_id`),
  UNIQUE KEY `platform_billing_refunds_attempt_company_key`
    (`payment_attempt_id`, `company_id`),
  UNIQUE KEY `platform_billing_refunds_company_request_key`
    (`company_id`, `request_key_hash`),
  KEY `platform_billing_refunds_company_state_idx`
    (`company_id`, `state`, `requested_at`, `id`),
  KEY `platform_billing_refunds_requested_by_idx` (`requested_by_id`),
  CONSTRAINT `platform_billing_refunds_company_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_billing_refunds_payment_fkey`
    FOREIGN KEY (`payment_id`, `company_id`, `payment_attempt_id`)
    REFERENCES `platform_billing_payments` (`id`, `company_id`, `payment_attempt_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_billing_refunds_attempt_fkey`
    FOREIGN KEY (`payment_attempt_id`, `company_id`)
    REFERENCES `platform_payment_attempts` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_billing_refunds_requested_by_fkey`
    FOREIGN KEY (`requested_by_id`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_billing_refunds_money_chk` CHECK (
    `amount` > 0
    AND `amount_minor` > 0
    AND `amount` * 100 = `amount_minor`
    AND `currency_code` IN ('SAR', 'USD', 'YER')
  ),
  CONSTRAINT `platform_billing_refunds_request_chk` CHECK (
    (`request_key_hash` IS NULL AND `request_fingerprint` IS NULL)
    OR (`request_key_hash` IS NOT NULL
      AND `request_fingerprint` IS NOT NULL
      AND `requested_by_id` IS NOT NULL)
  ),
  CONSTRAINT `platform_billing_refunds_state_chk` CHECK (
    (`state` = 'PENDING'
      AND `completed_at` IS NULL
      AND `failure_code` IS NULL
      AND `failure_reason` IS NULL)
    OR (`state` = 'SUCCEEDED'
      AND `completed_at` IS NOT NULL
      AND `provider_refund_id` IS NOT NULL
      AND `failure_code` IS NULL
      AND `failure_reason` IS NULL)
    OR (`state` = 'FAILED'
      AND `completed_at` IS NOT NULL
      AND `failure_code` IS NOT NULL)
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
