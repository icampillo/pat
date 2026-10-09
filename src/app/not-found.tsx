import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="error-page">
      <div className="panel">
        <h1>Page introuvable</h1>
        <p>Cette page n’existe pas ou n’est plus disponible.</p>
        <Link className="btn primary" href="/dashboard">
          Revenir au tableau de bord
        </Link>
      </div>
    </main>
  );
}
