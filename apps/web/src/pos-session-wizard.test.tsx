import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./ui", () => ({
  Modal: ({ children, title }: { children: React.ReactNode; title: string }) => <section role="dialog" aria-label={title}>{children}</section>,
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));
vi.mock("./i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import { isPosSessionDetailsComplete, PosSessionWizard } from "./PosSessionWizard";

const snapshot = {
  scopeKey: "scope", documentDate: "2026-09-15", requiresWarehouse: true, lock: null, canEdit: true, canReview: true,
  reviewed: false, hasSavedDraft: false, verificationExpired: false,
  period: { documentDate: "2026-09-15", status: "RESOLVED" as const, period: { id: "1", name: "Open period", startDate: "2026-01-01", endDate: "2026-12-31", status: "OPEN" as const, version: 1 } },
  fields: {
    warehouseId: { id: "1", source: "choice" as const, status: "available" as const, reference: { id: "1", label: "Main warehouse", revision: "1" } },
    cashBankAccountId: { id: "2", source: "choice" as const, status: "available" as const, reference: { id: "2", label: "Cash", revision: "1" } },
    paymentMethodId: { id: "3", source: "choice" as const, status: "available" as const, reference: { id: "3", label: "Cash", revision: "1", requiresReference: false } },
    currencyId: { id: "4", source: "choice" as const, status: "available" as const, reference: { id: "4", label: "SAR", revision: "1", isBase: true } },
  },
};

describe("PosSessionWizard", () => {
  it("renders the first navigable step and never exposes checkout", () => {
    const html = renderToStaticMarkup(<PosSessionWizard locale="en" onClose={vi.fn()} onReview={() => false} blocked={false}
      snapshot={snapshot} value={{ periodId: "1", currencyId: "4", exchangeRate: "1", documentDate: "2026-09-15", description: "Counter sale", customerId: "5", customerLabel: "Walk-in", warehouseId: "1", warehouseLabel: "Main warehouse", cashAccountId: "2", cashAccountLabel: "Cash", paymentMethod: { id: "3", label: "Cash", requiresReference: false }, referenceNumber: "", notes: "" }}
      sessionContext={<div data-testid="session-context">Context controller</div>} saleDetails={<div>Sale details</div>} />);
    expect(html).toContain("Prepare sale session");
    expect(html).toContain("Context controller");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Close and return to basket");
    expect(html).not.toContain("Complete sale and receipt");
  });
  it("requires every sale detail and a required payment reference before activation", () => {
    const value = { periodId: "", currencyId: "", exchangeRate: "1", documentDate: "2026-09-15", description: "Counter sale", customerId: "5", customerLabel: "Walk-in", warehouseId: "", warehouseLabel: "", cashAccountId: "", cashAccountLabel: "", paymentMethod: null, referenceNumber: "", notes: "" };
    expect(isPosSessionDetailsComplete(snapshot, value)).toBe(true);
    expect(isPosSessionDetailsComplete(snapshot, { ...value, description: "" })).toBe(false);
    expect(isPosSessionDetailsComplete(snapshot, { ...value, exchangeRate: "0" })).toBe(false);
    const referenceRequired = { ...snapshot, fields: { ...snapshot.fields, paymentMethodId: { ...snapshot.fields.paymentMethodId, reference: { ...snapshot.fields.paymentMethodId.reference, requiresReference: true } } } };
    expect(isPosSessionDetailsComplete(referenceRequired, value)).toBe(false);
    expect(isPosSessionDetailsComplete(referenceRequired, { ...value, referenceNumber: "POS-1" })).toBe(true);
  });
});
