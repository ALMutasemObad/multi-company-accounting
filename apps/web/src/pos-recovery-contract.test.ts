import contractSource from "../../../packages/contracts/openapi.yaml?raw";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { POS_RECOVERY_REJECTION_REASONS } from "./pos-recovery-model";

describe("POS recovery transport parity", () => {
  it("keeps the browser rejection allowlist identical to its OpenAPI source", () => {
    const document = parse(contractSource) as {
      components: { schemas: { PosCheckoutRejectionReason: { enum: string[] } } };
    };
    expect([...POS_RECOVERY_REJECTION_REASONS].sort()).toEqual([...document.components.schemas.PosCheckoutRejectionReason.enum].sort());
  });
});
