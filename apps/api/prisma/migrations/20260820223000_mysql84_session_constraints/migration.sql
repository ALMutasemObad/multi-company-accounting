-- MySQL 8.4 does not allow a column referenced by a CHECK constraint to also
-- participate in a cascading or SET NULL foreign-key action. Users and
-- companies use application-level deactivation, so restricting physical ID
-- deletion and updates is the correct accounting-data invariant.
ALTER TABLE `sessions`
  DROP FOREIGN KEY `sessions_user_id_fkey`,
  DROP FOREIGN KEY `sessions_selected_company_id_fkey`;

ALTER TABLE `sessions`
  ADD CONSTRAINT `sessions_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `sessions_selected_company_id_fkey`
    FOREIGN KEY (`selected_company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `fiscal_periods`
  DROP FOREIGN KEY `fiscal_periods_closed_by_fkey`,
  DROP FOREIGN KEY `fiscal_periods_reopened_by_fkey`;

ALTER TABLE `fiscal_periods`
  ADD CONSTRAINT `fiscal_periods_closed_by_fkey`
    FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fiscal_periods_reopened_by_fkey`
    FOREIGN KEY (`reopened_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `accounting_documents`
  DROP FOREIGN KEY `accounting_documents_posted_by_fkey`,
  DROP FOREIGN KEY `accounting_documents_reversed_by_document_id_company_id_fkey`;

ALTER TABLE `accounting_documents`
  ADD CONSTRAINT `accounting_documents_posted_by_fkey`
    FOREIGN KEY (`posted_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `accounting_documents_reversed_by_document_id_company_id_fkey`
    FOREIGN KEY (`reversed_by_document_id`, `company_id`) REFERENCES `accounting_documents`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `payment_methods`
  DROP FOREIGN KEY `payment_methods_company_id_fkey`;

ALTER TABLE `payment_methods`
  ADD CONSTRAINT `payment_methods_company_id_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `receipts`
  DROP FOREIGN KEY `receipts_customer_id_company_id_fkey`,
  DROP FOREIGN KEY `receipts_counter_account_id_company_id_fkey`;

ALTER TABLE `receipts`
  ADD CONSTRAINT `receipts_customer_id_company_id_fkey`
    FOREIGN KEY (`customer_id`, `company_id`) REFERENCES `customers`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `receipts_counter_account_id_company_id_fkey`
    FOREIGN KEY (`counter_account_id`, `company_id`) REFERENCES `accounts`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `payments`
  DROP FOREIGN KEY `payments_supplier_id_company_id_fkey`,
  DROP FOREIGN KEY `payments_counter_account_id_company_id_fkey`;

ALTER TABLE `payments`
  ADD CONSTRAINT `payments_supplier_id_company_id_fkey`
    FOREIGN KEY (`supplier_id`, `company_id`) REFERENCES `suppliers`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `payments_counter_account_id_company_id_fkey`
    FOREIGN KEY (`counter_account_id`, `company_id`) REFERENCES `accounts`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
