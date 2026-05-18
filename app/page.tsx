/**
 * Home page (/) — convertida desde el index.html legacy.
 *
 * Si querés mantener el index.html legacy intacto, podés borrar este archivo
 * y poner el HTML en public/index.html (Next.js lo servirá directo si no hay
 * page.tsx en /). Recomendado: usar este page.tsx para que aproveche el layout
 * y los OG tags globales.
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'IM SPORTS — Tu comunidad deportiva',
  description: 'La app donde tu grupo deportivo vive, compite y crece. Próximamente en App Store y Google Play.',
};

export default function HomePage() {
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 40 }}>
        <div style={{
          width: 72, height: 72, background: '#00E676', borderRadius: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#0A0A0A', fontSize: 34, fontWeight: 800, letterSpacing: -1.5,
        }}>IM</div>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1 }}>SPORTS</div>
      </div>

      <h1 style={{
        fontSize: 'clamp(28px, 6vw, 44px)',
        fontWeight: 800,
        letterSpacing: -1.2,
        lineHeight: 1.1,
        marginBottom: 16,
        maxWidth: 620,
      }}>
        Tu grupo deportivo<br />
        <span style={{ color: '#00E676' }}>vive, compite y crece</span>
      </h1>

      <p style={{
        fontSize: 'clamp(15px, 3vw, 18px)',
        color: '#aaa',
        marginBottom: 36,
        maxWidth: 520,
        lineHeight: 1.55,
      }}>
        IM SPORTS es la plataforma donde tu grupo lleva su historial,
        estadísticas, rankings y convocatorias. Todo en un solo lugar.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 320 }}>
        <a
          href="https://apps.apple.com/app/id6761868170"
          style={{
            background: '#FF6B2B',
            padding: '16px 24px',
            borderRadius: 14,
            fontWeight: 700,
            fontSize: 16,
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          📲 Descargar en App Store
        </a>
        <span style={{ fontSize: 13, color: '#666' }}>
          Próximamente en Google Play
        </span>
      </div>

      <p style={{ marginTop: 'auto', paddingTop: 60, fontSize: 12, color: '#555' }}>
        imsports.app · La comunidad deportiva
      </p>
    </main>
  );
}
