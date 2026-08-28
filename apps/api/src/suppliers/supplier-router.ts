import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import {
  SupplierService,
  SupplierError,
} from "./supplier-service.js";
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
export function createSupplierRouter(
  auth: AuthService,
  service: SupplierService,
) {
  const router = Router();
  const authorize = (req: Request, permission: string, csrf: boolean) =>
    auth.authorize({
      sid: sid(req),
      csrfToken: req.header("X-CSRF-Token") ?? undefined,
      permission,
      requireCsrf: csrf,
    });
  router.get("/suppliers", async (req, res) => {
    const context = await authorize(req, "suppliers.view", false);
    const q = page
      .extend({
        active: z
          .enum(["true", "false"])
          .transform((v) => v === "true")
          .optional(),
      })
      .parse(req.query);
    const result = await service.listSuppliers(context, q);
    res.json({
      data: result.data.map(SupplierService.supplierJson),
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / q.pageSize),
      },
    });
  });
  router.post("/suppliers", async (req, res) => {
    const context = await authorize(req, "suppliers.manage", true);
    res
      .status(201)
      .json(
        SupplierService.supplierJson(
          await service.createSupplier(context, bodies.createSupplier.parse(req.body)),
        ),
      );
  });
  router.get("/suppliers/:supplierId", async (req, res) => {
    const context = await authorize(req, "suppliers.view", false);
    res.json(
      SupplierService.supplierJson(
        await service.getSupplier(context, id.parse(req.params.supplierId)),
      ),
    );
  });
  router.patch("/suppliers/:supplierId", async (req, res) => {
    const context = await authorize(req, "suppliers.manage", true);
    res.json(
      SupplierService.supplierJson(
        await service.updateSupplier(
          context,
          id.parse(req.params.supplierId),
          bodies.updateSupplier.parse(req.body),
        ),
      ),
    );
  });
  router.post("/suppliers/:supplierId/deactivate", async (req, res) => {
    const context = await authorize(req, "suppliers.manage", true);
    const body = bodies.deactivateSupplier.parse(req.body);
    res.json(
      SupplierService.supplierJson(
        await service.deactivateSupplier(
          context,
          id.parse(req.params.supplierId),
          body.reason,
        ),
      ),
    );
  });
  router.post("/suppliers/:supplierId/addresses", async (req, res) => {
    const context = await authorize(req, "suppliers.manage", true);
    res
      .status(201)
      .json(
        SupplierService.addressJson(
          await service.createAddress(
            context,
            id.parse(req.params.supplierId),
            bodies.createSupplierAddress.parse(req.body),
          ),
        ),
      );
  });
  router.patch(
    "/suppliers/:supplierId/addresses/:addressId",
    async (req, res) => {
      const context = await authorize(req, "suppliers.manage", true);
      res.json(
        SupplierService.addressJson(
          await service.updateAddress(
            context,
            id.parse(req.params.supplierId),
            id.parse(req.params.addressId),
            bodies.updateSupplierAddress.parse(req.body),
          ),
        ),
      );
    },
  );
  router.delete(
    "/suppliers/:supplierId/addresses/:addressId",
    async (req, res) => {
      const context = await authorize(req, "suppliers.manage", true);
      await service.deleteAddress(
        context,
        id.parse(req.params.supplierId),
        id.parse(req.params.addressId),
      );
      res.status(204).send();
    },
  );
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof ZodError) {
      res
        .status(400)
        .json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof SupplierError) {
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
