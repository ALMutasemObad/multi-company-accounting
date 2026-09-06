ALTER TABLE `external_identities`
  DROP INDEX `ext_identity_user_provider_key`,
  ADD INDEX `external_identities_user_provider_idx` (`user_id`, `provider`);
