'use client';

import { useEffect } from 'react';

function safeSegment(value: string): string {
  // Next puede entregar el segmento todavía encodeado; decode + encode
  // una vez evita %22 → %2522. Un UUID no cambia.
  try {
    return encodeURIComponent(decodeURIComponent(value));
  } catch {
    return encodeURIComponent(value);
  }
}

export default function OpenAppButton({ matchId, card }: { matchId: string; card: string }) {
  const path = matchId
    ? `/match/${safeSegment(matchId)}/share?card=${safeSegment(card || 'mvp')}`
    : '/';
  const href = `imsports:/${path}`;

  useEffect(() => {
    if (!matchId) return;
    // Intento de abrir la app; si no está, la persona queda en esta página.
    window.location.href = href;
  }, [href, matchId]);

  return (
    <a href={href} style={btnStyle}>
      Abrir en IM SPORTS
    </a>
  );
}

const btnStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  background: '#FF6B35',
  color: '#fff',
  textDecoration: 'none',
  padding: '14px 18px',
  borderRadius: 12,
  fontWeight: 700,
  fontSize: 16,
  marginBottom: 10,
  textAlign: 'center',
};
