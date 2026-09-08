import { beforeAll, describe, expect, it } from "vitest";
import { createTranslator, loadLocale } from "./i18n";
import { auditFilterLabel, readableAuditCode } from "./audit-filter-labels";

beforeAll(async () => {
  await Promise.all(["ar", "en", "ur", "hi"].map((locale) => loadLocale(locale as "ar" | "en" | "ur" | "hi")));
});

describe("audit filter labels", () => {
  it("uses existing translations for known codes in every locale", () => {
    const expected = {
      ar: ["إنشاء عميل", "عميل"],
      en: ["Customer created", "Customer"],
      ur: ["کسٹمر نے تخلیق کیا", "گاہک"],
      hi: ["ग्राहक बनाया गया", "ख़रीदार"],
    } as const;
    for (const locale of ["ar", "en", "ur", "hi"] as const) {
      const translate = createTranslator(locale);
      expect(auditFilterLabel("action", "CUSTOMER_CREATED", translate)).toBe(expected[locale][0]);
      expect(auditFilterLabel("entity", "CUSTOMER", translate)).toBe(expected[locale][1]);
    }
  });

  it("turns unknown future codes into non-empty readable fallbacks", () => {
    const prefixes = {
      ar: ["إجراء غير معروف", "كيان غير معروف"],
      en: ["Unknown action", "Unknown entity"],
      ur: ["نامعلوم کارروائی", "نامعلوم ہستی"],
      hi: ["अज्ञात कार्रवाई", "अज्ञात इकाई"],
    } as const;
    for (const locale of ["ar", "en", "ur", "hi"] as const) {
      const translate = createTranslator(locale);
      expect(auditFilterLabel("action", "POS_SALE_COMPLETED", translate)).toBe(`${prefixes[locale][0]} — POS sale completed`);
      expect(auditFilterLabel("entity", "FINANCIAL_CLOSE_RUN", translate)).toBe(`${prefixes[locale][1]} — Financial close run`);
      expect(auditFilterLabel("action", "", translate)).toBe(prefixes[locale][0]);
      expect(auditFilterLabel("entity", "___", translate)).toBe(prefixes[locale][1]);
    }
  });

  it("preserves common acronyms while removing internal separators", () => {
    expect(readableAuditCode("DOCUMENT_PDF_PRINTED")).toBe("Document PDF printed");
    expect(readableAuditCode("receipt-realized.fx-recorded")).toBe("Receipt realized FX recorded");
  });
});
