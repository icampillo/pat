// Les relevés Bourso et avis d'opéré expriment leurs heures en Europe/Paris.
export function parisDateTime(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(local))
    throw new Error('Date et heure locales invalides.');
  const complete = local.length === 16 ? `${local}:00` : local;
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const dates = ['+01:00', '+02:00']
    .map((offset) => new Date(complete + offset))
    .filter(
      (date) =>
        Number.isFinite(date.getTime()) && formatter.format(date).replace(' ', 'T') === complete,
    );
  if (dates.length !== 1) throw new Error('Heure locale Europe/Paris invalide ou ambiguë.');
  return dates[0].toISOString();
}

// Suggestion uniquement : le nom du fichier ne certifie pas la date de l'inventaire.
export function suggestInventoryDate(filename: string): string | null {
  const match = /(?:^|[-_])(\d{2})-(\d{2})-(\d{4})_(\d{2})-(\d{2})-(\d{2})(?:\.csv)$/i.exec(
    filename,
  );
  if (!match) return null;
  const local = `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6]}`;
  try {
    parisDateTime(local);
    return local;
  } catch {
    return null;
  }
}
