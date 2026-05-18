/**
 * OG image generator — produce a 1200x630 PNG dinámico por fase.
 *
 * URL: /og/match/[id]?phase={convocatoria|titulares|equipos|playing|voting|closed}
 * Output: image/png para que WhatsApp/Twitter/Slack rendericen el preview.
 */
import { ImageResponse } from 'next/og';
import { fetchMatchForOG, PHASE_LABELS, PHASE_EMOJI } from '@/lib/supabase';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const COLORS = {
  bg: '#0A0A0A',
  bg2: '#1a1a1a',
  green: '#00E676',
  orange: '#FF6B2B',
  white: '#FFFFFF',
  gray: '#888',
  grayLight: '#bbb',
};

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { searchParams } = new URL(req.url);
  const phaseOverride = searchParams.get('phase');

  const match = await fetchMatchForOG(params.id);

  if (!match) {
    return new Response('Match not found', { status: 404 });
  }

  const phase = phaseOverride || match.phase;
  const groupName = match.group?.name || 'IM SPORTS';

  // ─── Render content per phase (separate functions for clarity) ──
  function renderClosed() {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', fontSize: 32, color: COLORS.gray, marginBottom: 18 }}>
          {groupName}
        </div>
        <div style={{
          display: 'flex',
          fontSize: 32,
          color: COLORS.grayLight,
          marginBottom: 8,
          gap: 24,
          alignItems: 'baseline',
        }}>
          <span>{match!.team_a_name || 'Equipo A'}</span>
          <span style={{ color: COLORS.gray, fontSize: 22 }}>vs</span>
          <span>{match!.team_b_name || 'Equipo B'}</span>
        </div>
        <div style={{
          display: 'flex',
          fontSize: 180,
          fontWeight: 800,
          letterSpacing: -8,
          lineHeight: 1,
          gap: 30,
          alignItems: 'center',
        }}>
          <span>{match!.team_a_score ?? 0}</span>
          <span style={{ color: COLORS.gray, fontSize: 100, fontWeight: 400 }}>-</span>
          <span>{match!.team_b_score ?? 0}</span>
        </div>
        {match!.mvp ? (
          <div style={{
            display: 'flex',
            marginTop: 30,
            fontSize: 30,
            color: COLORS.orange,
            alignItems: 'center',
            gap: 8,
          }}>
            <span>🌟 MVP:</span>
            <span style={{ fontWeight: 700, color: COLORS.white }}>{match!.mvp.display_name}</span>
          </div>
        ) : (
          <div style={{ display: 'flex' }} />
        )}
      </div>
    );
  }

  function renderVoting() {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ display: 'flex', fontSize: 90, fontWeight: 800, marginBottom: 24 }}>🗳️</div>
        <div style={{ display: 'flex', fontSize: 56, fontWeight: 800, marginBottom: 18, textAlign: 'center' }}>
          Vota tu MVP
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: COLORS.gray }}>{groupName}</div>
        <div style={{
          display: 'flex',
          marginTop: 30,
          fontSize: 22,
          color: COLORS.orange,
          padding: '10px 24px',
          border: `2px solid ${COLORS.orange}`,
          borderRadius: 999,
        }}>
          Abrí la app para votar
        </div>
      </div>
    );
  }

  function renderOpen() {
    const label = PHASE_LABELS[phase] || 'Próximo partido';
    const emoji = PHASE_EMOJI[phase] || '⚽';
    const dateLine = match!.date
      ? `${match!.date}${match!.time ? ` · ${match!.time}` : ''}`
      : '';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ display: 'flex', fontSize: 72, marginBottom: 10 }}>{emoji}</div>
        <div style={{
          display: 'flex',
          fontSize: 54,
          fontWeight: 800,
          marginBottom: 20,
          textAlign: 'center',
        }}>
          {label}
        </div>
        <div style={{
          display: 'flex',
          fontSize: 38,
          color: COLORS.white,
          marginBottom: 12,
          fontWeight: 600,
        }}>
          {groupName}
        </div>
        {dateLine ? (
          <div style={{ display: 'flex', fontSize: 26, color: COLORS.grayLight }}>
            {dateLine}
          </div>
        ) : (
          <div style={{ display: 'flex' }} />
        )}
        {match!.location ? (
          <div style={{
            display: 'flex',
            fontSize: 22,
            color: COLORS.gray,
            marginTop: 6,
          }}>
            📍 {match!.location}
          </div>
        ) : (
          <div style={{ display: 'flex' }} />
        )}
      </div>
    );
  }

  // Pick content
  let content;
  if (phase === 'closed') content = renderClosed();
  else if (phase === 'voting') content = renderVoting();
  else content = renderOpen();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: `linear-gradient(135deg, ${COLORS.bg} 0%, ${COLORS.bg2} 100%)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 70,
          color: COLORS.white,
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* Logo lockup */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 50 }}>
          <div style={{
            display: 'flex',
            width: 80,
            height: 80,
            background: COLORS.green,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            color: COLORS.bg,
            fontSize: 40,
            fontWeight: 800,
            letterSpacing: -2,
          }}>
            IM
          </div>
          <div style={{
            display: 'flex',
            fontSize: 44,
            fontWeight: 800,
            letterSpacing: -1.5,
            color: COLORS.white,
          }}>
            SPORTS
          </div>
        </div>

        {/* Content per phase */}
        {content}

        {/* Footer */}
        <div style={{
          display: 'flex',
          position: 'absolute',
          bottom: 30,
          right: 40,
          fontSize: 20,
          color: COLORS.gray,
          fontWeight: 500,
        }}>
          imsports.app
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        'Content-Type': 'image/png',
      },
    }
  );
}
