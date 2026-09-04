import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import {
  EmployeeExpenseError,
  type EmployeeExpenseService,
} from "./employee-expense-service.js";

const publicId = z.string().uuid();
const idempotencyKey = (request: Request) => z.string().min(16).max(100).parse(request.header("Idempotency-Key"));
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  scope: z.enum(["mine", "company"]).default("mine"),
  status: z.enum(["DRAFT", "AWAITING_APPROVAL", "READY_FOR_PAYMENT"]).optional(),
});

function sid(request: Request) {
  return Object.fromEntries((request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim().split("=", 2))
    .filter(([key, value]) => key && value)).sid;
}

export function createEmployeeExpenseRouter(auth: AuthService, expenses: EmployeeExpenseService) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf: boolean) => auth.authorize({
    sid: sid(request),
    csrfToken: request.header("X-CSRF-Token") ?? undefined,
    permission,
    requireCsrf,
  });

  router.get("/employee-expense-claims", async (request, response) => {
    const query = querySchema.parse(request.query);
    const context = await authorize(
      request,
      query.scope === "company" ? "employee_expenses.review" : "employee_expenses.view",
      false,
    );
    response.json(await expenses.list(context, query));
  });
  router.get("/employee-expense-cost-centers", async (request, response) => {
    const context = await authorize(request, "employee_expenses.view", false);
    response.json(await expenses.listCostCenters(context));
  });
  router.post("/employee-expense-claims", async (request, response) => {
    const context = await authorize(request, "employee_expenses.submit", true);
    response.status(201).json(await expenses.create(context, {
      ...bodies.createEmployeeExpenseClaim.parse(request.body),
      idempotencyKey: idempotencyKey(request),
    }));
  });
  router.patch("/employee-expense-claims/:claimId", async (request, response) => {
    const context = await authorize(request, "employee_expenses.submit", true);
    response.json(await expenses.update(
      context,
      publicId.parse(request.params.claimId),
      {
        ...bodies.updateEmployeeExpenseClaim.parse(request.body),
        idempotencyKey: idempotencyKey(request),
      },
    ));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof EmployeeExpenseError) {
      const status = ["NOT_FOUND", "NOT_OWNER", "COST_CENTER_NOT_FOUND"].includes(error.reason)
        ? 404
        : ["VERSION_CONFLICT", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS"].includes(error.reason)
          ? 409
          : 422;
      response.status(status).json({ status, code: "BUSINESS_RULE_VIOLATION", reason: error.reason });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
