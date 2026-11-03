/** Re-test PR #7. Datos ficticios. La ventana no se recorta con la pichanga siguiente. */
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
const CIERRE_A = '2026-10-27T13:43:00Z'; // mar 27-oct 10:43 CLT

test('R1 semanal: pago de A a tiempo (mar 10:00, antes del cierre 10:43) queda en A', async () => {
  const conv = { [A.id]: '2026-10-20T12:00:00Z', [B.id]: '2026-10-27T12:00:00Z' };
  const p = pago(201, '2026-10-27T10:00:00.000-03:00', NICO);
  const d = armar([A, B], { [A.id]: [NICO], [B.id]: [NICO] }, [p], conv, { [A.id]: CIERRE_A });
  const a = await estadoPagos(d, G, A.id);
  const b = await estadoPagos(d, G, B.id);
  assert.equal(a.titulares[0].estado, 'pagado');
  assert.equal(a.titulares[0].pago!.id, '201');
  assert.equal(a.partido.ventana.solapa, true);
  assert.equal(b.titulares[0].estado, 'no_pagado');
  await assert.rejects(
    sancionarNoPago(d, G, { match_id: A.id, user_id: NICO.user_id, confirmar: true }, null),
    (e: any) => e.status === 409,
  );
  await assert.rejects(
    sancionarNoPago(d, G, { match_id: B.id, user_id: NICO.user_id, confirmar: true }, null),
    (e: any) => e.status === 409,
  );
});

test('R2 el estado de A no cambia al convocarse B', async () => {
  const p = pago(202, '2026-10-27T10:00:00.000-03:00', NICO);
  const antes = await estadoPagos(armar([A], { [A.id]: [NICO] }, [p], { [A.id]: '2026-10-20T12:00:00Z' }, { [A.id]: CIERRE_A }), G, A.id);
  const despues = await estadoPagos(armar([A, B], { [A.id]: [NICO], [B.id]: [NICO] }, [p], { [A.id]: '2026-10-20T12:00:00Z', [B.id]: '2026-10-27T12:00:00Z' }, { [A.id]: CIERRE_A }), G, A.id);
  assert.equal(antes.titulares[0].estado, 'pagado');
  assert.equal(despues.titulares[0].estado, antes.titulares[0].estado);
  assert.equal(despues.titulares[0].pago!.id, '202');
});

test('R3 B precreada sin mensaje no le quita el pago a A', async () => {
  const Bpre = { ...B, created_at: '2026-10-21T12:00:00Z' };
  const p = pago(203, '2026-10-26T18:00:00.000-03:00', NICO);
  const d = armar([A, Bpre], { [A.id]: [NICO], [Bpre.id]: [NICO] }, [p], { [A.id]: '2026-10-20T12:00:00Z' }, { [A.id]: CIERRE_A });
  const a = await estadoPagos(d, G, A.id);
  const b = await estadoPagos(d, G, Bpre.id);
  assert.equal(a.titulares[0].estado, 'pagado');
  assert.equal(a.titulares[0].pago!.id, '203');
  assert.equal(a.partido.ventana.solapa, true);
  assert.equal(b.titulares[0].estado, 'no_pagado');
  await assert.rejects(
    sancionarNoPago(d, G, { match_id: A.id, user_id: NICO.user_id, confirmar: true }, null),
    (e: any) => e.status === 409,
  );
});

test('R4 pichanga cancelada en medio: el pago no desaparece', async () => {
  const C = partido('m-c', '2026-11-02T00:00:00+00:00', { status: 'cancelled', created_at: '2026-10-27T12:00:00Z' });
  const D = partido('m-d', '2026-11-09T00:00:00+00:00', { created_at: '2026-11-03T12:00:00Z' });
  const p = pago(204, '2026-10-28T10:00:00.000-03:00', NICO);
  const d = armar([A, C, D], { [A.id]: [NICO], [D.id]: [NICO] }, [p], {
    [A.id]: '2026-10-20T12:00:00Z', [C.id]: '2026-10-27T12:00:00Z', [D.id]: '2026-11-03T12:00:00Z',
  }, { [A.id]: CIERRE_A }, new Date('2026-11-10T16:00:00Z'));
  const a = await estadoPagos(d, G, A.id);
  const dd = await estadoPagos(d, G, D.id);
  assert.equal(a.titulares[0].estado, 'pagado_tarde');
  assert.equal(a.titulares[0].pago!.id, '204');
  assert.equal(dd.titulares[0].estado, 'no_pagado');
  assert.equal(dd.sin_asignar.find((s) => s.id === '204')?.motivo, 'fuera_de_ventana');
});

test('R5 pago fuera de ventana: visible sin email, no suma, y no cuenta como pagado', async () => {
  const conv = { [A.id]: '2026-10-20T12:00:00Z', [B.id]: '2026-10-27T12:00:00Z' };
  const p = pago(205, '2026-10-27T08:00:00.000-03:00', NICO);
  const d = armar([A, B], { [A.id]: [], [B.id]: [NICO] }, [p], conv, { [B.id]: '2026-11-03T13:00:00Z' });
  const b = await estadoPagos(d, G, B.id);
  const s = b.sin_asignar.find((x) => x.id === '205');
  assert.equal(s?.motivo, 'fuera_de_ventana');
  assert.equal(b.resumen?.recaudado, 0);
  assert.equal(b.titulares[0].estado, 'no_pagado');
  assert.equal(/[a-z0-9._-]{3,}@/i.test(JSON.stringify(b)), false);
});

test('R5b pago posterior al fin de la ventana también se muestra fuera y no suma', async () => {
  const p = pago(206, '2026-11-02T10:00:00.000-03:00', NICO);
  const d = armar([A], { [A.id]: [NICO] }, [p], { [A.id]: '2026-10-20T12:00:00Z' }, { [A.id]: CIERRE_A }, new Date('2026-11-04T16:00:00Z'));
  const a = await estadoPagos(d, G, A.id);
  assert.equal(a.titulares[0].estado, 'no_pagado');
  assert.equal(a.sin_asignar.find((s) => s.id === '206')?.motivo, 'fuera_de_ventana');
  assert.equal(a.resumen?.recaudado, 0);
  assert.equal(/@example\.test/.test(JSON.stringify(a)), false);
});
