import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Cuenta confirmada — IM SPORTS',
  description: 'Tu cuenta de IM SPORTS quedó activa.',
  other: {
    'apple-itunes-app': 'app-id=6761868170',
  },
};

const APP_SCHEME = 'imsports://';
const APP_STORE_URL = 'https://apps.apple.com/app/id6761868170';

export default function ConfirmadoPage() {
  return (
    <main style={styles.main}>
      <div style={styles.container}>
        {/* Logo */}
        <div style={styles.logoWrap}>
          <div style={styles.badge}>IM</div>
          <div style={styles.wordmark}>SPORTS</div>
        </div>

        {/* Check de éxito */}
        <div style={styles.checkCircle}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M20 6L9 17l-5-5"
              stroke="#0A0A0A"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1 style={styles.h1}>¡Cuenta confirmada!</h1>
        <p style={styles.subtitle}>
          Tu cuenta ya está activa. Vuelve a IM SPORTS e inicia sesión para empezar a
          registrar partidos y competir con tu grupo.
        </p>

        {/* CTA abrir app */}
        <a href={APP_SCHEME} style={styles.primaryBtn}>
          Abrir IM SPORTS
        </a>

        {/* Fallback App Store */}
        <a href={APP_STORE_URL} style={styles.secondaryLink}>
          ¿No tienes la app? Descárgala aquí
        </a>

        <div style={styles.footer}>
          <div style={styles.footerLogo}>
            <span style={{ color: '#00E676' }}>IM</span> SPORTS
          </div>
          <p style={styles.footerCopy}>Registra partidos · Compite con tu grupo · Vive el deporte</p>
        </div>
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
    color: '#1a1a1a',
    background: '#ffffff',
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
  },
  container: {
    maxWidth: 420,
    width: '100%',
    margin: '0 auto',
    textAlign: 'center',
    lineHeight: 1.6,
  },
  logoWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 40,
  },
  badge: {
    width: 44,
    height: 44,
    background: '#00E676',
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#0A0A0A',
    fontWeight: 800,
    fontSize: 20,
    letterSpacing: -1,
  },
  wordmark: { fontSize: 20, fontWeight: 800, letterSpacing: -1, color: '#0A0A0A' },
  checkCircle: {
    width: 88,
    height: 88,
    borderRadius: '50%',
    background: '#00E676',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 24px auto',
    boxShadow: '0 8px 30px rgba(0, 230, 118, 0.35)',
  },
  h1: { fontSize: 30, fontWeight: 800, marginBottom: 12, letterSpacing: -1, color: '#0A0A0A' },
  subtitle: { fontSize: 16, color: '#555', marginBottom: 32 },
  primaryBtn: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    padding: '16px 24px',
    background: '#FF6B2B',
    color: '#0A0A0A',
    fontSize: 16,
    fontWeight: 700,
    borderRadius: 999,
    textDecoration: 'none',
    marginBottom: 16,
  },
  secondaryLink: {
    display: 'inline-block',
    color: '#FF6B2B',
    fontSize: 14,
    textDecoration: 'underline',
  },
  footer: {
    marginTop: 48,
    paddingTop: 24,
    borderTop: '1px solid #eee',
  },
  footerLogo: { fontSize: 15, fontWeight: 800, letterSpacing: -0.5, color: '#0A0A0A', marginBottom: 6 },
  footerCopy: { fontSize: 12, color: '#888' },
};
