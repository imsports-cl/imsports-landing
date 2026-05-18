import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface Props { params: { id: string }; }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { data } = await supabase
    .from('groups')
    .select('name, sport, description')
    .eq('id', params.id)
    .single();

  if (!data) return { title: 'IM SPORTS' };

  const title = `${data.name} — IM SPORTS`;
  const description = data.description || `Comunidad deportiva de ${data.sport || 'fútbol'} en IM SPORTS`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `https://imsports.app/group/${params.id}`,
      siteName: 'IM SPORTS',
    },
  };
}

export default function GroupPage({ params }: Props) {
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
        <div style={{
          width: 64, height: 64, background: '#00E676', borderRadius: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#0A0A0A', fontSize: 30, fontWeight: 800, letterSpacing: -1.5,
        }}>IM</div>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -1 }}>SPORTS</div>
      </div>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 12 }}>📲 Abriendo el grupo en la app...</h1>
      <a href="https://apps.apple.com/app/id6761868170" style={{
        background: '#FF6B2B', padding: '14px 26px', borderRadius: 14,
        fontWeight: 700, fontSize: 16, color: '#fff', marginTop: 16,
      }}>Descargar en App Store</a>
    </main>
  );
}
