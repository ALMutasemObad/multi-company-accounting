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
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:3140");
  const path = url.pathname.replace("/api/v1", "");
  res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store");
  let body = ""; for await (const chunk of req) body += chunk;
  const send = (data, status = 200) => { res.writeHead(status); res.end(JSON.stringify(data)); };
  if (path === "/health") return send({ localFixture: true });
  if (path === "/pos/sales") return send(list([], 1, 10));
  if (path === "/sales/catalog") {
    const search = (url.searchParams.get("search") ?? "").toLowerCase();
    return send(list(rows.filter((row) => `${row.code} ${row.nameAr} ${row.nameEn}`.toLowerCase().includes(search))));
  }
  if (path.startsWith("/sales/catalog/items/")) { const row = rows.find((item) => item.inventoryItemId === path.split("/").at(-1)); return row ? send({ data: row }) : send({ code: "NOT_FOUND" }, 404); }
  if (path === "/inventory-barcodes/resolve") {
    const value = JSON.parse(body).value;
    const row = rows[value === "0002" ? 1 : 0];
    if (!["0001", "0002"].includes(value)) return send({ code: "BARCODE_NOT_FOUND" }, 404);
    return send({ barcode: { id: row.inventoryItemId, symbology: "CODE_128", isPrimary: true }, inventoryItem: { id: row.inventoryItemId, ...row } });
  }
  if (path === "/fiscal-periods") return send(list([{ id: "1", name: "Test open period", status: "OPEN" }], 1, 100));
  if (path === "/currencies") return send({ data: [{ id: "1", code: "SAR", nameAr: "ريال", isBase: true }, { id: "2", code: "USD", nameAr: "دولار", isBase: false }] });
  if (path === "/customers") return send(list([{ id: "1", code: "CUS-TEST", nameAr: "عميل تجريبي", nameEn: "Test customer" }]));
  if (path === "/warehouses") return send(list([{ id: "1", code: "WH-TEST", nameAr: "مستودع تجريبي", nameEn: "Test warehouse" }]));
  if (path === "/cash-bank-accounts") return send(list([{ id: "1", code: "CB-TEST", nameAr: "صندوق تجريبي", nameEn: "Test cash" }]));
  if (path === "/payment-methods") return send(list([{ id: "1", code: "CASH", nameAr: "نقد تجريبي", requiresReference: false }]));
  if (path === "/accounts") return send(list([{ id: "41", code: "4100", nameAr: "إيراد تجريبي", nameEn: "Test revenue" }]));
  if (path === "/tax-rates") return send(list([]));
  if (path === "/pos/checkouts") return send({ id: "1", completedAt: "2026-08-31T08:00:00.000Z", invoice: { id: "101", documentNumber: "SI-TEST-101", status: "POSTED", customerName: "Test customer", total: "2.1000", baseTotal: "2.1000", generatedJournalEntryIds: ["1"] }, receipt: { id: "102", documentNumber: "REC-TEST-102", status: "POSTED", generatedJournalEntryIds: ["2"] } }, 201);
  return send({ code: "NOT_FOUND" }, 404);
});
server.listen(3140, "127.0.0.1", () => process.stdout.write("R1 local-only fixture API on 3140\n"));
