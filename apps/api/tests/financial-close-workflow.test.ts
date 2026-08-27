import { describe, expect, it } from "vitest";
import {
  InvalidFinancialCloseTransitionError,
  transitionFinancialClose,
} from "../src/fiscal/financial-close-workflow.js";

describe("financial close workflow adapter", () => {
  it("supports prepare, approval, return, close, and reopen transitions", () => {
    expect(transitionFinancialClose("OPEN", "PREPARE")).toBe("PREPARING");
    expect(transitionFinancialClose("PREPARING", "SUBMIT")).toBe("AWAITING_APPROVAL");
    expect(transitionFinancialClose("AWAITING_APPROVAL", "APPROVE")).toBe("REVIEWED");
    expect(transitionFinancialClose("AWAITING_APPROVAL", "REJECT")).toBe("PREPARING");
    expect(transitionFinancialClose("REVIEWED", "RETURN")).toBe("PREPARING");
    expect(transitionFinancialClose("REVIEWED", "CLOSE")).toBe("CLOSED");
    expect(transitionFinancialClose("CLOSED", "REOPEN")).toBe("OPEN");
  });

  it("rejects skipped and repeated transitions", () => {
    expect(() => transitionFinancialClose("OPEN", "APPROVE")).toThrow(InvalidFinancialCloseTransitionError);
    expect(() => transitionFinancialClose("PREPARING", "CLOSE")).toThrow(InvalidFinancialCloseTransitionError);
    expect(() => transitionFinancialClose("CLOSED", "CLOSE")).toThrow(InvalidFinancialCloseTransitionError);
  });
});
