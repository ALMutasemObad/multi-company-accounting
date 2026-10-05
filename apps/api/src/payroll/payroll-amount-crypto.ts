import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type PayrollAmountEnvelope = Readonly<{
  algorithm: "AES-256-GCM";
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}>;
export type PayrollAmountScope = Readonly<{
  companyId: string;
  employeeId: string;
  recordId: string;
  field: "RECURRING_AMOUNT" | "ONE_OFF_AMOUNT";
  recordVersion: number;
}>;
export type PayrollKey = Readonly<{ id: string; bytes: Buffer }>;

const scopeBytes = (scope: PayrollAmountScope) => {
  if (!scope.companyId || !scope.employeeId || !scope.recordId || !Number.isSafeInteger(scope.recordVersion)
      || scope.recordVersion < 1 || !["RECURRING_AMOUNT", "ONE_OFF_AMOUNT"].includes(scope.field)) {
    throw new Error("INVALID_PAYROLL_ENCRYPTION_SCOPE");
  }
  return Buffer.from(JSON.stringify([scope.companyId, scope.employeeId, scope.recordId,
    scope.field, scope.recordVersion]), "utf8");
};
const keyBytes = (key: PayrollKey) => {
  if (!key.id || key.bytes.length !== 32) throw new Error("INVALID_PAYROLL_KEY");
  return key.bytes;
};
const canonicalAmount = (amount: string) => {
  if (!/^(?:0|[1-9]\d{0,18})(?:\.\d{1,8})?$/.test(amount)) throw new Error("INVALID_PAYROLL_AMOUNT");
  return amount;
};

/** The caller owns key retrieval/rotation. Never persist key bytes beside this envelope. */
export function encryptPayrollAmount(amount: string, scope: PayrollAmountScope, key: PayrollKey): PayrollAmountEnvelope {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), nonce);
  cipher.setAAD(scopeBytes(scope));
  const ciphertext = Buffer.concat([cipher.update(canonicalAmount(amount), "utf8"), cipher.final()]);
  return Object.freeze({ algorithm: "AES-256-GCM", keyId: key.id,
    nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") });
}

export function decryptPayrollAmount(envelope: PayrollAmountEnvelope, scope: PayrollAmountScope, key: PayrollKey): string {
  if (envelope.algorithm !== "AES-256-GCM" || envelope.keyId !== key.id) throw new Error("PAYROLL_KEY_MISMATCH");
  const nonce = Buffer.from(envelope.nonce, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  if (nonce.length !== 12 || tag.length !== 16) throw new Error("INVALID_PAYROLL_ENVELOPE");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), nonce);
  decipher.setAAD(scopeBytes(scope));
  decipher.setAuthTag(tag);
  try {
    return canonicalAmount(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8"));
  } catch {
    // Do not include salary, employee identifiers or cryptographic material in the error.
    throw new Error("PAYROLL_DECRYPTION_FAILED");
  }
}
