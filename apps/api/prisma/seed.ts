import 'dotenv/config';
import { hash } from 'argon2';
import { createDatabase } from '../src/database.js';
import { currencyDefinitions } from '../src/platform/reference-data.js';
import { paymentMethodDefinitions } from '../src/treasury/treasury-reference-data.js';

const databaseUrl = process.env.DATABASE_URL;
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (!adminPassword || adminPassword.length < 12) throw new Error('SEED_ADMIN_PASSWORD must contain at least 12 characters');

const prisma = createDatabase(databaseUrl);

try {
  for (const definition of currencyDefinitions) {
    await prisma.currency.upsert({
      where: { scopeKey_code: { scopeKey: 'GLOBAL', code: definition.code } },
      update: { nameAr: definition.nameAr, decimals: definition.decimals, isActive: true, scope: 'GLOBAL', ownerCompanyId: null },
      create: { ...definition, scope: 'GLOBAL', scopeKey: 'GLOBAL' },
    });
  }
  const currency = await prisma.currency.findUniqueOrThrow({ where: { scopeKey_code: { scopeKey: 'GLOBAL', code: 'SAR' } } });
  const existingOrganization = await prisma.organization.findFirst({ where: { name: 'المؤسسة التجريبية' } });
  const organization = existingOrganization
    ? await prisma.organization.update({ where: { id: existingOrganization.id }, data: { code: 'MCAP-DEVELOPMENT' } })
    : await prisma.organization.create({ data: { code: 'MCAP-DEVELOPMENT', name: 'المؤسسة التجريبية' } });
  const existingCompany = await prisma.company.findFirst({ where: { organizationId: organization.id, name: 'الشركة التجريبية' } });
  const company = existingCompany
    ? await prisma.company.update({ where: { id: existingCompany.id }, data: { code: 'MCAP-DEMO' } })
    : await prisma.company.create({ data: { organizationId: organization.id, baseCurrencyId: currency.id, code: 'MCAP-DEMO', name: 'الشركة التجريبية', timezone: 'Asia/Riyadh' } });
  await prisma.companyCurrency.upsert({
    where: { companyId_currencyId: { companyId: company.id, currencyId: currency.id } },
    update: { isActive: true },
    create: { companyId: company.id, currencyId: currency.id },
  });
  const user = await prisma.user.upsert({
    where: { emailNormalized: 'admin@mcap.local' },
    update: { passwordHash: await hash(adminPassword), displayName: 'مدير النظام', isActive: true },
    create: { emailNormalized: 'admin@mcap.local', passwordHash: await hash(adminPassword), displayName: 'مدير النظام' },
  });
  await prisma.userCompany.upsert({
    where: { userId_companyId: { userId: user.id, companyId: company.id } },
    update: { isActive: true },
    create: { userId: user.id, companyId: company.id },
  });
  const administratorRole = await prisma.role.upsert({
    where: { companyId_code: { companyId: company.id, code: 'ADMINISTRATOR' } },
    update: { nameAr: 'مدير النظام', isActive: true, isSystemRole: true },
    create: { companyId: company.id, code: 'ADMINISTRATOR', nameAr: 'مدير النظام', isSystemRole: true },
  });
  const permissionDefinitions = [
    ['audit_logs.view', 'audit_logs', 'عرض سجل التدقيق'],
    ['audit_logs.export', 'audit_logs', 'تصدير سجل التدقيق'],
    ['security_events.view', 'security', 'عرض سجل الأمان والتنبيهات'],
    ['security_events.acknowledge', 'security', 'الإقرار بتنبيهات سجل الأمان'],
    ['receipts.print', 'receipts', 'طباعة وأرشفة سندات القبض'],
    ['payments.print', 'payments', 'طباعة وأرشفة سندات الصرف'],
    ['manual_journals.print', 'manual_journals', 'طباعة وأرشفة القيود اليدوية'],
    ['companies.view', 'companies', 'عرض بيانات الشركة'],
    ['companies.update', 'companies', 'تعديل بيانات الشركة'],
    ['settings.manage', 'settings', 'إدارة إعدادات الشركة'],
    ['currencies.view', 'currencies', 'عرض العملات المفعلة وأسعار الصرف'],
    ['currencies.manage', 'currencies', 'إدارة عملات الشركة وأسعار الصرف'],
    ['currencies.create', 'currencies', 'إنشاء عملة مخصصة للشركة'],
    ['auth.sessions.view', 'auth', 'عرض جلسات المستخدم'],
    ['auth.sessions.revoke', 'auth', 'إلغاء جلسة مستخدم'],
    ['users.view', 'users', 'عرض المستخدمين'],
    ['users.create', 'users', 'إنشاء مستخدم'],
    ['users.update', 'users', 'تعديل مستخدم'],
    ['users.disable', 'users', 'تعطيل مستخدم'],
    ['roles.view', 'roles', 'عرض الأدوار والصلاحيات'],
    ['roles.manage', 'roles', 'إدارة أدوار المستخدمين'],
    ['fiscal_periods.view', 'fiscal', 'عرض السنوات والفترات المالية'],
    ['fiscal_periods.manage', 'fiscal', 'إدارة السنوات والفترات المالية'],
    ['fiscal_periods.close', 'fiscal', 'إغلاق فترة مالية'],
    ['fiscal_periods.reopen', 'fiscal', 'إعادة فتح فترة مالية'],
    ['accounts.view', 'accounts', 'عرض دليل الحسابات'],
    ['accounts.create', 'accounts', 'إنشاء حساب'],
    ['accounts.update', 'accounts', 'تعديل حساب'],
    ['accounts.deactivate', 'accounts', 'تعطيل حساب'],
    ['accounts.delete', 'accounts', 'حذف حساب غير مستخدم'],
    ['accounts.template.apply', 'accounts', 'تطبيق قالب دليل الحسابات'],
    ['cost_centers.manage', 'cost_centers', 'إدارة مراكز التكلفة'],
    ['manual_journals.view', 'manual_journals', 'عرض القيود اليدوية'],
    ['manual_journals.create', 'manual_journals', 'إنشاء القيود اليدوية'],
    ['manual_journals.update', 'manual_journals', 'تعديل القيود اليدوية'],
    ['manual_journals.post', 'manual_journals', 'ترحيل القيود اليدوية'],
    ['manual_journals.cancel', 'manual_journals', 'إلغاء القيود اليدوية'],
    ['manual_journals.reverse', 'manual_journals', 'عكس القيود اليدوية'],
    ['customers.view', 'customers', 'عرض العملاء'],
    ['customers.manage', 'customers', 'إدارة العملاء'],
    ['cash_bank_accounts.view', 'treasury', 'عرض الصناديق والحسابات البنكية'],
    ['cash_bank_accounts.manage', 'treasury', 'إدارة الصناديق والحسابات البنكية'],
    ['receipts.view', 'receipts', 'عرض سندات القبض'],
    ['receipts.create', 'receipts', 'إنشاء سندات القبض'],
    ['receipts.update', 'receipts', 'تعديل سندات القبض'],
    ['receipts.post', 'receipts', 'ترحيل سندات القبض'],
    ['receipts.cancel', 'receipts', 'إلغاء سندات القبض'],
    ['receipts.reverse', 'receipts', 'عكس سندات القبض'],
    ['suppliers.view', 'suppliers', 'عرض الموردين'],
    ['suppliers.manage', 'suppliers', 'إدارة الموردين'],
    ['payments.view', 'payments', 'عرض سندات الصرف'],
    ['payments.create', 'payments', 'إنشاء سندات الصرف'],
    ['payments.update', 'payments', 'تعديل سندات الصرف'],
    ['payments.post', 'payments', 'ترحيل سندات الصرف'],
    ['payments.cancel', 'payments', 'إلغاء سندات الصرف'],
    ['payments.reverse', 'payments', 'عكس سندات الصرف'],
    ['dashboard.view', 'dashboard', 'عرض لوحة التحكم المالية'],
    ['reports.trial_balance.view', 'reports', 'عرض تقرير ميزان المراجعة'],
    ['reports.financial_position.view', 'reports', 'عرض تقرير المركز المالي'],
    ['reports.income_statement.view', 'reports', 'عرض تقرير قائمة الدخل'],
    ['reports.ledger.view', 'reports', 'عرض تقرير الأستاذ العام وكشف الحساب'],
    ['reports.financial_statements.export', 'reports', 'تصدير القوائم المالية'],
    ['reports.journal.view', 'reports', 'عرض تقرير دفتر اليومية'],
    ['reports.journal.export', 'reports', 'تصدير تقرير دفتر اليومية'],
    ['sales_invoices.view', 'sales_invoices', 'عرض فواتير المبيعات والإشعارات الدائنة'],
    ['sales_invoices.create', 'sales_invoices', 'إنشاء فواتير المبيعات والإشعارات الدائنة'],
    ['sales_invoices.update', 'sales_invoices', 'تعديل فواتير المبيعات والإشعارات الدائنة'],
    ['sales_invoices.post', 'sales_invoices', 'ترحيل فواتير المبيعات والإشعارات الدائنة'],
    ['sales_invoices.cancel', 'sales_invoices', 'إلغاء مسودات فواتير المبيعات'],
    ['sales_invoices.reverse', 'sales_invoices', 'عكس فواتير المبيعات المرحلة'],
    ['tax_rates.manage', 'sales_invoices', 'إدارة نسب ضريبة المبيعات'],
    ['reports.receivables.view', 'reports', 'عرض أرصدة العملاء وأعمار الديون'],
    ['purchase_invoices.view', 'purchase_invoices', 'عرض فواتير المشتريات والإشعارات المدينة'],
    ['purchase_invoices.create', 'purchase_invoices', 'إنشاء فواتير المشتريات والإشعارات المدينة'],
    ['purchase_invoices.update', 'purchase_invoices', 'تعديل فواتير المشتريات والإشعارات المدينة'],
    ['purchase_invoices.post', 'purchase_invoices', 'ترحيل فواتير المشتريات والإشعارات المدينة'],
    ['purchase_invoices.cancel', 'purchase_invoices', 'إلغاء مسودات فواتير المشتريات'],
    ['purchase_invoices.reverse', 'purchase_invoices', 'عكس فواتير المشتريات المرحلة'],
    ['purchase_invoices.print', 'purchase_invoices', 'طباعة وأرشفة فواتير المشتريات والإشعارات المدينة'],
    ['input_tax_rates.manage', 'purchase_invoices', 'إدارة حساب ضريبة المدخلات'],
    ['reports.payables.view', 'reports', 'عرض أرصدة الموردين وأعمار الديون'],
    ['data_imports.view', 'data_imports', 'عرض قوالب ومعاينات وسجل استيراد البيانات'],
    ['data_imports.execute', 'data_imports', 'تنفيذ استيراد البيانات بعد المعاينة'],
  ] as const;
  for (const [code, module, descriptionAr] of permissionDefinitions) {
    const permission = await prisma.permission.upsert({
      where: { code },
      update: { module, descriptionAr },
      create: { code, module, descriptionAr },
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: administratorRole.id, permissionId: permission.id } },
      update: {},
      create: { roleId: administratorRole.id, permissionId: permission.id },
    });
  }
  await prisma.userCompanyRole.upsert({
    where: { userId_companyId_roleId: { userId: user.id, companyId: company.id, roleId: administratorRole.id } },
    update: {},
    create: { userId: user.id, companyId: company.id, roleId: administratorRole.id },
  });
  const accountTypes = [
    { code: 'ASSET', nameAr: 'الأصول', class: 'ASSET', normalBalance: 'DEBIT', statementSection: 'BALANCE_SHEET' },
    { code: 'LIABILITY', nameAr: 'الالتزامات', class: 'LIABILITY', normalBalance: 'CREDIT', statementSection: 'BALANCE_SHEET' },
    { code: 'EQUITY', nameAr: 'حقوق الملكية', class: 'EQUITY', normalBalance: 'CREDIT', statementSection: 'BALANCE_SHEET' },
    { code: 'REVENUE', nameAr: 'الإيرادات', class: 'REVENUE', normalBalance: 'CREDIT', statementSection: 'INCOME_STATEMENT' },
    { code: 'EXPENSE', nameAr: 'المصروفات', class: 'EXPENSE', normalBalance: 'DEBIT', statementSection: 'INCOME_STATEMENT' },
  ] as const;
  for (const accountType of accountTypes) {
    await prisma.accountType.upsert({ where: { code: accountType.code }, update: accountType, create: accountType });
  }
  for (const method of paymentMethodDefinitions) {
    await prisma.paymentMethod.upsert({ where: { code: method.code }, update: { ...method, isActive: true, scope: 'GLOBAL', companyId: null }, create: { ...method, scope: 'GLOBAL' } });
  }
  console.log('Development seed completed.');
} finally {
  await prisma.$disconnect();
}
