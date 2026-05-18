/**
 * Match landing page — dynamic per match_id.
 *
 * iOS Universal Links: si el user tiene IM SPORTS instalada, iOS abre la app
 * directo y NUNCA carga esta página. Esta página la ven solo users sin la app.
 *
 * MÁS importante: el metadata genera OG tags dinámicos por fase, para que
 * WhatsApp/Twitter/etc. muestren preview rico cuando se comparte el link.
 */
import type { Metadata } from 'next';
import { fetchMatchForOG, PHASE_LABELS, PHASE_EMOJI } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Props {
  params: { id: string };
}

function formatDateLabel(date: string | null, time: string | null, location: string | null): string {
  if (!date) return '';
  const parts: string[] = [date];
  if (time) parts.push(`a las ${time}`);
  if (location) parts.push(`en ${location}`);
  return parts.join(' ');
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const match = await fetchMatchForOG(params.id);

  if (!match) {
    return {
      title: 'IM SPORTS',
      description: 'Partido no encontrado',
    };
  }

  const groupName = match.group?.name || 'IM SPORTS';
  const phaseLabel = PHASE_LABELS[match.phase] || 'Partido';
  const emoji = PHASE_EMOJI[match.phase] || '⚽';

  const title = `${emoji} ${groupName} — ${phaseLabel}`;

  let description: string;
  if (match.phase === 'closed') {
    const score = `${match.team_a_score ?? 0} - ${match.team_b_score ?? 0}`;
    const mvpStr = match.mvp ? ` · MVP: ${match.mvp.display_name}` : '';
    description = `Resultado: ${score}${mvpStr}`;
  } else if (match.phase === 'voting') {
    description = `🗳️ Vota tu MVP en ${groupName}`;
  } else {
    description = formatDateLabel(match.date, match.time, match.location) || `Partido de ${groupName}`;
  }

  // Cache-bust the OG image when phase changes. WhatsApp caches aggressively
  // — including the phase in the query helps when the same match shifts state.
  const ogImage = `https://imsports.app/og/match/${params.id}?phase=${match.phase}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      url: `https://imsports.app/match/${params.id}`,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
      siteName: 'IM SPORTS',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function MatchPage({ params }: Props) {
  const match = await fetchMatchForOG(params.id);
  const groupName = match?.group?.name || 'IM SPORTS';

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      textAlign: 'center',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
        <div style={{
          width: 64, height: 64, background: '#00E676', borderRadius: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#0A0A0A', fontSize: 30, fontWeight: 800, letterSpacing: -1.5,
        }}>IM</div>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -1 }}>SPORTS</div>
      </div>

      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 12 }}>
        📲 Abriendo {groupName}...
      </h1>
      <p style={{ color: '#aaa', marginBottom: 28, maxWidth: 480 }}>
        Si tenés IM SPORTS instalada, este link debería abrirla automáticamente. Si no, descargala:
      </p>
      <a
        href="https://apps.apple.com/app/id6761868170"
        style={{
          background: '#FF6B2B', padding: '14px 26px', borderRadius: 14,
          fontWeight: 700, fontSize: 16, color: '#fff',
        }}
      >
        Descargar en App Store
      </a>

      <p style={{ marginTop: 40, fontSize: 12, color: '#666' }}>
        <a href="https://imsports.app">imsports.app</a> · La comunidad deportiva
      </p>
    </main>
  );
}
