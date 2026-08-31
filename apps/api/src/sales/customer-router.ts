import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { CustomerError } from "./customer-ports.js";
import { CustomerService } from "./customer-service.js";
import { readWithPosContext } from "../platform/pos-request-context.js";

const id = z.string().regex(/^[1-9][0-9]*$/).transform(BigInt);
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

export function createCustomerRouter(auth: AuthService, customers: CustomerService) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf: boolean) => auth.authorize({
    sid: sid(request),
    csrfToken: request.header("X-CSRF-Token") ?? undefined,
    permission,
    requireCsrf,
  });

  router.get("/customers", async (request, response) => {
    response.json(await readWithPosContext(request, () => authorize(request, "customers.view", false), async context => {
    const query = page.extend({
      active: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
    }).parse(request.query);
    const result = await customers.listCustomers(context, query);
    return {
      data: result.data.map(CustomerService.customerJson),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / query.pageSize),
      },
    };
    }));
  });

  router.post("/customers", async (request, response) => {
    const context = await authorize(request, "customers.manage", true);
    response.status(201).json(CustomerService.customerJson(
      await customers.createCustomer(context, bodies.createCustomer.parse(request.body)),
    ));
  });

  router.get("/customers/:customerId", async (request, response) => {
    const context = await authorize(request, "customers.view", false);
    response.json(CustomerService.customerJson(
      await customers.getCustomer(context, id.parse(request.params.customerId)),
    ));
  });

  router.patch("/customers/:customerId", async (request, response) => {
    const context = await authorize(request, "customers.manage", true);
    response.json(CustomerService.customerJson(await customers.updateCustomer(
      context,
      id.parse(request.params.customerId),
      bodies.updateCustomer.parse(request.body),
    )));
  });

  router.post("/customers/:customerId/deactivate", async (request, response) => {
    const context = await authorize(request, "customers.manage", true);
    const body = bodies.deactivateCustomer.parse(request.body);
    response.json(CustomerService.customerJson(await customers.deactivateCustomer(
      context,
      id.parse(request.params.customerId),
      body.reason,
    )));
  });

  router.post("/customers/:customerId/addresses", async (request, response) => {
    const context = await authorize(request, "customers.manage", true);
    response.status(201).json(CustomerService.addressJson(await customers.createAddress(
      context,
      id.parse(request.params.customerId),
      bodies.createCustomerAddress.parse(request.body),
    )));
  });

  router.patch("/customers/:customerId/addresses/:addressId", async (request, response) => {
    const context = await authorize(request, "customers.manage", true);
    response.json(CustomerService.addressJson(await customers.updateAddress(
      context,
      id.parse(request.params.customerId),
      id.parse(request.params.addressId),
      bodies.updateCustomerAddress.parse(request.body),
    )));
  });

  router.delete("/customers/:customerId/addresses/:addressId", async (request, response) => {
    const context = await authorize(request, "customers.manage", true);
    await customers.deleteAddress(
      context,
      id.parse(request.params.customerId),
      id.parse(request.params.addressId),
    );
    response.status(204).end();
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof CustomerError) {
      const status = error.reason === "NOT_FOUND" ? 404 : error.reason === "CODE_EXISTS" ? 409 : 422;
      response.status(status).json({
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
