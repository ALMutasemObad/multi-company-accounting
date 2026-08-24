import type { Prisma } from "@prisma/client";

export type MasterDataEntityType =
  | "CUSTOMER"
  | "SUPPLIER"
  | "COST_CENTER"
  | "CASH_BANK_ACCOUNT"
  | "WAREHOUSE"
  | "INVENTORY_ITEM"
  | "PAYMENT_METHOD"
  | "TAX_RATE"
  | "CUSTOM_ROLE";

const defaults: Record<
  MasterDataEntityType,
  { prefix: string | ((companyId: bigint) => string); padding: number }
> = {
  CUSTOMER: { prefix: "CUS-", padding: 6 },
  SUPPLIER: { prefix: "SUP-", padding: 6 },
  COST_CENTER: { prefix: "CC-", padding: 6 },
  CASH_BANK_ACCOUNT: { prefix: "CB-", padding: 6 },
  WAREHOUSE: { prefix: "WH-", padding: 6 },
  INVENTORY_ITEM: { prefix: "ITM-", padding: 6 },
  PAYMENT_METHOD: {
    // PaymentMethod.code is globally unique because GLOBAL methods have no
    // company owner. Embedding the company id keeps generated company methods
    // collision-free while their numeric sequence remains company-scoped.
    prefix: (companyId) => `PM-${companyId}-`,
    padding: 6,
  },
  TAX_RATE: { prefix: "TAX-", padding: 6 },
  CUSTOM_ROLE: { prefix: "ROL-", padding: 6 },
};

type ReservedSequenceRow = {
  prefix: string;
  padding: number;
  nextNumber: bigint;
};

export function formatMasterDataCode(
  prefix: string,
  sequenceNumber: bigint,
  padding: number,
) {
  if (sequenceNumber < 1n) {
    throw new RangeError("Master-data sequence number must be positive");
  }
  if (!Number.isInteger(padding) || padding < 1 || padding > 20) {
    throw new RangeError("Master-data sequence padding must be between 1 and 20");
  }
  const code = `${prefix}${sequenceNumber.toString().padStart(padding, "0")}`;
  if (code.length > 40) {
    throw new RangeError("Generated master-data code exceeds 40 characters");
  }
  return code;
}

/**
 * Reserves one company-scoped master-data code on the current transaction.
 *
 * LAST_INSERT_ID is connection-local. Prisma keeps an interactive transaction
 * on one connection, so the increment and read are atomic on MySQL/MariaDB.
 * The caller must create the aggregate using the returned code before commit.
 */
export async function reserveMasterDataCode(
  tx: Prisma.TransactionClient,
  companyId: bigint,
  entityType: MasterDataEntityType,
) {
  const initial = defaults[entityType];
  const initialPrefix =
    typeof initial.prefix === "function"
      ? initial.prefix(companyId)
      : initial.prefix;
  await tx.$executeRaw`
    INSERT INTO master_data_code_sequences
      (company_id, entity_type, prefix, next_number, padding, created_at, updated_at)
    VALUES
      (${companyId}, ${entityType}, ${initialPrefix}, 1, ${initial.padding}, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
  `;

  const affected = await tx.$executeRaw`
    UPDATE master_data_code_sequences
    SET next_number = LAST_INSERT_ID(next_number + 1),
        updated_at = CURRENT_TIMESTAMP(3)
    WHERE company_id = ${companyId}
      AND entity_type = ${entityType}
  `;
  if (affected !== 1) {
    throw new Error("MASTER_DATA_SEQUENCE_NOT_RESERVED");
  }

  const rows = await tx.$queryRaw<ReservedSequenceRow[]>`
    SELECT
      prefix,
      padding,
      CAST(LAST_INSERT_ID() AS UNSIGNED) AS nextNumber
    FROM master_data_code_sequences
    WHERE company_id = ${companyId}
      AND entity_type = ${entityType}
  `;
  const row = rows[0];
  if (!row || row.nextNumber < 2n) {
    throw new Error("MASTER_DATA_SEQUENCE_NOT_RESERVED");
  }

  return formatMasterDataCode(row.prefix, row.nextNumber - 1n, row.padding);
}
