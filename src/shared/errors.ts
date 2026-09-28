export function errorMessage(error: unknown, fallback = 'Une erreur est survenue. Réessayez.') {
  return error instanceof Error && error.message ? error.message : fallback;
}
