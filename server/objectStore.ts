import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { getDatabasePool } from './db.js';

const defaultObjectRoot = path.join(process.cwd(), 'data', 'objects');
const encryptionMagic = Buffer.from('FORG3ENC1');

export class ObjectStore {
  private readonly rootPath: string;
  private readonly encryptionKey: Buffer | null;
  private readonly pool: pg.Pool | null;

  constructor(rootPath = process.env.FORG3_OBJECT_STORE_PATH || defaultObjectRoot) {
    this.pool = getDatabasePool();
    this.rootPath = path.resolve(process.cwd(), rootPath);
    this.encryptionKey = loadEncryptionKey();

    if (process.env.NODE_ENV === 'production' && !this.encryptionKey && process.env.ALLOW_PLAINTEXT_OBJECTS_IN_PRODUCTION !== 'true') {
      throw new Error('Production object storage requires FORG3_OBJECT_ENCRYPTION_KEY (32 bytes, hex or base64).');
    }
  }

  async init() {
    if (this.pool) {
      await this.pool.query(
        'CREATE TABLE IF NOT EXISTS forg3_objects (key text PRIMARY KEY, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())'
      );
      return;
    }

    fs.mkdirSync(this.rootPath, { recursive: true });
  }

  async putDataUrl(ownerEmail: string, documentId: string, kind: 'original' | 'signed', dataUrl: string) {
    const key = `${safeSegment(ownerEmail)}/${safeSegment(documentId)}/${kind}.dataurl`;
    const sealed = this.seal(Buffer.from(dataUrl, 'utf8'));

    if (this.pool) {
      await this.pool.query(
        'INSERT INTO forg3_objects (key, data) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data',
        [key, sealed]
      );
      return key;
    }

    const absolutePath = this.resolveKey(key);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, sealed);
    return key;
  }

  async getDataUrl(key: string) {
    if (this.pool) {
      const result = await this.pool.query('SELECT data FROM forg3_objects WHERE key = $1', [key]);

      if (!result.rows[0]) {
        throw new Error('Stored object not found.');
      }

      return this.open(result.rows[0].data as Buffer).toString('utf8');
    }

    return this.open(fs.readFileSync(this.resolveKey(key))).toString('utf8');
  }

  async deleteOwnerObjects(ownerEmail: string) {
    if (this.pool) {
      await this.pool.query('DELETE FROM forg3_objects WHERE key LIKE $1', [`${safeSegment(ownerEmail)}/%`]);
      return;
    }

    const ownerPath = this.resolveKey(safeSegment(ownerEmail));
    if (fs.existsSync(ownerPath)) {
      fs.rmSync(ownerPath, { recursive: true, force: true });
    }
  }

  status() {
    return {
      mode: (this.pool ? 'postgres' : 'local_object_store') as 'postgres' | 'local_object_store' | 'provider',
      configured: Boolean(this.pool) || fs.existsSync(this.rootPath),
      encryptedAtRest: Boolean(this.encryptionKey)
    };
  }

  private seal(plaintext: Buffer) {
    if (!this.encryptionKey) {
      return plaintext;
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([encryptionMagic, iv, cipher.getAuthTag(), ciphertext]);
  }

  private open(stored: Buffer) {
    if (!stored.subarray(0, encryptionMagic.length).equals(encryptionMagic)) {
      // Object written before encryption at rest was enabled.
      return stored;
    }

    if (!this.encryptionKey) {
      throw new Error('Encrypted object found but FORG3_OBJECT_ENCRYPTION_KEY is not configured.');
    }

    const iv = stored.subarray(encryptionMagic.length, encryptionMagic.length + 12);
    const tag = stored.subarray(encryptionMagic.length + 12, encryptionMagic.length + 28);
    const ciphertext = stored.subarray(encryptionMagic.length + 28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  private resolveKey(key: string) {
    const normalizedKey = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    const absolutePath = path.resolve(this.rootPath, normalizedKey);

    if (!absolutePath.startsWith(this.rootPath)) {
      throw new Error('Invalid object key.');
    }

    return absolutePath;
  }
}

function loadEncryptionKey(): Buffer | null {
  const raw = (process.env.FORG3_OBJECT_ENCRYPTION_KEY || '').trim();

  if (!raw) {
    return null;
  }

  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');

  if (key.length !== 32) {
    throw new Error('FORG3_OBJECT_ENCRYPTION_KEY must decode to exactly 32 bytes (hex or base64).');
  }

  return key;
}

function safeSegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 80) || 'unknown';
}
