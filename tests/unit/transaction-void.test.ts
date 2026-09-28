import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tx: {
    transaction: { findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    transactionRevision: { create: vi.fn() },
  },
}));
vi.mock('../../src/server/portfolio-store', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/server/portfolio-store')>();
  return {
    ...original,
    mutate: (
      _user: string,
      _key: string,
      _scope: string,
      _input: unknown,
      action: (tx: typeof mocks.tx, portfolio: { id: string }) => Promise<unknown>,
    ) => action(mocks.tx, { id: 'portfolio' }),
  };
});
import { command } from '../../src/server/portfolio';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.tx.transaction.findFirst.mockResolvedValue({
    id: 'transaction',
    assetId: null,
    version: 1,
  });
  mocks.tx.transaction.findMany.mockResolvedValue([]);
  mocks.tx.transaction.update.mockResolvedValue({ id: 'transaction', version: 2, voided: true });
});
const cancel = (input: unknown) =>
  command('owner', 'DELETE', ['transactions', 'transaction'], input, 'request-key', '1');

it('rejette une confirmation mal formée avant toute écriture', async () => {
  for (const input of [
    null,
    { confirmed: 'true', reason: 'Erreur' },
    { confirmed: true, reason: 42 },
  ]) {
    await expect(cancel(input)).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
      status: 422,
    });
  }
  expect(mocks.tx.transaction.update).not.toHaveBeenCalled();
  expect(mocks.tx.transactionRevision.create).not.toHaveBeenCalled();
});

it('conserve le motif, la révision et la validation du journal pour une annulation valide', async () => {
  const reason = '  Correction de saisie  ';
  await expect(cancel({ confirmed: true, reason })).resolves.toMatchObject({ voided: true });
  expect(mocks.tx.transaction.update).toHaveBeenCalledWith({
    where: { id: 'transaction' },
    data: { voided: true, version: { increment: 1 } },
  });
  expect(mocks.tx.transactionRevision.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      transactionId: 'transaction',
      version: 2,
      actorId: 'owner',
      reason,
    }),
  });
  expect(mocks.tx.transaction.findMany).toHaveBeenCalledWith({
    where: { portfolioId: 'portfolio', voided: false },
  });
});
