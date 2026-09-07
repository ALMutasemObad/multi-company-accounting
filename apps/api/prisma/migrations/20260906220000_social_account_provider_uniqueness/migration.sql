-- One identity per configured provider per user. Existing rows are never
-- rewritten or deleted: duplicate data makes this ALTER fail closed.
ALTER TABLE `external_identities`
  DROP INDEX `external_identities_user_provider_idx`,
  ADD UNIQUE INDEX `ext_identity_user_provider_key` (`user_id`, `provider`);
