import { decimal as d, precise } from './money';
import { parseCsvDecimal } from './securities-csv';
import { csvDate } from './transaction-csv';

// Un avis, une exécution, Euronext Paris : les autres présentations sont refusées.
export function parseBoursoNotice(text: string): Record<string, string> {
  const content = text.replace(/[\s\u00a0\u202f]+/g, ' ').trim();
  const invalid = () =>
    new Error(
      'Avis Bourso non reconnu : utilisez un avis textuel d’achat/vente au comptant, avec une seule exécution sur Euronext Paris.',
    );
  if (
    !/boursorama|boursobank/i.test(content) ||
    (content.match(/Référence\s*:/g) || []).length !== 1
  )
    throw invalid();
  const side = content.match(/\b(ACHAT|VENTE) COMPTANT(?: ETR)?\b/);
  const execution = content.match(
    /Informations sur l'exécution\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})\s+([\d.,]+)\s+(.+?)\s+Référence\s*:\s*(\d+)/,
  );
  const isin = content.match(/Code ISIN\s*:\s*([A-Z]{2}[A-Z0-9]{9}\d)\b/);
  const price = content.match(/Cours exécuté\s*:\s*([\d., ]+)\s+(EUR|USD)\b/);
  const venue = content.match(/Lieu d'exécution\s*:\s*(.*?)\s+Montant transaction brut/);
  if (!side || !execution || !isin || !price || venue?.[1] !== 'EURONEXT PARIS') throw invalid();
  const currency = price[2];
  const amounts = (section: string) =>
    [...section.matchAll(/([\d]+(?:[ .]\d{3})*(?:[,.]\d+)?)\s+(EUR|USD)\b/g)].map((match) => {
      if (match[2] !== currency) throw new Error('Devises incohérentes dans l’avis.');
      return parseCsvDecimal(match[1]);
    });
  const grossSection = content.match(/Montant transaction brut (.*?) Commission Frais divers/);
  const feesSection = content.match(
    /Commission Frais divers Montant total des frais (.*?) Montant net au (débit|crédit) de votre compte/,
  );
  const net = content.match(
    /Montant net au (débit|crédit) de votre compte\s+([\d., ]+)\s+(EUR|USD)\b/,
  );
  if (!grossSection || !feesSection || !net) throw invalid();
  const gross = amounts(grossSection[1]),
    costs = amounts(feesSection[1]);
  if (gross.length !== 5 || costs.length !== 3 || net[3] !== currency) throw invalid();
  const fees = d(gross[3]).add(costs[0]).add(costs[1]);
  if (!d(gross[1]).isZero() || !d(gross[0]).eq(gross[2]) || !fees.eq(costs[2]))
    throw new Error('Détail des montants ou frais non pris en charge. Vérifiez l’avis.');
  const type = side[1] === 'ACHAT' ? 'BUY' : 'SELL';
  if (
    net[1] !== (type === 'BUY' ? 'débit' : 'crédit') ||
    !d(parseCsvDecimal(net[2])).eq(d(gross[0]).add(type === 'BUY' ? fees : fees.neg()))
  )
    throw new Error('Le montant net ne correspond pas au montant brut et aux frais.');
  const local = `${csvDate(execution[1]).slice(0, 10)}T${execution[2]}`;
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
    .map((offset) => new Date(local + offset))
    .filter(
      (date) =>
        Number.isFinite(date.getTime()) && formatter.format(date).replace(' ', 'T') === local,
    );
  if (dates.length !== 1) throw new Error('Heure locale d’exécution invalide ou ambiguë.');
  return {
    type,
    isin: isin[1],
    name: execution[4],
    quantity: parseCsvDecimal(execution[3]),
    unit_price: parseCsvDecimal(price[1]),
    amount: gross[0],
    fees: precise(fees),
    currency,
    occurred_at: dates[0].toISOString(),
    external_reference: execution[5],
    settlement: 'EXTERNAL',
    comment: `Avis d’opéré BoursoBank · Euronext Paris · Réf. ${execution[5]}`,
  };
}
