import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('../../src/server/db', () => ({ db: () => ({ $transaction: mocks.transaction }) }));
import { mutate } from '../../src/server/portfolio-store';

beforeEach(() => {
  mocks.transaction.mockReset();
});
const action = async () => ({ id: 'result' });
const save = () => mutate('owner', 'request-key', 'POST/assets', {}, action);

it('refuse une mutation sans clé d’idempotence avant tout accès à la base', async () => {
  await expect(mutate('owner', null, 'POST/assets', {}, action)).rejects.toMatchObject({
    code: 'IDEMPOTENCY_REQUIRED',
    status: 400,
  });
  expect(mocks.transaction).not.toHaveBeenCalled();
});

it('borne les reprises de conflits et conserve l’isolation sérialisable', async () => {
  const conflict = { code: 'P2034' };
  mocks.transaction.mockRejectedValue(conflict);
  await expect(save()).rejects.toBe(conflict);
  expect(mocks.transaction).toHaveBeenCalledTimes(3);
  expect(mocks.transaction).toHaveBeenLastCalledWith(expect.any(Function), {
    isolationLevel: 'Serializable',
    timeout: 20_000,
  });
});

it('retourne le résultat dès que la reprise réussit', async () => {
  mocks.transaction.mockRejectedValueOnce({ code: 'P2034' }).mockResolvedValue({ id: 'saved' });
  await expect(save()).resolves.toEqual({ id: 'saved' });
  expect(mocks.transaction).toHaveBeenCalledTimes(2);
});

it('traduit une référence en doublon sans rejouer la mutation', async () => {
  mocks.transaction.mockRejectedValue({ code: 'P2002' });
  await expect(save()).rejects.toMatchObject({ code: 'DUPLICATE', status: 409 });
  expect(mocks.transaction).toHaveBeenCalledTimes(1);
});

it('ne masque pas une erreur inconnue par un TypeError lors de la lecture de son code', async () => {
  mocks.transaction.mockRejectedValue(null);
  await expect(save()).rejects.toBeNull();
  expect(mocks.transaction).toHaveBeenCalledTimes(1);
});
