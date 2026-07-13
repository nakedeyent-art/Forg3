export type DocumentStatus = 'sent' | 'signed' | 'voided';
export type PublicStatus = DocumentStatus | 'expired';
export type AuthProvider = 'google' | 'apple' | 'email' | 'demo';
export type PlanId = 'forg3_pay_per_signature_annual' | 'forg3_pro_monthly' | 'forg3_business_monthly';
export type BillingProvider = 'apple_app_store' | 'google_play' | 'stripe' | 'demo';
export type SubscriptionStatus = 'inactive' | 'active' | 'past_due' | 'canceled' | 'pending_verification';
export type BillingModel = 'flat' | 'metered';
export type AccountAccessKind = 'inactive' | 'paid' | 'highest_tier' | 'creator_unlimited';
export type SignatureChargeStatus = 'metered' | 'waived';
export type SignerStatus = 'sent' | 'signed';
export type EmailDeliveryStatus = 'logged' | 'provider_required' | 'sent' | 'failed';
export type EmailDeliveryKind = 'signing_link' | 'reminder' | 'signed_copy';
export type DeliveryChannel = 'email';
export type CompanyRole = 'owner' | 'admin' | 'sender' | 'viewer';
export type MfaChallengeStatus = 'pending' | 'verified' | 'expired' | 'locked';

export interface SignatureFieldPlacement {
  page: 'last';
  xPercent: number;
  yPercent: number;
  widthPercent: number;
}

export interface SignerIdentityVerification {
  status: 'not_required' | 'self_attested' | 'provider_required';
  method: 'none' | 'self_attestation' | 'provider';
  verifiedAt?: string;
  signerEmailConfirmation?: string;
  providerReference?: string;
}

export interface DocumentSigner {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role?: string;
  order: number;
  status: SignerStatus;
  tokenHash: string | null;
  expiresAt: string;
  signedAt?: string;
  signatureDataUrl?: string;
  signerNameConfirmation?: string;
  consentText?: string;
  identityVerification?: SignerIdentityVerification;
}

export interface SigningDocument {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  fileDataUrl?: string;
  fileObjectKey?: string;
  documentHash: string;
  ownerName: string;
  ownerEmail: string;
  signerName: string;
  signerEmail: string;
  signers?: DocumentSigner[];
  signatureField?: SignatureFieldPlacement;
  identityVerificationRequired?: boolean;
  authProvider: AuthProvider;
  createdAt: string;
  expiresAt: string;
  status: DocumentStatus;
  tokenHash: string | null;
  signedAt?: string;
  signedFileDataUrl?: string;
  signedFileObjectKey?: string;
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

export interface TrustedDevice {
  id: string;
  ownerEmail: string;
  deviceIdHash: string;
  deviceName: string;
  trustedAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface MfaChallenge {
  id: string;
  ownerEmail: string;
  deviceIdHash: string;
  deviceName: string;
  codeHash: string;
  status: MfaChallengeStatus;
  attemptCount: number;
  createdAt: string;
  expiresAt: string;
  verifiedAt?: string;
  deliveryId?: string;
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

export interface OwnerSession {
  id: string;
  ownerEmail: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt?: string;
  deviceName?: string;
  deviceIdHash?: string;
  authMethod: 'email_code' | 'dev' | 'firebase';
}

export type TotpStatus = 'pending' | 'active';

export interface TotpEnrollment {
  ownerEmail: string;
  secret: string;
  status: TotpStatus;
  createdAt: string;
  activatedAt?: string;
}

export type AuditEventType =
  | 'auth.login'
  | 'auth.mfa_verified'
  | 'auth.session_revoked'
  | 'auth.sessions_revoked_all'
  | 'auth.device_revoked'
  | 'auth.totp_enrolled'
  | 'auth.totp_activated'
  | 'auth.totp_disabled'
  | 'document.created'
  | 'document.viewed'
  | 'document.signer_signed'
  | 'document.signed'
  | 'document.link_rotated'
  | 'document.reminder_sent'
  | 'document.voided'
  | 'subscription.activated'
  | 'subscription.canceled'
  | 'account.exported'
  | 'account.deleted';

export interface AuditEvent {
  id: string;
  sequence: number;
  ownerEmail: string;
  actorEmail: string;
  type: AuditEventType;
  message: string;
  documentId?: string;
  signerId?: string;
  createdAt: string;
  previousHash: string;
  hash: string;
}

export interface StoreShape {
  documents: SigningDocument[];
  subscriptions: AccountSubscription[];
  signatureCharges: SignatureCharge[];
  emailDeliveries: EmailDelivery[];
  templates: DocumentTemplate[];
  companies: CompanyProfile[];
  trustedDevices: TrustedDevice[];
  mfaChallenges: MfaChallenge[];
  sessions: OwnerSession[];
  totpEnrollments: TotpEnrollment[];
  auditEvents: AuditEvent[];
}
