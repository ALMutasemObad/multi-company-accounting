import type { Locale } from "../i18n";
import copy from "./copy.json";

type RegistrationDeliveryCopy = {
  acceptedTitle: string;
  acceptedDescription: string;
  resendAccepted: string;
  resendHelp: string;
};

export const registrationDeliveryCopy = copy satisfies Record<Locale, RegistrationDeliveryCopy>;

export function deliveryCopyFor(locale: Locale) {
  return registrationDeliveryCopy[locale];
}
