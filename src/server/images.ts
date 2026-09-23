import sharp from 'sharp';
import { z } from 'zod';
import { mutate, owned } from './portfolio';
import { db } from './db';
import { AppError } from './errors';
const imageSchema = z
  .object({
    base64: z
      .string()
      .min(4)
      .max(2_800_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
export async function saveImage(
  userId: string,
  assetId: string,
  input: unknown,
  key: string | null,
) {
  const { base64 } = imageSchema.parse(input);
  let content: Buffer;
  try {
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > 2_000_000) throw new Error();
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp =
      bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!png && !jpeg && !webp) throw new Error();
    const metadata = await sharp(bytes, { limitInputPixels: 16_000_000 }).metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format || '') || (metadata.pages || 1) > 1)
      throw new Error();
    content = await sharp(bytes, { limitInputPixels: 16_000_000 })
      .rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw new AppError(
      'IMAGE_INVALID',
      'Image JPG, PNG ou WebP requise, 2 Mo et 16 mégapixels maximum.',
      422,
    );
  }
  const bytes = new Uint8Array(content);
  return mutate(userId, key, `POST/assets/${assetId}/image`, input, async (tx, p) => {
    if (!(await tx.asset.findFirst({ where: { id: assetId, portfolioId: p.id, deletedAt: null } })))
      throw new AppError('NOT_FOUND', 'Actif introuvable.', 404);
    const image = await tx.assetImage.upsert({
      where: { assetId },
      create: { assetId, portfolioId: p.id, content: bytes },
      update: { content: bytes },
    });
    return { id: assetId, updatedAt: image.updatedAt };
  });
}
export async function getImage(userId: string, assetId: string) {
  const p = await owned(userId);
  const image = await db().assetImage.findFirst({
    where: { assetId, portfolioId: p.id, asset: { deletedAt: null } },
  });
  if (!image) throw new AppError('NOT_FOUND', 'Image introuvable.', 404);
  return new Response(Buffer.from(image.content), {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
