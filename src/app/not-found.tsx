import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="error-page">
      <div>
        <h1>Page introuvable</h1>
        <Link className="btn primary" href="/dashboard">
          Revenir au tableau de bord
        </Link>
      </div>
    </main>
  );
}
