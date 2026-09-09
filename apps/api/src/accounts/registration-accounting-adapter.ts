import type { RegistrationAccountingPort } from "../registration/registration-owner-ports.js";
import { isAllowedOnboardingChartTemplate, onboardingChartTemplates } from "./default-chart-template.js";

const chartTemplates = onboardingChartTemplates();

export class RegistrationAccountingAdapter implements RegistrationAccountingPort {
  listChartTemplates() {
    return chartTemplates;
  }

  isAllowedOnboardingChartTemplate(code: string) {
    return isAllowedOnboardingChartTemplate(code);
  }
}
