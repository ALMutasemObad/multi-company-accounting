CREATE TABLE `rate_limit_counters` (
  `scope` VARCHAR(40) NOT NULL,
  `identity_hash` BINARY(32) NOT NULL,
  `window_started_at` DATETIME(3) NOT NULL,
  `request_count` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `expires_at` DATETIME(3) NOT NULL,

  PRIMARY KEY (`scope`, `identity_hash`, `window_started_at`),
  INDEX `rate_limit_counters_expires_at_idx` (`expires_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
