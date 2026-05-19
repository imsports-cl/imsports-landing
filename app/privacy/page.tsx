import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Política de Privacidad — IM SPORTS',
  description: 'Cómo IM SPORTS recopila, usa y protege tu información personal.',
};

const UPDATED = '2026-05-18';
const SUPPORT_EMAIL = 'admin@sportslink.cl';

export default function PrivacyPage() {
  return (
    <main style={styles.main}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.logoWrap}>
            <div style={styles.badge}>IM</div>
            <div style={styles.wordmark}>SPORTS</div>
          </div>
        </header>

        <h1 style={styles.h1}>Política de Privacidad</h1>
        <p style={styles.updatedLine}>Última actualización: {UPDATED}</p>

        <Section title="1. Introducción">
          <p>
            IM SPORTS (operada bajo el nombre comercial SportsLink, en adelante "nosotros", "la app")
            respeta tu privacidad. Esta política describe qué información recopilamos, cómo la usamos,
            con quién la compartimos y los derechos que tienes sobre ella.
          </p>
          <p>
            Al usar la app aceptas las prácticas descritas en este documento.
          </p>
        </Section>

        <Section title="2. Información que recopilamos">
          <ul style={styles.ul}>
            <li><strong>Datos de cuenta:</strong> nombre, email, foto de perfil, fecha de nacimiento (opcional), nickname.</li>
            <li><strong>Autenticación:</strong> credenciales gestionadas vía Apple Sign-In o Google Sign-In (no almacenamos contraseñas).</li>
            <li><strong>Datos de uso deportivo:</strong> grupos a los que perteneces, partidos en los que participas, votos MVP, goles registrados, estadísticas.</li>
            <li><strong>Contenido generado por el usuario:</strong> fotos que subes a los grupos, comentarios en fotos, mensajes en el chat del grupo, ubicación textual de los partidos.</li>
            <li><strong>Token de notificaciones push:</strong> identificador anónimo de Expo/APNs para enviarte notificaciones.</li>
            <li><strong>Preferencias de notificaciones:</strong> qué eventos te interesan recibir por push o email.</li>
          </ul>
          <p>
            <strong>NO recopilamos:</strong> ubicación GPS continua, contactos del teléfono, datos financieros,
            historial de navegación, ni información biométrica.
          </p>
        </Section>

        <Section title="3. Cómo usamos tu información">
          <ul style={styles.ul}>
            <li>Operar el servicio: mostrar tus grupos, convocatorias, marcadores y estadísticas.</li>
            <li>Enviarte notificaciones de eventos relevantes (convocatorias, resultados, MVP), respetando tus preferencias.</li>
            <li>Mantener la integridad del servicio (anti-fraude, prevención de spam, backups).</li>
            <li>Mejorar la app: analizar uso agregado y anónimo para priorizar features.</li>
          </ul>
          <p>
            No vendemos tus datos personales a terceros. No usamos tus datos para publicidad personalizada
            de terceros.
          </p>
        </Section>

        <Section title="4. Compartición con terceros">
          <p>Para operar el servicio compartimos información mínima necesaria con los siguientes proveedores:</p>
          <ul style={styles.ul}>
            <li><strong>Supabase</strong> (base de datos y autenticación) — almacena los datos de cuenta y actividad.</li>
            <li><strong>SendGrid</strong> (Twilio) — envía emails transaccionales (convocatorias, resultados).</li>
            <li><strong>Expo</strong> (push notifications) — entrega notificaciones push a tu dispositivo.</li>
            <li><strong>Apple App Store Connect</strong> — gestiona la distribución y autenticación con Apple ID.</li>
            <li><strong>Google</strong> — autenticación opcional con Google Sign-In.</li>
            <li><strong>Vercel</strong> — sirve las páginas web (landing, deep links).</li>
          </ul>
          <p>
            Estos proveedores actúan como procesadores de datos y están sujetos a sus propios términos de
            privacidad.
          </p>
        </Section>

        <Section title="5. Retención de datos">
          <p>
            Conservamos tu información mientras tu cuenta esté activa. Si solicitas eliminar tu cuenta,
            removeremos tus datos personales (email, nombre, foto) en un plazo máximo de 30 días.
          </p>
          <p>
            <strong>Excepción:</strong> el historial agregado de partidos (marcador, MVP, goles) puede mantenerse
            de forma anónima como parte del registro histórico del grupo, sin identificadores que te apunten directamente.
          </p>
        </Section>

        <Section title="6. Tus derechos">
          <p>Tienes derecho a:</p>
          <ul style={styles.ul}>
            <li><strong>Acceder</strong> a la información personal que tenemos sobre ti.</li>
            <li><strong>Rectificar</strong> datos incorrectos.</li>
            <li><strong>Eliminar</strong> tu cuenta y datos personales.</li>
            <li><strong>Exportar</strong> tus datos en formato legible.</li>
            <li><strong>Revocar consentimiento</strong> para notificaciones en cualquier momento.</li>
          </ul>
          <p>
            Para ejercer estos derechos, escribinos a <a href={`mailto:${SUPPORT_EMAIL}`} style={styles.link}>{SUPPORT_EMAIL}</a>.
          </p>
        </Section>

        <Section title="7. Seguridad">
          <p>
            Implementamos medidas técnicas y organizativas razonables: cifrado en tránsito (TLS),
            cifrado en reposo, Row Level Security en la base de datos, y acceso limitado a personal autorizado.
            Sin embargo, ningún sistema es 100% seguro: te recomendamos usar contraseñas únicas en los servicios
            de terceros que uses para iniciar sesión.
          </p>
        </Section>

        <Section title="8. Menores de edad">
          <p>
            IM SPORTS está dirigida a personas de 13 años o más. No recopilamos conscientemente información
            de menores de 13 años. Si descubrís que un menor ha creado una cuenta sin consentimiento parental,
            escribinos para eliminarla.
          </p>
        </Section>

        <Section title="9. Cambios en esta política">
          <p>
            Podemos actualizar esta política periódicamente. Los cambios significativos se anunciarán dentro
            de la app o por email. La fecha de "última actualización" arriba indica la versión vigente.
          </p>
        </Section>

        <Section title="10. Contacto">
          <p>
            ¿Dudas sobre privacidad? Escribinos a{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} style={styles.link}>{SUPPORT_EMAIL}</a>.
          </p>
          <p>
            Operamos desde Chile. Las disputas se rigen por la legislación chilena aplicable
            (Ley 19.628 sobre Protección de la Vida Privada).
          </p>
        </Section>

        <footer style={styles.footer}>
          <p><a href="/" style={styles.link}>← Volver a imsports.app</a></p>
          <p style={styles.footerCopy}>© 2026 IM SPORTS · Hecho con ⚽ en Chile</p>
        </footer>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={styles.section}>
      <h2 style={styles.h2}>{title}</h2>
      {children}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: '100vh',
    padding: 24,
    color: '#1a1a1a',
    background: '#ffffff',
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
  },
  container: {
    maxWidth: 720,
    margin: '0 auto',
    lineHeight: 1.6,
  },
  header: { marginBottom: 32 },
  logoWrap: { display: 'flex', alignItems: 'center', gap: 10 },
  badge: {
    width: 48, height: 48, background: '#00E676', borderRadius: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#0A0A0A', fontWeight: 800, fontSize: 22, letterSpacing: -1,
  },
  wordmark: { fontSize: 22, fontWeight: 800, letterSpacing: -1, color: '#0A0A0A' },
  h1: { fontSize: 36, fontWeight: 800, marginBottom: 8, letterSpacing: -1, color: '#0A0A0A' },
  updatedLine: { color: '#666', fontSize: 14, marginBottom: 32 },
  section: { marginBottom: 28 },
  h2: { fontSize: 20, fontWeight: 700, marginBottom: 12, color: '#0A0A0A' },
  ul: { paddingLeft: 22, marginBottom: 12 },
  link: { color: '#FF6B2B', textDecoration: 'underline' },
  footer: { marginTop: 48, paddingTop: 24, borderTop: '1px solid #eee', color: '#666' },
  footerCopy: { fontSize: 12, marginTop: 8 },
};
