import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Eliminar cuenta — IM SPORTS',
  description:
    'Cómo eliminar tu cuenta de IM SPORTS y qué datos se borran o conservan.',
};

export default function EliminarCuentaPage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '48px 24px',
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        color: '#1a1a1a',
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1 }}>
        Eliminar tu cuenta de IM SPORTS
      </h1>
      <p>
        Esta página explica cómo eliminar tu cuenta de la app{' '}
        <strong>IM SPORTS</strong> (desarrollador: IM SPORTS / SportsLink) y qué
        pasa con tus datos.
      </p>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginTop: 32 }}>
        Opción 1 — Desde la app (recomendado)
      </h2>
      <ol>
        <li>Abre IM SPORTS e inicia sesión.</li>
        <li>
          Ve a <strong>Perfil → Configuración → Eliminar cuenta</strong>.
        </li>
        <li>Confirma la eliminación.</li>
      </ol>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginTop: 32 }}>
        Opción 2 — Por correo
      </h2>
      <p>
        Escribe a{' '}
        <a href="mailto:admin@sportslink.cl">admin@sportslink.cl</a> desde el
        correo asociado a tu cuenta, con el asunto “Eliminar cuenta”.
        Procesaremos la solicitud en un plazo máximo de 30 días.
      </p>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginTop: 32 }}>
        ¿Qué datos se eliminan?
      </h2>
      <ul>
        <li>
          <strong>Se eliminan:</strong> tu nombre, correo electrónico, foto de
          perfil, apodos, preferencias de notificaciones, token de
          notificaciones push y credenciales de acceso.
        </li>
        <li>
          <strong>Pueden conservarse de forma anónima:</strong> el historial
          agregado de partidos del grupo (marcadores, goles, MVP), sin
          identificadores que apunten a tu persona, como parte del registro
          histórico del grupo.
        </li>
      </ul>
      <p>
        No hay períodos de retención adicionales, salvo obligaciones legales.
        Más detalles en nuestra{' '}
        <Link href="/privacy">Política de Privacidad</Link>.
      </p>

      <p style={{ marginTop: 48, fontSize: 14, color: '#888' }}>
        <Link href="/">← Volver a imsports.app</Link>
      </p>
    </main>
  );
}
