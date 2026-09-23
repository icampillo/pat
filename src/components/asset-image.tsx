'use client';
import { useState } from 'react';
import Image from 'next/image';
import type { SaveAction } from './forms';
export function AssetImage({
  id,
  updatedAt,
  save,
}: {
  id: string;
  updatedAt?: string;
  save: SaveAction;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <section className="asset-image">
      <h3>Image de l’actif</h3>
      {updatedAt && (
        <Image
          unoptimized
          src={`/api/v1/assets/${id}/image?v=${encodeURIComponent(updatedAt)}`}
          alt="Visuel de l’actif"
          width={320}
          height={240}
          style={{ objectFit: 'contain', maxWidth: '100%', height: 'auto', maxHeight: 240 }}
        />
      )}
      <label>
        Ajouter ou remplacer l’image
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setError('');
            if (file.size > 2_000_000) {
              setError('Image limitée à 2 Mo.');
              return;
            }
            setBusy(true);
            try {
              const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });
              await save(`assets/${id}/image`, 'POST', { base64 });
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
        <small>JPG, PNG ou WebP · 2 Mo maximum · image privée</small>
      </label>
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
