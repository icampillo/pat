import { fetchDeBankPublic } from '../src/server/debank-public';
const address = process.argv[2];
if (!address) throw new Error('Usage : pnpm wallet:check 0x…');
try {
  const data = await fetchDeBankPublic(address);
  console.log(
    JSON.stringify(
      {
        source: data.source,
        totalUsd: data.totalUsd,
        tokens: data.tokens.length,
        positions: data.positions.map((p) => ({
          protocol: p.protocol,
          kind: p.kind,
          valueUsd: p.netUsd,
        })),
        updatedLabel: data.updatedLabel,
        warnings: data.warnings,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Lecture DeBank impossible.');
  process.exitCode = 1;
}
