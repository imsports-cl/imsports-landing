import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'IM SPORTS — Tu comunidad deportiva',
  description: 'IM SPORTS — La app donde tu grupo deportivo vive, compite y crece.',
  openGraph: {
    title: 'IM SPORTS',
    description: 'La app donde tu grupo deportivo vive, compite y crece.',
    type: 'website',
    url: 'https://imsports.app',
  },
  appleWebApp: { capable: true, title: 'IM SPORTS' },
  other: {
    'apple-itunes-app': 'app-id=6761868170',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
