-- Supports the stable platform billing account order used by database pagination.
CREATE INDEX `platform_billing_accounts_next_id_idx`
  ON `platform_billing_accounts` (`next_billing_date`, `id`);
