'use client';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="error-page">
      <div className="panel">
        <h1>Le portefeuille est momentanément indisponible</h1>
        <p>
          Vérifiez que PostgreSQL est démarré, puis réessayez. Vos données enregistrées sont
          conservées.
        </p>
        <button className="btn primary" onClick={reset}>
          Réessayer
        </button>
      </div>
    </main>
  );
}
