import crypto from 'node:crypto';

// RFC 6238 TOTP (SHA-1, 30 second steps, 6 digits) — compatible with
// Google Authenticator, 1Password, Authy, and Apple Passwords.
const stepSeconds = 30;
const digits = 6;
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function buildOtpAuthUrl(accountEmail: string, secret: string, issuer = 'Forg3 Sign') {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountEmail)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${digits}&period=${stepSeconds}`;
}

export function verifyTotpCode(secret: string, code: string, windowSteps = 1) {
  const normalized = String(code || '').replace(/\D/g, '');

  if (normalized.length !== digits) {
    return false;
  }

  const counter = Math.floor(Date.now() / 1000 / stepSeconds);

  for (let offset = -windowSteps; offset <= windowSteps; offset += 1) {
    if (constantTimeEqual(totpAt(secret, counter + offset), normalized)) {
      return true;
    }
  }

  return false;
}

function totpAt(secret: string, counter: number) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

function base32Encode(input: Buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += base32Alphabet[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input: string) {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    value = (value << 5) | base32Alphabet.indexOf(char);
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
