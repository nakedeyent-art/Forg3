export type DocumentStatus = 'sent' | 'signed' | 'voided';
export type PublicStatus = DocumentStatus | 'expired';
export type AuthProvider = 'google' | 'apple' | 'demo';
export type PlanId = 'forg3_pay_per_signature_annual' | 'forg3_pro_monthly' | 'forg3_business_monthly';
export type BillingProvider = 'apple_app_store' | 'google_play' | 'stripe' | 'demo';
export type SubscriptionStatus = 'inactive' | 'active' | 'past_due' | 'canceled' | 'pending_verification';
export type BillingModel = 'flat' | 'metered';
export type SignatureChargeStatus = 'metered' | 'waived';

export interface SigningDocument {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  fileDataUrl: string;
  documentHash: string;
  ownerName: string;
  ownerEmail: string;
  signerName: string;
  signerEmail: string;
  authProvider: AuthProvider;
  createdAt: string;
  expiresAt: string;
  status: DocumentStatus;
  tokenHash: string | null;
  signedAt?: string;
  signedFileDataUrl?: string;
  signedDocumentHash?: string;
  signatureDataUrl?: string;
  signerNameConfirmation?: string;
  consentText?: string;
  voidedAt?: string;
}

export interface DocumentSummary {
  id: string;
  title: string;
  fileName: string;
  documentHash: string;
  ownerName: string;
  ownerEmail: string;
  signerName: string;
  signerEmail: string;
  authProvider: AuthProvider;
  createdAt: string;
  expiresAt: string;
  status: PublicStatus;
  signedAt?: string;
  signedDocumentHash?: string;
  linkAvailable: boolean;
}

export interface SubscriptionPlan {
  id: PlanId;
  name: string;
  priceLabel: string;
  cadence: string;
  billingModel: BillingModel;
  packetLimit: number | null;
  seatLimit: number;
  appleProductId: string;
  googleProductId: string;
  usagePriceCents?: number;
  usagePriceLabel?: string;
  billingNote?: string;
  features: string[];
}

export interface AccountSubscription {
  ownerEmail: string;
  ownerName: string;
  planId: PlanId;
  billingProvider: BillingProvider;
  status: SubscriptionStatus;
  startedAt: string;
  renewsAt: string;
  updatedAt: string;
  providerTransactionId?: string;
  canceledAt?: string;
}

export interface SubscriptionUsageSummary {
  signatureCount: number;
  totalUsageCents: number;
  totalUsageLabel: string;
}

export interface SubscriptionEntitlement {
  active: boolean;
  status: SubscriptionStatus;
  plan: SubscriptionPlan | null;
  subscription: AccountSubscription | null;
  usageSummary?: SubscriptionUsageSummary;
  reason?: string;
}

export interface SignatureCharge {
  id: string;
  ownerEmail: string;
  documentId: string;
  signerEmail: string;
  planId: PlanId;
  amountCents: number;
  status: SignatureChargeStatus;
  createdAt: string;
}

export interface StoreShape {
  documents: SigningDocument[];
  subscriptions: AccountSubscription[];
  signatureCharges: SignatureCharge[];
}
