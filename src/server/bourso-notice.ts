import { getDocumentProxy, extractText } from 'unpdf';
import { parseBoursoNotice } from '@/domain/bourso-notice';
import { AppError } from './errors';

export async function readBoursoNotice(base64: string) {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > 150_000 || bytes.toString('ascii', 0, 5) !== '%PDF-')
    throw new AppError('PDF_INVALID', 'Avis PDF invalide ou supérieur à 150 Ko.');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    if (pdf.numPages > 2) throw new Error('Importez un seul avis, de deux pages maximum.');
    const { text } = await extractText(pdf, { mergePages: true });
    if (text.length > 30_000) throw new Error('Avis trop volumineux.');
    return parseBoursoNotice(text);
  } finally {
    await pdf.loadingTask.destroy();
  }
}
