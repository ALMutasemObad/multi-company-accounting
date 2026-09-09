import type { Prisma } from '@prisma/client';

export const DEFAULT_CHART_TEMPLATE_CODE = 'SMALL_BUSINESS_GENERAL';
export const DEFAULT_CHART_TEMPLATE_VERSION = 2;
export const PROFESSIONAL_CHART_TEMPLATE_CODE = 'PROFESSIONAL_SERVICES';
export const RETAIL_INVENTORY_CHART_TEMPLATE_CODE = 'RETAIL_INVENTORY';
export const MANUFACTURING_CHART_TEMPLATE_CODE = 'MANUFACTURING';

export const chartTemplateCatalog = [
  { code: PROFESSIONAL_CHART_TEMPLATE_CODE, nameAr: 'دليل الخدمات المهنية', nameEn: 'Professional services chart', availableForOnboarding: true },
  { code: RETAIL_INVENTORY_CHART_TEMPLATE_CODE, nameAr: 'دليل التجزئة والمخزون', nameEn: 'Retail and inventory chart', availableForOnboarding: true },
  { code: MANUFACTURING_CHART_TEMPLATE_CODE, nameAr: 'دليل الإنتاج والتصنيع', nameEn: 'Manufacturing chart', availableForOnboarding: true },
  { code: DEFAULT_CHART_TEMPLATE_CODE, nameAr: 'الدليل العام القديم', nameEn: 'Legacy general chart', availableForOnboarding: false },
] as const;

export type ChartTemplateCode = (typeof chartTemplateCatalog)[number]['code'];

export type DefaultChartDefinition = {
  key: string;
  parentKey: string | null;
  code: string;
  nameAr: string;
  nameEn: string;
  accountTypeCode: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  allowsPosting: boolean;
  isControlAccount?: boolean;
};

export const defaultChartDefinitions: readonly DefaultChartDefinition[] = [
  { key: 'assets', parentKey: null, code: '1000', nameAr: 'الأصول', nameEn: 'Assets', accountTypeCode: 'ASSET', allowsPosting: false },
  { key: 'current-assets', parentKey: 'assets', code: '1100', nameAr: 'الأصول المتداولة', nameEn: 'Current assets', accountTypeCode: 'ASSET', allowsPosting: false },
  { key: 'cash', parentKey: 'current-assets', code: '1110', nameAr: 'الصندوق الرئيسي', nameEn: 'Main cash', accountTypeCode: 'ASSET', allowsPosting: true },
  { key: 'bank', parentKey: 'current-assets', code: '1120', nameAr: 'الحساب البنكي الرئيسي', nameEn: 'Main bank account', accountTypeCode: 'ASSET', allowsPosting: true },
  { key: 'receivables', parentKey: 'current-assets', code: '1130', nameAr: 'ذمم العملاء', nameEn: 'Accounts receivable', accountTypeCode: 'ASSET', allowsPosting: true, isControlAccount: true },
  { key: 'input-vat', parentKey: 'current-assets', code: '1140', nameAr: 'ضريبة القيمة المضافة المدخلة', nameEn: 'Input VAT', accountTypeCode: 'ASSET', allowsPosting: true },
  { key: 'inventory', parentKey: 'current-assets', code: '1150', nameAr: 'المخزون', nameEn: 'Inventory', accountTypeCode: 'ASSET', allowsPosting: true, isControlAccount: true },
  { key: 'prepayments', parentKey: 'current-assets', code: '1160', nameAr: 'مصروفات مدفوعة مقدماً', nameEn: 'Prepaid expenses', accountTypeCode: 'ASSET', allowsPosting: true },
  { key: 'employee-advances', parentKey: 'current-assets', code: '1170', nameAr: 'سلف الموظفين', nameEn: 'Employee advances', accountTypeCode: 'ASSET', allowsPosting: true },
  { key: 'fixed-assets', parentKey: 'assets', code: '1200', nameAr: 'الأصول الثابتة', nameEn: 'Fixed assets', accountTypeCode: 'ASSET', allowsPosting: false },
  { key: 'equipment', parentKey: 'fixed-assets', code: '1210', nameAr: 'الأجهزة والمعدات', nameEn: 'Equipment', accountTypeCode: 'ASSET', allowsPosting: true },
  { key: 'furniture', parentKey: 'fixed-assets', code: '1220', nameAr: 'الأثاث والتجهيزات', nameEn: 'Furniture and fixtures', accountTypeCode: 'ASSET', allowsPosting: true },
  { key: 'vehicles', parentKey: 'fixed-assets', code: '1230', nameAr: 'المركبات', nameEn: 'Vehicles', accountTypeCode: 'ASSET', allowsPosting: true },
  { key: 'accumulated-depreciation', parentKey: 'fixed-assets', code: '1290', nameAr: 'مجمع الإهلاك', nameEn: 'Accumulated depreciation', accountTypeCode: 'ASSET', allowsPosting: false },
  { key: 'accumulated-depreciation-equipment', parentKey: 'accumulated-depreciation', code: '1291', nameAr: 'مجمع إهلاك الأجهزة والمعدات', nameEn: 'Accumulated depreciation - equipment', accountTypeCode: 'ASSET', allowsPosting: true },
  { key: 'accumulated-depreciation-furniture', parentKey: 'accumulated-depreciation', code: '1292', nameAr: 'مجمع إهلاك الأثاث', nameEn: 'Accumulated depreciation - furniture', accountTypeCode: 'ASSET', allowsPosting: true },
  { key: 'accumulated-depreciation-vehicles', parentKey: 'accumulated-depreciation', code: '1293', nameAr: 'مجمع إهلاك المركبات', nameEn: 'Accumulated depreciation - vehicles', accountTypeCode: 'ASSET', allowsPosting: true },

  { key: 'liabilities', parentKey: null, code: '2000', nameAr: 'الالتزامات', nameEn: 'Liabilities', accountTypeCode: 'LIABILITY', allowsPosting: false },
  { key: 'current-liabilities', parentKey: 'liabilities', code: '2100', nameAr: 'الالتزامات المتداولة', nameEn: 'Current liabilities', accountTypeCode: 'LIABILITY', allowsPosting: false },
  { key: 'payables', parentKey: 'current-liabilities', code: '2110', nameAr: 'ذمم الموردين', nameEn: 'Accounts payable', accountTypeCode: 'LIABILITY', allowsPosting: true, isControlAccount: true },
  { key: 'output-vat', parentKey: 'current-liabilities', code: '2120', nameAr: 'ضريبة القيمة المضافة المخرجة', nameEn: 'Output VAT', accountTypeCode: 'LIABILITY', allowsPosting: true },
  { key: 'accrued-expenses', parentKey: 'current-liabilities', code: '2130', nameAr: 'مصروفات مستحقة', nameEn: 'Accrued expenses', accountTypeCode: 'LIABILITY', allowsPosting: true },
  { key: 'salaries-payable', parentKey: 'current-liabilities', code: '2140', nameAr: 'رواتب مستحقة', nameEn: 'Salaries payable', accountTypeCode: 'LIABILITY', allowsPosting: true },
  { key: 'other-payables', parentKey: 'current-liabilities', code: '2150', nameAr: 'التزامات متداولة أخرى', nameEn: 'Other current liabilities', accountTypeCode: 'LIABILITY', allowsPosting: true },
  { key: 'long-term-liabilities', parentKey: 'liabilities', code: '2200', nameAr: 'الالتزامات طويلة الأجل', nameEn: 'Long-term liabilities', accountTypeCode: 'LIABILITY', allowsPosting: false },
  { key: 'loans', parentKey: 'long-term-liabilities', code: '2210', nameAr: 'القروض', nameEn: 'Loans', accountTypeCode: 'LIABILITY', allowsPosting: true },

  { key: 'equity', parentKey: null, code: '3000', nameAr: 'حقوق الملكية', nameEn: 'Equity', accountTypeCode: 'EQUITY', allowsPosting: false },
  { key: 'capital', parentKey: 'equity', code: '3110', nameAr: 'رأس المال', nameEn: 'Capital', accountTypeCode: 'EQUITY', allowsPosting: true },
  { key: 'owner-current', parentKey: 'equity', code: '3200', nameAr: 'جاري المالك أو الشركاء', nameEn: 'Owner or partners current account', accountTypeCode: 'EQUITY', allowsPosting: true },
  { key: 'retained-earnings', parentKey: 'equity', code: '3300', nameAr: 'الأرباح المبقاة', nameEn: 'Retained earnings', accountTypeCode: 'EQUITY', allowsPosting: true },
  { key: 'current-year-result', parentKey: 'equity', code: '3400', nameAr: 'نتيجة العام الحالي', nameEn: 'Current year result', accountTypeCode: 'EQUITY', allowsPosting: true },

  { key: 'revenue', parentKey: null, code: '4000', nameAr: 'الإيرادات', nameEn: 'Revenue', accountTypeCode: 'REVENUE', allowsPosting: false },
  { key: 'operating-revenue', parentKey: 'revenue', code: '4100', nameAr: 'إيرادات النشاط', nameEn: 'Operating revenue', accountTypeCode: 'REVENUE', allowsPosting: false },
  { key: 'sales-revenue', parentKey: 'operating-revenue', code: '4110', nameAr: 'إيرادات المبيعات', nameEn: 'Sales revenue', accountTypeCode: 'REVENUE', allowsPosting: true },
  { key: 'service-revenue', parentKey: 'operating-revenue', code: '4120', nameAr: 'إيرادات الخدمات', nameEn: 'Service revenue', accountTypeCode: 'REVENUE', allowsPosting: true },
  { key: 'other-operating-revenue', parentKey: 'operating-revenue', code: '4130', nameAr: 'إيرادات نشاط أخرى', nameEn: 'Other operating revenue', accountTypeCode: 'REVENUE', allowsPosting: true },
  { key: 'other-income', parentKey: 'revenue', code: '4200', nameAr: 'إيرادات أخرى', nameEn: 'Other income', accountTypeCode: 'REVENUE', allowsPosting: false },
  { key: 'misc-income', parentKey: 'other-income', code: '4210', nameAr: 'إيرادات متنوعة', nameEn: 'Miscellaneous income', accountTypeCode: 'REVENUE', allowsPosting: true },
  { key: 'realized-fx-gain', parentKey: 'other-income', code: '4220', nameAr: 'أرباح فروق العملة المحققة', nameEn: 'Realized foreign exchange gains', accountTypeCode: 'REVENUE', allowsPosting: true },

  { key: 'expenses', parentKey: null, code: '5000', nameAr: 'المصروفات', nameEn: 'Expenses', accountTypeCode: 'EXPENSE', allowsPosting: false },
  { key: 'operating-expenses', parentKey: 'expenses', code: '5100', nameAr: 'المصروفات التشغيلية والإدارية', nameEn: 'Operating and administrative expenses', accountTypeCode: 'EXPENSE', allowsPosting: false },
  { key: 'rent-expense', parentKey: 'operating-expenses', code: '5110', nameAr: 'مصروف الإيجار', nameEn: 'Rent expense', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'salary-expense', parentKey: 'operating-expenses', code: '5120', nameAr: 'مصروف الرواتب والأجور', nameEn: 'Salaries and wages', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'operating-supplies', parentKey: 'operating-expenses', code: '5130', nameAr: 'مستلزمات التشغيل والمكتب', nameEn: 'Operating and office supplies', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'utilities', parentKey: 'operating-expenses', code: '5140', nameAr: 'الكهرباء والمياه', nameEn: 'Utilities', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'telecom', parentKey: 'operating-expenses', code: '5150', nameAr: 'الاتصالات والإنترنت', nameEn: 'Telecommunications and internet', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'maintenance', parentKey: 'operating-expenses', code: '5160', nameAr: 'الصيانة والإصلاح', nameEn: 'Repairs and maintenance', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'transport', parentKey: 'operating-expenses', code: '5170', nameAr: 'النقل والسفر', nameEn: 'Transportation and travel', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'bank-fees', parentKey: 'operating-expenses', code: '5180', nameAr: 'الرسوم والمصاريف البنكية', nameEn: 'Bank charges', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'professional-fees', parentKey: 'operating-expenses', code: '5190', nameAr: 'الأتعاب المهنية', nameEn: 'Professional fees', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'cost-of-revenue', parentKey: 'expenses', code: '5200', nameAr: 'تكلفة المبيعات والخدمات', nameEn: 'Cost of sales and services', accountTypeCode: 'EXPENSE', allowsPosting: false },
  { key: 'purchases', parentKey: 'cost-of-revenue', code: '5210', nameAr: 'المشتريات وتكلفة البضاعة', nameEn: 'Purchases and cost of goods', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'direct-service-cost', parentKey: 'cost-of-revenue', code: '5220', nameAr: 'التكاليف المباشرة للخدمات', nameEn: 'Direct service costs', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'freight-in', parentKey: 'cost-of-revenue', code: '5230', nameAr: 'نقل ومصاريف مشتريات', nameEn: 'Freight and purchasing costs', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'sales-marketing', parentKey: 'expenses', code: '5300', nameAr: 'مصروفات البيع والتسويق', nameEn: 'Sales and marketing expenses', accountTypeCode: 'EXPENSE', allowsPosting: false },
  { key: 'marketing', parentKey: 'sales-marketing', code: '5310', nameAr: 'الدعاية والتسويق', nameEn: 'Advertising and marketing', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'sales-commissions', parentKey: 'sales-marketing', code: '5320', nameAr: 'عمولات المبيعات', nameEn: 'Sales commissions', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'depreciation-expenses', parentKey: 'expenses', code: '5400', nameAr: 'مصروفات الإهلاك', nameEn: 'Depreciation expenses', accountTypeCode: 'EXPENSE', allowsPosting: false },
  { key: 'depreciation-expense', parentKey: 'depreciation-expenses', code: '5410', nameAr: 'مصروف الإهلاك', nameEn: 'Depreciation expense', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'other-expenses', parentKey: 'expenses', code: '5500', nameAr: 'مصروفات أخرى', nameEn: 'Other expenses', accountTypeCode: 'EXPENSE', allowsPosting: false },
  { key: 'misc-expense', parentKey: 'other-expenses', code: '5510', nameAr: 'مصروفات متنوعة', nameEn: 'Miscellaneous expenses', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'realized-fx-loss', parentKey: 'other-expenses', code: '5520', nameAr: 'خسائر فروق العملة المحققة', nameEn: 'Realized foreign exchange losses', accountTypeCode: 'EXPENSE', allowsPosting: true },
] as const;

const professionalOverlay: readonly DefaultChartDefinition[] = [
  { key: 'unbilled-professional-services', parentKey: 'current-assets', code: '1180', nameAr: 'خدمات مهنية غير مفوترة', nameEn: 'Unbilled professional services', accountTypeCode: 'ASSET', allowsPosting: true },
  { key: 'client-retainers', parentKey: 'current-liabilities', code: '2160', nameAr: 'دفعات وأتعاب مقدمة من العملاء', nameEn: 'Client retainers', accountTypeCode: 'LIABILITY', allowsPosting: true },
  { key: 'professional-services-revenue', parentKey: 'operating-revenue', code: '4140', nameAr: 'إيرادات الخدمات المهنية', nameEn: 'Professional services revenue', accountTypeCode: 'REVENUE', allowsPosting: true },
  { key: 'professional-subcontractors', parentKey: 'cost-of-revenue', code: '5240', nameAr: 'تكلفة الخبراء والمتعاقدين', nameEn: 'Professional subcontractor costs', accountTypeCode: 'EXPENSE', allowsPosting: true },
];

const retailOverlay: readonly DefaultChartDefinition[] = [
  { key: 'inventory-shrinkage', parentKey: 'cost-of-revenue', code: '5240', nameAr: 'فروقات وهالك المخزون', nameEn: 'Inventory shrinkage', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'ecommerce-fees', parentKey: 'sales-marketing', code: '5330', nameAr: 'رسوم منصات البيع', nameEn: 'Commerce platform fees', accountTypeCode: 'EXPENSE', allowsPosting: true },
];

const manufacturingOverlay: readonly DefaultChartDefinition[] = [
  { key: 'raw-materials', parentKey: 'current-assets', code: '1180', nameAr: 'مخزون المواد الخام', nameEn: 'Raw materials inventory', accountTypeCode: 'ASSET', allowsPosting: true },
  { key: 'work-in-progress', parentKey: 'current-assets', code: '1181', nameAr: 'إنتاج تحت التشغيل', nameEn: 'Work in progress', accountTypeCode: 'ASSET', allowsPosting: true },
  { key: 'finished-goods', parentKey: 'current-assets', code: '1182', nameAr: 'مخزون الإنتاج التام', nameEn: 'Finished goods inventory', accountTypeCode: 'ASSET', allowsPosting: true },
  { key: 'manufacturing-overhead', parentKey: 'cost-of-revenue', code: '5240', nameAr: 'تكاليف صناعية غير مباشرة', nameEn: 'Manufacturing overhead', accountTypeCode: 'EXPENSE', allowsPosting: true },
  { key: 'direct-labor', parentKey: 'cost-of-revenue', code: '5250', nameAr: 'أجور إنتاج مباشرة', nameEn: 'Direct manufacturing labor', accountTypeCode: 'EXPENSE', allowsPosting: true },
];

function overlayFor(code: ChartTemplateCode) {
  if (code === PROFESSIONAL_CHART_TEMPLATE_CODE) return professionalOverlay;
  if (code === RETAIL_INVENTORY_CHART_TEMPLATE_CODE) return retailOverlay;
  if (code === MANUFACTURING_CHART_TEMPLATE_CODE) return manufacturingOverlay;
  return [];
}

export function isSupportedChartTemplate(code: string): code is ChartTemplateCode {
  return chartTemplateCatalog.some((template) => template.code === code);
}

export function isAllowedOnboardingChartTemplate(code: string): code is ChartTemplateCode {
  return chartTemplateCatalog.some((template) => template.code === code && template.availableForOnboarding);
}

export function onboardingChartTemplates() {
  return chartTemplateCatalog
    .filter(({ code }) => isAllowedOnboardingChartTemplate(code))
    .map(({ code, nameAr, nameEn }) => ({ code, nameAr, nameEn }));
}

type TemplateAccount = {
  id: bigint;
  code: string;
  parentAccountId: bigint | null;
  level: number;
  allowsPosting: boolean;
  isActive: boolean;
  sourceTemplateCode: string | null;
  sourceTemplateKey: string | null;
};

export type DefaultChartTemplateStatus = {
  templateCode: ChartTemplateCode;
  version: number;
  nameAr: string;
  total: number;
  matched: number;
  missing: number;
  inactive: number;
  conflicts: number;
  canApply: boolean;
};

function findMatches(accounts: TemplateAccount[], definition: DefaultChartDefinition, sourceTemplateCode = DEFAULT_CHART_TEMPLATE_CODE) {
  const marked = accounts.find((account) => account.sourceTemplateCode === sourceTemplateCode && account.sourceTemplateKey === definition.key);
  const byCode = accounts.find((account) => account.code === definition.code);
  return { marked, byCode, selected: marked ?? byCode };
}

export async function inspectDefaultChartTemplate(tx: Prisma.TransactionClient, companyId: bigint, templateCode: ChartTemplateCode = DEFAULT_CHART_TEMPLATE_CODE): Promise<DefaultChartTemplateStatus> {
  const accounts = await tx.account.findMany({
    where: { companyId },
    select: { id: true, code: true, parentAccountId: true, level: true, allowsPosting: true, isActive: true, sourceTemplateCode: true, sourceTemplateKey: true },
  });
  let matched = 0; let inactive = 0; let conflicts = 0;
  const definitions = [
    ...defaultChartDefinitions.map((definition) => ({ definition, sourceTemplateCode: DEFAULT_CHART_TEMPLATE_CODE })),
    ...overlayFor(templateCode).map((definition) => ({ definition, sourceTemplateCode: templateCode })),
  ];
  for (const { definition, sourceTemplateCode } of definitions) {
    const { marked, byCode, selected } = findMatches(accounts, definition, sourceTemplateCode);
    if (marked && byCode && marked.id !== byCode.id) conflicts += 1;
    if (selected) { matched += 1; if (!selected.isActive) inactive += 1; }
    else if (definition.parentKey) {
      const parentDefinition = definitions.find(({ definition: candidate }) => candidate.key === definition.parentKey)!;
      const parent = findMatches(accounts, parentDefinition.definition, parentDefinition.sourceTemplateCode).selected;
      if (parent && (!parent.isActive || parent.allowsPosting)) conflicts += 1;
    }
  }
  const missing = definitions.length - matched;
  const template = chartTemplateCatalog.find(({ code }) => code === templateCode)!;
  return { templateCode, version: DEFAULT_CHART_TEMPLATE_VERSION, nameAr: template.nameAr, total: definitions.length, matched, missing, inactive, conflicts, canApply: conflicts === 0 };
}

export async function applyDefaultChartTemplate(tx: Prisma.TransactionClient, companyId: bigint, requestedTemplateCode: string = DEFAULT_CHART_TEMPLATE_CODE) {
  if (!isSupportedChartTemplate(requestedTemplateCode)) throw new Error(`DEFAULT_CHART_UNSUPPORTED:${requestedTemplateCode}`);
  const templateCode = requestedTemplateCode;
  const types = new Map((await tx.accountType.findMany({ select: { id: true, code: true } })).map((type) => [type.code, type.id]));
  const accounts: TemplateAccount[] = await tx.account.findMany({
    where: { companyId },
    select: { id: true, code: true, parentAccountId: true, level: true, allowsPosting: true, isActive: true, sourceTemplateCode: true, sourceTemplateKey: true },
  });
  const resolved = new Map<string, TemplateAccount>();
  let created = 0; let linked = 0; let existing = 0;

  const definitions = [
    ...defaultChartDefinitions.map((definition) => ({ definition, sourceTemplateCode: DEFAULT_CHART_TEMPLATE_CODE })),
    ...overlayFor(templateCode).map((definition) => ({ definition, sourceTemplateCode: templateCode })),
  ];
  for (const { definition, sourceTemplateCode } of definitions) {
    const { marked, byCode } = findMatches(accounts, definition, sourceTemplateCode);
    if (marked && byCode && marked.id !== byCode.id) throw new Error(`DEFAULT_CHART_CONFLICT:${definition.key}:CODE`);
    let account = marked ?? byCode;
    if (account) {
      if (!marked) {
        account = await tx.account.update({
          where: { id: account.id },
          data: { sourceTemplateCode, sourceTemplateKey: definition.key },
          select: { id: true, code: true, parentAccountId: true, level: true, allowsPosting: true, isActive: true, sourceTemplateCode: true, sourceTemplateKey: true },
        });
        const index = accounts.findIndex((item) => item.id === account!.id); accounts[index] = account; linked += 1;
      } else existing += 1;
      resolved.set(definition.key, account);
      continue;
    }

    const parent = definition.parentKey ? resolved.get(definition.parentKey) : undefined;
    if (definition.parentKey && (!parent || !parent.isActive || parent.allowsPosting)) throw new Error(`DEFAULT_CHART_CONFLICT:${definition.key}:PARENT`);
    const accountTypeId = types.get(definition.accountTypeCode);
    if (!accountTypeId) throw new Error(`DEFAULT_CHART_CONFLICT:${definition.key}:ACCOUNT_TYPE`);
    account = await tx.account.create({
      data: {
        companyId,
        accountTypeId,
        parentAccountId: parent?.id ?? null,
        code: definition.code,
        nameAr: definition.nameAr,
        nameEn: definition.nameEn,
        level: parent ? parent.level + 1 : 1,
        allowsPosting: definition.allowsPosting,
        isControlAccount: definition.isControlAccount ?? false,
        sourceTemplateCode,
        sourceTemplateKey: definition.key,
      },
      select: { id: true, code: true, parentAccountId: true, level: true, allowsPosting: true, isActive: true, sourceTemplateCode: true, sourceTemplateKey: true },
    });
    accounts.push(account); resolved.set(definition.key, account); created += 1;
  }

  const status = await inspectDefaultChartTemplate(tx, companyId, templateCode);
  return { ...status, created, linked, existing };
}
