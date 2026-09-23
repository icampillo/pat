import 'dotenv/config';
import { db } from '../src/server/db';
import { metadataSchema } from '../src/shared/schemas';

const assets = await db().asset.findMany({
  where: { externalId: { startsWith: 'xlsx:' }, deletedAt: null, category: { key: 'METALS' } },
});
if (assets.length !== 7) throw new Error(`Sept pièces importées attendues, ${assets.length} trouvées.`);
for (const asset of assets) {
  const metadata = metadataSchema.parse(asset.metadata);
  if (!metadata.metalType || !metadata.weightGrams || !metadata.purity)
    throw new Error(`Poids ou pureté absents pour ${asset.id}.`);
}
const changed = await db().$transaction(async (tx) => {
  let count = 0;
  for (const asset of assets) {
    const metadata = metadataSchema.parse(asset.metadata);
    if (metadata.pricingMode === 'METAL_MARKET') continue;
    await tx.asset.update({
      where: { id: asset.id },
      data: { metadata: { ...metadata, pricingMode: 'METAL_MARKET' }, version: { increment: 1 } },
    });
    count++;
  }
  return count;
});
console.log(JSON.stringify({ coinsEnabled: changed }));
await db().$disconnect();
