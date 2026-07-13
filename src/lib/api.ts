import type {
  AuditEventSummary,
  CreateDocumentInput,
  CompanyProfile,
  DocumentTemplate,
  DocumentSummary,
  EmailDelivery,
  FeatureStatus,
  OwnerSessionSummary,
  PlanId,
  PublicSigningDocument,
  SignerInboxDocument,
  SignedDocumentResponse,
  SigningLinkResponse,
  SubscriptionResponse,
  TotpStatus,
  TrustedDeviceSummary,
  BillingProvider
} from './types';
import { getAuthToken, getDeviceId, getDeviceName } from './auth';

const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export async function listDocuments() {
  return request<{ documents: DocumentSummary[] }>('/api/documents');
}

export async function createDocument(input: CreateDocumentInput) {
  return request<SigningLinkResponse>('/api/documents', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function getSubscription() {
  return request<SubscriptionResponse>('/api/subscription');
}

export async function getFeatureStatus() {
  return request<{
    featureStatus: FeatureStatus;
    capabilities: Record<string, boolean>;
  }>('/api/features');
}

export async function startSubscription(input: {
  planId: PlanId;
  billingProvider: BillingProvider;
}) {
  return request<SubscriptionResponse>('/api/subscription/checkout', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function cancelSubscription() {
  return request<SubscriptionResponse>('/api/subscription/cancel', {
    method: 'POST'
  });
}

export async function rotateSigningLink(id: string, expiresInHours: number) {
  return request<SigningLinkResponse>(`/api/documents/${id}/rotate-link`, {
    method: 'POST',
    body: JSON.stringify({ expiresInHours })
  });
}

export async function sendReminder(id: string) {
  return request<SigningLinkResponse & { deliveries: EmailDelivery[] }>(`/api/documents/${id}/remind`, {
    method: 'POST'
  });
}

export async function voidDocument(id: string) {
  return request<{ document: DocumentSummary }>(`/api/documents/${id}/void`, {
    method: 'POST'
  });
}

export async function getPublicSigningDocument(token: string) {
  return request<{ document: PublicSigningDocument; fileDataUrl: string }>(`/api/signing/${token}`);
}

export async function listSignerDocuments() {
  return request<{ documents: SignerInboxDocument[] }>('/api/signer/documents');
}

export async function getAssignedSigningDocument(documentId: string, signerId: string) {
  return request<{ document: PublicSigningDocument; fileDataUrl: string }>(
    `/api/signer/documents/${documentId}/${signerId}`
  );
}

export async function signDocument(
  token: string,
  payload: {
    signatureDataUrl: string;
    signerNameConfirmation: string;
    signerEmailConfirmation?: string;
    consentText: string;
  }
) {
  return request<SignedDocumentResponse>(`/api/signing/${token}/sign`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function signAssignedDocument(
  documentId: string,
  signerId: string,
  payload: {
    signatureDataUrl: string;
    signerNameConfirmation: string;
    signerEmailConfirmation?: string;
    consentText: string;
  }
) {
  return request<SignedDocumentResponse>(`/api/signer/documents/${documentId}/${signerId}/sign`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function getSignedDocument(id: string) {
  return request<Omit<SignedDocumentResponse, 'document'>>(`/api/documents/${id}/signed`);
}

export async function listEmailDeliveries() {
  return request<{ deliveries: EmailDelivery[] }>('/api/email-deliveries');
}

export async function listTemplates() {
  return request<{ templates: DocumentTemplate[] }>('/api/templates');
}

export async function createTemplate(input: {
  name: string;
  title: string;
  signers: Array<{ name: string; email: string; role?: string }>;
  expiresInHours: number;
  signatureField: CreateDocumentInput['signatureField'];
  identityVerificationRequired: boolean;
}) {
  return request<{ template: DocumentTemplate }>('/api/templates', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function getCompany() {
  return request<{ company: CompanyProfile }>('/api/company');
}

export async function addCompanyMember(input: {
  name: string;
  email: string;
  role: 'admin' | 'sender' | 'viewer';
}) {
  return request<{ company: CompanyProfile }>('/api/company/members', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function listSessions() {
  return request<{ sessions: OwnerSessionSummary[] }>('/api/auth/sessions');
}

export async function revokeSession(sessionId: string) {
  return request<{ revoked: boolean }>('/api/auth/sessions/revoke', {
    method: 'POST',
    body: JSON.stringify({ sessionId })
  });
}

export async function revokeAllSessions() {
  return request<{ revoked: number }>('/api/auth/sessions/revoke-all', {
    method: 'POST'
  });
}

export async function listTrustedDevices() {
  return request<{ devices: TrustedDeviceSummary[] }>('/api/auth/devices');
}

export async function revokeTrustedDevice(deviceId: string) {
  return request<{ revoked: boolean }>(`/api/auth/devices/${deviceId}`, {
    method: 'DELETE'
  });
}

export async function getTotpStatus() {
  return request<TotpStatus>('/api/auth/totp');
}

export async function enrollTotp() {
  return request<{ secret: string; otpauthUrl: string }>('/api/auth/totp/enroll', {
    method: 'POST'
  });
}

export async function activateTotp(code: string) {
  return request<{ enabled: boolean }>('/api/auth/totp/activate', {
    method: 'POST',
    body: JSON.stringify({ code })
  });
}

export async function disableTotp(code: string) {
  return request<{ enabled: boolean }>('/api/auth/totp/disable', {
    method: 'POST',
    body: JSON.stringify({ code })
  });
}

export async function listAuditEvents() {
  return request<{ events: AuditEventSummary[] }>('/api/audit');
}

export async function exportAccountData() {
  return request<Record<string, unknown>>('/api/account/export');
}

export async function deleteAccount(confirmEmail: string) {
  return request<{ deleted: boolean; documentsRemoved: number }>('/api/account/delete', {
    method: 'POST',
    body: JSON.stringify({ confirmEmail })
  });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthToken();
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Forg3-Device-Id': getDeviceId(),
      'X-Forg3-Device-Name': getDeviceName(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {})
    }
  });

  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }

  return payload;
}
