'use client';

/**
 * Panel Admin IM SPORTS — imsports.app/admin
 * Acceso: solo emails en la allowlist del API (/admin/api).
 * Login con Google o email+clave (cuentas de la app).
 */
import { useEffect, useMemo, useState } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://whxufmuakpmuyiatfttr.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoeHVmbXVha3BtdXlpYXRmdHRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NDgxOTEsImV4cCI6MjA5MDEyNDE5MX0.TB5FXT570-RyM8rW56Gsxj92LoXOhs_DtypZiZP1xiY'
);

interface RankRow { nombre: string; is_ghost: boolean; pj: number; v: number; e: number; d: number; goles: number; mvp: number; }
interface RegRow { nombre: string; email: string; registrado: string; ultimo_acceso: string | null; partidos: number; }
interface PanelData { fechas: string[]; ranking: RankRow[]; registrados: RegRow[]; }

const S = {
  bg: '#0A0A0A', card: '#161616', border: '#2A2A2A',
  accent: '#00E676', text: '#FFFFFF', dim: '#9A9A9A',
};

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [data, setData] = useState<PanelData | null>(null);
  const [denied, setDenied] = useState(false);
  const [tab, setTab] = useState<'ranking' | 'registrados'>('ranking');

  useEffect(() => {
    supa.auth.getSession().then(({ data: { session } }) => { setSession(session); setReady(true); });
    const { data: sub } = supa.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setData(null); setDenied(false); return; }
    fetch('/admin/api', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (r) => {
        if (r.status === 403) { setDenied(true); return null; }
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((d) => d && setData(d))
      .catch(() => setDenied(true));
  }, [session]);

  const loginGoogle = () =>
    supa.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: typeof window !== 'undefined' ? window.location.href : undefined, queryParams: { prompt: 'select_account' } },
    });

  const loginEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErr('');
    const { error } = await supa.auth.signInWithPassword({ email, password: pass });
    if (error) setLoginErr('Credenciales incorrectas');
  };

  const registradosOrdenados = useMemo(
    () => (data ? [...data.registrados] : []),
    [data]
  );

  const box: React.CSSProperties = { background: S.card, border: `1px solid ${S.border}`, borderRadius: 14, padding: 20 };
  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', color: S.dim, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${S.border}` };
  const td: React.CSSProperties = { padding: '8px 10px', borderBottom: `1px solid ${S.border}`, fontSize: 14 };

  return (
    <main style={{ minHeight: '100vh', background: S.bg, color: S.text, fontFamily: 'Inter, -apple-system, sans-serif', padding: '32px 16px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, background: S.accent, color: '#0A0A0A', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>IM</div>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Panel Admin · Galletas + Ibáñez</h1>
          </div>
          {session && (
            <button onClick={() => supa.auth.signOut()} style={{ background: 'none', border: `1px solid ${S.border}`, color: S.dim, borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
              Salir
            </button>
          )}
        </header>

        {!ready ? null : !session ? (
          <div style={{ ...box, maxWidth: 380, margin: '60px auto', textAlign: 'center' }}>
            <p style={{ color: S.dim, marginBottom: 20 }}>Acceso restringido. Entra con tu cuenta IM SPORTS.</p>
            <button onClick={loginGoogle} style={{ width: '100%', background: '#fff', color: '#111', border: 'none', borderRadius: 10, padding: '12px', fontWeight: 700, cursor: 'pointer', marginBottom: 14 }}>
              Continuar con Google
            </button>
            <form onSubmit={loginEmail}>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email"
                style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8, padding: 11, borderRadius: 10, border: `1px solid ${S.border}`, background: '#0F0F0F', color: S.text }} />
              <input value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Contraseña" type="password"
                style={{ width: '100%', boxSizing: 'border-box', marginBottom: 12, padding: 11, borderRadius: 10, border: `1px solid ${S.border}`, background: '#0F0F0F', color: S.text }} />
              <button type="submit" style={{ width: '100%', background: S.accent, color: '#0A0A0A', border: 'none', borderRadius: 10, padding: '12px', fontWeight: 800, cursor: 'pointer' }}>
                Iniciar sesión
              </button>
              {loginErr && <p style={{ color: '#FF6B6B', fontSize: 13, marginTop: 10 }}>{loginErr}</p>}
            </form>
          </div>
        ) : denied ? (
          <div style={{ ...box, maxWidth: 420, margin: '60px auto', textAlign: 'center' }}>
            <p style={{ fontSize: 40, margin: '0 0 10px' }}>🔒</p>
            <p>Tu cuenta ({session.user.email}) no tiene acceso a este panel.</p>
          </div>
        ) : !data ? (
          <p style={{ color: S.dim, textAlign: 'center', marginTop: 60 }}>Cargando…</p>
        ) : (
          <>
            <nav style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
              {(['ranking', 'registrados'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  style={{ padding: '8px 16px', borderRadius: 100, border: `1px solid ${tab === t ? S.accent : S.border}`, background: tab === t ? 'rgba(0,230,118,0.12)' : 'transparent', color: tab === t ? S.accent : S.dim, fontWeight: 700, cursor: 'pointer' }}>
                  {t === 'ranking' ? `⚽ Últimas 12 pichangas` : `👥 Registrados (${data.registrados.length})`}
                </button>
              ))}
            </nav>

            {tab === 'ranking' && (
              <section style={box}>
                <p style={{ color: S.dim, fontSize: 13, marginTop: 0 }}>
                  Fechas: {data.fechas[data.fechas.length - 1]} → {data.fechas[0]} · ordenado por asistencia (criterio de cupos)
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      <th style={th}>#</th><th style={th}>Jugador</th><th style={th}>PJ</th><th style={th}>V</th><th style={th}>E</th><th style={th}>D</th><th style={th}>Goles</th><th style={th}>MVP</th>
                    </tr></thead>
                    <tbody>
                      {data.ranking.map((r, i) => (
                        <tr key={r.nombre + i}>
                          <td style={{ ...td, color: S.dim }}>{i + 1}</td>
                          <td style={{ ...td, fontWeight: 600 }}>{r.nombre}{r.is_ghost ? ' 🍪' : ''}</td>
                          <td style={{ ...td, color: S.accent, fontWeight: 800 }}>{r.pj}</td>
                          <td style={td}>{r.v}</td><td style={td}>{r.e}</td><td style={td}>{r.d}</td>
                          <td style={td}>{r.goles}</td><td style={td}>{r.mvp}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {tab === 'registrados' && (
              <section style={box}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      <th style={th}>Jugador</th><th style={th}>Email</th><th style={th}>Registrado</th><th style={th}>Último acceso</th><th style={th}>Partidos</th>
                    </tr></thead>
                    <tbody>
                      {registradosOrdenados.map((r) => (
                        <tr key={r.email}>
                          <td style={{ ...td, fontWeight: 600 }}>{r.nombre}</td>
                          <td style={{ ...td, color: S.dim }}>{r.email}</td>
                          <td style={td}>{r.registrado}</td>
                          <td style={{ ...td, color: S.dim }}>{r.ultimo_acceso || '—'}</td>
                          <td style={td}>{r.partidos}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
