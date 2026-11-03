/** Re-test PR #7 @ 9f736f8 tope 200/2 años y max-rows de titulares. Datos ficticios. */
import './_guard';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoPagos, sancionarNoPago, type Deps, type Partido } from '../../lib/mp/servicio';
import { fakeRepo } from './fake-repo';
import type { Titular } from '../../lib/mp/cruce';
import type { PagoMpRaw } from '../../lib/mp/pagos-mp';

const G = 'g-lunes';
const partido = (id: string, date: string, extra: Partial<Partido> = {}): Partido => ({
  id, group_id: G, date, time: '20:00', price: 5000, status: 'scheduled', phase: 'voting', ...extra,
});
const tit = (user_id: string, n: string, a: string): Titular =>
  ({ user_id, nombre: n, nickname: n, display_name: `${n} ${a}`, email: `${n}.${a}@example.test`.toLowerCase() });
const NICO = tit('u-nico', 'Nico', 'Soto');
const pago = (id: number, fecha: string, t: Titular): PagoMpRaw => ({
  id, status: 'approved', currency_id: 'CLP', transaction_amount_refunded: 0, transaction_amount: 5000,
  description: 'Pichanga Conecta', date_approved: fecha,
  payer: { id: String(9000 + id % 100), email: t.email, first_name: t.nombre.toUpperCase(), last_name: t.display_name!.split(' ')[1].toUpperCase() },
});
function armar(partidos: Partido[], titulares: Record<string, Titular[]>, pagos: PagoMpRaw[], conv: Record<string, string>, cierres: Record<string, string> = {}, ahora = new Date('2026-11-03T16:00:00Z')) {
  const db = fakeRepo({ partidos, titulares, convocatorias: conv, cierres });
  const d: Deps = {
    repo: db.repo,
    mp: { async buscarAprobados() { return pagos; }, async pago(id) { return pagos.find((p) => String(p.id) === id)!; } },
    ahora: () => ahora, noPagan: [],
  };
  return d;
}
const sanc = (d: Deps, m: string) => sancionarNoPago(d, G, { match_id: m, user_id: NICO.user_id, confirmar: true }, null)
  .then((r: any) => `SANCIONADO applies_to=${r.applies_to}`, (e) => `rechazado(${e.status}): ${e.message}`);

const A = partido('m-a', '2026-10-26T00:00:00+00:00', { status: 'completed', phase: 'closed', created_at: '2026-10-20T12:00:00Z' });
const B = partido('m-b', '2026-11-02T00:00:00+00:00', { created_at: '2026-10-27T12:00:00Z' });
const CIERRE_A = '2026-10-27T13:43:00Z'; // mar 27-oct 10:43 CLT
const RAFA = tit('u-rafa', 'Rafa', 'Mora');
const DIA = 86400000;
// Lunes 20:00 CLT, convocado el martes anterior 09:00 CLT (todas las ventanas se solapan con la siguiente).
function lunes(desdeYmd: string, n: number, cada = 7) {
  const out: { m: Partido; conv: string }[] = [];
  const t0 = Date.parse(`${desdeYmd}T23:00:00Z`);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * cada * DIA; const ymd = new Date(t).toISOString().slice(0, 10);
    const conv = new Date(t - 6 * DIA - 11 * 3600000).toISOString(); // martes previo 09:00 CLT
    out.push({ m: partido(`m${ymd}`, `${ymd}T00:00:00+00:00`, { status: 'completed', phase: 'closed', created_at: conv }), conv });
  }
  return out;
}
const armarW = (ws: { m: Partido; conv: string }[], ts: Titular[], pagos: PagoMpRaw[], ahora: Date) =>
  armar(ws.map((w) => w.m), Object.fromEntries(ws.map((w) => [w.m.id, ts])), pagos, Object.fromEntries(ws.map((w) => [w.m.id, w.conv])), {}, ahora);
const est = async (d: Deps, id: string) => { const r = await estadoPagos(d, G, id); return Object.fromEntries(r.titulares.map((t: any) => [t.user_id, `${t.estado}:${t.pago?.id ?? '-'}${t.solape ? ':solape' : ''}`])); };
const sancU = (d: Deps, m: string, u: string) => sancionarNoPago(d, G, { match_id: m, user_id: u, confirmar: true }, null).then(() => 'SANCIONADO', (e) => `${e.status}`);

const wed = (ymd: string) => new Date(Date.parse(`${ymd}T13:00:00Z`) + 2 * DIA).toISOString();
const FIN = new Date('2029-06-20T16:00:00Z');
test('G1 semanal 2,5 años (130 partidos, < 200) → historial_incompleto por 2 años, aviso y 409', async () => {
  const W = lunes('2024-01-01', 130); const id = W[129].m.id;
  const d = armarW(W, [NICO, RAFA], [], FIN);
  const r: any = await estadoPagos(d, G, id);
  const s = await sancU(d, id, 'u-rafa');
  console.log('G1', id, 'historial', r.historial_incompleto, 'solape', r.titulares.map((t: any) => t.solape), s);
  assert.equal(r.historial_incompleto, true); assert.equal(s, '409');
  const r2: any = await estadoPagos(d, G, W[60].m.id); console.log('G1 idx60 (cadena 61 < 2 años)', r2.historial_incompleto);
});
test('G2 cada 2 días 210 partidos (< 2 años, > 200) → historial_incompleto', async () => {
  const W = lunes('2026-01-01', 210, 2); const id = W[209].m.id;
  const d = armarW(W, [NICO, RAFA], [], FIN);
  const r: any = await estadoPagos(d, G, id); const s = await sancU(d, id, 'u-rafa');
  const r199: any = await estadoPagos(d, G, W[199].m.id); const r200: any = await estadoPagos(d, G, W[200].m.id);
  console.log('G2 idx209', r.historial_incompleto, s, '| idx199', r199.historial_incompleto, '| idx200', r200.historial_incompleto);
  assert.equal(r.historial_incompleto, true); assert.equal(s, '409');
  assert.equal(r199.historial_incompleto, false);
});
test('G3 PostgREST max_rows=1000 en titularesDe (lun+jue 1 año, 14 titulares): ¿corte mudo?', async () => {
  const W = lunes('2025-11-03', 104, 3.5);
  const resto = Array.from({ length: 13 }, (_, i) => tit(`u-x${i}`, `X${i}`, 'Z'));
  const pagos = W.slice(0, 103).map((w, i) => pago(1000 + i, wed(w.m.id.slice(1)).replace(/T.*/, 'T') + '23:30:00Z', NICO)); // paga cada uno ~1 día después
  const mk = (cap: boolean) => {
    const d = armarW(W, [NICO, ...resto], pagos, new Date('2026-12-20T16:00:00Z'));
    if (cap) { const r: any = d.repo; const o = r.titularesDe.bind(r); r.titularesDe = async (ms: Partido[]) => {
      const full = await o(ms); const out: Record<string, Titular[]> = {}; let n = 0;
      for (const m of ms) { out[m.id] = []; for (const t of full[m.id]) if (n++ < 1000) out[m.id].push(t); }
      return out; }; }
    return d;
  };
  const id = W[103].m.id;
  const a: any = await estadoPagos(mk(false), G, id), b: any = await estadoPagos(mk(true), G, id);
  const sa = await sancU(mk(false), id, 'u-nico'), sb = await sancU(mk(true), id, 'u-nico');
  const f = (r: any) => { const t = r.titulares.find((x: any) => x.user_id === 'u-nico'); return `${t.estado}:${t.pago?.id ?? '-'} hist=${r.historial_incompleto}`; };
  console.log('G3 sin tope filas', f(a), sa, '| con max_rows 1000', f(b), sb);
  assert.equal(f(a), f(b), 'resultado cambia en silencio cuando PostgREST corta a 1000 filas');
});
