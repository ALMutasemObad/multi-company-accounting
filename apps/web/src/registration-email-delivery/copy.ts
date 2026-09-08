import { localizedCopyFor } from "../i18n";
import type { Locale } from "../i18n";
import copy from "./copy.json";

type RegistrationDeliveryCopy = {
  acceptedTitle: string;
  acceptedDescription: string;
  resendAccepted: string;
  resendHelp: string;
};

export const registrationDeliveryCopy: Readonly<Record<string, RegistrationDeliveryCopy>> = copy;

export function deliveryCopyFor(locale: Locale): RegistrationDeliveryCopy {
  return localizedCopyFor(registrationDeliveryCopy, locale, "ar");
}
