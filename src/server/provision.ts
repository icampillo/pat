import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { db } from './db';
import { categories } from '@/shared/schemas';
export async function createUser(name: string, email: string, password: string, isDemo = false) {
  const normalized = email.trim().toLowerCase();
  if (password.length < 12) throw new Error('Mot de passe : 12 caractères minimum.');
  const hash = await hashPassword(password);
  return db().$transaction(async (tx) => {
    await tx.currency.upsert({
      where: { code: 'EUR' },
      update: {},
      create: { code: 'EUR', name: 'Euro', symbol: '€' },
    });
    await tx.currency.upsert({
      where: { code: 'USD' },
      update: {},
      create: { code: 'USD', name: 'Dollar américain', symbol: '$' },
    });
    const id = randomUUID();
    await tx.user.create({
      data: {
        id,
        name,
        email: normalized,
        accounts: {
          create: { id: randomUUID(), accountId: id, providerId: 'credential', password: hash },
        },
      },
    });
    const p = await tx.portfolio.create({
      data: {
        ownerId: id,
        name: isDemo ? 'Collection personnelle' : 'Mon patrimoine',
        isDemo,
        categories: { create: categories.map((c) => ({ ...c })) },
        platforms: { create: { name: 'Personnel' } },
      },
    });
    return { userId: id, portfolioId: p.id };
  });
}
