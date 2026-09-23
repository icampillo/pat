import 'dotenv/config';
import { db } from '../src/server/db';
import { json, valuation } from '../src/server/portfolio';

const DEMO_NOTE = 'Exemple fictif — ne constitue pas une cotation de marché.';

const result = await db().$transaction(
  async (tx) => {
    const portfolio = await tx.portfolio.findFirst({
      where: { isDemo: true },
      select: { id: true, ownerId: true, name: true },
    });
    if (!portfolio) throw new Error('Aucun portefeuille de démonstration à nettoyer.');

    const demoAssets = await tx.asset.findMany({
      where: { portfolioId: portfolio.id, notes: DEMO_NOTE },
      select: { id: true },
    });
    if (demoAssets.length !== 8)
      throw new Error(`Inventaire de démonstration inattendu (${demoAssets.length} actifs).`);

    const personalAssets = await tx.asset.count({
      where: { portfolioId: portfolio.id, externalId: { startsWith: 'xlsx:' }, deletedAt: null },
    });
    if (personalAssets !== 7)
      throw new Error(`Inventaire personnel inattendu (${personalAssets} actifs importés).`);

    const walletCount = await tx.walletConnection.count({
      where: { portfolioId: portfolio.id, deletedAt: null },
    });
    if (walletCount < 1) throw new Error('Wallet personnel introuvable : purge interrompue.');

    const assetIds = demoAssets.map((asset) => asset.id);
    const transactions = await tx.transaction.findMany({
      where: { assetId: { in: assetIds } },
      select: { id: true },
    });
    const transactionIds = transactions.map((transaction) => transaction.id);

    const prices = await tx.priceHistory.deleteMany({ where: { assetId: { in: assetIds } } });
    const revisions = await tx.transactionRevision.deleteMany({
      where: { transactionId: { in: transactionIds } },
    });
    const removedTransactions = await tx.transaction.deleteMany({
      where: { assetId: { in: assetIds } },
    });
    const images = await tx.assetImage.deleteMany({ where: { assetId: { in: assetIds } } });
    const removedAssets = await tx.asset.deleteMany({ where: { id: { in: assetIds } } });
    const snapshots = await tx.portfolioSnapshot.deleteMany({
      where: { portfolioId: portfolio.id, kind: 'SEED' },
    });
    const rates = await tx.fxRate.deleteMany({
      where: { portfolioId: portfolio.id, source: 'demo' },
    });

    // Recalculer les captures mixtes à leur date : les pièces et observations DeBank sont conservées.
    const personalSnapshots = await tx.portfolioSnapshot.findMany({
      where: { portfolioId: portfolio.id },
      orderBy: { capturedAt: 'asc' },
      select: { id: true, capturedAt: true, kind: true },
    });
    if (
      personalSnapshots.length < 7 ||
      personalSnapshots.some((snapshot) => !['WALLET', 'IMPORT', 'INVALIDATED'].includes(snapshot.kind))
    )
      throw new Error(`Captures personnelles inattendues (${personalSnapshots.length}).`);
    for (const snapshot of personalSnapshots) {
      const state = await valuation(tx, portfolio.id, snapshot.capturedAt);
      if (state.rows.some((row) => assetIds.includes(row.id)))
        throw new Error('Une capture recalculée contient encore un actif fictif.');
      await tx.portfolioSnapshot.update({
        where: { id: snapshot.id },
        data: {
          totalEur: snapshot.kind === 'INVALIDATED' ? null : state.totals.valueEur,
          totalUsd: snapshot.kind === 'INVALIDATED' ? null : state.totals.valueUsd,
          investedEur: state.totals.costEur,
          netFlowsEur: state.totals.netFlowsEur,
          data: json({ ...state, transactions: undefined }),
        },
      });
    }

    await tx.portfolio.update({
      where: { id: portfolio.id },
      data: { isDemo: false, name: portfolio.name === 'Collection personnelle' ? 'Mon patrimoine' : portfolio.name },
    });
    await tx.auditLog.create({
      data: {
        portfolioId: portfolio.id,
        actorId: portfolio.ownerId,
        action: 'DEMO_DATA_PURGED',
      },
    });

    return {
      assets: removedAssets.count,
      transactions: removedTransactions.count,
      transactionRevisions: revisions.count,
      prices: prices.count,
      images: images.count,
      demoSnapshotsRemoved: snapshots.count,
      personalSnapshotsRecalculated: personalSnapshots.length,
      fxRates: rates.count,
      personalAssetsPreserved: personalAssets,
      walletsPreserved: walletCount,
    };
  },
  { isolationLevel: 'Serializable', timeout: 30_000 },
);

console.log(JSON.stringify(result, null, 2));
await db().$disconnect();
