import type { Metadata } from 'next';
import RecuperarForm from './RecuperarForm';

// Página para crear una nueva contraseña desde el correo de recuperación,
// sin depender del deep link de la app (que se pierde con la app en segundo
// plano y que los escáneres de Outlook/Safe Links pueden pre-abrir).
export const metadata: Metadata = {
  title: 'Recupera tu contraseña — IM SPORTS',
  description: 'Crea una nueva contraseña para tu cuenta de IM SPORTS.',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function RecuperarPage() {
  return <RecuperarForm />;
}
