import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import {
  ReceiptReferenceService,
  ReferenceError,
} from "./reference-service.js";
const id = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(BigInt);
const page = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).optional(),
});
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
          await service.createCustomer(context, bodies.createCustomer.parse(req.body)),
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
          bodies.updateCustomer.parse(req.body),
        ),
      ),
    );
  });
  router.post("/customers/:customerId/deactivate", async (req, res) => {
    const context = await authorize(req, "customers.manage", true);
    const body = bodies.deactivateCustomer.parse(req.body);
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
            bodies.createCustomerAddress.parse(req.body),
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
            bodies.updateCustomerAddress.parse(req.body),
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
  router.get("/currencies", async (req, res) => {
    const context = await authorize(req, "currencies.view", false);
    const data = (await service.listCurrencies(context))
      .map(ReceiptReferenceService.currencyJson)
      .sort((left, right) => Number(right.isBase) - Number(left.isBase) || left.code.localeCompare(right.code));
    res.json({ data });
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
