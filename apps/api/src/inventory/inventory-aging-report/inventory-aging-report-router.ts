import { Router, type Request } from "express";
import { z } from "zod";
import type { AuthService } from "../../auth/auth-service.js";
import type { InventoryAgingReportService } from "./inventory-aging-report-service.js";
import { inventoryAgingReportXlsx } from "./inventory-aging-report-xlsx.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const querySchema = z.object({
  asOf: isoDate,
  slowMovingDays: z.coerce.number().int().min(1).max(3650).default(90),
  stagnantDays: z.coerce.number().int().min(2).max(7300).default(180),
});

function sid(request: Request) {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((value) => value.trim().split("=", 2))
      .filter(([key, value]) => key && value),
  ).sid;
}

export function createInventoryAgingReportRouter(
  auth: AuthService,
  service: InventoryAgingReportService,
) {
  const router = Router();
  const generate = async (request: Request) => {
    const context = await auth.authorize({
      sid: sid(request),
      permission: "inventory_movements.view",
      requireCsrf: false,
    });
    const query = querySchema.parse(request.query);
    return service.generate(context, {
      ...query,
      asOf: new Date(`${query.asOf}T23:59:59.999Z`),
    });
  };

  router.get("/inventory-aging-report", async (request, response) => {
    response.json(await generate(request));
  });

  router.get("/inventory-aging-report.xlsx", async (request, response) => {
    const report = await generate(request);
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", "attachment; filename=inventory-aging-report.xlsx");
    response.send(inventoryAgingReportXlsx(report));
  });

  return router;
}
