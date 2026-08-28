import { Prisma, type PrismaClient, type ProfessionalProject } from "@prisma/client";
import type { ActorContext } from "../users/user-service.js";

type Db = PrismaClient | Prisma.TransactionClient;

export class ProfessionalProjectAccessPolicy {
  scope(context: ActorContext): Prisma.ProfessionalProjectWhereInput {
    return {
      companyId: context.companyId,
      OR: [
        { accessMode: "COMPANY" },
        { members: { some: { companyId: context.companyId, userId: context.userId, isActive: true } } },
        { accessGrants: { some: { companyId: context.companyId, userId: context.userId, isActive: true } } },
      ],
    };
  }

  where(context: ActorContext, extra: Prisma.ProfessionalProjectWhereInput = {}): Prisma.ProfessionalProjectWhereInput {
    return { AND: [this.scope(context), extra] };
  }

  async findAccessible(
    db: Db,
    context: ActorContext,
    extra: Prisma.ProfessionalProjectWhereInput,
  ) {
    return db.professionalProject.findFirst({ where: this.where(context, extra) });
  }

  async assertAccessible(
    db: Db,
    context: ActorContext,
    projectId: bigint,
    notFound: () => Error,
  ) {
    const row = await db.professionalProject.findFirst({
      where: this.where(context, { id: projectId }),
      select: { id: true },
    });
    if (!row) throw notFound();
  }

  async lockAccessible(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    publicId: string,
    notFound: () => Error,
  ): Promise<ProfessionalProject> {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM professional_projects
      WHERE public_id=${publicId} AND company_id=${context.companyId}
      FOR UPDATE`;
    if (rows.length !== 1) throw notFound();
    await this.assertAccessible(tx, context, rows[0]!.id, notFound);
    return tx.professionalProject.findFirstOrThrow({
      where: { id: rows[0]!.id, companyId: context.companyId },
    });
  }
}
