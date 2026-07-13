import fs from 'node:fs';
import path from 'node:path';

const defaultObjectRoot = path.join(process.cwd(), 'data', 'objects');

export class ObjectStore {
  private readonly rootPath: string;

  constructor(rootPath = process.env.FORG3_OBJECT_STORE_PATH || defaultObjectRoot) {
    this.rootPath = path.resolve(process.cwd(), rootPath);
    fs.mkdirSync(this.rootPath, { recursive: true });
  }

  putDataUrl(ownerEmail: string, documentId: string, kind: 'original' | 'signed', dataUrl: string) {
    const key = path.join(safeSegment(ownerEmail), safeSegment(documentId), `${kind}.dataurl`);
    const absolutePath = this.resolveKey(key);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, dataUrl, 'utf8');
    return key;
  }

  getDataUrl(key: string) {
    return fs.readFileSync(this.resolveKey(key), 'utf8');
  }

  status() {
    return {
      mode: (process.env.FORG3_OBJECT_STORE_PROVIDER ? 'provider' : 'local_object_store') as
        | 'provider'
        | 'local_object_store',
      configured: Boolean(process.env.FORG3_OBJECT_STORE_PROVIDER) || fs.existsSync(this.rootPath)
    };
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

function safeSegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 80) || 'unknown';
}
