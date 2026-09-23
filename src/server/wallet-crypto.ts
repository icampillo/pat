import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { DeBankError } from './debank';
function key() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new DeBankError('KEY');
  return Buffer.from(hkdfSync('sha256', secret, 'patrimoine', 'debank-credentials-v1', 32));
}
export function encryptKey(value: string, portfolioId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(portfolioId));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}
export function decryptKey(value: string, portfolioId: string) {
  try {
    const [version, iv, tag, encrypted] = value.split('.');
    if (version !== 'v1') throw new Error();
    const cipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    cipher.setAAD(Buffer.from(portfolioId));
    cipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      cipher.update(Buffer.from(encrypted, 'base64')),
      cipher.final(),
    ]).toString('utf8');
  } catch {
    throw new DeBankError('KEY');
  }
}
