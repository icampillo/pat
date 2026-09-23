import { ZodError } from 'zod';
import { LedgerError } from '@/domain/ledger';
import { AppError } from './errors';
export const response = (data: unknown, status = 200) =>
  Response.json({ data }, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function body(request: Request, limit = 256_000) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new AppError('CONTENT_TYPE', 'Corps JSON requis.', 400);
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new AppError('TOO_LARGE', 'Requête trop volumineuse.', 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('JSON_INVALID', 'JSON invalide.', 400);
  }
}
export function errorResponse(error: unknown) {
  const requestId = crypto.randomUUID();
  if (error instanceof ZodError)
    return Response.json(
      {
        error: {
          code: 'VALIDATION',
          message: error.issues[0]?.message || 'Données invalides.',
          fields: error.flatten().fieldErrors,
          requestId,
        },
      },
      { status: 422, headers: { 'Cache-Control': 'private, no-store' } },
    );
  if (error instanceof AppError || error instanceof LedgerError)
    return Response.json(
      {
        error: {
          code: error instanceof AppError ? error.code : 'LEDGER_CONFLICT',
          message: error.message,
          requestId,
        },
      },
      {
        status: error instanceof AppError ? error.status : 409,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  console.error(
    JSON.stringify({
      requestId,
      code: 'INTERNAL_ERROR',
      errorType: error instanceof Error ? error.name : 'Unknown',
    }),
  );
  return Response.json(
    {
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Le service est indisponible. Vérifiez la connexion à la base puis réessayez.',
        requestId,
      },
    },
    { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
