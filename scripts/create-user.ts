import 'dotenv/config';
import { input, password } from '@inquirer/prompts';
import { z } from 'zod';
import { createUser } from '../src/server/provision';
import { db } from '../src/server/db';
try {
  const name = await input({ message: 'Votre nom', validate: (v) => v.trim().length > 0 });
  const email = await input({
    message: 'Votre adresse e-mail (aucun message envoyé)',
    validate: (v) => z.email().safeParse(v).success,
  });
  const secret = await password({
    message: 'Mot de passe (12 caractères minimum)',
    mask: true,
    validate: (v) => v.length >= 12,
  });
  await createUser(name, email, secret);
  console.log('Utilisateur et portefeuille vide créés. Vous pouvez vous connecter.');
} finally {
  await db().$disconnect();
}
