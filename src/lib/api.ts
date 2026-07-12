import type {
  CreateDocumentInput,
  DocumentSummary,
  PlanId,
  PublicSigningDocument,
  SignedDocumentResponse,
  SigningLinkResponse,
  SubscriptionResponse,
  BillingProvider
} from './types';
import { getAuthToken } from './auth';

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

export async function voidDocument(id: string) {
  return request<{ document: DocumentSummary }>(`/api/documents/${id}/void`, {
    method: 'POST'
  });
}

export async function getPublicSigningDocument(token: string) {
  return request<{ document: PublicSigningDocument; fileDataUrl: string }>(`/api/signing/${token}`);
}

export async function signDocument(
  token: string,
  payload: {
    signatureDataUrl: string;
    signerNameConfirmation: string;
    consentText: string;
  }
) {
  return request<SignedDocumentResponse>(`/api/signing/${token}/sign`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function getSignedDocument(id: string) {
  return request<Omit<SignedDocumentResponse, 'document'>>(`/api/documents/${id}/signed`);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthToken();
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
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
