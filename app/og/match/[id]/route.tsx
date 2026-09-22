/**
 * OG image generator — produce a 1200x630 PNG dinámico por fase.
 *
 * URL: /og/match/[id]?phase={convocatoria|titulares|equipos|playing|voting|closed}
 * Output: image/png para que WhatsApp/Twitter/Slack rendericen el preview.
 */
import { ImageResponse } from 'next/og';
import {
  fetchMatchForOG, PHASE_LABELS, PHASE_EMOJI,
  startersOf, benchOf, shortName, formatShortDate,
} from '@/lib/supabase';

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
  const teamA = match.team_a_name || 'Equipo A';
  const teamB = match.team_b_name || 'Equipo B';
  const dateLabel = formatShortDate(match.date);

  // Columna de nombres (para titulares / equipos)
  function nameColumn(title: string, color: string, items: string[], width: number) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width, gap: 4 }}>
        <div style={{ display: 'flex', fontSize: 26, fontWeight: 800, color, marginBottom: 6, opacity: title.trim() ? 1 : 0, minHeight: 32 }}>{title.trim() || '·'}</div>
        {items.length === 0 ? (
          <div style={{ display: 'flex', fontSize: 22, color: COLORS.gray }}>—</div>
        ) : items.map((n, i) => (
          <div key={i} style={{ display: 'flex', fontSize: 23, color: COLORS.white, lineHeight: 1.25 }}>{n}</div>
        ))}
      </div>
    );
  }

  // Líneas de goleadores por equipo (+ el MVP aunque no haya marcado)
  function scorerLines(team: 'a' | 'b') {
    const mvpId = match!.mvp_user_id;
    return match!.players
      .filter((p) => p.team === team && (p.goals > 0 || p.user_id === mvpId))
      .sort((a, b) => b.goals - a.goals || (a.user_id === mvpId ? -1 : 0))
      .map((p) => {
        const mvp = p.user_id === mvpId;
        const goals = p.goals > 0 ? ` ⚽${p.goals > 1 ? ` x${p.goals}` : ''}` : '';
        return { mvp, text: `${mvp ? '🏆 ' : ''}${shortName(p.name)}${goals}` };
      });
  }

  function renderClosed() {
    const la = scorerLines('a');
    const lb = scorerLines('b');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
        <div style={{ display: 'flex', fontSize: 28, color: COLORS.gray, marginBottom: 10 }}>
          {groupName}{dateLabel ? ` · ${dateLabel}` : ''}
        </div>
        {/* Marcador con nombres a cada lado */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28, width: '100%' }}>
          <div style={{ display: 'flex', flex: 1, justifyContent: 'flex-end', fontSize: 34, fontWeight: 700, color: COLORS.grayLight }}>{teamA}</div>
          <div style={{ display: 'flex', fontSize: 130, fontWeight: 800, letterSpacing: -6, lineHeight: 1, gap: 18, alignItems: 'center' }}>
            <span>{match!.team_a_score ?? 0}</span>
            <span style={{ color: COLORS.gray, fontSize: 70, fontWeight: 400 }}>-</span>
            <span>{match!.team_b_score ?? 0}</span>
          </div>
          <div style={{ display: 'flex', flex: 1, justifyContent: 'flex-start', fontSize: 34, fontWeight: 700, color: COLORS.grayLight }}>{teamB}</div>
        </div>
        {/* Goleadores: uno por línea bajo cada equipo, MVP marcado con 🏆 */}
        {(la.length || lb.length) ? (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 40, width: '100%', marginTop: 12 }}>
            <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              {la.map((l, i) => (
                <div key={i} style={{ display: 'flex', fontSize: 23, color: l.mvp ? COLORS.white : COLORS.grayLight, fontWeight: l.mvp ? 700 : 400, lineHeight: 1.25 }}>{l.text}</div>
              ))}
            </div>
            <div style={{ display: 'flex', width: 40 }} />
            <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              {lb.map((l, i) => (
                <div key={i} style={{ display: 'flex', fontSize: 23, color: l.mvp ? COLORS.white : COLORS.grayLight, fontWeight: l.mvp ? 700 : 400, lineHeight: 1.25 }}>{l.text}</div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex' }} />
        )}
        {match!.mvp_name && !match!.players.some((p) => p.user_id === match!.mvp_user_id && p.team) ? (
          <div style={{
            display: 'flex', marginTop: 18, fontSize: 30, color: COLORS.orange, alignItems: 'center', gap: 10,
            padding: '8px 26px', border: `2px solid ${COLORS.orange}`, borderRadius: 999,
          }}>
            <span>🏆 MVP</span>
            <span style={{ fontWeight: 800, color: COLORS.white }}>{match!.mvp_name}</span>
          </div>
        ) : (
          <div style={{ display: 'flex' }} />
        )}
      </div>
    );
  }

  // ⭐ Titulares definidos: lista de titulares en 2 columnas + banca ordenada
  function renderTitulares() {
    const starters = startersOf(match!.players).map((p) => shortName(p.name));
    const bench = benchOf(match!.players).map((p, i) => `${p.bench_order ?? i + 1}º ${shortName(p.name)}`);
    const half = Math.ceil(starters.length / 2);
    const col1 = starters.slice(0, half);
    const col2 = starters.slice(half);
    if (starters.length === 0) return renderOpen();
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
        <div style={{ display: 'flex', fontSize: 40, fontWeight: 800, marginBottom: 4 }}>⭐ Titulares</div>
        <div style={{ display: 'flex', fontSize: 24, color: COLORS.gray, marginBottom: 18 }}>
          {groupName}{dateLabel ? ` · ${dateLabel}` : ''}{match!.time ? ` · ${match!.time}` : ''}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 50, width: '100%' }}>
          {nameColumn(`Titulares (${starters.length})`, COLORS.green, col1, 300)}
          {nameColumn(' ', COLORS.green, col2, 300)}
          {nameColumn('🪑 Banca', COLORS.orange, bench, 300)}
        </div>
      </div>
    );
  }

  // 👕 Equipos armados / en juego: dos columnas por equipo + banca
  function renderEquipos() {
    const a = startersOf(match!.players, 'a').map((p) => shortName(p.name));
    const b = startersOf(match!.players, 'b').map((p) => shortName(p.name));
    const bench = benchOf(match!.players).map((p, i) => `${p.bench_order ?? i + 1}º ${shortName(p.name)}`);
    if (a.length === 0 && b.length === 0) return renderTitulares();
    const label = phase === 'playing' ? '⚽ En juego' : '👕 Equipos';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
        <div style={{ display: 'flex', fontSize: 40, fontWeight: 800, marginBottom: 4 }}>{label}</div>
        <div style={{ display: 'flex', fontSize: 24, color: COLORS.gray, marginBottom: 18 }}>
          {groupName}{dateLabel ? ` · ${dateLabel}` : ''}{match!.time ? ` · ${match!.time}` : ''}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 50, width: '100%' }}>
          {nameColumn(teamA, COLORS.white, a, 300)}
          {nameColumn(teamB, COLORS.orange, b, 300)}
          {nameColumn('🪑 Banca', COLORS.gray, bench, 300)}
        </div>
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
  else if (phase === 'titulares') content = renderTitulares();
  else if (phase === 'equipos' || phase === 'playing') content = renderEquipos();
  else content = renderOpen();

  // Con listas de nombres el logo ocupa menos espacio
  const compact = phase === 'titulares' || phase === 'equipos' || phase === 'playing' || phase === 'closed';

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
          padding: compact ? 40 : 70,
          color: COLORS.white,
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* Logo lockup */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: compact ? 18 : 50 }}>
          <div style={{
            display: 'flex',
            width: compact ? 52 : 80,
            height: compact ? 52 : 80,
            background: COLORS.green,
            borderRadius: compact ? 12 : 18,
            alignItems: 'center',
            justifyContent: 'center',
            color: COLORS.bg,
            fontSize: compact ? 26 : 40,
            fontWeight: 800,
            letterSpacing: -2,
          }}>
            IM
          </div>
          <div style={{
            display: 'flex',
            fontSize: compact ? 30 : 44,
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
        'Cache-Control': 'public, max-age=600, s-maxage=600',
        'Content-Type': 'image/png',
      },
    }
  );
}
