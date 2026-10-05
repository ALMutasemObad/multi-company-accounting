import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";

const envelopeSchema = z.object({ keyId: z.string().min(1), nonce: z.string(), tag: z.string(), ciphertext: z.string() }).strict();
export type PayrollEnvelope = z.infer<typeof envelopeSchema>;
export type PayrollVaultScope = { companyId: bigint; kind: "AGREEMENT" | "RUN"; publicId: string };
const aad = (scope: PayrollVaultScope) => Buffer.from(JSON.stringify(["payroll-v1", String(scope.companyId), scope.kind, scope.publicId]));

/** Keys are injected by deployment secret storage, never loaded from the payroll database. */
export class PayrollVault {
  static fromEnvironment(env: NodeJS.ProcessEnv): PayrollVault | null {
    if (env.PAYROLL_ENABLED !== "true") return null;
    if (env.NODE_ENV === "production" && env.PAYROLL_POLICY_REVIEWED !== "true") throw new Error("PAYROLL_POLICY_REVIEW_REQUIRED");
    try {
      const keys = z.record(z.string(), z.string()).parse(JSON.parse(env.PAYROLL_KEY_RING ?? ""));
      return new PayrollVault(env.PAYROLL_ACTIVE_KEY_ID ?? "", keys, env.PAYROLL_FINGERPRINT_KEY_ID ?? "");
    } catch { throw new Error("PAYROLL_CONFIGURATION_INVALID"); }
  }
  private readonly keys = new Map<string, Buffer>();
  constructor(private readonly activeKeyId: string, keys: Readonly<Record<string, string>>, private readonly fingerprintKeyId: string) {
    for (const [id, encoded] of Object.entries(keys)) {
      const bytes = Buffer.from(encoded, "base64");
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || bytes.length !== 32 || bytes.toString("base64") !== encoded) {
        throw new Error("INVALID_PAYROLL_KEY_CONFIGURATION");
      }
      this.keys.set(id, bytes);
    }
    if (!this.keys.has(activeKeyId)) throw new Error("PAYROLL_ACTIVE_KEY_MISSING");
    if (!this.keys.has(fingerprintKeyId)) throw new Error("PAYROLL_FINGERPRINT_KEY_MISSING");
  }
  seal(scope: PayrollVaultScope, payload: unknown): PayrollEnvelope {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.keys.get(this.activeKeyId)!, nonce);
    cipher.setAAD(aad(scope));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    return { keyId: this.activeKeyId, nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
  }
  open<T>(scope: PayrollVaultScope, value: unknown, schema: z.ZodType<T>): T {
    try {
      const envelope = envelopeSchema.parse(value);
      const key = this.keys.get(envelope.keyId);
      if (!key) throw new Error("missing key");
      const nonce = Buffer.from(envelope.nonce, "base64");
      const tag = Buffer.from(envelope.tag, "base64");
      if (nonce.length !== 12 || tag.length !== 16) throw new Error("invalid envelope");
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(aad(scope));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
      return schema.parse(JSON.parse(plaintext));
    } catch {
      throw new Error("PAYROLL_PRIVATE_DATA_UNAVAILABLE");
    }
  }
  fingerprint(value: string) {
    // Prevent offline guessing of a small salary from an idempotency fingerprint.
    return createHmac("sha256", this.keys.get(this.fingerprintKeyId)!).update("payroll-command-v1:").update(value).digest("hex");
  }
  snapshotHash(envelope: unknown) {
    return createHash("sha256").update(JSON.stringify(envelopeSchema.parse(envelope))).digest("hex");
  }
}
