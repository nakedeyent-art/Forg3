import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AccountSubscription,
  AuditEvent,
  AuditEventType,
  CompanyProfile,
  DocumentTemplate,
  EmailDelivery,
  MfaChallenge,
  OwnerSession,
  SignatureCharge,
  SigningDocument,
  StoreShape,
  TotpEnrollment,
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

  trustedDevicesForOwner(ownerEmail: string): TrustedDevice[] {
    const normalizedEmail = normalizeEmail(ownerEmail);
    return this.read()
      .trustedDevices.filter((device) => normalizeEmail(device.ownerEmail) === normalizedEmail)
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  deleteTrustedDevice(ownerEmail: string, deviceId: string): boolean {
    const store = this.read();
    const normalizedEmail = normalizeEmail(ownerEmail);
    const before = store.trustedDevices.length;
    store.trustedDevices = store.trustedDevices.filter(
      (device) => !(device.id === deviceId && normalizeEmail(device.ownerEmail) === normalizedEmail)
    );

    if (store.trustedDevices.length === before) {
      return false;
    }

    this.write(store);
    return true;
  }

  addSession(session: OwnerSession): OwnerSession {
    const store = this.read();
    store.sessions.push(session);
    this.write(store);
    return session;
  }

  getSession(ownerEmail: string, sessionId: string): OwnerSession | undefined {
    const normalizedEmail = normalizeEmail(ownerEmail);
    return this.read().sessions.find(
      (session) => session.id === sessionId && normalizeEmail(session.ownerEmail) === normalizedEmail
    );
  }

  sessionsForOwner(ownerEmail: string): OwnerSession[] {
    const normalizedEmail = normalizeEmail(ownerEmail);
    return this.read()
      .sessions.filter((session) => normalizeEmail(session.ownerEmail) === normalizedEmail)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  isSessionActive(ownerEmail: string, sessionId: string): boolean {
    const session = this.getSession(ownerEmail, sessionId);
    return Boolean(session && !session.revokedAt && new Date(session.expiresAt).getTime() > Date.now());
  }

  touchSession(ownerEmail: string, sessionId: string) {
    const store = this.read();
    const normalizedEmail = normalizeEmail(ownerEmail);
    const index = store.sessions.findIndex(
      (session) => session.id === sessionId && normalizeEmail(session.ownerEmail) === normalizedEmail
    );

    if (index >= 0) {
      store.sessions[index] = { ...store.sessions[index], lastSeenAt: new Date().toISOString() };
      this.write(store);
    }
  }

  revokeSession(ownerEmail: string, sessionId: string): boolean {
    const store = this.read();
    const normalizedEmail = normalizeEmail(ownerEmail);
    const index = store.sessions.findIndex(
      (session) => session.id === sessionId && normalizeEmail(session.ownerEmail) === normalizedEmail && !session.revokedAt
    );

    if (index < 0) {
      return false;
    }

    store.sessions[index] = { ...store.sessions[index], revokedAt: new Date().toISOString() };
    this.write(store);
    return true;
  }

  revokeAllSessions(ownerEmail: string): number {
    const store = this.read();
    const normalizedEmail = normalizeEmail(ownerEmail);
    const revokedAt = new Date().toISOString();
    let revoked = 0;
    store.sessions = store.sessions.map((session) => {
      if (normalizeEmail(session.ownerEmail) === normalizedEmail && !session.revokedAt) {
        revoked += 1;
        return { ...session, revokedAt };
      }

      return session;
    });

    this.write(store);
    return revoked;
  }

  getTotpEnrollment(ownerEmail: string): TotpEnrollment | undefined {
    const normalizedEmail = normalizeEmail(ownerEmail);
    return this.read().totpEnrollments.find((enrollment) => normalizeEmail(enrollment.ownerEmail) === normalizedEmail);
  }

  upsertTotpEnrollment(enrollment: TotpEnrollment): TotpEnrollment {
    const store = this.read();
    const normalizedEmail = normalizeEmail(enrollment.ownerEmail);
    const index = store.totpEnrollments.findIndex(
      (current) => normalizeEmail(current.ownerEmail) === normalizedEmail
    );

    if (index >= 0) {
      store.totpEnrollments[index] = enrollment;
    } else {
      store.totpEnrollments.push(enrollment);
    }

    this.write(store);
    return enrollment;
  }

  deleteTotpEnrollment(ownerEmail: string): boolean {
    const store = this.read();
    const normalizedEmail = normalizeEmail(ownerEmail);
    const before = store.totpEnrollments.length;
    store.totpEnrollments = store.totpEnrollments.filter(
      (enrollment) => normalizeEmail(enrollment.ownerEmail) !== normalizedEmail
    );

    if (store.totpEnrollments.length === before) {
      return false;
    }

    this.write(store);
    return true;
  }

  appendAuditEvent(input: {
    ownerEmail: string;
    actorEmail: string;
    type: AuditEventType;
    message: string;
    documentId?: string;
    signerId?: string;
  }): AuditEvent {
    const store = this.read();
    const normalizedEmail = normalizeEmail(input.ownerEmail);
    const ownerEvents = store.auditEvents.filter((event) => normalizeEmail(event.ownerEmail) === normalizedEmail);
    const previous = ownerEvents.reduce<AuditEvent | undefined>(
      (latest, event) => (!latest || event.sequence > latest.sequence ? event : latest),
      undefined
    );
    const sequence = (previous?.sequence ?? 0) + 1;
    const previousHash = previous?.hash ?? 'genesis';
    const createdAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const hash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          id,
          sequence,
          ownerEmail: normalizedEmail,
          actorEmail: normalizeEmail(input.actorEmail),
          type: input.type,
          message: input.message,
          documentId: input.documentId || null,
          signerId: input.signerId || null,
          createdAt,
          previousHash
        })
      )
      .digest('hex');
    const event: AuditEvent = {
      id,
      sequence,
      ownerEmail: normalizedEmail,
      actorEmail: normalizeEmail(input.actorEmail),
      type: input.type,
      message: input.message,
      documentId: input.documentId,
      signerId: input.signerId,
      createdAt,
      previousHash,
      hash
    };

    store.auditEvents.push(event);
    this.write(store);
    return event;
  }

  auditEventsForOwner(ownerEmail: string, limit = 200): AuditEvent[] {
    const normalizedEmail = normalizeEmail(ownerEmail);
    return this.read()
      .auditEvents.filter((event) => normalizeEmail(event.ownerEmail) === normalizedEmail)
      .sort((a, b) => b.sequence - a.sequence)
      .slice(0, limit);
  }

  deleteOwnerData(ownerEmail: string): { documents: SigningDocument[] } {
    const store = this.read();
    const normalizedEmail = normalizeEmail(ownerEmail);
    const matchesOwner = (value: string) => normalizeEmail(value) === normalizedEmail;
    const removedDocuments = store.documents.filter((document) => matchesOwner(document.ownerEmail));

    store.documents = store.documents.filter((document) => !matchesOwner(document.ownerEmail));
    store.subscriptions = store.subscriptions.filter((subscription) => !matchesOwner(subscription.ownerEmail));
    store.signatureCharges = store.signatureCharges.filter((charge) => !matchesOwner(charge.ownerEmail));
    store.emailDeliveries = store.emailDeliveries.filter((delivery) => !matchesOwner(delivery.ownerEmail));
    store.templates = store.templates.filter((template) => !matchesOwner(template.ownerEmail));
    store.companies = store.companies.filter((company) => !matchesOwner(company.ownerEmail));
    store.trustedDevices = store.trustedDevices.filter((device) => !matchesOwner(device.ownerEmail));
    store.mfaChallenges = store.mfaChallenges.filter((challenge) => !matchesOwner(challenge.ownerEmail));
    store.sessions = store.sessions.filter((session) => !matchesOwner(session.ownerEmail));
    store.totpEnrollments = store.totpEnrollments.filter((enrollment) => !matchesOwner(enrollment.ownerEmail));
    store.auditEvents = store.auditEvents.filter((event) => !matchesOwner(event.ownerEmail));

    this.write(store);
    return { documents: removedDocuments };
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
        mfaChallenges: [],
        sessions: [],
        totpEnrollments: [],
        auditEvents: []
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
      mfaChallenges: store.mfaChallenges || [],
      sessions: store.sessions || [],
      totpEnrollments: store.totpEnrollments || [],
      auditEvents: store.auditEvents || []
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
