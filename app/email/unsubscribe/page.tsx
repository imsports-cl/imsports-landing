/**
 * GET /email/unsubscribe?token=...
 *
 * Solo muestra una página de confirmación. No da de baja.
 * El botón hace POST a la edge email-unsubscribe (ver docs/EMAIL-UNSUBSCRIBE-CONTRACT.md).
 * Tras un POST exitoso, la edge redirige aquí con ?status=ok (o error).
 */
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata: Metadata = {
  title: 'Baja de correo — IM SPORTS',
  description: 'Confirma si quieres dejar de recibir este tipo de correo de IM SPORTS.',
  robots: { index: false, follow: false },
};

const EDGE_UNSUBSCRIBE =
  `${process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://whxufmuakpmuyiatfttr.supabase.co'}/functions/v1/email-unsubscribe`;

interface Props {
  searchParams: { token?: string; status?: string };
}

export default function UnsubscribePage({ searchParams }: Props) {
  const token = typeof searchParams.token === 'string' ? searchParams.token : '';
  const status = typeof searchParams.status === 'string' ? searchParams.status : '';

  let title = '¿Quieres darte de baja?';
  let body = 'Esto solo corta este tipo de correo (felicitaciones de MVP o el resumen mensual). El resto de tus avisos no cambia. Puedes volver a activarlos en Ajustes, en la app.';
  let showForm = Boolean(token);

  if (status === 'ok') {
    title = 'Listo, te das de baja';
    body = 'Ya no te vamos a mandar este tipo de correo. El resto de tus avisos no cambia. Puedes volver a activarlos en Ajustes, en la app.';
    showForm = false;
  } else if (status === 'error') {
    title = 'No se pudo completar';
    body = 'Inténtalo más tarde o entra a Ajustes en la app.';
    showForm = Boolean(token);
  } else if (!token) {
    title = 'El enlace no es válido';
    body = 'Falta el token de baja. Abre el enlace que llegó en el correo.';
    showForm = false;
  }

  return (
    <main style={styles.main}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>IM</span>
          <span style={styles.logoWord}>SPORTS</span>
        </div>
        <h1 style={styles.h1}>{title}</h1>
        <p style={styles.p}>{body}</p>
        {showForm ? (
          <form method="POST" action={EDGE_UNSUBSCRIBE} style={styles.form}>
            <input type="hidden" name="token" value={token} />
            <button type="submit" style={styles.button}>Confirmar baja</button>
          </form>
        ) : null}
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
  logoWord: { fontWeight: 800, fontSize: 22 },
  h1: { fontSize: 22, margin: '0 0 12px' },
  p: { color: '#A0A0A0', lineHeight: 1.55, margin: '0 0 24px' },
  form: { margin: 0 },
  button: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    background: '#FF6B35',
    color: '#fff',
    border: 'none',
    padding: '14px 18px',
    borderRadius: 12,
    fontWeight: 700,
    fontSize: 16,
    cursor: 'pointer',
  },
  hint: { fontSize: 13, color: '#6B6B6B', marginTop: 24 },
};
