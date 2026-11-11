/**
 * Fallback web de /match/{id}/share.
 *
 * No lee la base, no usa la anon key y no expone datos personales.
 * El id del partido solo se usa, ya codificado, en el deep link imsports://.
 * iOS Universal Links: si la app está instalada, iOS la abre y no carga esta página.
 */
import type { Metadata } from 'next';
import OpenAppButton from './OpenAppButton';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TITLE = 'Tu tarjeta de MVP — IM SPORTS';
const DESCRIPTION = 'Abre la app para ver tu tarjeta de MVP y compartirla.';
const OG_IMAGE = 'https://imsports.app/og-invite.png';

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

interface Props {
  params: { id: string };
  searchParams: { card?: string };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const matchId = decodeParam(params.id || '');
  const card = decodeParam(searchParams.card || 'mvp');
  const url = matchId
    ? `https://imsports.app/match/${encodeURIComponent(matchId)}/share?card=${encodeURIComponent(card)}`
    : 'https://imsports.app';

  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: { index: false, follow: false },
    openGraph: {
      title: 'Fuiste el MVP — IM SPORTS',
      description: DESCRIPTION,
      type: 'website',
      siteName: 'IM SPORTS',
      locale: 'es_CL',
      url,
      images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: 'IM SPORTS' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Fuiste el MVP — IM SPORTS',
      description: DESCRIPTION,
      images: [OG_IMAGE],
    },
    other: {
      'apple-itunes-app': 'app-id=6761868170',
    },
  };
}

export default function MatchShareFallbackPage({ params, searchParams }: Props) {
  const matchId = decodeParam(params.id || '');
  const card = decodeParam(searchParams.card || 'mvp');

  return (
    <main style={styles.main}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>IM</span>
          <span style={styles.logoWord}>SPORTS</span>
        </div>
        <h1 style={styles.h1}>Tu tarjeta de MVP</h1>
        <p style={styles.p}>
          Si tienes la app, ábrela para ver la tarjeta y compartirla. Si no, descárgala y entra con el mismo enlace.
        </p>
        <OpenAppButton matchId={matchId} card={card} />
        <a href="https://apps.apple.com/app/id6761868170" style={styles.secondary}>
          Descargar para iOS
        </a>
        <a href="https://play.google.com/store/apps/details?id=cl.imsports.app" style={styles.secondary}>
          Descargar para Android
        </a>
        <p style={styles.hint}>IM SPORTS · imsports.app</p>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    background: '#0A0A0A',
    color: '#FFFFFF',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  card: {
    background: '#1C1C1E',
    borderRadius: 24,
    padding: '48px 32px',
    maxWidth: 420,
    width: '100%',
    textAlign: 'center',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 28,
  },
  logoIcon: {
    background: '#00E676',
    color: '#0A0A0A',
    fontWeight: 800,
    fontSize: 18,
    padding: '6px 10px',
    borderRadius: 8,
  },
  logoWord: { fontWeight: 800, fontSize: 22, letterSpacing: -0.5 },
  h1: { fontSize: 26, margin: '0 0 12px', lineHeight: 1.2 },
  p: { color: '#A0A0A0', lineHeight: 1.55, margin: '0 0 24px' },
  secondary: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    background: 'transparent',
    color: '#fff',
    textDecoration: 'none',
    padding: '12px 18px',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.16)',
    fontWeight: 600,
    marginBottom: 10,
  },
  hint: { fontSize: 13, color: '#6B6B6B', marginTop: 8 },
};
