import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import type { PayrollOwnerPort } from "../payroll/payroll-reference-ports.js";
export class PayrollOwnerAdapter implements PayrollOwnerPort {
  async isOwner(tx: Prisma.TransactionClient, context: ActorContext, organizationId: bigint) {
    const membership = await tx.organizationMembership.findFirst({ where: {
      organizationId, userId: context.userId, isActive: true, role: "OWNER", user: { isActive: true },
    }, select: { userId: true } });
    if (!membership) return false;
    return Boolean(await tx.userCompany.findFirst({ where: {
      userId: context.userId, companyId: context.companyId, isActive: true,
    }, select: { userId: true } }));
  }
}
