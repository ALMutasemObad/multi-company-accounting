CREATE TABLE `external_identities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `provider` ENUM('GOOGLE', 'APPLE') NOT NULL,
  `issuer` VARCHAR(255) NOT NULL,
  `subject` VARCHAR(255) NOT NULL,
  `email_snapshot` VARCHAR(320) NULL,
  `private_relay` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `external_identities_issuer_subject_key` (`issuer`, `subject`),
  INDEX `external_identities_user_provider_idx` (`user_id`, `provider`),
  PRIMARY KEY (`id`),
  CONSTRAINT `external_identities_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `social_authorization_transactions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `provider` ENUM('GOOGLE', 'APPLE') NOT NULL,
  `purpose` ENUM('SIGN_IN', 'LINK') NOT NULL,
  `initiating_session_id` BIGINT UNSIGNED NOT NULL,
  `initiating_user_id` BIGINT UNSIGNED NULL,
  `state_hash` BINARY(32) NOT NULL,
  `nonce_hash` BINARY(32) NOT NULL,
  `protected_nonce` VARBINARY(256) NOT NULL,
  `browser_binding_hash` BINARY(32) NOT NULL,
  `protected_pkce_verifier` VARBINARY(512) NOT NULL,
  `return_path` VARCHAR(255) NOT NULL,
  `consented_at` DATETIME(3) NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `used_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `social_authorization_state_hash_key` (`state_hash`),
  INDEX `social_authorization_expiry_idx` (`expires_at`, `used_at`),
  INDEX `social_authorization_session_idx` (`initiating_session_id`, `provider`, `purpose`),
  PRIMARY KEY (`id`),
  CONSTRAINT `social_authorization_session_fk` FOREIGN KEY (`initiating_session_id`) REFERENCES `sessions` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `social_authorization_user_fk` FOREIGN KEY (`initiating_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
