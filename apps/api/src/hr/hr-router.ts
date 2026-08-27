import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { HrError, type HrService } from "./hr-service.js";

const publicId = z.string().uuid();
const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");
const idempotencyKey = (request: Request) => z.string().min(16).max(100).parse(request.header("Idempotency-Key"));
const structureQuery = z.object({
  active: booleanQuery.optional(),
  search: z.string().trim().min(1).max(160).optional(),
});
const employeeQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(160).optional(),
  status: z.enum(["ACTIVE", "ON_LEAVE", "TERMINATED"]).optional(),
  departmentId: publicId.optional(),
});
const optionQuery = z.object({ search: z.string().trim().min(1).max(160).optional() });

function sid(request: Request) {
  return Object.fromEntries((request.headers.cookie ?? "").split(";").map((part) => part.trim().split("=", 2)).filter(([key, value]) => key && value)).sid;
}

export function createHrRouter(auth: AuthService, hr: HrService) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf: boolean) => auth.authorize({
    sid: sid(request),
    csrfToken: request.header("X-CSRF-Token") ?? undefined,
    permission,
    requireCsrf,
  });

  router.get("/hr/departments", async (request, response) => {
    const context = await authorize(request, "hr.structure.view", false);
    response.json(await hr.listDepartments(context, structureQuery.parse(request.query)));
  });
  router.post("/hr/departments", async (request, response) => {
    const context = await authorize(request, "hr.structure.manage", true);
    response.status(201).json(await hr.createDepartment(context, { ...bodies.createHrDepartment.parse(request.body), idempotencyKey: idempotencyKey(request) }));
  });
  router.patch("/hr/departments/:departmentId", async (request, response) => {
    const context = await authorize(request, "hr.structure.manage", true);
    response.json(await hr.updateDepartment(context, publicId.parse(request.params.departmentId), bodies.updateHrDepartment.parse(request.body)));
  });
  router.get("/hr/positions", async (request, response) => {
    const context = await authorize(request, "hr.structure.view", false);
    response.json(await hr.listPositions(context, structureQuery.parse(request.query)));
  });
  router.post("/hr/positions", async (request, response) => {
    const context = await authorize(request, "hr.structure.manage", true);
    response.status(201).json(await hr.createPosition(context, { ...bodies.createHrPosition.parse(request.body), idempotencyKey: idempotencyKey(request) }));
  });
  router.patch("/hr/positions/:positionId", async (request, response) => {
    const context = await authorize(request, "hr.structure.manage", true);
    response.json(await hr.updatePosition(context, publicId.parse(request.params.positionId), bodies.updateHrPosition.parse(request.body)));
  });
  router.get("/hr/user-options", async (request, response) => {
    const context = await authorize(request, "hr.employees.view", false);
    response.json(await hr.listUserOptions(context, optionQuery.parse(request.query).search));
  });
  router.get("/hr/employees", async (request, response) => {
    const context = await authorize(request, "hr.employees.view", false);
    response.json(await hr.listEmployees(context, employeeQuery.parse(request.query)));
  });
  router.post("/hr/employees", async (request, response) => {
    const context = await authorize(request, "hr.employees.manage", true);
    const body = bodies.createEmployee.parse(request.body);
    response.status(201).json(await hr.createEmployee(context, {
      ...body,
      idempotencyKey: idempotencyKey(request),
    }));
  });
  router.get("/hr/employees/:employeeId", async (request, response) => {
    const context = await authorize(request, "hr.employees.view", false);
    response.json(await hr.getEmployee(context, publicId.parse(request.params.employeeId)));
  });
  router.patch("/hr/employees/:employeeId", async (request, response) => {
    const context = await authorize(request, "hr.employees.manage", true);
    const body = bodies.updateEmployee.parse(request.body);
    response.json(await hr.updateEmployee(context, publicId.parse(request.params.employeeId), {
      ...body,
    }));
  });
  router.post("/hr/employees/:employeeId/transition", async (request, response) => {
    const context = await authorize(request, "hr.employees.manage", true);
    response.json(await hr.transitionEmployee(context, publicId.parse(request.params.employeeId), {
      ...bodies.transitionEmployee.parse(request.body),
      idempotencyKey: idempotencyKey(request),
    }));
  });
  router.get("/hr/employees/:employeeId/contracts", async (request, response) => {
    const context = await authorize(request, "hr.contracts.view", false);
    response.json(await hr.listContracts(context, publicId.parse(request.params.employeeId)));
  });
  router.post("/hr/employees/:employeeId/contracts", async (request, response) => {
    const context = await authorize(request, "hr.contracts.manage", true);
    response.status(201).json(await hr.createContract(context, publicId.parse(request.params.employeeId), {
      ...bodies.createEmploymentContract.parse(request.body),
      idempotencyKey: idempotencyKey(request),
    }));
  });
  router.post("/hr/employees/:employeeId/contracts/:contractId/end", async (request, response) => {
    const context = await authorize(request, "hr.contracts.manage", true);
    response.json(await hr.endContract(
      context,
      publicId.parse(request.params.employeeId),
      publicId.parse(request.params.contractId),
      { ...bodies.endEmploymentContract.parse(request.body), idempotencyKey: idempotencyKey(request) },
    ));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof HrError) {
      const status = ["NOT_FOUND", "REFERENCE_NOT_FOUND", "USER_NOT_FOUND", "MANAGER_NOT_FOUND"].includes(error.reason)
        ? 404
        : ["VERSION_CONFLICT", "USER_ALREADY_LINKED", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS"].includes(error.reason)
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
