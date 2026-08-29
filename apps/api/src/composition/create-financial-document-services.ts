import type { PrismaClient } from "@prisma/client";
import {
  RealizedFxAccountService,
  type RealizedFxAccountPort,
} from "../core-accounting/realized-fx-account-service.js";
import {
  InventoryCatalogService,
  type InventoryInvoiceCatalogPort,
} from "../inventory/inventory-catalog-service.js";
import {
  InventoryMovementService,
  type InventoryInvoiceStockPort,
} from "../inventory/inventory-movement-service.js";
import {
  PayableItemService,
  type PayableInvoicePort,
  type PayableSettlementPort,
} from "../payables/payable-item-service.js";
import { PaymentService } from "../payments/payment-service.js";
import { PurchaseInvoiceService } from "../purchases/purchase-invoice-service.js";
import { ReceiptService } from "../receipts/receipt-service.js";
import {
  ReceivableItemService,
  type ReceivableInvoicePort,
  type ReceivableSettlementPort,
} from "../receivables/receivable-item-service.js";
import { SalesInvoiceService } from "../sales/sales-invoice-service.js";
import type { TaxQuotePort } from "../tax/tax-service.js";
import type { TreasuryInstrumentPort } from "../treasury/treasury-service.js";

export type FinancialDocumentCompositionDependencies = {
  taxes: TaxQuotePort;
  inventory: InventoryInvoiceCatalogPort;
  stock: InventoryInvoiceStockPort;
  treasury: TreasuryInstrumentPort;
};

export type SalesInvoiceCompositionDependencies = {
  taxes: TaxQuotePort;
  inventory?: InventoryInvoiceCatalogPort;
  stock?: InventoryInvoiceStockPort;
  receivables?: ReceivableInvoicePort;
};

export type PurchaseInvoiceCompositionDependencies = {
  taxes: TaxQuotePort;
  inventory?: InventoryInvoiceCatalogPort;
  stock?: InventoryInvoiceStockPort;
  payables?: PayableInvoicePort;
};

export type ReceiptCompositionDependencies = {
  treasury: TreasuryInstrumentPort;
  fxAccounts?: RealizedFxAccountPort;
  receivables?: ReceivableSettlementPort;
};

export type PaymentCompositionDependencies = {
  treasury: TreasuryInstrumentPort;
  fxAccounts?: RealizedFxAccountPort;
  payables?: PayableSettlementPort;
};

export function createSalesInvoiceService(
  prisma: PrismaClient,
  dependencies: SalesInvoiceCompositionDependencies,
) {
  return new SalesInvoiceService(prisma, {
    taxes: dependencies.taxes,
    inventory: dependencies.inventory ?? new InventoryCatalogService(prisma),
    stock: dependencies.stock ?? new InventoryMovementService(prisma),
    receivables: dependencies.receivables ?? new ReceivableItemService(),
  });
}

export function createPurchaseInvoiceService(
  prisma: PrismaClient,
  dependencies: PurchaseInvoiceCompositionDependencies,
) {
  return new PurchaseInvoiceService(prisma, {
    taxes: dependencies.taxes,
    inventory: dependencies.inventory ?? new InventoryCatalogService(prisma),
    stock: dependencies.stock ?? new InventoryMovementService(prisma),
    payables: dependencies.payables ?? new PayableItemService(),
  });
}

export function createReceiptService(
  prisma: PrismaClient,
  dependencies: ReceiptCompositionDependencies,
) {
  return new ReceiptService(prisma, {
    treasury: dependencies.treasury,
    fxAccounts: dependencies.fxAccounts ?? new RealizedFxAccountService(),
    receivables: dependencies.receivables ?? new ReceivableItemService(),
  });
}

export function createPaymentService(
  prisma: PrismaClient,
  dependencies: PaymentCompositionDependencies,
) {
  return new PaymentService(prisma, {
    treasury: dependencies.treasury,
    fxAccounts: dependencies.fxAccounts ?? new RealizedFxAccountService(),
    payables: dependencies.payables ?? new PayableItemService(),
  });
}

export function createFinancialDocumentServices(
  prisma: PrismaClient,
  dependencies: FinancialDocumentCompositionDependencies,
) {
  const receivables = new ReceivableItemService();
  const payables = new PayableItemService();
  const fxAccounts = new RealizedFxAccountService();

  return {
    salesInvoices: new SalesInvoiceService(prisma, {
      taxes: dependencies.taxes,
      inventory: dependencies.inventory,
      stock: dependencies.stock,
      receivables,
    }),
    purchaseInvoices: new PurchaseInvoiceService(prisma, {
      taxes: dependencies.taxes,
      inventory: dependencies.inventory,
      stock: dependencies.stock,
      payables,
    }),
    receipts: new ReceiptService(prisma, {
      treasury: dependencies.treasury,
      fxAccounts,
      receivables,
    }),
    payments: new PaymentService(prisma, {
      treasury: dependencies.treasury,
      fxAccounts,
      payables,
    }),
  };
}
