ALTER TABLE `users`
  MODIFY `password_hash` VARCHAR(255) NULL;

CREATE TABLE `social_onboarding_continuations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` VARCHAR(80) NOT NULL,
  `token_hash` BINARY(32) NOT NULL,
  `authorization_transaction_id` BIGINT UNSIGNED NOT NULL,
  `initiating_session_id` BIGINT UNSIGNED NOT NULL,
  `protected_profile` VARBINARY(2048) NOT NULL,
  `browser_binding_hash` BINARY(32) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `used_at` DATETIME(3) NULL,
  `completed_user_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `social_onboarding_public_id_key` (`public_id`),
  UNIQUE INDEX `social_onboarding_token_hash_key` (`token_hash`),
  UNIQUE INDEX `social_onboarding_authorization_key` (`authorization_transaction_id`),
  INDEX `social_onboarding_expiry_idx` (`expires_at`, `used_at`),
  INDEX `social_onboarding_session_idx` (`initiating_session_id`, `used_at`),
  INDEX `social_onboarding_completed_user_idx` (`completed_user_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `social_onboarding_authorization_fk` FOREIGN KEY (`authorization_transaction_id`) REFERENCES `social_authorization_transactions` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `social_onboarding_session_fk` FOREIGN KEY (`initiating_session_id`) REFERENCES `sessions` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `social_onboarding_completed_user_fk` FOREIGN KEY (`completed_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
