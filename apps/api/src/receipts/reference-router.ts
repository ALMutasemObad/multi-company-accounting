import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import {
  ReceiptReferenceService,
  ReferenceError,
} from "./reference-service.js";
const id = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(BigInt);
const nullable = <T extends z.ZodTypeAny>(v: T) => z.union([v, z.null()]);
const page = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).optional(),
});
const address = z
  .object({
    addressType: z.enum(["LEGAL", "BILLING", "OTHER"]),
    line1: z.string().trim().min(1).max(200),
    line2: nullable(z.string().max(200)).optional(),
    city: nullable(z.string().max(100)).optional(),
    region: nullable(z.string().max(100)).optional(),
    postalCode: nullable(z.string().max(20)).optional(),
    countryCode: nullable(z.string().regex(/^[A-Z]{2}$/)).optional(),
    isPrimary: z.boolean().default(false),
  })
  .strict();
const addressUpdate = address
  .partial()
  .refine((v) => Object.keys(v).length > 0);
const customer = z
  .object({
    receivableAccountId: id,
    code: z.string().trim().min(1).max(40),
    nameAr: z.string().trim().min(1).max(200),
    nameEn: nullable(z.string().max(200)).optional(),
    phone: nullable(z.string().max(40)).optional(),
    email: nullable(z.string().email().max(320)).optional(),
    taxNumber: nullable(z.string().max(64)).optional(),
    addresses: z.array(address).optional(),
  })
  .strict();
const customerUpdate = customer
  .omit({ addresses: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0);
const reason = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const cash = z
  .object({
    ledgerAccountId: id,
    accountType: z.enum(["CASH", "BANK"]),
    code: z.string().trim().min(1).max(40),
    nameAr: z.string().trim().min(1).max(160),
    nameEn: nullable(z.string().max(160)).optional(),
    bankName: nullable(z.string().max(160)).optional(),
    accountNumber: nullable(z.string().max(100)).optional(),
    iban: nullable(z.string().max(100)).optional(),
  })
  .strict();
const cashUpdate = cash.partial().refine((v) => Object.keys(v).length > 0);
const paymentMethod = z.object({ code: z.string().trim().min(1).max(40), nameAr: z.string().trim().min(1).max(120), requiresReference: z.boolean().default(false) }).strict();
const paymentMethodUpdate = paymentMethod.partial().refine((v) => Object.keys(v).length > 0);
function sid(req: Request) {
  return Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((v) => v.trim().split("=", 2))
      .filter(([k, v]) => k && v),
  ).sid;
}
export function createReceiptReferenceRouter(
  auth: AuthService,
  service: ReceiptReferenceService,
) {
  const router = Router();
  const authorize = (req: Request, permission: string, csrf: boolean) =>
    auth.authorize({
      sid: sid(req),
      csrfToken: req.header("X-CSRF-Token") ?? undefined,
      permission,
      requireCsrf: csrf,
    });
  router.get("/customers", async (req, res) => {
    const context = await authorize(req, "customers.view", false);
    const q = page
      .extend({
        active: z
          .enum(["true", "false"])
          .transform((v) => v === "true")
          .optional(),
      })
      .parse(req.query);
    const result = await service.listCustomers(context, q);
    res.json({
      data: result.data.map(ReceiptReferenceService.customerJson),
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / q.pageSize),
      },
    });
  });
  router.post("/customers", async (req, res) => {
    const context = await authorize(req, "customers.manage", true);
    res
      .status(201)
      .json(
        ReceiptReferenceService.customerJson(
          await service.createCustomer(context, customer.parse(req.body)),
        ),
      );
  });
  router.get("/customers/:customerId", async (req, res) => {
    const context = await authorize(req, "customers.view", false);
    res.json(
      ReceiptReferenceService.customerJson(
        await service.getCustomer(context, id.parse(req.params.customerId)),
      ),
    );
  });
  router.patch("/customers/:customerId", async (req, res) => {
    const context = await authorize(req, "customers.manage", true);
    res.json(
      ReceiptReferenceService.customerJson(
        await service.updateCustomer(
          context,
          id.parse(req.params.customerId),
          customerUpdate.parse(req.body),
        ),
      ),
    );
  });
  router.post("/customers/:customerId/deactivate", async (req, res) => {
    const context = await authorize(req, "customers.manage", true);
    const body = reason.parse(req.body);
    res.json(
      ReceiptReferenceService.customerJson(
        await service.deactivateCustomer(
          context,
          id.parse(req.params.customerId),
          body.reason,
        ),
      ),
    );
  });
  router.post("/customers/:customerId/addresses", async (req, res) => {
    const context = await authorize(req, "customers.manage", true);
    res
      .status(201)
      .json(
        ReceiptReferenceService.addressJson(
          await service.createAddress(
            context,
            id.parse(req.params.customerId),
            address.parse(req.body),
          ),
        ),
      );
  });
  router.patch(
    "/customers/:customerId/addresses/:addressId",
    async (req, res) => {
      const context = await authorize(req, "customers.manage", true);
      res.json(
        ReceiptReferenceService.addressJson(
          await service.updateAddress(
            context,
            id.parse(req.params.customerId),
            id.parse(req.params.addressId),
            addressUpdate.parse(req.body),
          ),
        ),
      );
    },
  );
  router.delete(
    "/customers/:customerId/addresses/:addressId",
    async (req, res) => {
      const context = await authorize(req, "customers.manage", true);
      await service.deleteAddress(
        context,
        id.parse(req.params.customerId),
        id.parse(req.params.addressId),
      );
      res.status(204).end();
    },
  );
  router.get("/cash-bank-accounts", async (req, res) => {
    const context = await authorize(req, "cash_bank_accounts.view", false);
    const q = page
      .extend({ type: z.enum(["CASH", "BANK"]).optional(), active: z.enum(["true", "false"]).transform((value) => value === "true").optional() })
      .parse(req.query);
    const result = await service.listCashBankAccounts(context, q);
    res.json({
      data: result.data.map(ReceiptReferenceService.cashBankJson),
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / q.pageSize),
      },
    });
  });
  router.post("/cash-bank-accounts", async (req, res) => {
    const context = await authorize(req, "cash_bank_accounts.manage", true);
    res
      .status(201)
      .json(
        ReceiptReferenceService.cashBankJson(
          await service.createCashBankAccount(context, cash.parse(req.body)),
        ),
      );
  });
  router.get("/cash-bank-accounts/:cashBankAccountId", async (req, res) => {
    const context = await authorize(req, "cash_bank_accounts.view", false);
    res.json(
      ReceiptReferenceService.cashBankJson(
        await service.getCashBankAccount(
          context,
          id.parse(req.params.cashBankAccountId),
        ),
      ),
    );
  });
  router.patch("/cash-bank-accounts/:cashBankAccountId", async (req, res) => {
    const context = await authorize(req, "cash_bank_accounts.manage", true);
    res.json(
      ReceiptReferenceService.cashBankJson(
        await service.updateCashBankAccount(
          context,
          id.parse(req.params.cashBankAccountId),
          cashUpdate.parse(req.body),
        ),
      ),
    );
  });
  router.post(
    "/cash-bank-accounts/:cashBankAccountId/deactivate",
    async (req, res) => {
      const context = await authorize(req, "cash_bank_accounts.manage", true);
      const body = reason.parse(req.body);
      res.json(
        ReceiptReferenceService.cashBankJson(
          await service.deactivateCashBankAccount(
            context,
            id.parse(req.params.cashBankAccountId),
            body.reason,
          ),
        ),
      );
    },
  );
  router.get("/payment-methods", async (req, res) => {
    const context = await authorize(req, "cash_bank_accounts.view", false);
    const query = z.object({ includeInactive: z.enum(["true", "false"]).transform((value) => value === "true").optional() }).parse(req.query);
    res.json({
      data: (await service.listPaymentMethods(context, query.includeInactive)).map(
        ReceiptReferenceService.paymentMethodJson,
      ),
    });
  });
  router.post("/payment-methods", async (req, res) => {
    const context = await authorize(req, "cash_bank_accounts.manage", true);
    res.status(201).json(ReceiptReferenceService.paymentMethodJson(await service.createPaymentMethod(context, paymentMethod.parse(req.body))));
  });
  router.patch("/payment-methods/:paymentMethodId", async (req, res) => {
    const context = await authorize(req, "cash_bank_accounts.manage", true);
    res.json(ReceiptReferenceService.paymentMethodJson(await service.updatePaymentMethod(context, id.parse(req.params.paymentMethodId), paymentMethodUpdate.parse(req.body))));
  });
  router.post("/payment-methods/:paymentMethodId/deactivate", async (req, res) => {
    const context = await authorize(req, "cash_bank_accounts.manage", true);
    const body = reason.parse(req.body);
    res.json(ReceiptReferenceService.paymentMethodJson(await service.deactivatePaymentMethod(context, id.parse(req.params.paymentMethodId), body.reason)));
  });
  router.get("/currencies", async (req, res) => {
    await authorize(req, "cash_bank_accounts.view", false);
    res.json({
      data: (await service.listCurrencies()).map(
        ReceiptReferenceService.currencyJson,
      ),
    });
  });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof ZodError) {
      res
        .status(400)
        .json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof ReferenceError) {
      const status =
        error.reason === "NOT_FOUND"
          ? 404
          : error.reason === "CODE_EXISTS"
            ? 409
            : 422;
      res
        .status(status)
        .json({
          status,
          code: "BUSINESS_RULE_VIOLATION",
          reason: error.reason,
        });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
