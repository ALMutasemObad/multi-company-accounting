import type { Prisma } from "@prisma/client";
import type { RegistrationIdentityPort } from "../registration/registration-owner-ports.js";

export class RegistrationIdentityAdapter implements RegistrationIdentityPort {
  async identityExists(tx: Prisma.TransactionClient, emailNormalized: string) {
    const user = await tx.user.findUnique({
      where: { emailNormalized },
      select: { id: true },
    });
    return Boolean(user);
  }
}
