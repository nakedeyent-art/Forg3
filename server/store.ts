import fs from 'node:fs';
import path from 'node:path';
import type {
  AccountSubscription,
  CompanyProfile,
  DocumentTemplate,
  EmailDelivery,
  MfaChallenge,
  SignatureCharge,
  SigningDocument,
  StoreShape,
  TrustedDevice
} from './types.js';

const defaultStorePath = path.join(process.cwd(), 'data', 'forg3-store.json');

export class DocumentStore {
  private readonly filePath: string;

  constructor(filePath = process.env.FORG3_DATA_FILE || defaultStorePath) {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_FILE_STORE_IN_PRODUCTION !== 'true') {
      throw new Error('Production requires Postgres plus encrypted blob storage. Set ALLOW_FILE_STORE_IN_PRODUCTION=true only for emergency migration tooling.');
    }

    this.filePath = path.resolve(process.cwd(), filePath);
    this.ensureStore();
  }

  all(): SigningDocument[] {
    return this.read().documents.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): SigningDocument | undefined {
    return this.read().documents.find((document) => document.id === id);
  }

  findByTokenHash(tokenHash: string): { document: SigningDocument; signerId?: string } | undefined {
    for (const document of this.read().documents) {
      if (document.tokenHash === tokenHash) {
        return { document };
      }

      const signer = document.signers?.find((current) => current.tokenHash === tokenHash);

      if (signer) {
        return { document, signerId: signer.id };
      }
    }

    return undefined;
  }

  create(document: SigningDocument): SigningDocument {
    const store = this.read();
    store.documents.push(document);
    this.write(store);
    return document;
  }

  getSubscription(ownerEmail: string): AccountSubscription | undefined {
    const normalizedEmail = normalizeEmail(ownerEmail);
    return this.read().subscriptions.find((subscription) => normalizeEmail(subscription.ownerEmail) === normalizedEmail);
  }

  upsertSubscription(subscription: AccountSubscription): AccountSubscription {
    const store = this.read();
    const normalizedEmail = normalizeEmail(subscription.ownerEmail);
    const index = store.subscriptions.findIndex(
      (current) => normalizeEmail(current.ownerEmail) === normalizedEmail
    );

    if (index >= 0) {
      store.subscriptions[index] = subscription;
    } else {
      store.subscriptions.push(subscription);
    }

    this.write(store);
    return subscription;
  }

  chargesForOwner(ownerEmail: string): SignatureCharge[] {
    const normalizedEmail = normalizeEmail(ownerEmail);
    return this.read()
      .signatureCharges.filter((charge) => normalizeEmail(charge.ownerEmail) === normalizedEmail)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  addSignatureCharge(charge: SignatureCharge): SignatureCharge {
    const store = this.read();
    const existing = store.signatureCharges.find((current) => current.documentId === charge.documentId);

    if (existing) {
      return existing;
    }

    store.signatureCharges.push(charge);
    this.write(store);
    return charge;
  }

  deliveriesForOwner(ownerEmail: string): EmailDelivery[] {
    const normalizedEmail = normalizeEmail(ownerEmail);
    return this.read()
      .emailDeliveries.filter((delivery) => normalizeEmail(delivery.ownerEmail) === normalizedEmail)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  addEmailDelivery(delivery: EmailDelivery): EmailDelivery {
    const store = this.read();
    store.emailDeliveries.push(delivery);
    this.write(store);
    return delivery;
  }

  getTrustedDevice(ownerEmail: string, deviceIdHash: string): TrustedDevice | undefined {
    const normalizedEmail = normalizeEmail(ownerEmail);
    const now = Date.now();
    const device = this.read().trustedDevices.find(
      (current) =>
        normalizeEmail(current.ownerEmail) === normalizedEmail &&
        current.deviceIdHash === deviceIdHash &&
        new Date(current.expiresAt).getTime() > now
    );

    if (device) {
      this.touchTrustedDevice(ownerEmail, deviceIdHash);
    }

    return device;
  }

  upsertTrustedDevice(device: TrustedDevice): TrustedDevice {
    const store = this.read();
    const normalizedEmail = normalizeEmail(device.ownerEmail);
    const index = store.trustedDevices.findIndex(
      (current) => normalizeEmail(current.ownerEmail) === normalizedEmail && current.deviceIdHash === device.deviceIdHash
    );

    if (index >= 0) {
      store.trustedDevices[index] = device;
    } else {
      store.trustedDevices.push(device);
    }

    this.write(store);
    return device;
  }

  addMfaChallenge(challenge: MfaChallenge): MfaChallenge {
    const store = this.read();
    store.mfaChallenges = store.mfaChallenges.map((current) =>
      normalizeEmail(current.ownerEmail) === normalizeEmail(challenge.ownerEmail) &&
      current.deviceIdHash === challenge.deviceIdHash &&
      current.status === 'pending'
        ? { ...current, status: 'expired' }
        : current
    );
    store.mfaChallenges.push(challenge);
    this.write(store);
    return challenge;
  }

  getMfaChallenge(ownerEmail: string, challengeId: string): MfaChallenge | undefined {
    const normalizedEmail = normalizeEmail(ownerEmail);
    return this.read().mfaChallenges.find(
      (challenge) => challenge.id === challengeId && normalizeEmail(challenge.ownerEmail) === normalizedEmail
    );
  }

  updateMfaChallenge(ownerEmail: string, challengeId: string, updater: (challenge: MfaChallenge) => MfaChallenge): MfaChallenge | undefined {
    const store = this.read();
    const normalizedEmail = normalizeEmail(ownerEmail);
    const index = store.mfaChallenges.findIndex(
      (challenge) => challenge.id === challengeId && normalizeEmail(challenge.ownerEmail) === normalizedEmail
    );

    if (index < 0) {
      return undefined;
    }

    const nextChallenge = updater(store.mfaChallenges[index]);
    store.mfaChallenges[index] = nextChallenge;
    this.write(store);
    return nextChallenge;
  }

  templatesForOwner(ownerEmail: string): DocumentTemplate[] {
    const normalizedEmail = normalizeEmail(ownerEmail);
    return this.read()
      .templates.filter((template) => normalizeEmail(template.ownerEmail) === normalizedEmail)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  upsertTemplate(template: DocumentTemplate): DocumentTemplate {
    const store = this.read();
    const index = store.templates.findIndex(
      (current) => current.id === template.id && normalizeEmail(current.ownerEmail) === normalizeEmail(template.ownerEmail)
    );

    if (index >= 0) {
      store.templates[index] = template;
    } else {
      store.templates.push(template);
    }

    this.write(store);
    return template;
  }

  deleteTemplate(ownerEmail: string, templateId: string): boolean {
    const store = this.read();
    const before = store.templates.length;
    store.templates = store.templates.filter(
      (template) => !(template.id === templateId && normalizeEmail(template.ownerEmail) === normalizeEmail(ownerEmail))
    );

    if (store.templates.length === before) {
      return false;
    }

    this.write(store);
    return true;
  }

  getCompany(ownerEmail: string): CompanyProfile | undefined {
    const normalizedEmail = normalizeEmail(ownerEmail);
    return this.read().companies.find((company) => normalizeEmail(company.ownerEmail) === normalizedEmail);
  }

  upsertCompany(company: CompanyProfile): CompanyProfile {
    const store = this.read();
    const normalizedEmail = normalizeEmail(company.ownerEmail);
    const index = store.companies.findIndex((current) => normalizeEmail(current.ownerEmail) === normalizedEmail);

    if (index >= 0) {
      store.companies[index] = company;
    } else {
      store.companies.push(company);
    }

    this.write(store);
    return company;
  }

  update(id: string, updater: (document: SigningDocument) => SigningDocument): SigningDocument | undefined {
    const store = this.read();
    const index = store.documents.findIndex((document) => document.id === id);

    if (index < 0) {
      return undefined;
    }

    const nextDocument = updater(store.documents[index]);
    store.documents[index] = nextDocument;
    this.write(store);
    return nextDocument;
  }

  private ensureStore() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });

    if (!fs.existsSync(this.filePath)) {
      this.write({
        documents: [],
        subscriptions: [],
        signatureCharges: [],
        emailDeliveries: [],
        templates: [],
        companies: [],
        trustedDevices: [],
        mfaChallenges: []
      });
    }
  }

  private read(): StoreShape {
    const raw = fs.readFileSync(this.filePath, 'utf8');
    const store = JSON.parse(raw) as Partial<StoreShape>;
    return {
      documents: store.documents || [],
      subscriptions: store.subscriptions || [],
      signatureCharges: store.signatureCharges || [],
      emailDeliveries: store.emailDeliveries || [],
      templates: store.templates || [],
      companies: store.companies || [],
      trustedDevices: store.trustedDevices || [],
      mfaChallenges: store.mfaChallenges || []
    };
  }

  private write(store: StoreShape) {
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(store, null, 2));
    fs.renameSync(tempPath, this.filePath);
  }

  private touchTrustedDevice(ownerEmail: string, deviceIdHash: string) {
    const store = this.read();
    const normalizedEmail = normalizeEmail(ownerEmail);
    const index = store.trustedDevices.findIndex(
      (device) => normalizeEmail(device.ownerEmail) === normalizedEmail && device.deviceIdHash === deviceIdHash
    );

    if (index >= 0) {
      store.trustedDevices[index] = {
        ...store.trustedDevices[index],
        lastSeenAt: new Date().toISOString()
      };
      this.write(store);
    }
  }
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}
