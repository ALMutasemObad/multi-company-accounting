import type { RegistrationAccountingPort } from "../registration/registration-owner-ports.js";
import { isSupportedChartTemplate, onboardingChartTemplates } from "./default-chart-template.js";

const chartTemplates = onboardingChartTemplates();

export class RegistrationAccountingAdapter implements RegistrationAccountingPort {
  listChartTemplates() {
    return chartTemplates;
  }

  isSupportedChartTemplate(code: string) {
    return isSupportedChartTemplate(code);
  }
}
