-- DropForeignKey
ALTER TABLE `accounting_documents` DROP FOREIGN KEY `accounting_documents_reversed_by_document_id_fkey`;

-- DropForeignKey
ALTER TABLE `journal_entries` DROP FOREIGN KEY `journal_entries_reversal_of_journal_entry_id_fkey`;

-- DropIndex
DROP INDEX `accounting_documents_reversed_by_document_id_key` ON `accounting_documents`;

-- DropIndex
DROP INDEX `journal_entries_reversal_of_journal_entry_id_key` ON `journal_entries`;

-- AlterTable
ALTER TABLE `companies` ADD COLUMN `manual_journal_maker_checker_enabled` BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX `accounting_documents_reversed_by_document_id_company_id_key` ON `accounting_documents`(`reversed_by_document_id`, `company_id`);

-- CreateIndex
CREATE UNIQUE INDEX `journal_entries_reversal_of_journal_entry_id_company_id_key` ON `journal_entries`(`reversal_of_journal_entry_id`, `company_id`);

-- AddForeignKey
ALTER TABLE `accounting_documents` ADD CONSTRAINT `accounting_documents_reversed_by_document_id_company_id_fkey` FOREIGN KEY (`reversed_by_document_id`, `company_id`) REFERENCES `accounting_documents`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_reversal_of_journal_entry_id_company_id_fkey` FOREIGN KEY (`reversal_of_journal_entry_id`, `company_id`) REFERENCES `journal_entries`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
