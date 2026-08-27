import { describe, expect, it } from "vitest";
import {
  InvalidFinancialCloseTransitionError,
  transitionFinancialClose,
} from "../src/fiscal/financial-close-workflow.js";

describe("financial close workflow adapter", () => {
  it("supports prepare, review, return, close, and reopen transitions", () => {
    expect(transitionFinancialClose("OPEN", "PREPARE")).toBe("PREPARING");
    expect(transitionFinancialClose("PREPARING", "REVIEW")).toBe("REVIEWED");
    expect(transitionFinancialClose("REVIEWED", "RETURN")).toBe("PREPARING");
    expect(transitionFinancialClose("REVIEWED", "CLOSE")).toBe("CLOSED");
    expect(transitionFinancialClose("CLOSED", "REOPEN")).toBe("OPEN");
  });

  it("rejects skipped and repeated transitions", () => {
    expect(() => transitionFinancialClose("OPEN", "REVIEW")).toThrow(InvalidFinancialCloseTransitionError);
    expect(() => transitionFinancialClose("PREPARING", "CLOSE")).toThrow(InvalidFinancialCloseTransitionError);
    expect(() => transitionFinancialClose("CLOSED", "CLOSE")).toThrow(InvalidFinancialCloseTransitionError);
  });
});
