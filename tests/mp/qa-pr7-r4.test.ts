/** Re-test PR #7 @ a4802c9 cadenas (no se commitea). Datos ficticios. */
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
const AHORA = new Date('2026-11-20T16:00:00Z');
const lun = (id: string, ymd: string, conv: string) => ({ m: partido(id, `${ymd}T00:00:00+00:00`, { status: 'completed', phase: 'closed', created_at: conv }), conv });
const sancU = (d: Deps, m: string, u: string) => sancionarNoPago(d, G, { match_id: m, user_id: u, confirmar: true }, null).then(() => 'SANCIONADO', (e) => `${e.status}`);
async function mapa(d: Deps, ids: string[]) {
  const out: Record<string, Record<string, string>> = {};
  for (const id of ids) {
    const r = await estadoPagos(d, G, id);
    out[id] = Object.fromEntries(r.titulares.map((t) => [t.user_id, `${t.estado}:${t.pago?.id ?? '-'}`]));
  }
  return out;
}
// Cadena semanal de 5: 19-oct..16-nov, convocadas el martes previo (todas se solapan con la siguiente).
const W = [lun('w1', '2026-10-19', '2026-10-13T12:00:00Z'), lun('w2', '2026-10-26', '2026-10-20T12:00:00Z'), lun('w3', '2026-11-02', '2026-10-27T12:00:00Z'), lun('w4', '2026-11-09', '2026-11-03T12:00:00Z'), lun('w5', '2026-11-16', '2026-11-10T12:00:00Z')];
const conv = (ws: typeof W) => Object.fromEntries(ws.map((w) => [w.m.id, w.conv]));
const todos = (ws: typeof W, ts: Titular[]) => Object.fromEntries(ws.map((w) => [w.m.id, ts]));

test('C1 cadena de 5: cada pago en una sola pichanga y estado idéntico desde cualquier vista', async () => {
  const pagos = [pago(401, '2026-10-21T10:00:00-03:00', NICO), pago(402, '2026-10-28T10:00:00-03:00', NICO), pago(403, '2026-10-29T10:00:00-03:00', NICO), pago(404, '2026-11-12T10:00:00-03:00', NICO), pago(405, '2026-11-04T10:00:00-03:00', RAFA)];
  const d = armar(W.map((w) => w.m), todos(W, [NICO, RAFA]), pagos, conv(W), {}, AHORA);
  const m = await mapa(d, W.map((w) => w.m.id));
  console.log('C1', JSON.stringify(m));
  const usados = Object.values(m).flatMap((x) => Object.values(x)).map((s) => s.split(':')[1]).filter((x) => x !== '-');
  assert.equal(new Set(usados).size, usados.length, 'pago duplicado');
  // esperado: 401→w1, 402→w2, 403→w3, 404→w4, 405(Rafa)→w2 (más antigua impaga con ventana que lo contiene: w3? w2 fin 31-oct; 4-nov ∈ w3,w4 → w3)
  assert.deepEqual(['w1', 'w2', 'w3', 'w4'].map((k) => m[k]['u-nico'].split(':')[1]), ['401', '402', '403', '404']);
  assert.equal(m.w3['u-rafa'].split(':')[1], '405');
});
test('C2 vista consistente: la ventana inicial no cambia el resultado (w2 visto solo vs con w1 existente)', async () => {
  const p = [pago(411, '2026-10-21T10:00:00-03:00', NICO), pago(412, '2026-10-28T10:00:00-03:00', NICO)];
  const sinW1 = armar(W.slice(1).map((w) => w.m), todos(W.slice(1), [NICO]), p, conv(W.slice(1)), {}, AHORA);
  const conW1 = armar(W.map((w) => w.m), todos(W, [NICO]), p, conv(W), {}, AHORA);
  console.log('C2 sinW1', JSON.stringify(await mapa(sinW1, ['w2', 'w3'])), 'conW1', JSON.stringify(await mapa(conW1, ['w1', 'w2', 'w3'])));
});
test('C3 corte: pichanga sin solape corta la cadena y la búsqueda MP arranca en la cadena', async () => {
  const P0 = lun('p0', '2026-10-05', '2026-09-29T12:00:00Z'); // fin 10-oct < conv w2 20-oct
  const ws = [P0, W[1], W[2]];
  const llamadas: string[] = [];
  const d = armar(ws.map((w) => w.m), todos(ws, [NICO]), [pago(421, '2026-10-08T10:00:00-03:00', NICO), pago(422, '2026-10-28T10:00:00-03:00', NICO)], conv(ws), {}, AHORA);
  const orig = d.mp!.buscarAprobados; d.mp!.buscarAprobados = async (a, b) => { llamadas.push(`${a} ${b}`); return orig(a, b); };
  const m = await mapa(d, ['p0', 'w2', 'w3']);
  console.log('C3', JSON.stringify(m), llamadas);
  assert.equal(m.p0['u-nico'], 'pagado_tarde:421'.replace('pagado_tarde', m.p0['u-nico'].split(':')[0]));
  assert.equal(m.w2['u-nico'].split(':')[1], '422');
  assert.ok(llamadas[1].startsWith('2026-10-20'), 'w2 no debería buscar desde p0');
});
test('C4 cancelada en medio de la cadena', async () => {
  const X = { m: partido('x', '2026-11-02T00:00:00+00:00', { status: 'cancelled', created_at: '2026-10-27T12:00:00Z' }), conv: '2026-10-27T12:00:00Z' };
  const Y = lun('y', '2026-11-05', '2026-10-30T12:00:00Z'); // jueves, convocada vie 30-oct: solapa con w2
  const ws = [W[0], W[1], X, Y];
  const d = armar(ws.map((w) => w.m), todos(ws, [NICO]), [pago(431, '2026-10-21T10:00:00-03:00', NICO), pago(432, '2026-10-31T10:00:00-03:00', NICO)], conv(ws), {}, AHORA);
  const m = await mapa(d, ['w1', 'w2', 'y']);
  console.log('C4', JSON.stringify(m));
  assert.deepEqual([m.w1['u-nico'].split(':')[1], m.w2['u-nico'].split(':')[1], m.y['u-nico'].split(':')[1]], ['431', '432', '-']);
});
test('C5 rendimiento: grupo lun+jue un año (todo solapado) → cuántos partidos, titulares y desde cuándo busca en MP', async () => {
  const ms: { m: Partido; conv: string }[] = [];
  let t = Date.parse('2025-11-03T23:00:00Z');
  for (let i = 0; i < 104; i++) {
    const dia = new Date(t); const ymd = dia.toISOString().slice(0, 10);
    ms.push({ m: partido(`y${i}`, `${ymd}T00:00:00+00:00`, { status: 'completed', phase: 'closed', created_at: new Date(t - 2 * 86400000).toISOString() }), conv: new Date(t - 2 * 86400000).toISOString() });
    t += (i % 2 === 0 ? 3 : 4) * 86400000;
  }
  const llamadas: string[] = []; let titCalls = 0;
  const d = armar(ms.map((x) => x.m), todos(ms as any, [NICO]), [], Object.fromEntries(ms.map((x) => [x.m.id, x.conv])), {}, new Date(t));
  const tr = d.repo.titulares.bind(d.repo); (d.repo as any).titulares = async (m: Partido) => { titCalls++; return tr(m); };
  const orig = d.mp!.buscarAprobados; d.mp!.buscarAprobados = async (a, b) => { llamadas.push(`${a} → ${b}`); return orig(a, b); };
  await estadoPagos(d, G, ms[103].m.id);
  console.log('C5 llamadas MP', llamadas.length, llamadas[0], '| titulares() llamadas', titCalls);
  assert.ok(titCalls <= 10, `cadena sin tope: ${titCalls} lecturas de titulares`);
  assert.ok(Date.parse(llamadas[0].split(' → ')[0]) > t - 60 * 86400000, 'la búsqueda MP trae casi un año de historial');
});
test('E1 sanción: quien de verdad no pagó se sanciona; con pago o ambiguo → 409; ambiguo muestra nombre, sin email', async () => {
  const ws = [W[1], W[2]];
  const N2 = { ...tit('u-nico2', 'Nico', 'Soto'), email: 'otro@example.test' };
  const amb = pago(441, '2026-10-28T10:00:00-03:00', NICO); amb.payer!.email = 'x@example.test';
  const d = armar(ws.map((w) => w.m), todos(ws, [NICO, N2, RAFA]), [amb], conv(ws), {}, AHORA);
  const r = await estadoPagos(d, G, 'w3');
  const filas = r.titulares.map((f: any) => `${f.nombre}:${f.estado}:${f.solape}`);
  console.log('E1 filas w3', filas, '| sanc', await sancU(d, 'w3', 'u-rafa'), await sancU(d, 'w3', 'u-nico'), await sancU(d, 'w3', 'u-nico2'), await sancU(d, 'w2', 'u-nico'));
  assert.equal(/@example\.test/.test(JSON.stringify(r)), false);
  assert.equal(await sancU(d, 'w2', 'u-rafa'), 'SANCIONADO');
});
