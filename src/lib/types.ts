export type AuthProvider = 'google' | 'apple' | 'demo';
export type PublicStatus = 'sent' | 'signed' | 'voided' | 'expired';
export type PlanId = 'forg3_pay_per_signature_annual' | 'forg3_pro_monthly' | 'forg3_business_monthly';
export type BillingProvider = 'apple_app_store' | 'google_play' | 'stripe' | 'demo';
export type SubscriptionStatus = 'inactive' | 'active' | 'past_due' | 'canceled' | 'pending_verification';
export type BillingModel = 'flat' | 'metered';

export interface AuthSession {
  provider: AuthProvider;
  mode: 'firebase' | 'demo';
  uid: string;
  name: string;
  email: string;
  idToken?: string;
  expiresAt?: number;
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

export interface PublicSigningDocument {
  id: string;
  title: string;
  fileName: string;
  documentHash: string;
  signerName: string;
  signerEmail: string;
  ownerName: string;
  expiresAt: string;
}

export interface CreateDocumentInput {
  title: string;
  fileName: string;
  fileType: string;
  fileDataUrl: string;
  signerName: string;
  signerEmail: string;
  authProvider: AuthProvider;
  expiresInHours: number;
}

export interface SigningLinkResponse {
  document: DocumentSummary;
  signingPath: string;
}

export interface SignedDocumentResponse {
  document: DocumentSummary;
  fileName: string;
  signedFileDataUrl: string;
  signedDocumentHash: string;
}

export interface SubscriptionResponse {
  entitlement: SubscriptionEntitlement;
  plans: SubscriptionPlan[];
}
