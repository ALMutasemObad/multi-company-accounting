import { Prisma } from "@prisma/client";
import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { TaxError, TaxService, type TaxUsage } from "./tax-service.js";

const id = z.string().regex(/^[1-9][0-9]*$/).transform(BigInt);
const activeOnly = z.enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();
const listQuery = z.object({
  activeOnly,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(200).optional(),
});

function sid(request: Request) {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((value) => value.trim().split("=", 2))
      .filter(([key, value]) => key && value),
  ).sid;
}

export function createTaxRouter(auth: AuthService, service: TaxService) {
  const router = Router();
  const authorize = (request: Request, permission: string, csrf: boolean) =>
    auth.authorize({
      sid: sid(request),
      csrfToken: request.header("X-CSRF-Token") ?? undefined,
      permission,
      requireCsrf: csrf,
    });

  const registerRoutes = (options: {
    basePath: "/tax-rates" | "/purchase-tax-rates";
    usage: TaxUsage;
    viewPermission: string;
    managePermission: string;
  }) => {
    const createSchema = options.usage === "OUTPUT" ? bodies.createTaxRate : bodies.createPurchaseTaxRate;
    const updateSchema = options.usage === "OUTPUT" ? bodies.updateTaxRate : bodies.updatePurchaseTaxRate;
    const accountField = options.usage === "OUTPUT"
      ? "outputTaxAccountId"
      : "inputTaxAccountId";

    router.get(options.basePath, async (request, response) => {
      const context = await authorize(request, options.viewPermission, false);
      const query = listQuery.parse(request.query);
      const result = await service.list(context, options.usage, query);
      response.json({
        data: result.data
          .map((value) => TaxService.json(value, options.usage)),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
          totalPages: Math.ceil(result.total / query.pageSize),
        },
      });
    });

    router.post(options.basePath, async (request, response) => {
      const context = await authorize(request, options.managePermission, true);
      const input = createSchema.parse(request.body) as Record<string, unknown> & {
        nameAr: string;
        rate: string;
      };
      const value = await service.create(context, options.usage, {
        nameAr: input.nameAr,
        rate: input.rate,
        ...(input[accountField] === undefined
          ? {}
          : { accountId: input[accountField] as bigint | null }),
      });
      response.status(201).json(TaxService.json(value, options.usage));
    });

    router.patch(`${options.basePath}/:taxRateId`, async (request, response) => {
      const context = await authorize(request, options.managePermission, true);
      const input = updateSchema.parse(request.body) as Record<string, unknown> & {
        version: number;
        nameAr?: string;
        rate?: string;
        isActive?: boolean;
      };
      const value = await service.update(
        context,
        options.usage,
        id.parse(request.params.taxRateId),
        {
          version: input.version,
          ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr }),
          ...(input.rate === undefined ? {} : { rate: input.rate }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          ...(input[accountField] === undefined
            ? {}
            : { accountId: input[accountField] as bigint | null }),
        },
      );
      response.json(TaxService.json(value, options.usage));
    });
  };

  registerRoutes({
    basePath: "/tax-rates",
    usage: "OUTPUT",
    viewPermission: "sales_invoices.view",
    managePermission: "tax_rates.manage",
  });
  registerRoutes({
    basePath: "/purchase-tax-rates",
    usage: "INPUT",
    viewPermission: "purchase_invoices.view",
    managePermission: "input_tax_rates.manage",
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof TaxError) {
      const status = error.reason === "NOT_FOUND"
        ? 404
        : error.reason === "VERSION_CONFLICT"
          ? 409
          : 422;
      response.status(status).json({
        status,
        code: "BUSINESS_RULE_VIOLATION",
        reason: error.reason,
      });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      response.status(409).json({ status: 409, code: "CONFLICT", reason: "DUPLICATE_VALUE" });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
