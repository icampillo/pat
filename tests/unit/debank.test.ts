import { afterEach, describe, expect, it, vi } from 'vitest';
import { addressSchema, fetchDeBank, normalizeDeBank } from '../../src/server/debank';
import { encryptKey, decryptKey } from '../../src/server/wallet-crypto';
import { address, tokens, protocols, total } from '../fixtures/debank';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('Contrat DeBank', () => {
  it('normalise les adresses et les profils, refuse les entrées et hôtes étrangers', () => {
    expect(addressSchema.parse(address.toUpperCase())).toBe(address);
    expect(addressSchema.parse(`https://debank.com/profile/${address}?tab=portfolio`)).toBe(
      address,
    );
    for (const value of [
      '0xabc',
      `https://evil.test/profile/${address}`,
      `https://debank.com.evil.test/profile/${address}`,
    ])
      expect(addressSchema.safeParse(value).success).toBe(false);
  });
  it('conserve le total officiel, exclut les reçus, distingue dette et récompenses', () => {
    const value = normalizeDeBank(total, tokens, protocols);
    expect(value).toMatchObject({
      totalUsd: '905',
      liquidUsd: '200',
      defiUsd: '700',
      debtUsd: '200',
      rewardsUsd: '10',
      reconciliationUsd: '5',
    });
    expect(value.tokens).toHaveLength(2);
    expect(value.tokens[1].valueUsd).toBeNull();
    expect(value.positions[0].borrows[0].amount).toBe('200');
    expect(value.positions[1].observedAt).toBeNull();
  });
  it('préserve les positions négatives et un wallet vide sans faux prix', () => {
    expect(normalizeDeBank({ total_usd_value: -12, chain_list: [] }, [], []).totalUsd).toBe('-12');
    expect(normalizeDeBank({ total_usd_value: 0, chain_list: [] }, [], []).totalUsd).toBe('0');
    for (const value of [{}, null, { total_usd_value: '905', chain_list: [] }])
      expect(() => normalizeDeBank(value, tokens, protocols)).toThrow('FORMAT');
    expect(() => normalizeDeBank(total, tokens, [{ id: 'incomplete' }])).toThrow('FORMAT');
  });
  it('utilise trois lectures officielles et transmet la clé uniquement au fournisseur', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(total))
      .mockResolvedValueOnce(Response.json(tokens))
      .mockResolvedValueOnce(Response.json(protocols));
    vi.stubGlobal('fetch', mock);
    const value = await fetchDeBank(address, 'test-only-key');
    expect(mock).toHaveBeenCalledTimes(3);
    expect(mock.mock.calls[1][0]).toContain(
      'https://pro-openapi.debank.com/v1/user/all_token_list?is_all=false&id=',
    );
    expect(mock.mock.calls[0][1]).toMatchObject({
      headers: { AccessKey: 'test-only-key' },
      redirect: 'error',
      cache: 'no-store',
    });
    expect(JSON.stringify(value)).not.toContain('test-only-key');
  });
  it.each([
    [401, 'AUTH'],
    [402, 'CREDITS'],
    [403, 'CREDITS'],
    [429, 'RATE_LIMIT'],
    [500, 'NETWORK'],
  ])('borne les appels sur HTTP %s et masque le corps', async (status, code) => {
    const mock = vi
      .fn()
      .mockResolvedValue(new Response('secret echoed by upstream', { status: Number(status) }));
    vi.stubGlobal('fetch', mock);
    await expect(fetchDeBank(address, 'private-key')).rejects.toMatchObject({
      code,
      message: `DeBank: ${code}`,
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('refuse les JSON incomplets et isole les erreurs réseau', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'secret' })));
    await expect(fetchDeBank(address, 'test')).rejects.toMatchObject({ code: 'FORMAT' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private URL and key')));
    await expect(fetchDeBank(address, 'test')).rejects.toMatchObject({
      code: 'NETWORK',
      message: 'DeBank: NETWORK',
    });
  });
  it('chiffre les clés avec intégrité et cloisonnement entre portefeuilles', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret'.repeat(8));
    const encrypted = encryptKey('private-test-key', 'owner-1');
    expect(encrypted).not.toContain('private-test-key');
    expect(decryptKey(encrypted, 'owner-1')).toBe('private-test-key');
    expect(() => decryptKey(encrypted, 'owner-2')).toThrow('KEY');
    const parts = encrypted.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptKey(parts.join('.'), 'owner-1')).toThrow('KEY');
  });
});
