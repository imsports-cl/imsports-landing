import type { Metadata } from 'next';
import Landing from './Landing';

export const metadata: Metadata = {
  title: 'IM SPORTS — Tu comunidad deportiva',
  description:
    'La app donde tu grupo deportivo vive, compite y crece. Próximamente en App Store y Google Play.',
};

export default function HomePage() {
  return <Landing />;
}
