'use client';
/**
 * Pestaña "Pagos" del panel admin: quién pagó cada pichanga en MercadoPago
 * (solo lectura). Muestra solo nombre, fecha y monto.
 *
 * Estados: ✅ pagó (a tiempo) · 🕓 pagó tarde (después del cierre: NO levanta
 * la sanción) · ❌ no pagó. Esta pestaña nunca quita ni perdona sanciones.
 */
import { useEffect, useRef, useState } from 'react';
import { CONFIRMACION_MARCAR_PAGADO, textoFechasPendientes } from '../../lib/cierre/fechas';
import { DIAS_VENTANA, horaClt } from '../../lib/mp/tiempo';

const S = {
  card: '#161616', border: '#2A2A2A', accent: '#00E676', text: '#FFFFFF', dim: '#9A9A9A', red: '#FF8A8A', warn: '#F6C453',
};

interface PagoV { id: string; fecha: string; fecha_clt?: string; tarde?: boolean; monto: number; pagador: string; via?: string }
interface Fila { user_id: string; nombre: string; estado: 'pagado' | 'pagado_tarde' | 'no_pagado'; pago: PagoV | null; sancion: string | null; solape?: boolean }
interface Cierre { en: string | null; fuente: 'match_closed' | 'inicio_partido' | 'pendiente' }
interface SinAsignar extends PagoV { motivo: string; candidatos: string[] }
interface Datos {
  configurado: boolean;
  mp_incompleto?: boolean;
  historial_incompleto?: boolean;
  /** ISO: hora del servidor al consultar MercadoPago */
  revisado_at?: string;
  partidos: { id: string; fecha: string; hora: string | null; cancelado: boolean }[];
  partido: { id: string; fecha: string; hora: string | null; precio: number | null; ventana: { desde: string; hasta: string; cerrada: boolean; solapa?: boolean }; cierre?: Cierre };
  fecha_sancion: string;
  titulares: Fila[];
  sin_asignar: SinAsignar[];
  resumen: { titulares: number; pagados: number; pagados_tarde?: number; no_pagados: number; sin_asignar: number; recaudado: number } | null;
  mensaje_cierre?: string;
  mensaje_cierre_bloqueado?: boolean;
  mensaje_cierre_aviso?: string | null;
  bloqueo?: 'historial_incompleto' | 'mp_no_configurado' | 'mp_incompleto' | 'cupos_no_disponibles' | 'sin_certeza' | null;
  sin_cierre?: boolean;
  /** 041. Apagado: no hay deudas en la respuesta. */
  sancion_hasta_pagar?: boolean;
  deudas?: { id: string; user_id: string; fecha: string; nombre: string; status: string }[];
  fechas_pendientes?: { user_id: string; nombre: string; fechas: number }[];
  /** Flag SANCIONES_AL_CIERRE. Apagado: no hay botón. */
  sanciones_al_cierre?: boolean;
  cierre_sancion?: {
    status: 'processing' | 'applied' | 'skipped_incomplete' | 'alert';
    note: string | null;
    processed_at: string;
    sancionados: { nombre: string; estado: 'no_pagado' | 'pagado_tarde'; deuda: boolean }[];
  } | null;
  cierre_sancion_aviso?: string | null;
  alias: { id: string; jugador: string; pagador: string }[];
  miembros: { user_id: string; nombre: string }[];
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaCorta = (ymd: string) => { const [, m, d] = ymd.split('-').map(Number); return `${d} ${MESES[m - 1]}`; };
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-CL', {
  timeZone: 'America/Santiago', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});
const fechaPago = (p: PagoV) => `${p.fecha_clt || fechaHora(p.fecha)} CLT`;
const FUENTE_CIERRE: Record<string, string> = {
  match_closed: 'cuando se cerró el partido en la app',
  inicio_partido: 'inicio del partido (cerrado sin mensaje de cierre)',
};
const clp = (n: number) => `$${n.toLocaleString('es-CL')}`;
const MOTIVO: Record<string, string> = {
  sin_coincidencia: 'No calza con ningún titular',
  ambiguo: 'Calza con más de uno',
  duplicado: 'Segundo pago del mismo jugador',
  no_titular: 'Mapeado a alguien que no es titular',
  fuera_de_ventana: 'Fuera de ventana (no cuenta para esta pichanga)',
};
const VIA: Record<string, string> = { alias: 'mapeo manual', email: 'correo', nombre: 'nombre' };

export default function Pagos({ token }: { token: string }) {
  const [matchId, setMatchId] = useState<string>('');
  const [d, setD] = useState<Datos | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [asignar, setAsignar] = useState<Record<string, string>>({});
  const [copiado, setCopiado] = useState(false);
  const [mensajeStale, setMensajeStale] = useState(false);
  const mensajeRef = useRef<HTMLTextAreaElement>(null);

  const [revisando, setRevisando] = useState(false);

  // Si falla, deja los datos anteriores en pantalla y solo muestra el error.
  // Contador de requests: solo la respuesta más reciente puede actualizar el estado.
  const reqId = useRef(0);
  const cargar = async (id = matchId) => {
    const mio = ++reqId.current;
    setErr(null);
    try {
      const r = await fetch(`/admin/api/pagos${id ? `?match_id=${encodeURIComponent(id)}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const j = await r.json().catch(() => ({}));
      if (mio !== reqId.current) return;
      if (!r.ok) {
        setErr(j.error || `No se pudieron cargar los pagos (${r.status})`);
        setMensajeStale(true);
        return;
      }
      setD(j);
      setMensajeStale(false);
      setCopiado(false);
      if (!id) setMatchId(j.partido.id);
    } catch {
      if (mio !== reqId.current) return;
      setErr('No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
      setMensajeStale(true);
    }
  };
  const revisar = async () => {
    setRevisando(true);
    try { await cargar(); } finally { setRevisando(false); }
  };
  useEffect(() => { cargar(); /* eslint-disable-next-line */ }, [token]);

  const post = async (payload: Record<string, unknown>, clave: string) => {
    setBusy(clave);
    try {
      const r = await fetch('/admin/api/pagos', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.error || 'No se pudo completar la acción'); return null; }
      await cargar();
      return j;
    } finally { setBusy(null); }
  };

  const sancionar = async (f: Fila) => {
    if (!d) return;
    const tarde = f.estado === 'pagado_tarde' && f.pago;
    const msg = `¿Cargar sanción "no pagó" a ${f.nombre}?\n\n` +
      (tarde
        ? `Pagó la pichanga del ${fechaCorta(d.partido.fecha)} DESPUÉS del cierre (${fechaPago(f.pago!)}): pagar tarde no levanta la sanción.\n`
        : `No aparece su pago de la pichanga del ${fechaCorta(d.partido.fecha)} en MercadoPago.\n`) +
      `Pierde cupo la fecha del ${fechaCorta(d.fecha_sancion)} (queda al final, sin puntos).\n\n` +
      `Se puede perdonar después en Titulares → "Pierden cupo esta fecha".`;
    // eslint-disable-next-line no-alert
    if (!window.confirm(msg)) return;
    const j = await post({ accion: 'sancion_no_pago', match_id: d.partido.id, user_id: f.user_id, confirmar: true }, f.user_id);
    if (j?.ya_existia) alert(`${f.nombre} ya tenía la sanción para el ${fechaCorta(j.applies_to)}.`);
  };

  const copiarTexto = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      const el = mensajeRef.current;
      if (!el) return;
      el.focus();
      el.value = texto;
      el.select();
      document.execCommand('copy');
    }
    setCopiado(true);
    window.setTimeout(() => setCopiado(false), 2000);
  };

  const marcarPagado = async (userId: string) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(CONFIRMACION_MARCAR_PAGADO)) return;
    await post({ accion: 'saldar_deuda', user_id: userId }, `deuda-${userId}`);
  };

  const conciliarDeudas = async () => {
    const j = await post({ accion: 'conciliar_deudas' }, 'conciliar');
    if (!j || j.omitido) return;
    const n = Array.isArray(j.saldadas) ? j.saldadas.length : 0;
    const sin = Array.isArray(j.sin_mapear) ? j.sin_mapear.length : 0;
    const aviso = n
      ? `Se marcaron pagadas ${n} deuda${n === 1 ? '' : 's'} con el pago de Mercado Pago.`
      : 'Ningún pago de Mercado Pago calzó con una deuda.';
    alert(sin ? `${aviso}\n${sin} sigue${sin === 1 ? '' : 'n'} sin saldar (no calzó alias, correo ni nombre).` : aviso);
  };

  const aplicarCierre = async () => {
    if (!d) return;
    const pierden = d.titulares.filter((f) => f.estado !== 'pagado').map((f) => f.nombre);
    const lista = pierden.length ? pierden.join(', ') : 'nadie';
    const msg = `¿Aplicar las sanciones del cierre de la pichanga del ${fechaCorta(d.partido.fecha)}?\n\n` +
      `Con el estado de ahora, pierden cupo el ${fechaCorta(d.fecha_sancion)}:\n${lista}\n\n` +
      `Quien no pagó queda además con deuda. Quien pagó tarde solo pierde esa fecha.\n` +
      `Si Mercado Pago, el historial o un pago en solape no dan certeza, no se sanciona a nadie y queda una alerta.\n` +
      `No se modifica el partido. Se puede volver a apretar: no duplica.`;
    // eslint-disable-next-line no-alert
    if (!window.confirm(msg)) return;
    const j = await post({ accion: 'aplicar_sanciones_cierre', match_id: d.partido.id, confirmar: true }, 'cierre');
    if (!j) return;
    if (j.omitido) {
      alert(j.note || 'Las sanciones al cierre están apagadas.');
      return;
    }
    if (j.ya_aplicado) {
      alert('Esas sanciones ya estaban aplicadas.');
      return;
    }
    if (j.status === 'applied') {
      const nombres = Array.isArray(j.sancionados) && j.sancionados.length
        ? j.sancionados.map((s: { nombre: string }) => s.nombre).join(', ')
        : 'nadie';
      alert(`Listo. Sanción no_pago: ${nombres}.`);
      return;
    }
    alert(j.note || 'No se aplicaron sanciones.');
  };

  const copiarMensaje = async () => {
    if (!d?.mensaje_cierre || d.mensaje_cierre_bloqueado || mensajeStale) return;
    await copiarTexto(d.mensaje_cierre);
  };

  const box: React.CSSProperties = { background: S.card, border: `1px solid ${S.border}`, borderRadius: 14, padding: 20, marginBottom: 16 };
  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', color: S.dim, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${S.border}` };
  const td: React.CSSProperties = { padding: '8px 10px', borderBottom: `1px solid ${S.border}`, fontSize: 14 };
  const sel: React.CSSProperties = { background: '#0F0F0F', color: S.text, border: `1px solid ${S.border}`, borderRadius: 8, padding: '6px 10px' };
  const btn = (color: string): React.CSSProperties => ({ background: 'none', border: `1px solid ${color}`, color, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12 });

  if (err && !d) return <section style={box}><p role="alert" style={{ color: S.red, margin: 0 }}>{err}</p></section>;
  if (!d) return <p style={{ color: S.dim, textAlign: 'center', marginTop: 40 }}>Cargando pagos…</p>;

  return (
    <>
      <section style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>
              💳 Pagos · Pichanga {fechaCorta(d.partido.fecha)}{d.partido.hora ? ` · ${d.partido.hora.slice(0, 5)}` : ''}
            </h2>
            <p style={{ color: S.dim, fontSize: 13, margin: '6px 0 0' }}>
              {d.partido.precio ? `${clp(d.partido.precio)} por titular · ` : ''}
              pagos aprobados en MercadoPago desde {fechaHora(d.partido.ventana.desde)} hasta {fechaHora(d.partido.ventana.hasta)}
              {!d.partido.ventana.cerrada && ` (sigue abierta: cierra ${DIAS_VENTANA} días después del partido)`}
            </p>
          {d.mp_incompleto && (
            <p role="status" style={{ color: S.warn, fontSize: 13, margin: '8px 0 0' }}>
              Mercado Pago devolvió demasiados pagos para esta ventana. Los estados quedan sin certeza: no se puede sancionar hasta que la búsqueda quepa.
            </p>
          )}
          {d.historial_incompleto && (
            <p role="status" style={{ color: S.warn, fontSize: 13, margin: '8px 0 0' }}>
              El historial de pichangas que se solapan supera el tope (200 partidos o 2 años). No se puede sancionar: la conciliación quedaría incompleta.
            </p>
          )}
          {d.partido.ventana.solapa && (
            <p role="status" style={{ color: S.warn, fontSize: 13, margin: '8px 0 0' }}>
              Esta ventana se solapa con otra pichanga. Un pago del tramo común se asigna a la más antigua que ese jugador todavía no tiene pagada. Revísalo antes de sancionar.
            </p>
          )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <button onClick={revisar} disabled={revisando || busy !== null} aria-busy={revisando}
              style={{ ...btn(S.accent), padding: '6px 12px', fontSize: 13, opacity: revisando ? 0.6 : 1, cursor: revisando ? 'wait' : 'pointer' }}
              title="Consulta MercadoPago ahora y actualiza pagó / pagó tarde / no pagó">
              {revisando ? 'Revisando…' : '🔄 Revisar pagos'}
            </button>
            {d.revisado_at && <span style={{ color: S.dim, fontSize: 12 }}>Última revisión: {horaClt(d.revisado_at)}</span>}
            {d.sanciones_al_cierre && d.partido.cierre?.fuente === 'match_closed' && d.partido.cierre.en && (
              <button type="button" onClick={aplicarCierre}
                disabled={busy !== null || d.cierre_sancion?.status === 'applied'}
                style={{ ...btn(S.warn), opacity: d.cierre_sancion?.status === 'applied' ? 0.55 : 1 }}>
                {busy === 'cierre' ? 'Aplicando…' : d.cierre_sancion?.status === 'applied' ? 'Sanciones del cierre aplicadas' : 'Aplicar sanciones del cierre'}
              </button>
            )}
          </div>
          <label style={{ color: S.dim, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
            Pichanga
            <select value={matchId} onChange={(e) => { setMatchId(e.target.value); setD(null); cargar(e.target.value); }} disabled={revisando} style={sel}>
              {d.partidos.map((p) => (
                <option key={p.id} value={p.id}>{fechaCorta(p.fecha)}{p.hora ? ` ${p.hora.slice(0, 5)}` : ''}{p.cancelado ? ' (cancelada)' : ''}</option>
              ))}
            </select>
          </label>
          </div>
        </div>
        {!d.configurado && (
          <p style={{ color: S.warn, fontSize: 13, margin: '12px 0 0' }}>
            ⚠️ MercadoPago no está conectado (falta MP_ACCESS_TOKEN en el servidor). Se muestran los titulares sin estado de pago.
          </p>
        )}
        {d.sanciones_al_cierre && d.cierre_sancion && d.cierre_sancion.status !== 'applied' && (
          <p role="alert" style={{ color: S.warn, fontSize: 13, margin: '12px 0 0', padding: '10px 12px', border: `1px solid ${S.warn}`, borderRadius: 8 }}>
            {d.cierre_sancion.note || 'No se aplicaron las sanciones del cierre.'}
          </p>
        )}
        {d.sanciones_al_cierre && d.cierre_sancion?.status === 'applied' && (
          <p style={{ color: S.dim, fontSize: 13, margin: '12px 0 0' }}>
            Sanciones del cierre aplicadas
            {d.cierre_sancion.sancionados.length > 0 && <>: {d.cierre_sancion.sancionados.map((s) => s.nombre).join(', ')}</>}
            {d.cierre_sancion.processed_at && <> · {fechaHora(d.cierre_sancion.processed_at)} CLT</>}
            {d.cierre_sancion.note && /No se pisó|No quedó registrada/.test(d.cierre_sancion.note) && <> · {d.cierre_sancion.note}</>}
          </p>
        )}
        {d.cierre_sancion_aviso && (
          <p role="alert" style={{ color: S.warn, fontSize: 13, margin: '12px 0 0' }}>{d.cierre_sancion_aviso}</p>
        )}
        {d.partido.cierre && (
          <p style={{ color: S.dim, fontSize: 13, margin: '6px 0 0' }}>
            🔒 Cierre de pago:{' '}
            {d.partido.cierre.en
              ? <><b style={{ color: S.text }}>{fechaHora(d.partido.cierre.en)} CLT</b> ({FUENTE_CIERRE[d.partido.cierre.fuente] || d.partido.cierre.fuente}). Lo que llega después es «pagó tarde» y no levanta la sanción.</>
              : <>pendiente (el partido todavía no se cierra en la app).</>}
          </p>
        )}
        {d.resumen && (
          <p style={{ fontSize: 14, margin: '12px 0 0' }}>
            <b style={{ color: S.accent }}>{d.resumen.pagados}</b> de {d.resumen.titulares} pagaron a tiempo ·{' '}
            {(d.resumen.pagados_tarde ?? 0) > 0 && <><b style={{ color: S.warn }}>{d.resumen.pagados_tarde}</b> pagaron tarde · </>}
            <b style={{ color: d.resumen.no_pagados ? S.red : S.dim }}>{d.resumen.no_pagados}</b> sin pagar ·{' '}
            {clp(d.resumen.recaudado)} recaudado
            {d.resumen.sin_asignar > 0 && <> · <b style={{ color: S.warn }}>{d.resumen.sin_asignar}</b> pago(s) sin asignar</>}
          </p>
        )}
        {err && <p role="alert" style={{ color: S.red, fontSize: 13, margin: '8px 0 0' }}>{err}</p>}
      </section>

      {d.mensaje_cierre != null && (
        <section style={box}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Mensaje de cierre</h3>
            <button type="button" onClick={copiarMensaje} disabled={d.mensaje_cierre_bloqueado || mensajeStale}
              style={{ ...btn(S.accent), opacity: d.mensaje_cierre_bloqueado || mensajeStale ? 0.45 : 1, cursor: d.mensaje_cierre_bloqueado || mensajeStale ? 'not-allowed' : 'pointer' }}>
              {copiado ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          {d.sin_cierre && (
            <>
              <p role="status" style={{ color: S.dim, fontSize: 13, margin: '0 0 8px' }}>
                Este partido aún no está cerrado en la app: hasta que lo cierres, ningún pago cuenta como tarde.
              </p>
              <p style={{ color: S.dim, fontSize: 13, margin: '0 0 12px' }}>
                Copia este mensaje y después cierra la pichanga en la app.
              </p>
            </>
          )}
          {(mensajeStale || d.mensaje_cierre_aviso) && (
            <p role="status" style={{ color: S.warn, fontSize: 13, margin: '0 0 12px' }}>
              {mensajeStale ? 'No se pudo actualizar: no uses este mensaje para sancionar' : d.mensaje_cierre_aviso}
            </p>
          )}
          <textarea ref={mensajeRef} readOnly value={mensajeStale ? '' : d.mensaje_cierre} aria-label="Mensaje de cierre"
            rows={Math.min(18, d.mensaje_cierre.split('\n').length + 1)}
            style={{ width: '100%', boxSizing: 'border-box', background: '#0F0F0F', color: S.text, border: `1px solid ${S.border}`, borderRadius: 8, padding: 12, font: 'inherit', fontSize: 14, lineHeight: 1.45, resize: 'vertical', whiteSpace: 'pre' }} />
        </section>
      )}

      {d.sancion_hasta_pagar && (
        <section style={box}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>💸 Deudas de no pago</h3>
            <button type="button" onClick={conciliarDeudas} disabled={busy !== null || !d.configurado} style={btn(S.accent)}>
              {busy === 'conciliar' ? 'Conciliando…' : 'Conciliar deudas'}
            </button>
          </div>
          <p style={{ color: S.dim, fontSize: 13, margin: '0 0 12px' }}>
            💸 Debe una pichanga · hasta que pague. Conciliar busca pagos aprobados desde la fecha del partido impago hasta hoy.
          </p>
          {(d.deudas || []).length === 0 ? (
            <p style={{ color: S.dim, fontSize: 13, margin: 0 }}>Nadie con deuda activa.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {(d.deudas || []).map((deuda) => {
                  const pendientes = (d.fechas_pendientes || []).find((f) => f.user_id === deuda.user_id)?.fechas ?? 0;
                  return (
                  <tr key={deuda.id}>
                    <td style={{ ...td, fontWeight: 700 }}>{deuda.nombre}</td>
                    <td style={{ ...td, color: S.dim, fontSize: 13 }}>
                      💸 Debe una pichanga · hasta que pague · debe la del {fechaCorta(deuda.fecha)}
                      {pendientes > 0 && <> · {textoFechasPendientes(pendientes)}</>}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button type="button" onClick={() => marcarPagado(deuda.user_id)} disabled={busy !== null}
                        style={{ background: 'none', border: `1px solid ${S.border}`, color: S.accent, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>
                        Marcar pagado
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section style={box}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, color: S.accent }}>🟢 TITULARES ({d.titulares.length})</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Jugador</th><th style={th}>Estado</th><th style={th}>Fecha</th><th style={th}>Monto</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {d.titulares.map((f) => (
                <tr key={f.user_id} style={f.estado === 'no_pagado' ? { background: 'rgba(255,107,107,0.06)' } : f.estado === 'pagado_tarde' ? { background: 'rgba(246,196,83,0.06)' } : undefined}>
                  <td style={{ ...td, fontWeight: 700 }}>{f.nombre}</td>
                  <td style={{ ...td, fontSize: 13, color: f.estado === 'pagado' ? S.accent : f.estado === 'pagado_tarde' ? S.warn : S.red }}>
                    {!d.configurado ? <span style={{ color: S.dim }}>—</span>
                      : f.estado === 'pagado' ? <>✅ Pagó <span style={{ color: S.dim }}>· {f.pago?.pagador} · por {VIA[f.pago?.via || ''] || f.pago?.via}</span></>
                      : f.estado === 'pagado_tarde' ? <>🕓 Pagó tarde <span style={{ color: S.dim }}>· {fechaPago(f.pago!)} · {f.pago?.pagador} · por {VIA[f.pago?.via || ''] || f.pago?.via}</span></>
                      : <>❌ No pagó{f.solape && <span style={{ color: S.warn }}> · {f.nombre}: {d.historial_incompleto ? 'historial incompleto, no sancionar' : 'pago en el solape, no sancionar sin revisar'}</span>}</>}
                  </td>
                  <td style={{ ...td, color: f.estado === 'pagado_tarde' ? S.warn : S.dim, fontSize: 13 }}>{f.pago ? fechaPago(f.pago) : '—'}</td>
                  <td style={td}>{f.pago ? clp(f.pago.monto) : '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {f.sancion ? (
                      <span style={{ color: S.red, fontSize: 12 }}>⛔ {f.sancion === 'no_pago' ? 'sancionado' : f.sancion} {fechaCorta(d.fecha_sancion)}</span>
                    ) : d.configurado && f.estado !== 'pagado' ? (
                      <button onClick={() => sancionar(f)} disabled={busy !== null} style={btn('#FF6B6B')}
                        title={`Pierde cupo el ${fechaCorta(d.fecha_sancion)}`}>
                        Cargar sanción no_pago
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ color: S.dim, fontSize: 12, margin: '12px 0 0' }}>
          La banca no paga. El cruce es por mapeo manual, correo o nombre + apellido (nunca solo por el primer nombre).
          Pagar después del cierre no levanta la sanción: «pagó tarde» se puede sancionar igual y esta pestaña nunca quita sanciones.
        </p>
      </section>

      {d.configurado && (
        <section style={box}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, color: S.warn }}>❓ Pagos sin asignar ({d.sin_asignar.length})</h3>
          {d.sin_asignar.length === 0 ? <p style={{ color: S.dim, fontSize: 13, margin: 0 }}>Todos los pagos quedaron asignados.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Pagador</th><th style={th}>Fecha</th><th style={th}>Monto</th><th style={th}>Por qué</th><th style={th}>Asignar a</th></tr></thead>
                <tbody>
                  {d.sin_asignar.map((p) => (
                    <tr key={p.id}>
                      <td style={{ ...td, fontWeight: 600 }}>{p.pagador}</td>
                      <td style={{ ...td, color: p.tarde ? S.warn : S.dim, fontSize: 13 }}>{fechaPago(p)}{p.tarde ? ' · tarde' : ''}</td>
                      <td style={td}>{clp(p.monto)}</td>
                      <td style={{ ...td, color: S.dim, fontSize: 13 }}>
                        {MOTIVO[p.motivo] || p.motivo}{p.candidatos.length ? `: ${p.candidatos.join(', ')}` : ''}
                      </td>
                      <td style={td}>
                        {p.motivo === 'fuera_de_ventana' ? (
                          <span style={{ color: S.dim, fontSize: 12 }}>No cuenta en esta pichanga</span>
                        ) : (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <select value={asignar[p.id] || ''} onChange={(e) => setAsignar({ ...asignar, [p.id]: e.target.value })} style={{ ...sel, minWidth: 130 }}>
                            <option value="">Jugador…</option>
                            {d.miembros.map((m) => <option key={m.user_id} value={m.user_id}>{m.nombre}</option>)}
                          </select>
                          <button disabled={!asignar[p.id] || busy !== null} style={btn(S.accent)}
                            onClick={() => post({ accion: 'mapear', payment_id: p.id, user_id: asignar[p.id] }, p.id)}>
                            Asignar
                          </button>
                        </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ color: S.dim, fontSize: 12, margin: '12px 0 0' }}>
            Asignar guarda el pagador para las próximas fechas (por ejemplo, si paga la pareja o desde otra cuenta).
          </p>
        </section>
      )}

      {d.alias.length > 0 && (
        <section style={box}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>🔗 Pagadores mapeados a mano ({d.alias.length})</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {d.alias.map((a) => (
                <tr key={a.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{a.pagador}</td>
                  <td style={{ ...td, color: S.dim }}>→ {a.jugador}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button disabled={busy !== null} style={btn(S.red)}
                      onClick={() => window.confirm(`¿Quitar el mapeo ${a.pagador} → ${a.jugador}?`) && post({ accion: 'quitar_alias', alias_id: a.id }, a.id)}>
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
