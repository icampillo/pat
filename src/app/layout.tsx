import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Patrimoine — vos investissements',
  description: 'Votre suivi personnel des investissements et collections.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
