import fs from 'node:fs';
import path from 'node:path';
import type { AccountSubscription, SignatureCharge, SigningDocument, StoreShape } from './types.js';

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

  findByTokenHash(tokenHash: string): SigningDocument | undefined {
    return this.read().documents.find((document) => document.tokenHash === tokenHash);
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
      this.write({ documents: [], subscriptions: [], signatureCharges: [] });
    }
  }

  private read(): StoreShape {
    const raw = fs.readFileSync(this.filePath, 'utf8');
    const store = JSON.parse(raw) as Partial<StoreShape>;
    return {
      documents: store.documents || [],
      subscriptions: store.subscriptions || [],
      signatureCharges: store.signatureCharges || []
    };
  }

  private write(store: StoreShape) {
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(store, null, 2));
    fs.renameSync(tempPath, this.filePath);
  }
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}
