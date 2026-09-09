import { createServer } from "node:http";
// Isolated local presentation fixtures. Never imported by the application or API.
const names = [["حليب تجريبي", "Test milk"], ["أرز تجريبي", "Test rice"], ["صنف بلا ملف", "Missing profile"], ["سعر صفري صريح", "Explicit zero"]];
const rows = names.map(([nameAr, nameEn], index) => ({
  inventoryItemId: String(index + 1), code: `ITM-TEST-${index + 1}`, nameAr, nameEn, description: null, isActive: true,
  unitOfMeasure: { id: "1", code: "EA", nameAr: "حبة", nameEn: "Each", decimalPlaces: 0, isActive: true },
  sellingProfile: index === 2 ? null : { id: String(index + 1), unitPrice: index === 3 ? "0.0000" : index === 0 ? "2.1000" : "9.7500", currencyId: "1", currencyCode: "SAR", revenueAccountId: "41", taxRateId: null, isActive: true, version: 1 },
  isReady: index !== 2, readinessReason: index === 2 ? "PROFILE_MISSING" : null,
}));
const list = (data, page = 1, pageSize = 24, total = data.length) => ({ data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
const contextRows = {
  warehouseId: { id: "1", label: "WH-TEST — Test warehouse", revision: "1", code: "WH-TEST", nameAr: "مستودع تجريبي", nameEn: "Test warehouse", isAvailable: true },
  cashBankAccountId: { id: "1", label: "CB-TEST — Test cash", revision: "1", code: "CB-TEST", nameAr: "صندوق تجريبي", nameEn: "Test cash", isAvailable: true },
  paymentMethodId: { id: "1", label: "CASH — Test cash payment", revision: "1", code: "CASH", nameAr: "نقد تجريبي", nameEn: "Test cash payment", requiresReference: false, isAvailable: true },
  currencyId: { id: "1", label: "SAR — Saudi riyal", revision: "1", code: "SAR", nameAr: "ريال سعودي", nameEn: "Saudi riyal", isBase: true, isAvailable: true },
};
const contextOptions = { ...Object.fromEntries(Object.entries(contextRows).map(([field, row]) => [field, [row]])),
  currencyId: [contextRows.currencyId, { id: "2", label: "USD — US dollar", revision: "1", code: "USD", nameAr: "دولار أمريكي", nameEn: "US dollar", isBase: false, isAvailable: true }],
};
const checkoutResult = { id: "1", completedAt: "2026-08-31T08:00:00.000Z", invoice: { id: "101", documentNumber: "SI-TEST-101", status: "POSTED", customerName: "Test customer", total: "2.1000", baseTotal: "2.1000", generatedJournalEntryIds: ["1"] }, receipt: { id: "102", documentNumber: "REC-TEST-102", status: "POSTED", generatedJournalEntryIds: ["2"] } };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:3140");
  const path = url.pathname.replace("/api/v1", "");
  res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store");
  let body = ""; for await (const chunk of req) body += chunk;
  const send = (data, status = 200) => { res.writeHead(status); res.end(JSON.stringify(data)); };
  const userId = req.headers["x-pos-expected-user-id"];
  const companyId = req.headers["x-pos-expected-company-id"];
  const validContext = typeof userId === "string" && typeof companyId === "string" && /^[1-9][0-9]*$/.test(userId) && /^[1-9][0-9]*$/.test(companyId);
  const scoped = data => ({ ...data, posContext: { userId, companyId } });
  if (path === "/health") return send({ localFixture: true });
  if (!validContext) return send({ code: "POS_CONTEXT_REQUIRED" }, 400);
  if (path === "/pos/context/identity") return send(scoped({}));
  if (path === "/pos/context/period") {
    const documentDate = url.searchParams.get("documentDate");
    return send(scoped({ documentDate, status: "RESOLVED", period: { id: "1", name: "Test open period", startDate: documentDate, endDate: documentDate, status: "OPEN", version: 1 } }));
  }
  if (path.startsWith("/pos/context/options/")) {
    const field = path.split("/").at(-1);
    const options = contextOptions[field] ?? [];
    return send(scoped(list(options, 1, 20)));
  }
  if (path.startsWith("/pos/context/references/")) {
    const [, , , , field, id] = path.split("/");
    const row = contextOptions[field]?.find(option => option.id === id);
    return row
      ? send(scoped({ status: "available", reference: Object.fromEntries(Object.entries(row).filter(([key]) => key !== "isAvailable")) }))
      : send(scoped({ status: "unavailable" }));
  }
  if (path === "/pos/sales") return send(scoped(list([], 1, 10)));
  if (path === "/sales/catalog") {
    const search = (url.searchParams.get("search") ?? "").toLowerCase();
    return send(scoped(list(rows.filter((row) => `${row.code} ${row.nameAr} ${row.nameEn}`.toLowerCase().includes(search)))));
  }
  if (path.startsWith("/sales/catalog/items/")) { const row = rows.find((item) => item.inventoryItemId === path.split("/").at(-1)); return row ? send(scoped({ data: row })) : send({ code: "NOT_FOUND" }, 404); }
  if (path === "/inventory-barcodes/resolve") {
    const value = JSON.parse(body).value;
    const row = rows[value === "0002" ? 1 : 0];
    if (!["0001", "0002"].includes(value)) return send({ code: "BARCODE_NOT_FOUND" }, 404);
    return send(scoped({ barcode: { id: row.inventoryItemId, symbology: "CODE_128", isPrimary: true }, inventoryItem: { id: row.inventoryItemId, ...row } }));
  }
  if (path === "/customers") return send(scoped(list([{ id: "1", code: "CUS-TEST", nameAr: "عميل تجريبي", nameEn: "Test customer" }])));
  if (path === "/accounts") return send(scoped(list([{ id: "41", code: "4100", nameAr: "إيراد تجريبي", nameEn: "Test revenue" }])));
  if (path === "/tax-rates") return send(scoped(list([])));
  if (path === "/pos/checkouts/recovery") return send(scoped({ outcome: "CONFIRMED", result: checkoutResult }));
  if (path === "/pos/checkouts") return send(scoped(checkoutResult), 201);
  return send({ code: "NOT_FOUND" }, 404);
});
server.listen(3140, "127.0.0.1", () => process.stdout.write("R1 local-only fixture API on 3140\n"));
