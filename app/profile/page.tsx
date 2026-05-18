import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Mi perfil — IM SPORTS',
  description: 'Tu perfil deportivo en IM SPORTS',
};

export default function ProfilePage() {
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
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 12 }}>📲 Abriendo tu perfil en la app...</h1>
      <a href="https://apps.apple.com/app/id6761868170" style={{
        background: '#FF6B2B', padding: '14px 26px', borderRadius: 14,
        fontWeight: 700, fontSize: 16, color: '#fff', marginTop: 16,
      }}>Descargar en App Store</a>
    </main>
  );
}
