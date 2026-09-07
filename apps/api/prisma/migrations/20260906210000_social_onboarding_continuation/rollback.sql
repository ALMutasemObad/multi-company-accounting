-- Fail closed before dropping continuation evidence when social-only users
-- already exist. An operator must first move those accounts to a supported
-- credential migration; this rollback never invents or deletes credentials.
ALTER TABLE `users`
  MODIFY `password_hash` VARCHAR(255) NOT NULL;

DROP TABLE IF EXISTS `social_onboarding_continuations`;
