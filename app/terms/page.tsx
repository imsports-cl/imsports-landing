import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Términos de Servicio — IM SPORTS',
  description: 'Términos y condiciones de uso de IM SPORTS.',
};

const UPDATED = '2026-05-18';
const SUPPORT_EMAIL = 'admin@sportslink.cl';

export default function TermsPage() {
  return (
    <main style={styles.main}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.logoWrap}>
            <div style={styles.badge}>IM</div>
            <div style={styles.wordmark}>SPORTS</div>
          </div>
        </header>

        <h1 style={styles.h1}>Términos de Servicio</h1>
        <p style={styles.updatedLine}>Última actualización: {UPDATED}</p>

        <Section title="1. Aceptación">
          <p>
            Al crear una cuenta o usar IM SPORTS aceptás estos términos. Si no estás de acuerdo, no uses la app.
          </p>
        </Section>

        <Section title="2. Descripción del servicio">
          <p>
            IM SPORTS es una plataforma social deportiva que permite a grupos de amigos organizar partidos,
            registrar resultados, votar MVPs, compartir fotos y mantener su historial deportivo.
          </p>
        </Section>

        <Section title="3. Cuenta de usuario">
          <ul style={styles.ul}>
            <li>Debés tener al menos 13 años para crear una cuenta.</li>
            <li>Tu cuenta es personal e intransferible. No la compartas.</li>
            <li>Sos responsable de la actividad en tu cuenta.</li>
            <li>Avisanos inmediatamente si sospechás un uso no autorizado.</li>
          </ul>
        </Section>

        <Section title="4. Contenido del usuario">
          <p>
            Sos dueño del contenido que subís (fotos, comentarios, mensajes). Al subirlo nos otorgás una
            licencia limitada para mostrarlo dentro de la app a otros miembros de tu grupo.
          </p>
          <p>
            No publiques contenido ilegal, ofensivo, que infrinja derechos de terceros o que viole privacidad
            de otros. Nos reservamos el derecho a remover contenido inapropiado y suspender cuentas que
            repetidamente violen estas normas.
          </p>
        </Section>

        <Section title="5. Conducta">
          <ul style={styles.ul}>
            <li>Tratá a otros usuarios con respeto.</li>
            <li>No hagas spam ni intentes acceder a datos de otros usuarios sin autorización.</li>
            <li>No usés bots para manipular estadísticas o votos.</li>
            <li>No intentés vulnerar la seguridad del servicio.</li>
          </ul>
        </Section>

        <Section title="6. Disponibilidad">
          <p>
            Hacemos esfuerzos razonables por mantener el servicio disponible, pero no garantizamos
            uptime al 100%. Podemos hacer mantenimiento programado avisando con anticipación cuando sea posible.
          </p>
        </Section>

        <Section title="7. Modificaciones del servicio">
          <p>
            Podemos modificar, suspender o discontinuar features en cualquier momento. Si una modificación
            afecta sustancialmente cómo usás la app, te avisaremos con razonable antelación.
          </p>
        </Section>

        <Section title="8. Terminación">
          <p>
            Podés eliminar tu cuenta en cualquier momento escribiendo a{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} style={styles.link}>{SUPPORT_EMAIL}</a>.
          </p>
          <p>
            Podemos suspender o terminar tu cuenta si violás reiteradamente estos términos. Te
            notificaremos por email antes de terminar la cuenta, salvo violaciones graves.
          </p>
        </Section>

        <Section title="9. Limitación de responsabilidad">
          <p>
            IM SPORTS se entrega "tal cual". No nos hacemos responsables de:
          </p>
          <ul style={styles.ul}>
            <li>Disputas entre usuarios sobre marcadores, MVPs o votos.</li>
            <li>Lesiones físicas durante partidos organizados via la app.</li>
            <li>Pérdida de datos por falla técnica de proveedores externos.</li>
            <li>Daños indirectos o consecuentes derivados del uso.</li>
          </ul>
        </Section>

        <Section title="10. Propiedad intelectual">
          <p>
            La marca IM SPORTS, el logo, el diseño y el código son propiedad de SportsLink y están
            protegidos por leyes de propiedad intelectual. No los reproduzcas sin autorización.
          </p>
        </Section>

        <Section title="11. Ley aplicable">
          <p>
            Estos términos se rigen por la ley chilena. Las disputas se resolverán en los tribunales
            de Santiago de Chile.
          </p>
        </Section>

        <Section title="12. Contacto">
          <p>
            Para cualquier consulta legal o sobre estos términos: <a href={`mailto:${SUPPORT_EMAIL}`} style={styles.link}>{SUPPORT_EMAIL}</a>
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
