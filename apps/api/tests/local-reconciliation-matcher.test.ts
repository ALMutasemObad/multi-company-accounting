import { describe, expect, it } from "vitest";
import { LocalReconciliationMatcher } from "../src/treasury/reconciliation/local-reconciliation-matcher.js";
import type {
  ReconciliationStatementFact,
  TreasuryMovementFact,
} from "../src/treasury/reconciliation/reconciliation-types.js";

const line = (
  id: bigint,
  bookingDate: string,
  amount: string,
  reference?: string,
): ReconciliationStatementFact => ({
  id,
  bookingDate,
  amount,
  currency: "SAR",
  ...(reference ? { reference } : {}),
});

const movement = (
  key: string,
  occurredOn: string,
  amount: string,
  reference?: string,
): TreasuryMovementFact => ({
  key,
  occurredOn,
  amount,
  currency: "SAR",
  ...(reference ? { reference } : {}),
  documentType: "MANUAL_JOURNAL",
  documentNumber: `DOC-${key}`,
});

describe("local 1:1 reconciliation matcher", () => {
  const matcher = new LocalReconciliationMatcher();

  it("prioritizes exact reference, amount and currency without binary floating point", () => {
    const proposals = matcher.propose(
      [line(2n, "2026-08-10", "0.3000", " ref-001 ")],
      [
        movement("b", "2026-08-10", "0.3000", "other"),
        movement("a", "2026-08-11", "0.3000", "REF-001"),
      ],
    );
    expect(proposals).toEqual([expect.objectContaining({
      bankStatementLineId: 2n,
      rule: "EXACT_REFERENCE_AMOUNT_CURRENCY",
      score: 100,
      bookMovement: expect.objectContaining({ key: "a" }),
    })]);
  });

  it("suggests exact amount and currency in the date window but never auto-approves", () => {
    const proposals = matcher.propose(
      [line(1n, "2026-08-10", "100.0000")],
      [movement("m-1", "2026-08-12", "100.0000")],
      { dateWindowDays: 3 },
    );
    expect(proposals).toEqual([expect.objectContaining({
      rule: "EXACT_AMOUNT_CURRENCY_DATE",
      score: 70,
    })]);
    expect(proposals[0]).not.toHaveProperty("approved");
  });

  it("rejects ambiguous equal-distance candidates and uses each fact at most once", () => {
    expect(matcher.propose(
      [line(1n, "2026-08-10", "10.0000")],
      [
        movement("a", "2026-08-09", "10.0000"),
        movement("b", "2026-08-11", "10.0000"),
      ],
    )).toEqual([]);

    const proposals = matcher.propose(
      [
        line(2n, "2026-08-10", "10.0000", "ONE"),
        line(1n, "2026-08-10", "10.0000", "ONE"),
      ],
      [movement("only", "2026-08-10", "10.0000", "ONE")],
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.bankStatementLineId).toBe(1n);
  });

  it("does not apply tolerance, fuzzy amounts or currency conversion", () => {
    expect(matcher.propose(
      [line(1n, "2026-08-10", "10.0000", "REF")],
      [
        { ...movement("amount", "2026-08-10", "10.0001", "REF") },
        { ...movement("currency", "2026-08-10", "10.0000", "REF"), currency: "USD" },
      ],
    )).toEqual([]);
  });
});
