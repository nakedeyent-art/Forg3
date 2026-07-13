export type AuthProvider = 'google' | 'apple' | 'email' | 'demo';
export type PublicStatus = 'sent' | 'signed' | 'voided' | 'expired';
export type PlanId = 'forg3_pay_per_signature_annual' | 'forg3_pro_monthly' | 'forg3_business_monthly';
export type BillingProvider = 'apple_app_store' | 'google_play' | 'stripe' | 'demo';
export type SubscriptionStatus = 'inactive' | 'active' | 'past_due' | 'canceled' | 'pending_verification';
export type BillingModel = 'flat' | 'metered';
export type AccountAccessKind = 'inactive' | 'paid' | 'highest_tier' | 'creator_unlimited';
export type SignerStatus = 'sent' | 'signed';
export type EmailDeliveryStatus = 'logged' | 'provider_required' | 'sent' | 'failed';
export type EmailDeliveryKind = 'signing_link' | 'reminder' | 'signed_copy';
export type DeliveryChannel = 'email';
export type CompanyRole = 'owner' | 'admin' | 'sender' | 'viewer';

export interface SignatureFieldPlacement {
  page: 'last';
  xPercent: number;
  yPercent: number;
  widthPercent: number;
}

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
  signerCount: number;
  signedSignerCount: number;
  signers: Array<{
    id: string;
    name: string;
    email: string;
    phone?: string;
    role?: string;
    status: SignerStatus;
    signedAt?: string;
  }>;
  signatureField?: SignatureFieldPlacement;
  identityVerificationRequired: boolean;
  authProvider: AuthProvider;
  createdAt: string;
  expiresAt: string;
  status: PublicStatus;
  signedAt?: string;
  signedDocumentHash?: string;
  linkAvailable: boolean;
}

export interface SignerInboxDocument {
  id: string;
  title: string;
  fileName: string;
  documentHash: string;
  ownerName: string;
  ownerEmail: string;
  signerId: string;
  signerName: string;
  signerEmail: string;
  signerRole?: string;
  signerStatus: SignerStatus;
  documentStatus: PublicStatus;
  expiresAt: string;
  signedAt?: string;
  canSign: boolean;
}

export interface SubscriptionPlan {
  id: PlanId;
  name: string;
  priceLabel: string;
  cadence: string;
  billingModel: BillingModel;
  packetLimit: number | null;
  seatLimit: number;
  unlimitedAccess: boolean;
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
  accessKind: AccountAccessKind;
  unlimitedAccess: boolean;
  creatorAccess: boolean;
  packetLimit: number | null;
}

export interface PublicSigningDocument {
  id: string;
  title: string;
  fileName: string;
  documentHash: string;
  signerId: string;
  signerName: string;
  signerEmail: string;
  signerRole?: string;
  ownerName: string;
  expiresAt: string;
  identityVerificationRequired: boolean;
}

export interface CreateDocumentSignerInput {
  name: string;
  email: string;
  role?: string;
}

export interface CreateDocumentInput {
  title: string;
  fileName: string;
  fileType: string;
  fileDataUrl: string;
  signerName: string;
  signerEmail: string;
  signers?: CreateDocumentSignerInput[];
  signatureField?: SignatureFieldPlacement;
  identityVerificationRequired?: boolean;
  authProvider: AuthProvider;
  expiresInHours: number;
}

export interface SigningLinkDetail {
  signerId: string;
  signerName: string;
  signerEmail: string;
  signingPath: string;
  signingUrl?: string;
}

export interface SigningLinkResponse {
  document: DocumentSummary;
  signingPath?: string;
  signingLinks: SigningLinkDetail[];
  deliveries?: EmailDelivery[];
}

export interface SignedDocumentResponse {
  document: DocumentSummary;
  fileName: string;
  signedFileDataUrl?: string;
  signedDocumentHash?: string;
  pendingSignerCount?: number;
}

export interface SubscriptionResponse {
  entitlement: SubscriptionEntitlement;
  plans: SubscriptionPlan[];
}

export interface EmailDelivery {
  id: string;
  ownerEmail: string;
  documentId: string;
  signerId?: string;
  senderEmail?: string;
  providerSenderEmail?: string;
  replyToEmail?: string;
  toEmail: string;
  toName: string;
  channel: DeliveryChannel;
  kind: EmailDeliveryKind;
  status: EmailDeliveryStatus;
  subject: string;
  body: string;
  createdAt: string;
  provider?: string;
  providerMessageId?: string;
  error?: string;
}

export interface DocumentTemplate {
  id: string;
  ownerEmail: string;
  name: string;
  title: string;
  signerRoles: Array<{ name: string; email: string; role?: string; order: number }>;
  expiresInHours: number;
  signatureField: SignatureFieldPlacement;
  identityVerificationRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyMember {
  id: string;
  email: string;
  name: string;
  role: CompanyRole;
  status: 'active' | 'invited';
  invitedAt: string;
}

export interface CompanyProfile {
  ownerEmail: string;
  companyName: string;
  members: CompanyMember[];
  updatedAt: string;
}

export interface FeatureStatus {
  emailDelivery: {
    mode: 'local_outbox' | 'provider';
    configured: boolean;
  };
  identityVerification: {
    mode: 'self_attestation' | 'provider';
    configured: boolean;
  };
  receiptVerification: {
    mode: 'mock' | 'provider_required';
    configured: boolean;
  };
  objectStorage: {
    mode: 'local_object_store' | 'provider';
    configured: boolean;
  };
  certificateAuthoritySignatures: {
    mode: 'provider_required';
    configured: boolean;
  };
}

export interface OwnerSessionSummary {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt?: string;
  deviceName?: string;
  authMethod: 'email_code' | 'dev' | 'firebase';
  active: boolean;
  current: boolean;
}

export interface TrustedDeviceSummary {
  id: string;
  deviceName: string;
  trustedAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface TotpStatus {
  enabled: boolean;
  pending: boolean;
  activatedAt?: string;
}

export interface AuditEventSummary {
  id: string;
  sequence: number;
  ownerEmail: string;
  actorEmail: string;
  type: string;
  message: string;
  documentId?: string;
  signerId?: string;
  createdAt: string;
  previousHash: string;
  hash: string;
}
