import type { RegistrationAccountingPort } from "../registration/registration-owner-ports.js";
import { DEFAULT_CHART_TEMPLATE_CODE } from "./default-chart-template.js";

const chartTemplates = [{
  code: DEFAULT_CHART_TEMPLATE_CODE,
  nameAr: "دليل عام للمنشآت الصغيرة",
  nameEn: "Small business general chart",
}] as const;

export class RegistrationAccountingAdapter implements RegistrationAccountingPort {
  listChartTemplates() {
    return chartTemplates;
  }

  isSupportedChartTemplate(code: string) {
    return chartTemplates.some((template) => template.code === code);
  }
}
