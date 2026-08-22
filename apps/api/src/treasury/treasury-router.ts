import { Prisma } from "@prisma/client";
import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { TreasuryError, TreasuryService } from "./treasury-service.js";

const id = z.string().regex(/^[1-9][0-9]*$/u).transform(BigInt);
const page = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).optional(),
});

function sid(request: Request) {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((value) => value.trim().split("=", 2))
      .filter(([key, value]) => key && value),
  ).sid;
}

export function createTreasuryRouter(auth: AuthService, service: TreasuryService) {
  const router = Router();
  const authorize = (request: Request, permission: string, csrf: boolean) =>
    auth.authorize({
      sid: sid(request),
      csrfToken: request.header("X-CSRF-Token") ?? undefined,
      permission,
      requireCsrf: csrf,
    });

  router.get("/cash-bank-accounts", async (request, response) => {
    const context = await authorize(request, "cash_bank_accounts.view", false);
    const query = page.extend({
      type: z.enum(["CASH", "BANK"]).optional(),
      active: z.enum(["true", "false"])
        .transform((value) => value === "true")
        .optional(),
    }).parse(request.query);
    const result = await service.listCashBankAccounts(context, query);
    response.json({
      data: result.data.map(TreasuryService.cashBankJson),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / query.pageSize),
      },
    });
  });

  router.post("/cash-bank-accounts", async (request, response) => {
    const context = await authorize(request, "cash_bank_accounts.manage", true);
    response.status(201).json(TreasuryService.cashBankJson(
      await service.createCashBankAccount(context, bodies.createCashBankAccount.parse(request.body)),
    ));
  });

  router.get("/cash-bank-accounts/:cashBankAccountId", async (request, response) => {
    const context = await authorize(request, "cash_bank_accounts.view", false);
    response.json(TreasuryService.cashBankJson(
      await service.getCashBankAccount(context, id.parse(request.params.cashBankAccountId)),
    ));
  });

  router.patch("/cash-bank-accounts/:cashBankAccountId", async (request, response) => {
    const context = await authorize(request, "cash_bank_accounts.manage", true);
    response.json(TreasuryService.cashBankJson(
      await service.updateCashBankAccount(
        context,
        id.parse(request.params.cashBankAccountId),
        bodies.updateCashBankAccount.parse(request.body),
      ),
    ));
  });

  router.post("/cash-bank-accounts/:cashBankAccountId/deactivate", async (request, response) => {
    const context = await authorize(request, "cash_bank_accounts.manage", true);
    response.json(TreasuryService.cashBankJson(
      await service.deactivateCashBankAccount(
        context,
        id.parse(request.params.cashBankAccountId),
        bodies.deactivateCashBankAccount.parse(request.body),
      ),
    ));
  });

  router.get("/payment-methods", async (request, response) => {
    const context = await authorize(request, "cash_bank_accounts.view", false);
    const query = z.object({
      includeInactive: z.enum(["true", "false"])
        .transform((value) => value === "true")
        .optional(),
    }).parse(request.query);
    response.json({
      data: (await service.listPaymentMethods(context, query.includeInactive))
        .map(TreasuryService.paymentMethodJson),
    });
  });

  router.post("/payment-methods", async (request, response) => {
    const context = await authorize(request, "cash_bank_accounts.manage", true);
    response.status(201).json(TreasuryService.paymentMethodJson(
      await service.createPaymentMethod(context, bodies.createPaymentMethod.parse(request.body)),
    ));
  });

  router.patch("/payment-methods/:paymentMethodId", async (request, response) => {
    const context = await authorize(request, "cash_bank_accounts.manage", true);
    response.json(TreasuryService.paymentMethodJson(
      await service.updatePaymentMethod(
        context,
        id.parse(request.params.paymentMethodId),
        bodies.updatePaymentMethod.parse(request.body),
      ),
    ));
  });

  router.post("/payment-methods/:paymentMethodId/deactivate", async (request, response) => {
    const context = await authorize(request, "cash_bank_accounts.manage", true);
    response.json(TreasuryService.paymentMethodJson(
      await service.deactivatePaymentMethod(
        context,
        id.parse(request.params.paymentMethodId),
        bodies.deactivatePaymentMethod.parse(request.body),
      ),
    ));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({
        status: 400,
        code: "VALIDATION_ERROR",
        errors: error.issues,
      });
      return;
    }
    if (error instanceof TreasuryError) {
      const status = error.reason === "NOT_FOUND"
        ? 404
        : ["CODE_EXISTS", "VERSION_CONFLICT"].includes(error.reason)
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
