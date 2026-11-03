/** Re-test PR #7 cadena de ventanas. Datos ficticios. */
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
const A = partido('m-a', '2026-10-26T00:00:00+00:00', { status: 'completed', phase: 'closed', created_at: '2026-10-20T12:00:00Z' });
const B = partido('m-b', '2026-11-02T00:00:00+00:00', { created_at: '2026-10-27T12:00:00Z' });
const CIERRE_A = '2026-10-27T13:43:00Z';
const Z = partido('m-z', '2026-10-19T00:00:00+00:00', { status: 'completed', phase: 'closed', created_at: '2026-10-13T12:00:00Z' });
const CONV = { [Z.id]: '2026-10-13T12:00:00Z', [A.id]: '2026-10-20T12:00:00Z', [B.id]: '2026-10-27T12:00:00Z' };
const CIE = { [Z.id]: '2026-10-20T13:43:00Z', [A.id]: CIERRE_A, [B.id]: '2026-11-03T13:43:00Z' };
const AHORA = new Date('2026-11-10T16:00:00Z');
const st = async (d: Deps, m: string) => {
  const r = await estadoPagos(d, G, m);
  return { e: r.titulares[0].estado, id: r.titulares[0].pago?.id, solapa: r.partido.ventana.solapa, sin: r.sin_asignar.map((s) => `${s.id}:${s.motivo}`), json: JSON.stringify(r) };
};
const sancR = (d: Deps, m: string, u = NICO.user_id) => sancionarNoPago(d, G, { match_id: m, user_id: u, confirmar: true }, null).then(() => 'SANCIONADO', (e) => `409:${e.status}`);

test('D1 pagó A y paga B el mié: B pagado, A sin duplicado', async () => {
  const d = armar([A, B], { [A.id]: [NICO], [B.id]: [NICO] }, [pago(301, '2026-10-26T18:00:00-03:00', NICO), pago(302, '2026-10-28T10:00:00-03:00', NICO)], CONV, CIE, AHORA);
  const a = await st(d, A.id), b = await st(d, B.id);
  assert.deepEqual([a.e, a.id, b.e, b.id], ['pagado', '301', 'pagado', '302']);
  assert.ok(!a.sin.some((s) => s.startsWith('302:') && !s.endsWith('fuera_de_ventana')));
});
test('D2 no pagó A, un pago el mié: A tarde, B no_pagado; ventanas ya cerradas, B sancionable', async () => {
  const d = armar([A, B], { [A.id]: [NICO], [B.id]: [NICO] }, [pago(303, '2026-10-28T10:00:00-03:00', NICO)], CONV, CIE, AHORA);
  const a = await st(d, A.id), b = await st(d, B.id);
  assert.deepEqual([a.e, a.id, b.e, b.solapa], ['pagado_tarde', '303', 'no_pagado', true]);
  // AHORA es 10-nov: la ventana de B (fin 7-nov) ya cerró. El 409 eterno por solape
  // quedó reemplazado: con todas las ventanas cerradas el resultado voraz es final.
  assert.equal(await sancR(d, B.id), 'SANCIONADO');
  assert.equal(await sancR(d, A.id), 'SANCIONADO');
});
test('D3 dos pagos en el solape: A y B pagados', async () => {
  const d = armar([A, B], { [A.id]: [NICO], [B.id]: [NICO] }, [pago(305, '2026-10-29T10:00:00-03:00', NICO), pago(304, '2026-10-28T10:00:00-03:00', NICO)], CONV, CIE, AHORA);
  const a = await st(d, A.id), b = await st(d, B.id);
  assert.deepEqual([a.e, a.id, b.e, b.id], ['pagado_tarde', '304', 'pagado', '305']);
});
test('D6 borde: exacto en fin A (sáb 31-oct 20:00) solo en B; 1 ms antes en A', async () => {
  const fin = '2026-10-31T23:00:00.000Z';
  const d = armar([A, B], { [A.id]: [NICO], [B.id]: [NICO] }, [pago(306, fin, NICO)], CONV, CIE, AHORA);
  const a = await st(d, A.id), b = await st(d, B.id);
  assert.deepEqual([a.e, b.e, b.id], ['no_pagado', 'pagado', '306']);
  assert.ok(a.sin.includes('306:fuera_de_ventana'));
  const d2 = armar([A, B], { [A.id]: [NICO], [B.id]: [NICO] }, [pago(307, '2026-10-31T22:59:59.999Z', NICO)], CONV, CIE, AHORA);
  assert.equal((await st(d2, A.id)).e, 'pagado_tarde');
  assert.equal((await st(d2, B.id)).e, 'no_pagado');
  const d3 = armar([A, B], { [A.id]: [NICO], [B.id]: [NICO] }, [pago(308, '2026-10-27T08:00:00.000-04:00', NICO)], CONV, CIE, AHORA);
  assert.deepEqual([(await st(d3, A.id)).e, (await st(d3, B.id)).e], ['pagado', 'no_pagado']);
});
test('D8 pago posterior al fin (sin siguiente): fuera_de_ventana, sin email, no suma', async () => {
  const d = armar([A], { [A.id]: [NICO] }, [pago(309, '2026-11-01T10:00:00-03:00', NICO)], CONV, CIE, AHORA);
  const a = await st(d, A.id);
  assert.equal(a.e, 'no_pagado');
  assert.ok(a.sin.includes('309:fuera_de_ventana'));
  assert.equal(/@example\.test/.test(a.json), false);
});
test('D9 ambiguo (dos titulares calzan) en el solape: no se sanciona a ninguno', async () => {
  const N2 = { ...tit('u-nico2', 'Nico', 'Soto'), email: 'otro@example.test' };
  const p = pago(310, '2026-10-28T10:00:00-03:00', NICO);
  p.payer!.email = 'x@example.test';
  const d = armar([A, B], { [A.id]: [NICO, N2], [B.id]: [NICO, N2] }, [p], CONV, CIE, AHORA);
  const r = [await sancR(d, A.id), await sancR(d, A.id, 'u-nico2'), await sancR(d, B.id), await sancR(d, B.id, 'u-nico2')];
  assert.deepEqual(r, ['409:409', '409:409', '409:409', '409:409']);
});
test('D10 cadena semanal Z-A-B: un pago no cuenta en dos pichangas (vista A vs vista B)', async () => {
  const d = armar([Z, A, B], { [Z.id]: [NICO], [A.id]: [NICO], [B.id]: [NICO] }, [pago(311, '2026-10-21T10:00:00-03:00', NICO), pago(312, '2026-10-28T10:00:00-03:00', NICO)], CONV, CIE, AHORA);
  const z = await st(d, Z.id), a = await st(d, A.id), b = await st(d, B.id);
  const usados = [z.id, a.id, b.id].filter(Boolean);
  assert.equal(new Set(usados).size, usados.length, 'el mismo pago quedó en dos pichangas');
  assert.notEqual(b.e, 'pagado');
  assert.deepEqual([z.id, a.id], ['311', '312']);
});
