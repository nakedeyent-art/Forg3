import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BillingProvider, PlanId } from './types';

export interface NativeBillingPurchase {
  providerReceipt: string;
  productId?: string;
  transactionId?: string;
  signedTransactionInfo?: string;
  purchaseToken?: string;
}

interface NativeBillingPlugin {
  purchase(input: {
    planId: PlanId;
    billingProvider: Exclude<BillingProvider, 'demo' | 'stripe'>;
    productId: string;
  }): Promise<NativeBillingPurchase>;
  restorePurchases(input: {
    billingProvider: Exclude<BillingProvider, 'demo' | 'stripe'>;
  }): Promise<{ purchases: NativeBillingPurchase[] }>;
  manageSubscriptions(input?: {
    productId?: string;
  }): Promise<{ opened: boolean }>;
}

const Forg3Billing = registerPlugin<NativeBillingPlugin>('Forg3Billing');

export function isNativeStoreBillingAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Forg3Billing');
}

export async function purchaseNativeSubscription(input: {
  planId: PlanId;
  billingProvider: Exclude<BillingProvider, 'demo' | 'stripe'>;
  productId: string;
}) {
  ensureNativeBillingAvailable();
  return Forg3Billing.purchase(input);
}

export async function restoreNativePurchases(input: {
  billingProvider: Exclude<BillingProvider, 'demo' | 'stripe'>;
}) {
  ensureNativeBillingAvailable();
  return Forg3Billing.restorePurchases(input);
}

export async function manageNativeSubscriptions(input?: { productId?: string }) {
  ensureNativeBillingAvailable();
  return Forg3Billing.manageSubscriptions(input);
}

function ensureNativeBillingAvailable() {
  if (!isNativeStoreBillingAvailable()) {
    throw new Error('Native billing is not available in this build.');
  }
}
