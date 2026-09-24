'use client';

/**
 * Panel Admin IM SPORTS — imsports.app/admin
 * Acceso: solo emails en la allowlist del API (/admin/api).
 * Login con Google o email+clave (cuentas de la app).
 */
import { useEffect, useMemo, useState } from 'react';
import Novedades from './Novedades';
import { createClient, type Session } from '@supabase/supabase-js';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://whxufmuakpmuyiatfttr.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoeHVmbXVha3BtdXlpYXRmdHRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NDgxOTEsImV4cCI6MjA5MDEyNDE5MX0.TB5FXT570-RyM8rW56Gsxj92LoXOhs_DtypZiZP1xiY'
);

interface RankRow { nombre: string; is_ghost: boolean; pj: number; v: number; e: number; d: number; goles: number; mvp: number; }
interface RegRow { nombre: string; email: string; registrado: string; ultimo_acceso: string | null; partidos: number; }
interface LineupPlayer {
  user_id: string; nombre: string; pj: number; orden: number; pos: number;
  titular: boolean; asegurado: boolean; es_mvp: boolean; es_organizador: boolean;
  sancionado: boolean; sancion_motivo: string | null; neteado: boolean;
  confirmo_tarde: boolean;
  asegura_hasta: string | null; confirmo_at: string | null;
}
interface SancionRow { user_id: string; nombre: string; motivo: string; confirmo: boolean; neteado: boolean }
interface CupoRow { user_id: string; nombre: string; hasta: string; es_mvp: boolean; es_organizador: boolean; manual: boolean; }
interface Lineup {
  match: { id: string; fecha: string; hora: string | null; lugar: string | null; fase: string; cupos: number; organizador: string | null };
  mvp_previo: string | null;
  fecha_previa: string | null;
  jugadores: LineupPlayer[];
  asegurados_sin_confirmar: { user_id: string; nombre: string; asegura_hasta: string; estado: string }[];
  cupos_asegurados: CupoRow[];
  sanciones: SancionRow[];
  bajados: { user_id: string; nombre: string; sancionado: boolean }[];
}
const MOTIVOS: Record<string, string> = {
  no_pago: '💸 No pagó a tiempo',
  atraso: '⏰ Llegó tarde',
  bajo_tarde: '🚪 Se bajó pasadas las 13:00',
};
interface Miembro { user_id: string; nombre: string }
interface PanelData { fechas: string[]; ranking: RankRow[]; registrados: RegRow[]; lineup: Lineup; miembros: Miembro[]; }

/** Fecha corta legible: 2026-09-28 → "28 sep" */
const fechaCorta = (iso: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${d} ${meses[m - 1]}`;
};
const horaCorta = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

// ─── Moderación (App Store Guideline 1.2) ───────────────────────────────
interface UserRef { id: string; display_name: string | null; email: string | null; suspended_at?: string | null; }
interface Denuncia {
  id: string; kind: string; target_id: string | null; reason: string;
  content_snapshot: string | null; created_at: string;
  reporter: UserRef | null; denunciado: UserRef | null; grupo: { id: string; name: string } | null;
}
interface Suspendido { id: string; display_name: string | null; email: string | null; suspended_at: string; suspended_reason: string | null; }
interface ModData { denuncias: Denuncia[]; suspendidos: Suspendido[]; }

const KIND_LABEL: Record<string, string> = {
  group_message: 'Mensaje de chat', group_photo: 'Foto',
  photo_comment: 'Comentario', user: 'Perfil',
};

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
  const [tab, setTab] = useState<'titulares' | 'ranking' | 'registrados' | 'moderacion' | 'novedades'>('titulares');
  const [mod, setMod] = useState<ModData | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [cupos, setCupos] = useState(12);
  const [busy, setBusy] = useState(false);
  // Form para agregar cupo manual
  const [nuevoUser, setNuevoUser] = useState('');
  const [nuevaFecha, setNuevaFecha] = useState('');
  // Form "pierde cupo"
  const [sancUser, setSancUser] = useState('');
  const [sancMotivo, setSancMotivo] = useState('atraso');

  useEffect(() => {
    supa.auth.getSession().then(({ data: { session } }) => { setSession(session); setReady(true); });
    const { data: sub } = supa.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const cargar = async (tok: string, n = cupos) => {
    const r = await fetch(`/admin/api?cupos=${n}`, { headers: { Authorization: `Bearer ${tok}` } });
    if (r.status === 403) { setDenied(true); return; }
    if (!r.ok) { setDenied(true); return; }
    setData(await r.json());
  };

  useEffect(() => {
    if (!session) { setData(null); setDenied(false); return; }
    cargar(session.access_token).catch(() => setDenied(true));
  }, [session, cupos]);

  /** Cupos asegurados (agregar/quitar/restaurar) y sanciones (sancionar/quitar_sancion) */
  const mutarCupo = async (accion: string, user_id: string, hasta?: string, reason?: string) => {
    if (!session) return;
    setBusy(true);
    try {
      await fetch('/admin/api', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion, user_id, hasta, reason }),
      });
      await cargar(session.access_token);
    } finally { setBusy(false); }
  };

  /** El jugador avisó por fuera que no va: queda fuera y NO asegura cupo. */
  const bajarJugador = async (user_id: string, nombre: string) => {
    if (!session || !data?.lineup) return;
    const msg = `¿Bajar a ${nombre} de esta pichanga?\n\n` +
      `Queda fuera de titulares y banca, y NO asegura cupo para las próximas fechas.\n\n` +
      `Aceptar = además pierde cupo la próxima fecha (avisó pasadas las 13:00).\n` +
      `Cancelar = avisó dentro de plazo, sin sanción.`;
    // eslint-disable-next-line no-alert
    const sancionar = window.confirm(msg);
    setBusy(true);
    try {
      await fetch('/admin/api', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'bajar', user_id, match_id: data.lineup.match.id, sancionar }),
      });
      await cargar(session.access_token);
    } finally { setBusy(false); }
  };

  const reincorporar = async (user_id: string) => {
    if (!session || !data?.lineup) return;
    setBusy(true);
    try {
      await fetch('/admin/api', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'reincorporar', user_id, match_id: data.lineup.match.id }),
      });
      await cargar(session.access_token);
    } finally { setBusy(false); }
  };

  // Moderación: se carga aparte, solo al abrir la pestaña.
  const cargarModeracion = async () => {
    if (!session) return;
    const r = await fetch('/admin/api/moderacion', { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (r.ok) setMod(await r.json());
  };
  useEffect(() => { if (tab === 'moderacion') cargarModeracion(); /* eslint-disable-next-line */ }, [tab, session]);

  const accionMod = async (payload: Record<string, unknown>, clave: string, confirmar?: string) => {
    if (!session) return;
    if (confirmar && !window.confirm(confirmar)) return;
    setOcupado(clave);
    try {
      const r = await fetch('/admin/api/moderacion', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) { alert((await r.json().catch(() => ({}))).error ?? 'No se pudo completar la acción'); return; }
      await cargarModeracion();
    } finally { setOcupado(null); }
  };

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
            <nav style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
              {(['titulares', 'ranking', 'registrados', 'moderacion', 'novedades'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  style={{ padding: '8px 16px', borderRadius: 100, border: `1px solid ${tab === t ? S.accent : S.border}`, background: tab === t ? 'rgba(0,230,118,0.12)' : 'transparent', color: tab === t ? S.accent : S.dim, fontWeight: 700, cursor: 'pointer' }}>
                  {t === 'titulares'
                    ? `🎯 Titulares`
                    : t === 'ranking'
                    ? `⚽ Últimas 12 pichangas`
                    : t === 'registrados'
                    ? `👥 Registrados (${data.registrados.length})`
                    : t === 'novedades'
                    ? `📣 Novedades`
                    : `🛡️ Moderación${mod?.denuncias.length ? ` (${mod.denuncias.length})` : ''}`}
                </button>
              ))}
            </nav>

            {tab === 'titulares' && data.lineup && (() => {
              const L = data.lineup;
              const titulares = L.jugadores.filter((j) => j.titular);
              const banca = L.jugadores.filter((j) => !j.titular);
              const comoEntra = (j: LineupPlayer) =>
                j.confirmo_tarde ? '🕐 Confirmó tras el anuncio · va al final'
                : j.neteado ? `⚖️ Netea · aseguraba y perdió cupo → entra por puntaje`
                : j.sancionado ? `⛔ Pierde cupo · ${MOTIVOS[j.sancion_motivo || ''] || j.sancion_motivo}`
                : j.es_mvp ? '🌟 MVP fecha pasada'
                : j.es_organizador ? '🎩 Organizador'
                : j.asegurado ? `🪑 Banca · asegura hasta ${fechaCorta(j.asegura_hasta)}`
                : 'Puntaje';
              // sancionado puro = pierde los puntos; neteado sí los conserva
              const sinPuntos = (j2: LineupPlayer) => j2.sancionado && !j2.neteado;
              const filaJ = (j: LineupPlayer, destacar: boolean) => (
                <tr key={j.user_id} style={sinPuntos(j) ? { background: 'rgba(255,107,107,0.07)' } : j.neteado ? { background: 'rgba(246,196,83,0.06)' } : undefined}>
                  <td style={{ ...td, color: S.dim, width: 34 }}>{j.pos}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{j.nombre}</td>
                  <td style={{ ...td, fontSize: 13, color: sinPuntos(j) ? '#FF8A8A' : j.neteado || j.confirmo_tarde ? '#F6C453' : j.asegurado ? S.accent : S.dim }}>
                    {destacar || j.sancionado || j.confirmo_tarde ? comoEntra(j) : '—'}
                  </td>
                  <td style={{ ...td, fontWeight: 800, color: sinPuntos(j) ? S.dim : destacar ? S.text : S.dim, textDecoration: sinPuntos(j) ? 'line-through' : undefined }}>{j.pj}</td>
                  <td style={{ ...td, color: S.dim, fontSize: 13 }}>{j.orden}º · {horaCorta(j.confirmo_at)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button onClick={() => bajarJugador(j.user_id, j.nombre)} disabled={busy}
                      title="El jugador avisó que no va"
                      style={{ background: 'none', border: `1px solid ${S.border}`, color: S.dim, borderRadius: 8, padding: '3px 9px', cursor: 'pointer', fontSize: 12 }}>
                      Se bajó
                    </button>
                  </td>
                </tr>
              );

              return (
                <>
                  <section style={{ ...box, marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                      <div>
                        <h2 style={{ margin: 0, fontSize: 17 }}>
                          Pichanga {fechaCorta(L.match.fecha)}
                          {L.match.hora ? ` · ${String(L.match.hora).slice(0, 5)}` : ''}
                          {L.match.lugar ? ` · ${L.match.lugar}` : ''}
                        </h2>
                        <p style={{ color: S.dim, fontSize: 13, margin: '6px 0 0' }}>
                          {L.jugadores.length} confirmados · MVP {fechaCorta(L.fecha_previa)}: <b style={{ color: S.accent }}>{L.mvp_previo || '—'}</b>
                          {L.match.organizador && <> · 🎩 Organiza: <b style={{ color: S.accent }}>{L.match.organizador}</b></>}
                        </p>
                      </div>
                      <label style={{ color: S.dim, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                        Cupos
                        <select value={cupos} onChange={(e) => setCupos(Number(e.target.value))}
                          style={{ background: '#0F0F0F', color: S.text, border: `1px solid ${S.border}`, borderRadius: 8, padding: '6px 10px' }}>
                          {[10, 12, 14, 16, 18, 20, 22].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </label>
                    </div>
                  </section>

                  {L.asegurados_sin_confirmar.length > 0 && (
                    <section style={{ ...box, marginBottom: 16, borderColor: '#B7791F', background: 'rgba(183,121,31,0.08)' }}>
                      <b style={{ color: '#F6C453' }}>⚠️ Aseguran cupo pero no han confirmado</b>
                      <p style={{ color: S.dim, fontSize: 13, margin: '6px 0 0' }}>
                        {L.asegurados_sin_confirmar.map((a) => `${a.nombre} (hasta ${fechaCorta(a.asegura_hasta)})`).join(' · ')}
                        {' '}— si confirman entran directo y salen los últimos por puntaje.
                      </p>
                    </section>
                  )}

                  <section style={{ ...box, marginBottom: 16 }}>
                    <h3 style={{ margin: '0 0 12px', fontSize: 15, color: S.accent }}>🟢 TITULARES ({titulares.length})</h3>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr>
                          <th style={th}>#</th><th style={th}>Jugador</th><th style={th}>Cómo entra</th><th style={th}>Asist.</th><th style={th}>Confirmó</th><th style={th}></th>
                        </tr></thead>
                        <tbody>{titulares.map((j) => filaJ(j, true))}</tbody>
                      </table>
                    </div>
                  </section>

                  <section style={{ ...box, marginBottom: 16 }}>
                    <h3 style={{ margin: '0 0 12px', fontSize: 15, color: S.dim }}>🪑 BANCA ({banca.length})</h3>
                    {banca.length === 0 ? <p style={{ color: S.dim, fontSize: 13 }}>Sin banca.</p> : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead><tr>
                            <th style={th}>#</th><th style={th}>Jugador</th><th style={th}></th><th style={th}>Asist.</th><th style={th}>Confirmó</th><th style={th}></th>
                          </tr></thead>
                          <tbody>{banca.map((j) => filaJ(j, false))}</tbody>
                        </table>
                      </div>
                    )}
                    <p style={{ color: S.dim, fontSize: 12, marginBottom: 0, marginTop: 12 }}>
                      Los que queden en banca aseguran cupo las próximas 4 fechas (se agregan solos al cerrar el partido),
                      salvo quien haya confirmado <b>después</b> de anunciados los titulares: juega si hay cupo, pero no asegura.
                      Si alguien avisó que no va, usa <b>“Se bajó”</b> — así no queda como banca ni asegura cupo.
                    </p>
                  </section>

                  {L.bajados?.length > 0 && (
                    <section style={{ ...box, marginBottom: 16 }}>
                      <h3 style={{ margin: '0 0 10px', fontSize: 15, color: S.dim }}>🚪 Se bajaron ({L.bajados.length})</h3>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <tbody>
                          {L.bajados.map((b) => (
                            <tr key={b.user_id}>
                              <td style={{ ...td, fontWeight: 600 }}>{b.nombre}</td>
                              <td style={{ ...td, color: S.dim, fontSize: 13 }}>
                                No cuenta como banca · no asegura cupo
                                {b.sancionado && <span style={{ color: '#FF8A8A' }}> · ⛔ pierde cupo la próxima</span>}
                              </td>
                              <td style={{ ...td, textAlign: 'right' }}>
                                <button onClick={() => reincorporar(b.user_id)} disabled={busy}
                                  style={{ background: 'none', border: `1px solid ${S.border}`, color: S.accent, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>
                                  Reincorporar
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  )}

                  <section style={box}>
                    <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>🎟️ Cupos asegurados vigentes</h3>
                    <p style={{ color: S.dim, fontSize: 13, marginTop: 0 }}>
                      Detectados automáticamente de la banca (4 fechas). Puedes cambiar la fecha o quitarlos.
                    </p>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {L.cupos_asegurados.map((c) => (
                          <tr key={c.user_id}>
                            <td style={{ ...td, fontWeight: 700 }}>{c.es_mvp ? '🌟 ' : c.es_organizador ? '🎩 ' : '🪑 '}{c.nombre}</td>
                            <td style={td}>
                              {c.es_mvp || c.es_organizador ? (
                                <span style={{ color: S.dim, fontSize: 13 }}>
                                  {c.es_mvp ? 'MVP · solo esta fecha' : 'Organizador · solo esta fecha'}
                                </span>
                              ) : (
                                <input type="date" defaultValue={c.hasta?.slice(0, 10)} disabled={busy}
                                  onChange={(e) => e.target.value && mutarCupo('agregar', c.user_id, e.target.value)}
                                  style={{ background: '#0F0F0F', color: S.text, border: `1px solid ${S.border}`, borderRadius: 8, padding: '5px 8px', fontSize: 13 }} />
                              )}
                            </td>
                            <td style={{ ...td, textAlign: 'right' }}>
                              {!c.es_mvp && !c.es_organizador && (
                                <button onClick={() => mutarCupo('quitar', c.user_id)} disabled={busy}
                                  style={{ background: 'none', border: `1px solid ${S.border}`, color: '#FF8A8A', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>
                                  Quitar
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                      <select value={nuevoUser} onChange={(e) => setNuevoUser(e.target.value)}
                        style={{ background: '#0F0F0F', color: S.text, border: `1px solid ${S.border}`, borderRadius: 8, padding: '8px 10px', flex: 1, minWidth: 160 }}>
                        <option value="">+ Agregar jugador…</option>
                        {data.miembros?.map((m) => <option key={m.user_id} value={m.user_id}>{m.nombre}</option>)}
                      </select>
                      <input type="date" value={nuevaFecha} onChange={(e) => setNuevaFecha(e.target.value)}
                        style={{ background: '#0F0F0F', color: S.text, border: `1px solid ${S.border}`, borderRadius: 8, padding: '7px 10px' }} />
                      <button disabled={!nuevoUser || !nuevaFecha || busy}
                        onClick={async () => { await mutarCupo('agregar', nuevoUser, nuevaFecha); setNuevoUser(''); setNuevaFecha(''); }}
                        style={{ background: nuevoUser && nuevaFecha ? S.accent : S.border, color: '#0A0A0A', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 800, cursor: nuevoUser && nuevaFecha ? 'pointer' : 'default' }}>
                        Agregar
                      </button>
                    </div>
                  </section>

                  <section style={{ ...box, marginTop: 16 }}>
                    <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>⛔ Pierden cupo esta fecha</h3>
                    <p style={{ color: S.dim, fontSize: 13, marginTop: 0 }}>
                      Por no pagar a tiempo o llegar tarde. Quedan al final de la lista (sin puntos) y entre
                      ellos ordena la hora de confirmación. Si hay cupo igual juegan. Dura solo esta fecha.
                      <br />
                      <b style={{ color: '#F6C453' }}>⚖️ Netea:</b> si el sancionado ya aseguraba cupo (MVP,
                      organizador o banca), se anulan y entra por puntaje normal.
                    </p>

                    {L.sanciones.length === 0 ? (
                      <p style={{ color: S.dim, fontSize: 13 }}>Nadie pierde cupo el {fechaCorta(L.match.fecha)}.</p>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 6 }}>
                        <tbody>
                          {L.sanciones.map((s) => (
                            <tr key={s.user_id}>
                              <td style={{ ...td, fontWeight: 700 }}>⛔ {s.nombre}</td>
                              <td style={{ ...td, color: S.dim, fontSize: 13 }}>
                                {MOTIVOS[s.motivo] || s.motivo}
                                {s.neteado && <span style={{ color: '#F6C453' }}> · ⚖️ netea (aseguraba cupo)</span>}
                                {!s.confirmo && ' · no ha confirmado'}
                              </td>
                              <td style={{ ...td, textAlign: 'right' }}>
                                <button onClick={() => mutarCupo('quitar_sancion', s.user_id, L.match.fecha)} disabled={busy}
                                  style={{ background: 'none', border: `1px solid ${S.border}`, color: S.accent, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>
                                  Perdonar
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      <select value={sancUser} onChange={(e) => setSancUser(e.target.value)}
                        style={{ background: '#0F0F0F', color: S.text, border: `1px solid ${S.border}`, borderRadius: 8, padding: '8px 10px', flex: 1, minWidth: 160 }}>
                        <option value="">+ Marcar jugador…</option>
                        {data.miembros?.map((m) => <option key={m.user_id} value={m.user_id}>{m.nombre}</option>)}
                      </select>
                      <select value={sancMotivo} onChange={(e) => setSancMotivo(e.target.value)}
                        style={{ background: '#0F0F0F', color: S.text, border: `1px solid ${S.border}`, borderRadius: 8, padding: '8px 10px' }}>
                        <option value="atraso">⏰ Llegó tarde</option>
                        <option value="no_pago">💸 No pagó a tiempo</option>
                        <option value="bajo_tarde">🚪 Se bajó pasadas las 13:00</option>
                      </select>
                      <button disabled={!sancUser || busy}
                        onClick={async () => { await mutarCupo('sancionar', sancUser, L.match.fecha, sancMotivo); setSancUser(''); }}
                        style={{ background: sancUser ? '#FF6B6B' : S.border, color: '#0A0A0A', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 800, cursor: sancUser ? 'pointer' : 'default' }}>
                        Pierde cupo
                      </button>
                    </div>
                  </section>

                  <details style={{ ...box, marginTop: 16 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 15 }}>
                      📋 Reglas de cupos <span style={{ color: S.dim, fontWeight: 400, fontSize: 13 }}>— cómo se arma esta lista</span>
                    </summary>

                    <div style={{ marginTop: 16, fontSize: 14, lineHeight: 1.7 }}>
                      <p style={{ color: S.dim, marginTop: 0 }}>
                        Solo se consideran los que <b style={{ color: S.text }}>confirmaron</b>. En este orden:
                      </p>
                      <ol style={{ paddingLeft: 20, margin: '0 0 18px' }}>
                        <li><b style={{ color: S.accent }}>🌟 MVP de la fecha pasada</b> — solo para la fecha siguiente.</li>
                        <li><b style={{ color: S.accent }}>🎩 Organizador</b> — quien creó el partido, solo esa fecha.</li>
                        <li><b style={{ color: S.accent }}>🪑 Los que quedaron en banca</b> — aseguran las <b>4 fechas siguientes</b>, y el cupo se mantiene aunque alcancen a jugar antes.</li>
                        <li><b>📊 El resto por asistencias</b> de las últimas 12 pichangas, de mayor a menor.</li>
                        <li><b>⏱️ Empate</b> en asistencias → clasifica <b>el que confirmó primero</b>.</li>
                      </ol>

                      <p style={{ margin: '0 0 6px', fontWeight: 700, color: '#FF8A8A' }}>⛔ Pierde cupo (dura una fecha)</p>
                      <ul style={{ paddingLeft: 20, margin: '0 0 18px', color: S.dim }}>
                        <li>💸 No pagó a tiempo · ⏰ Llegó tarde · 🚪 Se bajó pasadas las 13:00.</li>
                        <li>Queda al <b style={{ color: S.text }}>final de la lista y sin puntos</b>; entre sancionados ordena la hora de confirmación.</li>
                        <li>Si igual sobra cupo, juega: solo baja de prioridad.</li>
                      </ul>

                      <p style={{ margin: '0 0 6px', fontWeight: 700, color: '#F6C453' }}>⚖️ Neteo</p>
                      <p style={{ margin: '0 0 18px', color: S.dim }}>
                        Si alguien <b style={{ color: S.text }}>asegura cupo y lo pierde</b> en la misma fecha, se anulan:
                        entra por la regla de puntajes, conservando sus asistencias.
                      </p>

                      <p style={{ margin: '0 0 6px', fontWeight: 700 }}>🚪 Bajarse</p>
                      <ul style={{ paddingLeft: 20, margin: '0 0 18px', color: S.dim }}>
                        <li>Plazo: hasta las <b style={{ color: S.text }}>13:00 del día de la pichanga</b>. Después, pierde cupo la fecha siguiente.</li>
                        <li>Si avisó por fuera de la app, bájalo con <b style={{ color: S.text }}>“Se bajó”</b> y no con “Banca”: así no arrastra cupo asegurado.</li>
                      </ul>

                      <p style={{ margin: '0 0 6px', fontWeight: 700 }}>🕐 Confirmar tarde</p>
                      <ul style={{ paddingLeft: 20, margin: 0, color: S.dim }}>
                        <li>Quien confirma <b style={{ color: S.text }}>después</b> de anunciados los titulares <b style={{ color: S.text }}>no puede ser titular</b> esa fecha: la lista ya estaba cerrada. Va al final de la banca, aunque traiga cupo asegurado de antes.</li>
                        <li>Tampoco <b style={{ color: S.text }}>genera</b> cupo asegurado si termina en banca.</li>
                      </ul>
                    </div>
                  </details>
                </>
              );
            })()}

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

            {tab === 'novedades' && session && <Novedades token={session.access_token} />}

            {tab === 'moderacion' && (
              <section style={box}>
                <p style={{ color: S.dim, fontSize: 13, marginTop: 0 }}>
                  Denuncias de los jugadores y cuentas suspendidas. Suspender no borra nada:
                  el historial de partidos, goles y MVP queda intacto y se puede revertir.
                </p>

                <h3 style={{ fontSize: 15, margin: '18px 0 10px' }}>
                  Denuncias pendientes {mod ? `(${mod.denuncias.length})` : ''}
                </h3>

                {!mod ? (
                  <p style={{ color: S.dim, fontSize: 14 }}>Cargando…</p>
                ) : mod.denuncias.length === 0 ? (
                  <p style={{ color: S.dim, fontSize: 14 }}>Sin denuncias pendientes. 🎉</p>
                ) : (
                  mod.denuncias.map((d) => (
                    <div key={d.id} style={{ border: `1px solid ${S.border}`, borderRadius: 12, padding: 14, marginBottom: 12, background: '#0F0F0F' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                        <strong style={{ fontSize: 14 }}>
                          {KIND_LABEL[d.kind] ?? d.kind}
                          {d.grupo ? <span style={{ color: S.dim, fontWeight: 400 }}> · {d.grupo.name}</span> : null}
                        </strong>
                        <span style={{ color: S.dim, fontSize: 12 }}>
                          {new Date(d.created_at).toLocaleString('es-CL')}
                        </span>
                      </div>

                      <p style={{ margin: '0 0 8px', fontSize: 14 }}>
                        <span style={{ color: S.dim }}>Motivo:</span> {d.reason}
                      </p>
                      <p style={{ margin: '0 0 8px', fontSize: 13, color: S.dim }}>
                        Denuncia <strong style={{ color: S.text }}>{d.reporter?.display_name ?? '—'}</strong>
                        {' · '}Denunciado <strong style={{ color: S.text }}>{d.denunciado?.display_name ?? '—'}</strong>
                        {d.denunciado?.suspended_at ? ' (ya suspendido)' : ''}
                      </p>

                      {d.content_snapshot && (
                        <blockquote style={{ margin: '0 0 12px', padding: '8px 12px', borderLeft: `3px solid ${S.border}`, color: S.dim, fontSize: 13, whiteSpace: 'pre-wrap' }}>
                          {d.content_snapshot}
                        </blockquote>
                      )}

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {d.target_id && d.kind !== 'user' && (
                          <button
                            disabled={ocupado === d.id}
                            onClick={() => accionMod({ action: 'hide', reportId: d.id, kind: d.kind, targetId: d.target_id }, d.id)}
                            style={{ border: `1px solid ${S.border}`, background: 'transparent', color: S.text, borderRadius: 8, padding: '7px 13px', cursor: 'pointer', fontSize: 13 }}>
                            Ocultar contenido
                          </button>
                        )}
                        {d.denunciado && !d.denunciado.suspended_at && (
                          <button
                            disabled={ocupado === d.id}
                            onClick={() => accionMod(
                              { action: 'suspend', reportId: d.id, userId: d.denunciado!.id, motivo: d.reason },
                              d.id,
                              `¿Suspender a ${d.denunciado!.display_name ?? 'este usuario'}? No podrá entrar ni publicar. Su historial se conserva y puedes revertirlo.`
                            )}
                            style={{ border: '1px solid #FF6B6B', background: 'transparent', color: '#FF6B6B', borderRadius: 8, padding: '7px 13px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                            Suspender usuario
                          </button>
                        )}
                        <button
                          disabled={ocupado === d.id}
                          onClick={() => accionMod({ action: 'dismiss', reportId: d.id }, d.id)}
                          style={{ border: `1px solid ${S.border}`, background: 'transparent', color: S.dim, borderRadius: 8, padding: '7px 13px', cursor: 'pointer', fontSize: 13 }}>
                          Descartar
                        </button>
                      </div>
                    </div>
                  ))
                )}

                <h3 style={{ fontSize: 15, margin: '24px 0 10px' }}>
                  Cuentas suspendidas {mod ? `(${mod.suspendidos.length})` : ''}
                </h3>
                {!mod || mod.suspendidos.length === 0 ? (
                  <p style={{ color: S.dim, fontSize: 14 }}>Ninguna.</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>
                        <th style={th}>Jugador</th><th style={th}>Email</th><th style={th}>Desde</th><th style={th}>Motivo</th><th style={th}></th>
                      </tr></thead>
                      <tbody>
                        {mod.suspendidos.map((u) => (
                          <tr key={u.id}>
                            <td style={{ ...td, fontWeight: 600 }}>{u.display_name ?? '—'}</td>
                            <td style={{ ...td, color: S.dim }}>{u.email ?? '—'}</td>
                            <td style={td}>{new Date(u.suspended_at).toLocaleDateString('es-CL')}</td>
                            <td style={{ ...td, color: S.dim }}>{u.suspended_reason ?? '—'}</td>
                            <td style={td}>
                              <button
                                disabled={ocupado === u.id}
                                onClick={() => accionMod({ action: 'unsuspend', userId: u.id }, u.id)}
                                style={{ border: `1px solid ${S.accent}`, background: 'transparent', color: S.accent, borderRadius: 8, padding: '5px 11px', cursor: 'pointer', fontSize: 13 }}>
                                Reactivar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
