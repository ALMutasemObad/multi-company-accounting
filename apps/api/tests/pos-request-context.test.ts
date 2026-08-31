import { describe, expect, it, vi } from "vitest";
import { bindPosRequestContext, PosRequestContextError } from "../src/platform/pos-request-context.js";

function headers(userId: string, companyId: string) {
  return {
    headers: { "x-pos-expected-user-id": userId, "x-pos-expected-company-id": companyId },
    rawHeaders: ["X-POS-Expected-User-Id", userId, "X-POS-Expected-Company-Id", companyId],
  };
}

describe("POS request identity guard before HTTP transport normalization", () => {
  it.each(["\n", "\r", "\r\n", "\u2028", "\u2029", " ", "\t", "\u00a0"])("rejects line terminators or whitespace %j without authorizing or downgrading", suffix => {
    const authorize = vi.fn(async () => ({ userId: 1n, companyId: 2n }));
    for (const value of ["1" + suffix, suffix + "1", "1" + suffix + "2"]) {
      for (const request of [headers(value, "2"), headers("1", value)]) {
        for (const required of [false, true]) {
          expect(() => bindPosRequestContext(request, authorize, required)).toThrowError(new PosRequestContextError("POS_CONTEXT_REQUIRED"));
        }
      }
    }
    expect(authorize).not.toHaveBeenCalled();
  });

  it.each(["1", "9", "10", "18446744073709551615"])("accepts canonical positive unsigned64 identity %s", async id => {
    const actor = { userId: BigInt(id), companyId: BigInt(id) };
    const authorize = vi.fn(async () => actor);
    const binding = bindPosRequestContext(headers(id, id), authorize, true);
    expect(await binding.authorize()).toEqual(actor);
    expect(binding.response({ data: [] })).toEqual({ data: [], posContext: { userId: id, companyId: id } });
  });

  it.each(["", "0", "01", "+1", "-1", "1.0", "1e1", "18446744073709551616", "100000000000000000000", "١", "１"])("rejects noncanonical or out-of-bounds identity %j", id => {
    const authorize = vi.fn(async () => ({ userId: 1n, companyId: 2n }));
    expect(() => bindPosRequestContext(headers(id, "2"), authorize)).toThrowError(new PosRequestContextError("POS_CONTEXT_REQUIRED"));
    expect(() => bindPosRequestContext(headers("1", id), authorize)).toThrowError(new PosRequestContextError("POS_CONTEXT_REQUIRED"));
    expect(authorize).not.toHaveBeenCalled();
  });
});
