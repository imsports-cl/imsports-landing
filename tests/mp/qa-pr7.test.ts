/** Casos de QA del PR #7. Datos ficticios. Grupo semanal: A lun 26-oct, B lun 2-nov, B convocada el mar 27-oct. */
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
const RAFA = tit('u-rafa', 'Rafa', 'Mora');
const ALAN = tit('u-alan', 'Alan', 'Vega');
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
const CONV = { [A.id]: '2026-10-20T12:00:00Z', [B.id]: '2026-10-27T12:00:00Z' }; // mar 09:00 CLT
const CIERRES = { [A.id]: '2026-10-27T13:00:00Z', [B.id]: '2026-11-03T13:00:00Z' };

test('semanal: el pago anticipado de B (mié 28-oct) queda pagado en B y no duplicado en A', async () => {
  const pA = pago(101, '2026-10-26T18:00:00.000-03:00', NICO);
  const pB = pago(102, '2026-10-28T10:00:00.000-03:00', NICO);
  const d = armar([A, B], { [A.id]: [NICO], [B.id]: [NICO] }, [pA, pB], CONV, CIERRES);
  const a = await estadoPagos(d, G, A.id);
  const b = await estadoPagos(d, G, B.id);
  assert.equal(b.titulares[0].estado, 'pagado');
  assert.equal(b.titulares[0].pago!.id, '102');
  // Las ventanas se solapan (A sigue hasta el sábado). Ya no se recorta A
  // en la convocatoria de B: 101 se queda en A y 102, como A ya está pagada, va a B.
  assert.equal(b.partido.ventana.solapa, true);
  assert.equal(a.partido.ventana.solapa, true);
  assert.equal(a.titulares[0].estado, 'pagado');
  assert.equal(a.titulares[0].pago!.id, '101');
  assert.equal(a.sin_asignar.some((s) => s.id === '102'), false);
  assert.equal(b.sin_asignar.find((s) => s.id === '101')?.motivo, 'fuera_de_ventana');
});

test('semanal: un solo pago en el solape va a la pichanga más antigua y no se puede sancionar la otra', async () => {
  // Antes este caso exigía que A se recortara en la convocatoria de B, así el
  // miércoles no entraba en A. Eso dejaba fuera los pagos de A del martes.
  // Ahora el pago cae en las dos ventanas y, como A no tiene otro pago, se
  // asigna a A (tarde: el cierre de A es el 27-oct 10:00). B no lo muestra
  // como pagado, pero la sanción se rechaza: no hay certeza de que no sea de B.
  const pB = pago(103, '2026-10-28T10:00:00.000-03:00', RAFA);
  const d = armar([A, B], { [A.id]: [RAFA], [B.id]: [RAFA] }, [pB], CONV, CIERRES);
  const a = await estadoPagos(d, G, A.id);
  const b = await estadoPagos(d, G, B.id);
  assert.equal(a.titulares[0].estado, 'pagado_tarde');
  assert.equal(a.titulares[0].pago!.id, '103');
  assert.equal(b.titulares[0].estado, 'no_pagado');
  assert.equal(b.titulares[0].pago, null);
  await assert.rejects(
    sancionarNoPago(d, G, { match_id: B.id, user_id: RAFA.user_id, confirmar: true }, null),
    (e: any) => e.status === 409,
  );
});

for (const off of ['-04:00', '-03:00']) {
  test(`Alan 2-nov (pago ${off}) con pichanga semanal previa: pagado a tiempo`, async () => {
    const f = off === '-04:00' ? '2026-11-02T18:26:49.000-04:00' : '2026-11-02T19:26:49.000-03:00';
    const pAlan = pago(187428058992, f, ALAN);
    const d = armar([A, B], { [A.id]: [ALAN], [B.id]: [ALAN] }, [pAlan], CONV, CIERRES);
    const b = await estadoPagos(d, G, B.id);
    assert.equal(b.titulares[0].estado, 'pagado');
    assert.equal(b.titulares[0].pago!.id, '187428058992');
    assert.equal(b.titulares[0].pago!.tarde, false);
    assert.equal(/@example\.test/.test(JSON.stringify(b)), false);
  });
}

test('Alan sin pichanga previa ni mensaje (solo created_at): pagado', async () => {
  const d = armar([B], { [B.id]: [ALAN] }, [pago(187428058992, '2026-11-02T18:26:49.000-04:00', ALAN)], {}, CIERRES);
  const b = await estadoPagos(d, G, B.id);
  assert.equal(b.titulares[0].estado, 'pagado');
});

test('borde: el pago justo en el fin de los 5 días de A no cae en las dos ventanas', async () => {
  const pE = pago(104, '2026-10-31T20:00:00.000-03:00', NICO);
  const d = armar([A, B], { [A.id]: [NICO], [B.id]: [NICO] }, [pE], CONV, CIERRES);
  const a = await estadoPagos(d, G, A.id);
  const b = await estadoPagos(d, G, B.id);
  assert.ok(!(a.titulares[0].pago && b.titulares[0].pago), 'el mismo pago quedó en A y en B');
  assert.equal(a.titulares[0].pago, null);
  assert.equal(b.titulares[0].pago!.id, '104');
});
