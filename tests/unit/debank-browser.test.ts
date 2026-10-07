import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchDeBankPublic } from '../../src/server/debank-public';
import { address } from '../fixtures/debank';

const { launch, executablePath } = vi.hoisted(() => ({
  launch: vi.fn(),
  executablePath: vi.fn(),
}));
vi.mock('playwright', () => ({ chromium: { launch } }));
vi.mock('@sparticuz/chromium-min', () => ({
  default: { args: ['--serverless-test'], executablePath },
}));

beforeEach(() => {
  vi.stubEnv('CHROMIUM_PACK_URL', '');
  executablePath.mockResolvedValue('/tmp/chromium');
  // Stop before navigation: these tests must never contact DeBank or a database.
  launch.mockRejectedValue(new Error('stop before navigation'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('keeps the locally installed Playwright browser outside Vercel', async () => {
  vi.stubEnv('VERCEL', '');
  await expect(fetchDeBankPublic(address)).rejects.toThrow('BROWSER');
  expect(launch).toHaveBeenCalledWith({ headless: true, timeout: 20_000 });
  expect(executablePath).not.toHaveBeenCalled();
});

it.each(['x64', 'arm64'])('uses the official 153.0.0 pack matching %s on Vercel', async (arch) => {
  vi.stubEnv('VERCEL', '1');
  vi.stubGlobal('process', { ...process, arch });
  await expect(fetchDeBankPublic(address)).rejects.toThrow('BROWSER');
  expect(executablePath).toHaveBeenCalledWith(
    `https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.${arch}.tar`,
  );
  expect(launch).toHaveBeenCalledWith({
    args: ['--serverless-test'],
    executablePath: '/tmp/chromium',
    headless: true,
    timeout: 20_000,
  });
});

it('honors a configured mirror without falling back to a local Vercel browser', async () => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('CHROMIUM_PACK_URL', 'https://example.com/chromium-v153.0.0-pack.x64.tar');
  executablePath.mockRejectedValue(new Error('download failed'));
  await expect(fetchDeBankPublic(address)).rejects.toThrow('BROWSER');
  expect(executablePath).toHaveBeenCalledWith(process.env.CHROMIUM_PACK_URL);
  expect(launch).not.toHaveBeenCalled();
});

it('rejects an architecture without a matching official pack', async () => {
  vi.stubEnv('VERCEL', '1');
  vi.stubGlobal('process', { ...process, arch: 'ia32' });
  await expect(fetchDeBankPublic(address)).rejects.toThrow('BROWSER');
  expect(executablePath).not.toHaveBeenCalled();
  expect(launch).not.toHaveBeenCalled();
});
