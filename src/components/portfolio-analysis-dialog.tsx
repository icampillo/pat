'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { Copy, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { buildPortfolioContext } from '@/domain/portfolio-analysis';
import { buildPortfolioAnalysisPrompt } from '@/domain/portfolio-analysis-prompt';
import type { AppState } from '@/shared/types';
import { useWorkspace } from '@/components/workspace/context';

export function PortfolioAnalysisDialog({ state }: { state: AppState }) {
  const { currency, setFlash } = useWorkspace();
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);

  function openChange(open: boolean) {
    setError('');
    setCopied(false);
    setPrompt('');
    if (open) {
      try {
        // Freeze exactly what is displayed/copied until the next opening.
        setPrompt(buildPortfolioAnalysisPrompt(buildPortfolioContext(state, currency)));
      } catch {
        setError('Le résumé n’a pas pu être généré. Actualisez les données puis réessayez.');
      }
    }
  }
  async function copy() {
    setError('');
    setCopied(false);
    setCopying(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setFlash('Prompt copié');
    } catch {
      setError(
        'Copie automatique indisponible. Sélectionnez le texte ci-dessous puis utilisez Ctrl+C (ou ⌘C).',
      );
    } finally {
      setCopying(false);
    }
  }
  return (
    <Dialog.Root onOpenChange={openChange}>
      <Dialog.Trigger asChild>
        <button className="btn" type="button">
          <Sparkles size={16} aria-hidden="true" />
          Analyser avec une IA
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog portfolio-analysis-dialog">
          <div className="section-title">
            <Dialog.Title>Analyser mon patrimoine avec une IA</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="Fermer l’analyse">
              <X size={18} />
            </Dialog.Close>
          </div>
          <Dialog.Description>
            Patrimoine génère un résumé détaillé de votre portefeuille à copier dans ChatGPT,
            Claude, Gemini ou une autre IA.
          </Dialog.Description>
          <p className="small muted">
            Aucune donnée n’est envoyée automatiquement à une IA. Relisez le contenu avant de le
            partager.
          </p>
          <label htmlFor="portfolio-analysis-prompt">Prompt généré</label>
          <textarea
            id="portfolio-analysis-prompt"
            className="portfolio-analysis-prompt"
            value={prompt}
            readOnly
            spellCheck={false}
          />
          {error && (
            <p className="error-note" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="btn"
              type="button"
              disabled={!prompt}
              onClick={() => {
                const textarea = document.getElementById('portfolio-analysis-prompt');
                if (textarea instanceof HTMLTextAreaElement) {
                  textarea.focus();
                  textarea.select();
                }
              }}
            >
              Sélectionner le texte
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={!prompt || copying}
              onClick={() => void copy()}
            >
              <Copy size={16} aria-hidden="true" />
              {copied ? 'Prompt copié' : 'Copier le prompt'}
            </button>
          </div>
          <span className="sr-only" role="status">
            {copied ? 'Prompt copié' : ''}
          </span>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
