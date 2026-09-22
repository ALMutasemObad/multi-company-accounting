import { Prisma } from "@prisma/client";
import type { TabularRows } from "../../document-output-kernel/model.js";
import { tableToXlsx } from "../../document-output-kernel/tabular-profile.js";

export type ExternalStockReportPosition = {
  positionType: "THIRD_PARTY_HELD_BY_US" | "OWNED_HELD_BY_THIRD_PARTY" | "OWNED_IN_TRANSIT";
  quantity: string;
  inventoryValueBase: string | null;
  externalLocation: string | null;
  transitOrigin: string | null;
  transitDestination: string | null;
  item: { code: string; nameAr: string; unitCode: string };
  party: { code: string; nameAr: string };
  warehouse: { code: string; nameAr: string } | null;
  lastEvent: { effectiveDate: string; sourceReference: string } | null;
};

const typeLabels = {
  THIRD_PARTY_HELD_BY_US: "أمانات للغير في مستودعاتنا",
  OWNED_HELD_BY_THIRD_PARTY: "مخزوننا لدى الغير",
  OWNED_IN_TRANSIT: "بضاعة بالطريق",
} as const;

const locationLabel = (position: ExternalStockReportPosition) => position.warehouse
  ? `${position.warehouse.code} - ${position.warehouse.nameAr}`
  : position.externalLocation ?? [position.transitOrigin, position.transitDestination].filter(Boolean).join(" ← ");

export function externalStockPositionsXlsx(
  positions: ExternalStockReportPosition[],
  generatedAt = new Date().toISOString(),
) {
  const ownedTotal = positions.reduce((sum, position) => position.positionType === "THIRD_PARTY_HELD_BY_US" || position.inventoryValueBase === null
    ? sum
    : sum.plus(position.inventoryValueBase), new Prisma.Decimal(0));
  const rows: TabularRows = [
    [{ value: "كشف الأمانات والمخزون لدى الغير والبضاعة بالطريق", style: 1 }],
    [{ value: "وقت التوليد", style: 3 }, { value: generatedAt }],
    [{ value: "ملاحظة التقييم", style: 3 }, { value: "أمانات الغير معروضة كميًا دون تحميلها على قيمة مخزون المنشأة" }],
    ["النوع", "الردمك / الباركود", "الصنف", "الوحدة", "الطرف", "الموقع / المسار", "الكمية", "تكلفة الوحدة", "التكلفة الإجمالية", "مرجع المستند", "تاريخ المستند"].map((value) => ({ value, style: 2 })),
    ...positions.map((position) => {
      const quantity = new Prisma.Decimal(position.quantity);
      const unitCost = position.inventoryValueBase === null || quantity.isZero()
        ? null
        : new Prisma.Decimal(position.inventoryValueBase).div(quantity).toDecimalPlaces(8);
      return [
        { value: typeLabels[position.positionType] },
        { value: position.item.code },
        { value: position.item.nameAr },
        { value: position.item.unitCode },
        { value: `${position.party.code} - ${position.party.nameAr}` },
        { value: locationLabel(position) },
        { value: position.quantity, numeric: true },
        { value: unitCost?.toFixed(8) ?? "", numeric: unitCost !== null },
        { value: position.inventoryValueBase ?? "", numeric: position.inventoryValueBase !== null },
        { value: position.lastEvent?.sourceReference ?? "" },
        { value: position.lastEvent?.effectiveDate ?? "" },
      ];
    }),
    [{ value: "إجمالي قيمة مخزون المنشأة", style: 3 }, { value: ownedTotal.toFixed(4), numeric: true, style: 5 }],
  ];
  return tableToXlsx(rows, "المخزون الخارجي");
}
