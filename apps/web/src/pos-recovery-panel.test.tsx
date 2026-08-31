import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PosRecoveryPanel } from "./PosRecoveryPanel";
import { posRecoveryDictionaries } from "./i18n/locales/pos-recovery";
import { recoveryResult } from "./pos-recovery-test-fixtures";

describe("POS recovery accessible presentation", () => {
  it.each(["ar", "en", "hi", "ur"] as const)("shows %s copy without offering replacement or write retry while unknown", locale => {
    const copy = posRecoveryDictionaries[locale];
    const html = renderToStaticMarkup(<PosRecoveryPanel locale={locale} state={{ status: "unknown", reason: "expired" }}
      canCheckout barcodePending={false} onCheck={vi.fn()} onNewSale={vi.fn()} />);
    expect(html).toContain(copy.title); expect(html).toContain(copy.check); expect(html).toContain(copy.expired);
    expect(html).not.toContain(copy.newSale); expect(html).toContain(locale === "ar" || locale === "ur" ? 'dir="rtl"' : 'dir="ltr"');
    expect(html).toContain('role="alert"'); expect(html).not.toContain("attemptKey");
  });
  it("hides a confirmed result on permission loss and blocks new sale while barcode/profile requests remain", () => {
    const props = { locale: "en" as const, state: { status: "confirmed" as const, result: recoveryResult }, barcodePending: true, onCheck: vi.fn(), onNewSale: vi.fn() };
    const hidden = renderToStaticMarkup(<PosRecoveryPanel {...props} canCheckout={false} />);
    expect(hidden).not.toContain("SI-0008"); expect(hidden).not.toContain("9007199"); expect(hidden).not.toContain("<button");
    const visible = renderToStaticMarkup(<PosRecoveryPanel {...props} canCheckout />);
    expect(visible).toContain('disabled=""'); expect(visible).toContain("900719925474099.1234");
    expect(visible).toContain("<bdi>8</bdi>"); expect(visible).not.toContain("SAR");
    expect(visible).toContain(posRecoveryDictionaries.en.historical);
  });
  it("keeps all four dictionaries complete", () => {
    for (const copy of Object.values(posRecoveryDictionaries)) {
      expect(Object.keys(copy).sort()).toEqual(Object.keys(posRecoveryDictionaries.ar).sort());
      expect(Object.values(copy).every(value => value.trim().length > 0)).toBe(true);
    }
  });
  it.each(["ar", "en", "hi", "ur"] as const)("offers an explicit cart review only after a proved rejection in %s", locale => {
    const copy = posRecoveryDictionaries[locale];
    const html = renderToStaticMarkup(<PosRecoveryPanel locale={locale}
      state={{ status: "rejected", rejection: { code: "POS_CHECKOUT_REJECTED", reason: "INSUFFICIENT_STOCK" } }}
      canCheckout barcodePending onCheck={vi.fn()} onNewSale={vi.fn()} onReviewRejected={vi.fn()} />);
    expect(html).toContain(copy.rejected); expect(html).toContain(copy.review); expect(html).toContain(copy.reviewHelp);
    expect(html).toContain('disabled=""'); expect(html).not.toContain(copy.newSale); expect(html).not.toContain(copy.check);
  });
});
