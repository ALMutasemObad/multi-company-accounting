import 'dotenv/config';
import { hash } from 'argon2';
import { createDatabase } from '../src/database.js';
import { SalesInvoiceService } from '../src/sales/sales-invoice-service.js';
import { PurchaseInvoiceService } from '../src/purchases/purchase-invoice-service.js';

const databaseUrl = process.env.DATABASE_URL;
const seedPassword = process.env.SEED_ADMIN_PASSWORD;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (!seedPassword || seedPassword.length < 12) throw new Error('SEED_ADMIN_PASSWORD must contain at least 12 characters');

const prisma = createDatabase(databaseUrl);
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

try {
  const currency = await prisma.currency.findUniqueOrThrow({ where: { code: 'SAR' } });
  const company = await prisma.company.findFirstOrThrow({ where: { organization: { name: 'المؤسسة التجريبية' } } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { emailNormalized: 'admin@mcap.local' } });
  await prisma.company.update({
    where: { id: company.id },
    data: { name: 'الشركة التجريبية', timezone: 'Asia/Riyadh' },
  });

  const accountant = await prisma.user.upsert({
    where: { emailNormalized: 'accountant@mcap.local' },
    update: { displayName: 'سارة المحاسب', passwordHash: await hash(seedPassword), isActive: true },
    create: { emailNormalized: 'accountant@mcap.local', displayName: 'سارة المحاسب', passwordHash: await hash(seedPassword) },
  });
  const reviewer = await prisma.user.upsert({
    where: { emailNormalized: 'reviewer@mcap.local' },
    update: { displayName: 'خالد المراجع', passwordHash: await hash(seedPassword), isActive: true },
    create: { emailNormalized: 'reviewer@mcap.local', displayName: 'خالد المراجع', passwordHash: await hash(seedPassword) },
  });
  for (const user of [accountant, reviewer]) {
    await prisma.userCompany.upsert({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
      update: { isActive: true },
      create: { userId: user.id, companyId: company.id },
    });
  }
  const accountantRole = await prisma.role.upsert({
    where: { companyId_code: { companyId: company.id, code: 'ACCOUNTANT' } },
    update: { nameAr: 'محاسب', isActive: true },
    create: { companyId: company.id, code: 'ACCOUNTANT', nameAr: 'محاسب' },
  });
  const accountantPermissions = await prisma.permission.findMany({
    where: { module: { in: ['accounts', 'cost_centers', 'fiscal', 'manual_journals', 'customers', 'suppliers', 'treasury', 'receipts', 'payments', 'sales_invoices', 'purchase_invoices', 'dashboard', 'reports'] } },
  });
  for (const permission of accountantPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: accountantRole.id, permissionId: permission.id } },
      update: {}, create: { roleId: accountantRole.id, permissionId: permission.id },
    });
  }
  await prisma.userCompanyRole.upsert({
    where: { userId_companyId_roleId: { userId: accountant.id, companyId: company.id, roleId: accountantRole.id } },
    update: {}, create: { userId: accountant.id, companyId: company.id, roleId: accountantRole.id },
  });

  const accountTypes = new Map((await prisma.accountType.findMany()).map((item) => [item.code, item]));
  const account = async (input: { code: string; nameAr: string; type: string; parent?: bigint; level: number; allowsPosting: boolean; isControlAccount?: boolean }) =>
    prisma.account.upsert({
      where: { companyId_code: { companyId: company.id, code: input.code } },
      update: { nameAr: input.nameAr, accountTypeId: accountTypes.get(input.type)!.id, parentAccountId: input.parent ?? null, level: input.level, allowsPosting: input.allowsPosting, isControlAccount: input.isControlAccount ?? false, isActive: true },
      create: { companyId: company.id, code: input.code, nameAr: input.nameAr, accountTypeId: accountTypes.get(input.type)!.id, parentAccountId: input.parent ?? null, level: input.level, allowsPosting: input.allowsPosting, isControlAccount: input.isControlAccount ?? false },
    });

  const assets = await account({ code: '1000', nameAr: 'الأصول', type: 'ASSET', level: 1, allowsPosting: false });
  const currentAssets = await account({ code: '1100', nameAr: 'الأصول المتداولة', type: 'ASSET', parent: assets.id, level: 2, allowsPosting: false });
  const cash = await account({ code: '1110', nameAr: 'الصندوق الرئيسي', type: 'ASSET', parent: currentAssets.id, level: 3, allowsPosting: true });
  const bank = await account({ code: '1120', nameAr: 'البنك الأهلي - الحساب التشغيلي', type: 'ASSET', parent: currentAssets.id, level: 3, allowsPosting: true });
  const receivables = await account({ code: '1130', nameAr: 'ذمم العملاء', type: 'ASSET', parent: currentAssets.id, level: 3, allowsPosting: true, isControlAccount: true });
  const vatReceivable = await account({ code: '1140', nameAr: 'ضريبة القيمة المضافة - مدخلات', type: 'ASSET', parent: currentAssets.id, level: 3, allowsPosting: true });
  await account({ code: '1200', nameAr: 'الأصول الثابتة', type: 'ASSET', parent: assets.id, level: 2, allowsPosting: false });
  const equipment = await account({ code: '1210', nameAr: 'أجهزة ومعدات', type: 'ASSET', parent: assets.id, level: 2, allowsPosting: true });

  const liabilities = await account({ code: '2000', nameAr: 'الالتزامات', type: 'LIABILITY', level: 1, allowsPosting: false });
  const payables = await account({ code: '2110', nameAr: 'ذمم الموردين', type: 'LIABILITY', parent: liabilities.id, level: 2, allowsPosting: true, isControlAccount: true });
  const vatPayable = await account({ code: '2120', nameAr: 'ضريبة القيمة المضافة المستحقة', type: 'LIABILITY', parent: liabilities.id, level: 2, allowsPosting: true });
  const equity = await account({ code: '3000', nameAr: 'حقوق الملكية', type: 'EQUITY', level: 1, allowsPosting: false });
  const capital = await account({ code: '3110', nameAr: 'رأس المال', type: 'EQUITY', parent: equity.id, level: 2, allowsPosting: true });
  const revenueRoot = await account({ code: '4000', nameAr: 'الإيرادات', type: 'REVENUE', level: 1, allowsPosting: false });
  const serviceRevenue = await account({ code: '4110', nameAr: 'إيرادات الخدمات والاستشارات', type: 'REVENUE', parent: revenueRoot.id, level: 2, allowsPosting: true });
  const otherRevenue = await account({ code: '4120', nameAr: 'إيرادات أخرى', type: 'REVENUE', parent: revenueRoot.id, level: 2, allowsPosting: true });
  const expenseRoot = await account({ code: '5000', nameAr: 'المصروفات', type: 'EXPENSE', level: 1, allowsPosting: false });
  const rentExpense = await account({ code: '5110', nameAr: 'مصروف الإيجار', type: 'EXPENSE', parent: expenseRoot.id, level: 2, allowsPosting: true });
  const salaryExpense = await account({ code: '5120', nameAr: 'الرواتب والأجور', type: 'EXPENSE', parent: expenseRoot.id, level: 2, allowsPosting: true });
  const operationsExpense = await account({ code: '5130', nameAr: 'مصروفات تشغيلية', type: 'EXPENSE', parent: expenseRoot.id, level: 2, allowsPosting: true });

  const administration = await prisma.costCenter.upsert({
    where: { companyId_code: { companyId: company.id, code: 'CC-100' } },
    update: { nameAr: 'الإدارة العامة', isActive: true },
    create: { companyId: company.id, code: 'CC-100', nameAr: 'الإدارة العامة' },
  });
  const projects = await prisma.costCenter.upsert({
    where: { companyId_code: { companyId: company.id, code: 'CC-200' } },
    update: { nameAr: 'المشاريع', isActive: true },
    create: { companyId: company.id, code: 'CC-200', nameAr: 'المشاريع' },
  });
  await prisma.costCenter.upsert({
    where: { companyId_code: { companyId: company.id, code: 'CC-210' } },
    update: { nameAr: 'مشروع واجهة الرياض', parentId: projects.id, isActive: true },
    create: { companyId: company.id, code: 'CC-210', nameAr: 'مشروع واجهة الرياض', parentId: projects.id },
  });

  const cashBox = await prisma.cashBankAccount.upsert({
    where: { companyId_code: { companyId: company.id, code: 'CASH-01' } },
    update: { nameAr: 'الصندوق الرئيسي', ledgerAccountId: cash.id, isActive: true },
    create: { companyId: company.id, code: 'CASH-01', nameAr: 'الصندوق الرئيسي', accountType: 'CASH', ledgerAccountId: cash.id },
  });
  const bankAccount = await prisma.cashBankAccount.upsert({
    where: { companyId_code: { companyId: company.id, code: 'BANK-01' } },
    update: { nameAr: 'الحساب التشغيلي', bankName: 'البنك الأهلي السعودي', accountNumberLast4: '4821', ibanLast4: '4821', ledgerAccountId: bank.id, isActive: true },
    create: { companyId: company.id, code: 'BANK-01', nameAr: 'الحساب التشغيلي', accountType: 'BANK', bankName: 'البنك الأهلي السعودي', accountNumberLast4: '4821', ibanLast4: '4821', ledgerAccountId: bank.id },
  });

  const customerRows = [
    { code: 'CUS-001', nameAr: 'شركة آفاق التقنية', phone: '0112456789', email: 'finance@afaq.example', taxNumberLast4: '2047', city: 'الرياض' },
    { code: 'CUS-002', nameAr: 'مؤسسة روافد الأعمال', phone: '0126547890', email: 'accounts@rawafid.example', taxNumberLast4: '7712', city: 'جدة' },
    { code: 'CUS-003', nameAr: 'مجموعة المدار التجارية', phone: '0138123456', email: 'billing@almadar.example', taxNumberLast4: '9835', city: 'الدمام' },
  ];
  const customers = [];
  for (const row of customerRows) {
    const customer = await prisma.customer.upsert({
      where: { companyId_code: { companyId: company.id, code: row.code } },
      update: { nameAr: row.nameAr, phone: row.phone, email: row.email, taxNumberLast4: row.taxNumberLast4, receivableAccountId: receivables.id, isActive: true },
      create: { companyId: company.id, code: row.code, nameAr: row.nameAr, phone: row.phone, email: row.email, taxNumberLast4: row.taxNumberLast4, receivableAccountId: receivables.id },
    });
    const existingAddress = await prisma.customerAddress.findFirst({ where: { companyId: company.id, customerId: customer.id, isPrimary: true } });
    const address = { companyId: company.id, customerId: customer.id, addressType: 'BILLING' as const, line1: `حي الأعمال - ${row.city}`, city: row.city, countryCode: 'SA', isPrimary: true };
    if (existingAddress) await prisma.customerAddress.update({ where: { id: existingAddress.id }, data: address });
    else await prisma.customerAddress.create({ data: address });
    customers.push(customer);
  }

  const supplierRows = [
    { code: 'SUP-001', nameAr: 'شركة الإمداد المكتبي', phone: '0114001122', email: 'sales@office-supply.example', taxNumberLast4: '3188', city: 'الرياض' },
    { code: 'SUP-002', nameAr: 'مؤسسة سحابة للحلول', phone: '0114556677', email: 'billing@cloud.example', taxNumberLast4: '6401', city: 'الرياض' },
    { code: 'SUP-003', nameAr: 'شركة المدار للصيانة', phone: '0138332211', email: 'accounts@maintenance.example', taxNumberLast4: '5294', city: 'الدمام' },
  ];
  const suppliers = [];
  for (const row of supplierRows) {
    const supplier = await prisma.supplier.upsert({
      where: { companyId_code: { companyId: company.id, code: row.code } },
      update: { nameAr: row.nameAr, phone: row.phone, email: row.email, taxNumberLast4: row.taxNumberLast4, payableAccountId: payables.id, isActive: true },
      create: { companyId: company.id, code: row.code, nameAr: row.nameAr, phone: row.phone, email: row.email, taxNumberLast4: row.taxNumberLast4, payableAccountId: payables.id },
    });
    const existingAddress = await prisma.supplierAddress.findFirst({ where: { companyId: company.id, supplierId: supplier.id, isPrimary: true } });
    const address = { companyId: company.id, supplierId: supplier.id, addressType: 'PAYMENT' as const, line1: `المنطقة التجارية - ${row.city}`, city: row.city, countryCode: 'SA', isPrimary: true };
    if (existingAddress) await prisma.supplierAddress.update({ where: { id: existingAddress.id }, data: address });
    else await prisma.supplierAddress.create({ data: address });
    suppliers.push(supplier);
  }

  const fiscalYear = await prisma.fiscalYear.upsert({
    where: { companyId_name: { companyId: company.id, name: 'السنة المالية 2026' } },
    update: { startDate: date('2026-01-01'), endDate: date('2026-12-31'), status: 'OPEN' },
    create: { companyId: company.id, name: 'السنة المالية 2026', startDate: date('2026-01-01'), endDate: date('2026-12-31') },
  });
  const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const periods = [];
  for (let month = 1; month <= 12; month += 1) {
    const start = new Date(Date.UTC(2026, month - 1, 1));
    const end = new Date(Date.UTC(2026, month, 0));
    periods.push(await prisma.fiscalPeriod.upsert({
      where: { fiscalYearId_periodNumber: { fiscalYearId: fiscalYear.id, periodNumber: month } },
      update: { name: monthNames[month - 1]!, startDate: start, endDate: end, status: 'OPEN' },
      create: { companyId: company.id, fiscalYearId: fiscalYear.id, periodNumber: month, name: monthNames[month - 1]!, startDate: start, endDate: end },
    }));
  }
  for (const sequence of [
    { type: 'MANUAL_JOURNAL', prefix: 'JV' }, { type: 'RECEIPT', prefix: 'RV' }, { type: 'PAYMENT', prefix: 'PV' },
    { type: 'SALES_INVOICE', prefix: 'SI' }, { type: 'SALES_CREDIT_NOTE', prefix: 'SCN' },
    { type: 'PURCHASE_INVOICE', prefix: 'PI' }, { type: 'PURCHASE_DEBIT_NOTE', prefix: 'PDN' },
  ]) {
    await prisma.documentSequence.upsert({
      where: { fiscalYearId_documentType: { fiscalYearId: fiscalYear.id, documentType: sequence.type } },
      update: { prefix: sequence.prefix, nextNumber: 100n, padding: 5 },
      create: { companyId: company.id, fiscalYearId: fiscalYear.id, documentType: sequence.type, prefix: sequence.prefix, nextNumber: 100n, padding: 5 },
    });
  }

  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { code: 'CASH' } });
  const transferMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { code: 'BANK_TRANSFER' } });
  const postedAt = new Date('2026-08-11T08:00:00.000Z');
  const createJournalDocument = async (input: { number: string; documentDate: string; description: string; status?: 'DRAFT' | 'POSTED'; lines: Array<{ accountId: bigint; debit?: string; credit?: string; costCenterId?: bigint; customerId?: bigint; supplierId?: bigint; description: string }> }) => {
    const existing = await prisma.accountingDocument.findUnique({ where: { companyId_documentType_documentNumber: { companyId: company.id, documentType: 'MANUAL_JOURNAL', documentNumber: input.number } } });
    if (existing) return existing;
    const period = periods[Number(input.documentDate.slice(5, 7)) - 1]!;
    return prisma.accountingDocument.create({ data: {
      companyId: company.id, fiscalPeriodId: period.id, documentType: 'MANUAL_JOURNAL', documentNumber: input.number,
      documentDate: date(input.documentDate), description: input.description, status: input.status ?? 'POSTED', createdBy: accountant.id,
      postedBy: input.status === 'DRAFT' ? null : admin.id, postedAt: input.status === 'DRAFT' ? null : postedAt,
      journalEntries: { create: { entryNumber: 1, entryDate: date(input.documentDate), description: input.description,
        lines: { create: input.lines.map((line, index) => ({ lineNumber: index + 1, accountId: line.accountId, costCenterId: line.costCenterId, customerId: line.customerId, supplierId: line.supplierId, description: line.description, currencyId: currency.id, exchangeRate: '1', debitAmount: line.debit ?? '0', creditAmount: line.credit ?? '0', baseDebitAmount: line.debit ?? '0', baseCreditAmount: line.credit ?? '0' })) } } },
    } });
  };

  await createJournalDocument({ number: 'JV-00001', documentDate: '2026-01-01', description: 'قيد إثبات رأس المال والأرصدة الافتتاحية', lines: [
    { accountId: bank.id, debit: '250000', description: 'إيداع رأس المال في الحساب البنكي' },
    { accountId: equipment.id, debit: '50000', description: 'أجهزة ومعدات افتتاحية' },
    { accountId: capital.id, credit: '300000', description: 'رأس المال المدفوع' },
  ] });
  await createJournalDocument({ number: 'JV-00002', documentDate: '2026-07-31', description: 'إثبات رواتب شهر يوليو', lines: [
    { accountId: salaryExpense.id, debit: '32000', costCenterId: administration.id, description: 'رواتب وأجور يوليو' },
    { accountId: bank.id, credit: '32000', description: 'تحويل الرواتب' },
  ] });
  await createJournalDocument({ number: 'JV-00003', documentDate: '2026-08-10', description: 'قيد تسوية ضريبة القيمة المضافة - مسودة', status: 'DRAFT', lines: [
    { accountId: operationsExpense.id, debit: '1500', costCenterId: administration.id, description: 'تسوية ضريبة مدخلات' },
    { accountId: vatPayable.id, credit: '1500', description: 'ضريبة مستحقة' },
  ] });
  await createJournalDocument({ number: 'JV-00004', documentDate: '2026-06-15', description: 'فاتورة خدمات التحول الرقمي', lines: [
    { accountId: receivables.id, debit: '28000', customerId: customers[0]!.id, description: 'ذمة العميل' },
    { accountId: serviceRevenue.id, credit: '28000', description: 'إيراد خدمات' },
  ] });
  await createJournalDocument({ number: 'JV-00005', documentDate: '2026-07-10', description: 'فاتورة خدمات استشارية', lines: [
    { accountId: receivables.id, debit: '18500', customerId: customers[1]!.id, description: 'ذمة العميل' },
    { accountId: serviceRevenue.id, credit: '18500', description: 'إيراد استشارات' },
  ] });
  await createJournalDocument({ number: 'JV-00006', documentDate: '2026-08-02', description: 'فاتورة عقد الخدمات السنوي', lines: [
    { accountId: receivables.id, debit: '42000', customerId: customers[2]!.id, description: 'ذمة العميل' },
    { accountId: serviceRevenue.id, credit: '42000', description: 'إيراد العقد السنوي' },
  ] });
  await createJournalDocument({ number: 'JV-00007', documentDate: '2026-06-22', description: 'فاتورة خدمات سحابية', lines: [
    { accountId: operationsExpense.id, debit: '12000', costCenterId: projects.id, supplierId: suppliers[1]!.id, description: 'مصروف خدمات سحابية' },
    { accountId: payables.id, credit: '12000', supplierId: suppliers[1]!.id, description: 'ذمة المورد' },
  ] });
  await createJournalDocument({ number: 'JV-00008', documentDate: '2026-07-01', description: 'فاتورة إيجار المكتب', lines: [
    { accountId: rentExpense.id, debit: '22000', costCenterId: administration.id, supplierId: suppliers[0]!.id, description: 'مصروف الإيجار' },
    { accountId: payables.id, credit: '22000', supplierId: suppliers[0]!.id, description: 'ذمة المورد' },
  ] });
  await createJournalDocument({ number: 'JV-00009', documentDate: '2026-08-06', description: 'فاتورة صيانة وتجهيز', lines: [
    { accountId: operationsExpense.id, debit: '6750', costCenterId: projects.id, supplierId: suppliers[2]!.id, description: 'مصروف صيانة' },
    { accountId: payables.id, credit: '6750', supplierId: suppliers[2]!.id, description: 'ذمة المورد' },
  ] });

  const vat15 = await prisma.taxRate.upsert({
    where: { companyId_code: { companyId: company.id, code: 'VAT15' } },
    update: { nameAr: 'ضريبة القيمة المضافة 15%', rate: '15', outputTaxAccountId: vatPayable.id, inputTaxAccountId: vatReceivable.id, isActive: true },
    create: { companyId: company.id, code: 'VAT15', nameAr: 'ضريبة القيمة المضافة 15%', rate: '15', outputTaxAccountId: vatPayable.id, inputTaxAccountId: vatReceivable.id },
  });
  await prisma.taxRate.upsert({
    where: { companyId_code: { companyId: company.id, code: 'ZERO' } },
    update: { nameAr: 'نسبة صفرية', rate: '0', outputTaxAccountId: null, isActive: true },
    create: { companyId: company.id, code: 'ZERO', nameAr: 'نسبة صفرية', rate: '0' },
  });

  const salesService = new SalesInvoiceService(prisma);
  const salesContext = { userId: admin.id, companyId: company.id };
  const ensureSalesDocument = async (input: {
    documentType: 'SALES_INVOICE' | 'SALES_CREDIT_NOTE';
    documentDate: string;
    dueDate: string;
    description: string;
    customerIndex: number;
    sourceInvoiceId?: bigint;
    quantity: string;
    unitPrice: string;
    discountAmount?: string;
    post?: boolean;
  }) => {
    let invoice = await prisma.salesInvoice.findFirst({
      where: { companyId: company.id, accountingDocument: { documentType: input.documentType, description: input.description } },
      include: { accountingDocument: true },
    });
    if (!invoice) {
      invoice = await salesService.create(salesContext, {
        documentType: input.documentType,
        fiscalPeriodId: periods[Number(input.documentDate.slice(5, 7)) - 1]!.id,
        documentDate: input.documentDate,
        dueDate: input.dueDate,
        description: input.description,
        customerId: customers[input.customerIndex]!.id,
        sourceInvoiceId: input.sourceInvoiceId ?? null,
        currencyId: currency.id,
        exchangeRate: '1',
        customerAddress: 'المملكة العربية السعودية',
        notes: 'بيانات تجريبية لدورة المبيعات والذمم المدينة',
        lines: [{
          description: input.description,
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          discountAmount: input.discountAmount ?? '0',
          revenueAccountId: serviceRevenue.id,
          costCenterId: projects.id,
          taxRateId: vat15.id,
        }],
      });
    }
    if (input.post !== false && invoice.accountingDocument.status === 'DRAFT') {
      await salesService.post(salesContext, invoice.id, invoice.accountingDocument.version, `demo-post-${invoice.id}`);
      invoice = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { accountingDocument: true } });
    }
    return invoice;
  };

  const salesInvoice1 = await ensureSalesDocument({ documentType: 'SALES_INVOICE', documentDate: '2026-04-01', dueDate: '2026-04-30', description: 'اشتراك منصة الأعمال السنوي - فاتورة تجريبية', customerIndex: 0, quantity: '1', unitPrice: '20000' });
  await ensureSalesDocument({ documentType: 'SALES_INVOICE', documentDate: '2026-07-01', dueDate: '2026-07-31', description: 'خدمات استشارية للربع الثالث - فاتورة تجريبية', customerIndex: 1, quantity: '150', unitPrice: '100' });
  await ensureSalesDocument({ documentType: 'SALES_INVOICE', documentDate: '2026-08-10', dueDate: '2026-09-10', description: 'خدمات تشغيل ودعم - فاتورة تجريبية', customerIndex: 2, quantity: '10', unitPrice: '1000' });
  await ensureSalesDocument({ documentType: 'SALES_INVOICE', documentDate: '2026-08-12', dueDate: '2026-09-12', description: 'عرض خدمات تحت المراجعة - مسودة تجريبية', customerIndex: 0, quantity: '5', unitPrice: '750', discountAmount: '250', post: false });
  await ensureSalesDocument({ documentType: 'SALES_CREDIT_NOTE', documentDate: '2026-08-05', dueDate: '2026-08-05', description: 'تخفيض خدمة من الفاتورة السنوية - إشعار دائن تجريبي', customerIndex: 0, sourceInvoiceId: salesInvoice1.id, quantity: '1', unitPrice: '2000' });

  const purchaseService = new PurchaseInvoiceService(prisma);
  const purchaseContext = { userId: admin.id, companyId: company.id };
  const ensurePurchaseDocument = async (input: {
    documentType: 'PURCHASE_INVOICE' | 'PURCHASE_DEBIT_NOTE'; documentDate: string; dueDate: string;
    description: string; supplierIndex: number; sourceInvoiceId?: bigint; quantity: string; unitPrice: string;
    discountAmount?: string; debitAccountId: bigint; costCenterId?: bigint; supplierInvoiceNumber?: string; post?: boolean;
  }) => {
    let invoice = await prisma.purchaseInvoice.findFirst({ where: { companyId: company.id, accountingDocument: { documentType: input.documentType, description: input.description } }, include: { accountingDocument: true } });
    if (!invoice) {
      invoice = await purchaseService.create(purchaseContext, {
        documentType: input.documentType, fiscalPeriodId: periods[Number(input.documentDate.slice(5, 7)) - 1]!.id,
        documentDate: input.documentDate, dueDate: input.dueDate, description: input.description,
        supplierId: suppliers[input.supplierIndex]!.id, supplierInvoiceNumber: input.supplierInvoiceNumber ?? null,
        sourceInvoiceId: input.sourceInvoiceId ?? null, currencyId: currency.id, exchangeRate: '1',
        supplierAddress: 'المملكة العربية السعودية', notes: 'بيانات تجريبية لدورة المشتريات والذمم الدائنة',
        lines: [{ description: input.description, quantity: input.quantity, unitPrice: input.unitPrice, discountAmount: input.discountAmount ?? '0', debitAccountId: input.debitAccountId, costCenterId: input.costCenterId ?? null, taxRateId: vat15.id }],
      });
    }
    if (input.post !== false && invoice.accountingDocument.status === 'DRAFT') {
      await purchaseService.post(purchaseContext, invoice.id, invoice.accountingDocument.version, `demo-post-purchase-${invoice.id}`);
      invoice = await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { accountingDocument: true } });
    }
    return invoice;
  };

  const purchaseInvoice1 = await ensurePurchaseDocument({ documentType: 'PURCHASE_INVOICE', documentDate: '2026-05-10', dueDate: '2026-06-10', description: 'اشتراك الخدمات السحابية السنوي - فاتورة مورد تجريبية', supplierIndex: 1, supplierInvoiceNumber: 'CLOUD-2026-0510', quantity: '1', unitPrice: '12000', debitAccountId: operationsExpense.id, costCenterId: projects.id });
  await ensurePurchaseDocument({ documentType: 'PURCHASE_INVOICE', documentDate: '2026-07-01', dueDate: '2026-07-31', description: 'إيجار المكتب للربع الثالث - فاتورة مورد تجريبية', supplierIndex: 0, supplierInvoiceNumber: 'OFFICE-Q3-2026', quantity: '3', unitPrice: '7000', discountAmount: '500', debitAccountId: rentExpense.id, costCenterId: administration.id });
  await ensurePurchaseDocument({ documentType: 'PURCHASE_INVOICE', documentDate: '2026-08-06', dueDate: '2026-09-05', description: 'أعمال صيانة وتجهيز - فاتورة مورد تجريبية', supplierIndex: 2, supplierInvoiceNumber: 'MAINT-806', quantity: '1', unitPrice: '6750', debitAccountId: operationsExpense.id, costCenterId: projects.id });
  await ensurePurchaseDocument({ documentType: 'PURCHASE_INVOICE', documentDate: '2026-08-12', dueDate: '2026-09-12', description: 'مستلزمات مكتبية - مسودة فاتورة مورد', supplierIndex: 0, supplierInvoiceNumber: 'OFFICE-DRAFT-12', quantity: '10', unitPrice: '430', debitAccountId: operationsExpense.id, costCenterId: administration.id, post: false });
  await ensurePurchaseDocument({ documentType: 'PURCHASE_DEBIT_NOTE', documentDate: '2026-08-05', dueDate: '2026-08-05', description: 'تخفيض اشتراك الخدمات السحابية - إشعار مدين تجريبي', supplierIndex: 1, sourceInvoiceId: purchaseInvoice1.id, quantity: '1', unitPrice: '1000', debitAccountId: operationsExpense.id, costCenterId: projects.id });

  const createReceipt = async (input: { number: string; documentDate: string; amount: string; customerIndex: number; status?: 'DRAFT' | 'POSTED'; cashAccount?: typeof cashBox; counterAccountId?: bigint; targetJournalLineId?: bigint; description: string }) => {
    const existing = await prisma.accountingDocument.findUnique({ where: { companyId_documentType_documentNumber: { companyId: company.id, documentType: 'RECEIPT', documentNumber: input.number } } });
    if (existing) return existing;
    const customer = customers[input.customerIndex]!;
    const cashAccount = input.cashAccount ?? bankAccount;
    const period = periods[Number(input.documentDate.slice(5, 7)) - 1]!;
    const posted = input.status !== 'DRAFT';
    return prisma.accountingDocument.create({ data: {
      companyId: company.id, fiscalPeriodId: period.id, documentType: 'RECEIPT', documentNumber: input.number, documentDate: date(input.documentDate), description: input.description,
      status: posted ? 'POSTED' : 'DRAFT', createdBy: accountant.id, postedBy: posted ? admin.id : null, postedAt: posted ? postedAt : null,
      receipt: { create: { customerId: customer.id, counterAccountId: null, cashBankAccountId: cashAccount.id, paymentMethodId: cashAccount.accountType === 'CASH' ? cashMethod.id : transferMethod.id, currencyId: currency.id, exchangeRate: '1', amount: input.amount, baseAmount: input.amount, referenceNumber: cashAccount.accountType === 'BANK' ? `TR-${input.number}` : null, counterpartyNameSnapshot: customer.nameAr, counterpartyTaxLast4: customer.taxNumberLast4, counterpartyAddressSnapshot: 'المملكة العربية السعودية', notes: 'بيانات تجريبية', ...(input.targetJournalLineId ? { allocations: { create: { targetJournalLineId: input.targetJournalLineId, allocatedAmount: input.amount } } } : {}) } },
      ...(posted ? { journalEntries: { create: { entryNumber: 1, entryDate: date(input.documentDate), description: input.description, lines: { create: [
        { lineNumber: 1, accountId: cashAccount.ledgerAccountId, description: input.description, currencyId: currency.id, exchangeRate: '1', debitAmount: input.amount, creditAmount: '0', baseDebitAmount: input.amount, baseCreditAmount: '0' },
        { lineNumber: 2, accountId: receivables.id, customerId: customer.id, description: input.description, currencyId: currency.id, exchangeRate: '1', debitAmount: '0', creditAmount: input.amount, baseDebitAmount: '0', baseCreditAmount: input.amount },
      ] } } } } : {}),
    } });
  };
  await createReceipt({ number: 'RV-00001', documentDate: '2026-06-18', amount: '28000', customerIndex: 0, description: 'دفعة مشروع التحول الرقمي' });
  await createReceipt({ number: 'RV-00002', documentDate: '2026-07-12', amount: '18500', customerIndex: 1, cashAccount: cashBox, description: 'تحصيل خدمات استشارية' });
  await createReceipt({ number: 'RV-00003', documentDate: '2026-08-05', amount: '42000', customerIndex: 2, description: 'دفعة عقد الخدمات السنوي' });
  await createReceipt({ number: 'RV-00004', documentDate: '2026-08-11', amount: '9750', customerIndex: 0, status: 'DRAFT', description: 'دفعة تحت المراجعة' });
  await createReceipt({ number: 'RV-00005', documentDate: '2026-05-15', amount: '8000', customerIndex: 0, targetJournalLineId: salesInvoice1.arJournalLineId!, description: 'تحصيل جزئي مرتبط بالفاتورة السنوية' });

  const createPayment = async (input: { number: string; documentDate: string; amount: string; supplierIndex: number; expenseAccountId: bigint; costCenterId: bigint; status?: 'DRAFT' | 'POSTED'; targetJournalLineId?: bigint; description: string }) => {
    const existing = await prisma.accountingDocument.findUnique({ where: { companyId_documentType_documentNumber: { companyId: company.id, documentType: 'PAYMENT', documentNumber: input.number } } });
    if (existing) return existing;
    const supplier = suppliers[input.supplierIndex]!;
    const period = periods[Number(input.documentDate.slice(5, 7)) - 1]!;
    const posted = input.status !== 'DRAFT';
    return prisma.accountingDocument.create({ data: {
      companyId: company.id, fiscalPeriodId: period.id, documentType: 'PAYMENT', documentNumber: input.number, documentDate: date(input.documentDate), description: input.description,
      status: posted ? 'POSTED' : 'DRAFT', createdBy: accountant.id, postedBy: posted ? admin.id : null, postedAt: posted ? postedAt : null,
      payment: { create: { supplierId: supplier.id, counterAccountId: null, cashBankAccountId: bankAccount.id, paymentMethodId: transferMethod.id, currencyId: currency.id, exchangeRate: '1', amount: input.amount, baseAmount: input.amount, referenceNumber: `PAY-${input.number}`, counterpartyNameSnapshot: supplier.nameAr, counterpartyTaxLast4: supplier.taxNumberLast4, counterpartyAddressSnapshot: 'المملكة العربية السعودية', notes: 'بيانات تجريبية', ...(input.targetJournalLineId ? { allocations: { create: { targetJournalLineId: input.targetJournalLineId, allocatedAmount: input.amount } } } : {}) } },
      ...(posted ? { journalEntries: { create: { entryNumber: 1, entryDate: date(input.documentDate), description: input.description, lines: { create: [
        { lineNumber: 1, accountId: payables.id, supplierId: supplier.id, costCenterId: input.costCenterId, description: input.description, currencyId: currency.id, exchangeRate: '1', debitAmount: input.amount, creditAmount: '0', baseDebitAmount: input.amount, baseCreditAmount: '0' },
        { lineNumber: 2, accountId: bank.id, description: input.description, currencyId: currency.id, exchangeRate: '1', debitAmount: '0', creditAmount: input.amount, baseDebitAmount: '0', baseCreditAmount: input.amount },
      ] } } } } : {}),
    } });
  };
  await createPayment({ number: 'PV-00001', documentDate: '2026-06-25', amount: '12000', supplierIndex: 1, expenseAccountId: operationsExpense.id, costCenterId: projects.id, description: 'اشتراك خدمات سحابية' });
  await createPayment({ number: 'PV-00002', documentDate: '2026-07-01', amount: '22000', supplierIndex: 0, expenseAccountId: rentExpense.id, costCenterId: administration.id, description: 'إيجار المكتب للربع الثالث' });
  await createPayment({ number: 'PV-00003', documentDate: '2026-08-08', amount: '6750', supplierIndex: 2, expenseAccountId: operationsExpense.id, costCenterId: projects.id, description: 'أعمال صيانة وتجهيز' });
  await createPayment({ number: 'PV-00004', documentDate: '2026-08-11', amount: '4300', supplierIndex: 0, expenseAccountId: operationsExpense.id, costCenterId: administration.id, status: 'DRAFT', description: 'شراء مستلزمات مكتبية - مسودة' });
  await createPayment({ number: 'PV-00005', documentDate: '2026-05-20', amount: '5000', supplierIndex: 1, expenseAccountId: operationsExpense.id, costCenterId: projects.id, targetJournalLineId: purchaseInvoice1.apJournalLineId!, description: 'سداد جزئي مرتبط بفاتورة الخدمات السحابية' });

  const auditRows = [
    ['DEMO_DATA_SEEDED', 'Company', company.id.toString(), { note: 'تم تحميل البيانات التجريبية الأساسية' }],
    ['USER_ROLE_ASSIGNED', 'User', accountant.id.toString(), { role: 'ACCOUNTANT' }],
    ['FISCAL_YEAR_CREATED', 'FiscalYear', fiscalYear.id.toString(), { year: 2026 }],
    ['ACCOUNT_TREE_CREATED', 'Account', assets.id.toString(), { accounts: 18 }],
  ] as const;
  for (const [action, entityType, entityId, details] of auditRows) {
    const existing = await prisma.auditLog.findFirst({ where: { companyId: company.id, action, entityType, entityId } });
    if (!existing) await prisma.auditLog.create({ data: { companyId: company.id, actorUserId: admin.id, action, entityType, entityId, details } });
  }

  const securityRows = [
    { eventType: 'LOGIN_SUCCEEDED', severity: 'INFO' as const, userId: admin.id, emailSnapshot: admin.emailNormalized, ipAddress: '127.0.0.1', details: { demo: true, note: 'تسجيل دخول ناجح تجريبي' } },
    { eventType: 'LOGIN_FAILED', severity: 'WARNING' as const, userId: accountant.id, emailSnapshot: accountant.emailNormalized, ipAddress: '192.0.2.20', details: { demo: true, attempts: 2 } },
    { eventType: 'ACCOUNT_LOCKED', severity: 'CRITICAL' as const, userId: reviewer.id, emailSnapshot: reviewer.emailNormalized, ipAddress: '198.51.100.15', details: { demo: true, attempts: 5, note: 'تنبيه تجريبي غير مقر به' } },
  ];
  for (const row of securityRows) {
    const existing = await prisma.securityEvent.findFirst({ where: { companyId: company.id, eventType: row.eventType, userId: row.userId, ipAddress: row.ipAddress } });
    if (!existing) await prisma.securityEvent.create({ data: { companyId: company.id, userAgent: 'MCAP Demo Seed', ...row } });
  }

  console.log('Demo seed completed: accounts, fiscal periods, parties, treasury, documents, journals, users, audit logs, and security events are ready.');
} finally {
  await prisma.$disconnect();
}
