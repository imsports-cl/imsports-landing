/** Re-test PR #7 @ 0ef4217 bordes de trozo/bloque (no se commitea). Datos ficticios. */
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

test('T1 borde de TROZO (idx5|idx6, mismo bloque 45d): pago del solape no cuenta dos veces', async () => {
  const ws = lunes('2026-10-12', 8); // 12-oct..30-nov; bloque 11-oct..25-nov tiene 7 lunes: idx6 = 23-nov
  const p = pago(501, '2026-11-18T10:00:00-03:00', NICO); // mié: 16-nov ∩ 23-nov; Nico no pagó 16-nov antes
  const d = armarW(ws, [NICO, RAFA], [p], new Date('2026-12-10T16:00:00Z'));
  const a = await est(d, 'm2026-11-16'), b = await est(d, 'm2026-11-23');
  console.log('T1 16-nov', a, '| 23-nov', b, '| sanc Rafa 23-nov', await sancU(d, 'm2026-11-23', 'u-rafa'));
  const cuenta = [a['u-nico'], b['u-nico']].filter((s) => s.includes(':501')).length;
  assert.equal(cuenta, 1, 'el pago 501 cuenta en 16-nov y en 23-nov');
});
test('T2 borde de BLOQUE 45d (23-nov | 30-nov): pago del solape no cuenta dos veces', async () => {
  const ws = lunes('2026-11-16', 3); // 16, 23, 30-nov; bloque 56 empieza 25-nov 00:00Z
  const p = pago(502, '2026-11-25T10:00:00-03:00', NICO); // mié: 23-nov ∩ 30-nov (conv 24-nov)
  const d = armarW(ws, [NICO, RAFA], [p], new Date('2026-12-10T16:00:00Z'));
  const a = await est(d, 'm2026-11-23'), b = await est(d, 'm2026-11-30');
  console.log('T2 23-nov', a, '| 30-nov', b, '| sanc Rafa 30-nov', await sancU(d, 'm2026-11-30', 'u-rafa'));
  const cuenta = [a['u-nico'], b['u-nico']].filter((s) => s.includes(':502')).length;
  assert.equal(cuenta, 1, 'el pago 502 cuenta en 23-nov y en 30-nov');
});
test('T3 un año semanal: cuántas pichangas quedan SIN poder sancionar a quien nunca pagó', async () => {
  const ws = lunes('2026-01-05', 52);
  const d = armarW(ws, [NICO, RAFA], [], new Date('2027-01-20T16:00:00Z'));
  const bloqueadas: string[] = [];
  for (const w of ws) if ((await sancU(d, w.m.id, 'u-rafa')) !== 'SANCIONADO') bloqueadas.push(w.m.id.slice(1));
  console.log('T3 bloqueadas', bloqueadas.length, '/52:', bloqueadas.join(' '));
  assert.equal(bloqueadas.length, 0, 'pichangas donde un no-pagador nunca se puede sancionar');
});
test('T4 estabilidad: 16-nov visto el 20-nov (sin 23-nov) vs el 10-dic (con 23-nov y 30-nov)', async () => {
  const p = [pago(511, '2026-11-18T10:00:00-03:00', NICO)];
  const antes = await est(armarW(lunes('2026-10-12', 6), [NICO], p, new Date('2026-11-20T16:00:00Z')), 'm2026-11-16');
  const despues = await est(armarW(lunes('2026-10-12', 8), [NICO], p, new Date('2026-12-10T16:00:00Z')), 'm2026-11-16');
  console.log('T4', antes, despues);
  assert.equal(antes['u-nico'].split(':')[1], despues['u-nico'].split(':')[1]);
});
test('T5 >20 partidos en el bloque (4 por semana): la vista del partido 21+ no duplica', async () => {
  const ws = lunes('2026-10-12', 28, 1.75).map((w, i) => w); // ~4/semana
  const ids = ws.map((w) => w.m.id);
  const pagos = [pago(521, new Date(Date.parse(ws[21].conv) + 3600000).toISOString(), NICO)];
  const d = armarW(ws, [NICO], pagos, new Date('2026-12-20T16:00:00Z'));
  const vistas: string[] = [];
  for (const id of ids.slice(18, 24)) { const e = await est(d, id); if (e['u-nico'].includes(':521')) vistas.push(id); }
  console.log('T5 521 aparece en', vistas);
  assert.ok(vistas.length <= 1);
});
test('E1 tope MP (truncado) → aviso y 409 para todos', async () => {
  const ws = lunes('2026-10-19', 2);
  const d = armarW(ws, [NICO, RAFA], [], new Date('2026-11-10T16:00:00Z'));
  d.mp!.buscarAprobados = async () => Object.assign([] as PagoMpRaw[], { truncado: true });
  const r: any = await estadoPagos(d, G, 'm2026-10-26');
  console.log('E1 mp_incompleto', r.mp_incompleto, r.titulares.map((t: any) => t.solape), await sancU(d, 'm2026-10-26', 'u-rafa'));
  assert.equal(r.mp_incompleto, true);
  assert.equal(await sancU(d, 'm2026-10-26', 'u-rafa'), '409');
});
test('F1 no-pagador en medio del trozo se sanciona; sin email en JSON', async () => {
  const ws = lunes('2026-10-12', 5);
  const d = armarW(ws, [NICO, RAFA], [pago(531, '2026-10-26T10:00:00-03:00', NICO)], new Date('2026-11-20T16:00:00Z'));
  const r = await estadoPagos(d, G, 'm2026-10-26');
  assert.equal(/@example\.test/.test(JSON.stringify(r)), false);
  assert.equal(await sancU(d, 'm2026-10-26', 'u-rafa'), 'SANCIONADO');
  assert.equal(await sancU(d, 'm2026-10-26', 'u-nico'), '409');
});
