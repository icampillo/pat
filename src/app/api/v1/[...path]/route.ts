import { measureHttp } from '@/server/performance';
import { after } from 'next/server';
import { auth } from '@/server/auth';
import { command } from '@/server/portfolio';
import { walletSyncStatus } from '@/server/wallet-state';
import { assetPrices, walletHistory } from '@/server/detail-history';
import { getPageState } from '@/server/page-state';
import { getState } from '@/server/portfolio-query';
import { owned } from '@/server/portfolio-store';
import { body, errorResponse, response } from '@/server/http';
import { AppError } from '@/server/errors';
import { db } from '@/server/db';
import { exportData } from '@/server/exports';
import { importCommand } from '@/server/imports';
import { getImage, saveImage } from '@/server/images';
import { walletCommand, syncWallet } from '@/server/wallets';
import { syncMarketData } from '@/server/market';
import {
  previewSecurities,
  confirmSecurities,
  correctInventoryDate,
} from '@/server/securities-import';
import { syncSecuritiesPrices, repairSecurityPricing } from '@/server/securities-market';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const session = await auth().api.getSession({ headers: request.headers });
    if (!session) throw new AppError('UNAUTHORIZED', 'Connectez-vous pour continuer.', 401);
    const { path } = await context.params;
    if (request.method === 'GET') {
      if (path.length === 3 && path[0] === 'assets' && path[2] === 'image')
        return await getImage(session.user.id, path[1]);
      if (path[0] === 'exports' && path[1]) return await exportData(session.user.id, path[1]);
      if (path.join('/') === 'wallets/status')
        return response(await walletSyncStatus(session.user.id));
      if (path.length === 1 && path[0] === 'state') {
        const scope = new URL(request.url).searchParams.get('scope') ?? 'full';
        if (!['full', 'live', 'settings', 'wallets'].includes(scope))
          throw new AppError('INVALID_SCOPE', 'Portée de lecture invalide.', 400);
        return response({
          ...(scope === 'settings' || scope === 'wallets'
            ? await getPageState(session.user.id, scope)
            : await getState(session.user.id, scope !== 'live')),
          userName: session.user.name,
        });
      }
      if (path.length === 3 && path[0] === 'assets' && path[2] === 'prices')
        return response(
          await assetPrices(
            session.user.id,
            path[1],
            new URL(request.url).searchParams.get('cursor'),
          ),
        );
      if (path.length === 3 && path[0] === 'wallets' && path[2] === 'history')
        return response(await walletHistory(session.user.id, path[1]));
      if (path[0] === 'snapshots' && path[1]) {
        const p = await owned(session.user.id);
        const snapshot = await db().portfolioSnapshot.findFirst({
          where: { id: path[1], portfolioId: p.id },
        });
        if (!snapshot) throw new AppError('NOT_FOUND', 'Snapshot introuvable.', 404);
        return response(snapshot);
      }
      throw new AppError('NOT_FOUND', 'Route introuvable.', 404);
    }
    if (request.headers.get('origin') !== process.env.APP_ORIGIN)
      throw new AppError('ORIGIN_REJECTED', 'Origine de la requête refusée.', 403);
    if (path[0] === 'snapshots') throw new AppError('NOT_FOUND', 'Route introuvable.', 404);
    if (path[0] === 'securities' && request.method === 'POST') {
      if (path.length === 4 && path[1] === 'inventories' && path[3] === 'date')
        return response(
          await correctInventoryDate(
            session.user.id,
            path[2],
            await body(request),
            request.headers.get('idempotency-key'),
          ),
        );
      if (path.length === 3 && path[2] === 'repair')
        return response(
          await repairSecurityPricing(
            session.user.id,
            path[1],
            await body(request),
            request.headers.get('idempotency-key'),
          ),
        );
      if (path.length === 2 && path[1] === 'refresh')
        return response(await syncSecuritiesPrices((await owned(session.user.id)).id));
      if (path.length === 3 && path[1] === 'imports' && path[2] === 'preview')
        return response(
          await previewSecurities(
            session.user.id,
            await body(request),
            request.headers.get('idempotency-key'),
          ),
        );
      if (path.length === 4 && path[1] === 'imports' && path[3] === 'confirm')
        return response(
          await confirmSecurities(
            session.user.id,
            path[2],
            await body(request),
            request.headers.get('idempotency-key'),
          ),
        );
      throw new AppError('NOT_FOUND', 'Action Bourse introuvable.', 404);
    }
    if (
      path.length === 2 &&
      path[0] === 'market' &&
      path[1] === 'refresh' &&
      request.method === 'POST'
    ) {
      const portfolio = await owned(session.user.id);
      return response(await syncMarketData(portfolio.id));
    }
    if (['wallets', 'zerion'].includes(path[0])) {
      const input = await body(request);
      const result = await walletCommand(
        session.user.id,
        request.method,
        path,
        input,
        request.headers.get('idempotency-key'),
      );
      // walletCommand has already checked ownership inside its transaction. No network under lock.
      if (
        path[0] === 'wallets' &&
        result &&
        typeof result === 'object' &&
        'id' in result &&
        typeof result.id === 'string' &&
        (request.method === 'POST' ||
          (request.method === 'PATCH' &&
            input &&
            typeof input === 'object' &&
            'enabled' in input &&
            input.enabled === true))
      ) {
        const id = result.id;
        after(async () => {
          try {
            await syncWallet(id);
          } catch {
            console.warn(JSON.stringify({ job: 'wallets', code: 'MANUAL_SYNC_FAILED' }));
          }
        });
      }
      return response(result);
    }
    if (
      path.length === 3 &&
      path[0] === 'assets' &&
      path[2] === 'image' &&
      request.method === 'POST'
    )
      return response(
        await saveImage(
          session.user.id,
          path[1],
          await body(request, 2_900_000),
          request.headers.get('idempotency-key'),
        ),
      );
    if (path[0] === 'imports' && request.method === 'POST')
      return response(
        await importCommand(
          session.user.id,
          path,
          await body(request),
          request.headers.get('idempotency-key'),
        ),
      );
    const result = await command(
      session.user.id,
      request.method,
      path,
      await body(request),
      request.headers.get('idempotency-key'),
      request.headers.get('if-match'),
    );
    if (
      path[0] === 'assets' &&
      (request.method === 'POST' || request.method === 'PATCH') &&
      (result as { metadata?: { metalType?: string } }).metadata?.metalType
    ) {
      // The write is committed: external quotes must not delay its acknowledgement.
      after(async () => {
        try {
          const portfolio = await owned(session.user.id);
          await syncMarketData(portfolio.id);
        } catch {
          console.warn(JSON.stringify({ code: 'METAL_PRICE_AFTER_SAVE_UNAVAILABLE' }));
        }
      });
    }
    return response(result, request.method === 'POST' ? 201 : 200);
  } catch (error) {
    return errorResponse(error);
  }
}
const measured: typeof handle = (request, context) =>
  measureHttp(request, () => handle(request, context));
export const GET = measured;
export const POST = measured;
export const PATCH = measured;
export const DELETE = measured;
