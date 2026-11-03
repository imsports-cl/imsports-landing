/**
 * Regla del 20-oct: un pago que llega DESPUÉS del cierre no levanta la sanción.
 * Se muestra «pagó tarde» y el panel nunca quita sanciones por su cuenta.
 */
import './_guard';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cierrePago, esPagoTarde, fechaHoraClt } from '../../lib/mp/cierre';
import { cruzarPagos } from '../../lib/mp/cruce';
import { aPagoMp, esPagoDePichanga, type PagoMpRaw } from '../../lib/mp/pagos-mp';
import { estadoPagos, sancionarNoPago, type Deps } from '../../lib/mp/servicio';
import { fakeRepo } from './fake-repo';
import {
  GRUPO, MATCH, SIGUIENTE, TITULARES, PAGOS_RAW, PAGARON, ADMIN_EMAIL, CIERRE_19OCT, PAGO_ROBERT_TARDE,
} from './fixtures/pichanga-19oct';

const titularesQuePagan = TITULARES.filter((t) => t.email !== ADMIN_EMAIL);
const conRobert = [...PAGOS_RAW, PAGO_ROBERT_TARDE];
const pagos = (raw: PagoMpRaw[]) => raw.filter((r) => esPagoDePichanga(r, 5000)).map(aPagoMp);
const estados = (r: ReturnType<typeof cruzarPagos>) => Object.fromEntries(r.titulares.map((f) => [f.user_id, f.estado]));

// ---- definición del cierre ----

test('cierre: el primer mensaje match_closed del partido', () => {
  const c = cierrePago({ ...MATCH, phase: 'closed', status: 'completed' }, '2026-10-20T13:43:40.127324+00:00');
  assert.deepEqual(c, { en: CIERRE_19OCT, fuente: 'match_closed' });
});

test('cierre: partido sin cerrar → pendiente (nadie paga tarde todavía)', () => {
  assert.deepEqual(cierrePago(MATCH, null), { en: null, fuente: 'pendiente' });
  assert.equal(esPagoTarde('2026-10-25T12:00:00Z', null), false);
});

test('sin mensaje de cierre, un pago después del pitazo es pagado', () => {
  const c = cierrePago({ ...MATCH, phase: 'closed', status: 'completed' }, null);
  assert.deepEqual(c, { en: null, fuente: 'pendiente' });
  // 20:30 CLT, media hora después del pitazo de las 20:00.
  assert.equal(esPagoTarde('2026-10-19T23:30:00.000Z', c.en), false);
});

test('cierre a las 22:00: 21:59 es pagado y 22:05 es pagado tarde', () => {
  // 22:00 CLT del 19-oct (UTC-3) = 01:00Z del 20-oct.
  const c = cierrePago({ ...MATCH, phase: 'closed', status: 'completed' }, '2026-10-20T01:00:00.000Z');
  assert.equal(c.fuente, 'match_closed');
  assert.equal(esPagoTarde('2026-10-20T00:59:00.000Z', c.en), false);
  assert.equal(esPagoTarde('2026-10-20T01:05:00.000Z', c.en), true);
});

// ---- a tiempo / tarde / borde / zona horaria ----

test('a tiempo: pago antes del cierre', () => {
  assert.equal(esPagoTarde('2026-10-19T20:34:01.000-04:00', CIERRE_19OCT), false);
  assert.equal(esPagoTarde('2026-10-20T08:09:04.000-04:00', CIERRE_19OCT), false);
});

test('tarde: pago después del cierre (Robert, 20-oct 10:44 CLT)', () => {
  assert.equal(esPagoTarde(PAGO_ROBERT_TARDE.date_approved!, CIERRE_19OCT), true);
  assert.equal(esPagoTarde('2026-10-21T12:00:00Z', CIERRE_19OCT), true);
});

test('borde exacto: en el mismo instante del cierre es a tiempo; 1 ms después es tarde', () => {
  assert.equal(esPagoTarde(CIERRE_19OCT, CIERRE_19OCT), false);
  assert.equal(esPagoTarde('2026-10-20T09:43:40.127-04:00', CIERRE_19OCT), false); // mismo instante, otro offset
  assert.equal(esPagoTarde('2026-10-20T13:43:40.128Z', CIERRE_19OCT), true);
  assert.equal(esPagoTarde('2026-10-20T13:43:40.126Z', CIERRE_19OCT), false);
});

test('zona horaria: compara instantes, no textos (MP -04:00 vs Chile -03:00)', () => {
  // Como texto "09:44" < "10:43" parecería a tiempo; como instante es 10:44 CLT → tarde
  assert.equal(esPagoTarde('2026-10-20T09:44:00.000-04:00', '2026-10-20T10:43:40.127-03:00'), true);
  // 10:43 en -04:00 = 11:43 CLT → tarde, aunque el texto sea igual a la hora del cierre
  assert.equal(esPagoTarde('2026-10-20T10:43:00.000-04:00', '2026-10-20T10:43:40.127-03:00'), true);
  // Sin mensaje de cierre no hay corte, ni en invierno.
  const inv = cierrePago({ date: '2026-07-06T00:00:00+00:00', time: '20:00', phase: 'closed', status: 'completed' }, null);
  assert.equal(inv.en, null);
  assert.equal(esPagoTarde('2026-07-06T20:00:01.000-04:00', inv.en), false);
});

test('fecha/hora del pago se muestra en CLT', () => {
  assert.equal(fechaHoraClt(PAGO_ROBERT_TARDE.date_approved!), 'mar 20-oct 10:44');
  assert.equal(fechaHoraClt('2026-10-19T23:16:15.000-04:00'), 'mar 20-oct 00:16'); // cambia de día en Chile
  assert.equal(fechaHoraClt('2026-07-06T20:00:00.000-04:00'), 'lun 06-jul 20:00');
});

// ---- cruce ----

test('19-oct con cierre: 7 pagaron a tiempo, Robert pagó tarde, 3 no pagaron', () => {
  const r = cruzarPagos(titularesQuePagan, pagos(conRobert), [], undefined, CIERRE_19OCT);
  const e = estados(r);
  for (const u of PAGARON) assert.equal(e[u], 'pagado', u);
  assert.equal(e['u-robert'], 'pagado_tarde');
  for (const u of ['u-gsoto', 'u-chino', 'u-gonzalo']) assert.equal(e[u], 'no_pagado', u);
  assert.deepEqual(
    { p: r.resumen.pagados, t: r.resumen.pagados_tarde, n: r.resumen.no_pagados, s: r.resumen.sin_asignar },
    { p: 7, t: 1, n: 3, s: 0 },
  );
  const robert = r.titulares.find((f) => f.user_id === 'u-robert')!;
  assert.equal(robert.pago!.tarde, true);
  assert.equal(robert.pago!.fecha_clt, 'mar 20-oct 10:44');
  assert.equal(r.cierre, CIERRE_19OCT);
  // orden: no pagaron, pagaron tarde, pagaron
  assert.deepEqual([...new Set(r.titulares.map((f) => f.estado))], ['no_pagado', 'pagado_tarde', 'pagado']);
});

test('sin cierre (pendiente) el mismo pago cuenta como pagado', () => {
  const r = cruzarPagos(titularesQuePagan, pagos(conRobert));
  assert.equal(estados(r)['u-robert'], 'pagado');
  assert.equal(r.resumen.pagados_tarde, 0);
  assert.equal(r.cierre, null);
});

test('pago justo en el cierre: pagado (a tiempo)', () => {
  const justo = { ...PAGO_ROBERT_TARDE, date_approved: CIERRE_19OCT };
  const r = cruzarPagos(titularesQuePagan, pagos([...PAGOS_RAW, justo]), [], undefined, CIERRE_19OCT);
  assert.equal(estados(r)['u-robert'], 'pagado');
});

test('pagos sin asignar también marcan si llegaron tarde', () => {
  const raro = { ...PAGO_ROBERT_TARDE, id: 1011, payer: { id: '1', first_name: 'Nadie', last_name: 'Conocido' } };
  const r = cruzarPagos(titularesQuePagan, pagos([raro]), [], undefined, CIERRE_19OCT);
  assert.equal(r.sin_asignar[0].tarde, true);
  assert.equal(r.sin_asignar[0].fecha_clt, 'mar 20-oct 10:44');
});

// ---- servicio: nunca perdona ----

function deps(sanciones: any[] = []) {
  const db = fakeRepo({
    partidos: [{ ...MATCH, phase: 'closed', status: 'completed' }, SIGUIENTE],
    titulares: { [MATCH.id]: TITULARES },
    cierres: { [MATCH.id]: '2026-10-20T13:43:40.127324+00:00' },
    sanciones,
  });
  const d: Deps = {
    repo: db.repo,
    mp: { async buscarAprobados() { return conRobert; }, async pago(id) { return conRobert.find((p) => String(p.id) === id)!; } },
    ahora: () => new Date('2026-10-20T15:00:00Z'),
    noPagan: [ADMIN_EMAIL],
  };
  return { d, db };
}

test('servicio: Robert sale «pagó tarde», con el cierre del partido, y su sanción sigue', async () => {
  const sanc = { group_id: GRUPO, user_id: 'u-robert', applies_to: '2026-10-26', reason: 'no_pago', note: 'No pagó pichanga 19-oct' };
  const { d, db } = deps([sanc]);
  const r = await estadoPagos(d, GRUPO, MATCH.id);
  const robert = r.titulares.find((f) => f.user_id === 'u-robert')!;
  assert.equal(robert.estado, 'pagado_tarde');
  assert.equal(robert.sancion, 'no_pago', 'la sanción se muestra, no se levanta');
  assert.deepEqual(r.partido.cierre, { en: CIERRE_19OCT, fuente: 'match_closed' });
  assert.equal(r.resumen!.pagados, 7);
  assert.equal(r.resumen!.pagados_tarde, 1);
  assert.equal(db.inserts.length, 0, 'el GET no escribe en player_sanctions');
  assert.equal(db.sanciones.length, 1);
  assert.deepEqual(db.sanciones[0], sanc, 'ni la borra ni la modifica');
});

test('servicio: sin cierre el pago posterior al pitazo es a tiempo; con cierre 22:00, 22:05 es tarde', async () => {
  const nico = titularesQuePagan[0];
  const armar = (cierres: Record<string, string>, fecha: string) => {
    const pago = { ...PAGO_ROBERT_TARDE, id: 8801, date_approved: fecha, payer: { ...PAGO_ROBERT_TARDE.payer, email: nico.email, first_name: 'NICO', last_name: 'SOTO' } };
    const db = fakeRepo({
      partidos: [{ ...MATCH, phase: 'closed', status: 'completed' }, SIGUIENTE],
      titulares: { [MATCH.id]: [nico] },
      cierres,
    });
    const d: Deps = {
      repo: db.repo,
      mp: { async buscarAprobados() { return [pago]; }, async pago(id) { return pago; } },
      ahora: () => new Date('2026-10-21T15:00:00Z'),
      noPagan: [],
    };
    return d;
  };
  const despues = '2026-10-19T23:30:00.000Z'; // 20:30 CLT, después del pitazo
  const sin = await estadoPagos(armar({}, despues), GRUPO, MATCH.id);
  assert.equal(sin.titulares[0].estado, 'pagado');
  await assert.rejects(
    sancionarNoPago(armar({}, despues), GRUPO, { match_id: MATCH.id, user_id: nico.user_id, confirmar: true }, null),
    (e: any) => e.status === 409,
  );
  const aTiempo = '2026-10-20T00:59:00.000Z'; // 21:59 CLT
  const tarde = '2026-10-20T01:05:00.000Z'; // 22:05 CLT
  const cierre = { [MATCH.id]: '2026-10-20T01:00:00.000Z' }; // 22:00 CLT
  assert.equal((await estadoPagos(armar(cierre, aTiempo), GRUPO, MATCH.id)).titulares[0].estado, 'pagado');
  assert.equal((await estadoPagos(armar(cierre, tarde), GRUPO, MATCH.id)).titulares[0].estado, 'pagado_tarde');
  const san = await sancionarNoPago(armar(cierre, tarde), GRUPO, { match_id: MATCH.id, user_id: nico.user_id, confirmar: true }, null);
  assert.equal(san.ya_existia, false);
});

test('servicio: a quien pagó tarde se le puede cargar la sanción; a quien pagó a tiempo no', async () => {
  const { d, db } = deps();
  const a = await sancionarNoPago(d, GRUPO, { match_id: MATCH.id, user_id: 'u-robert', confirmar: true }, 'u-zlatan');
  assert.equal(a.ya_existia, false);
  assert.equal(db.inserts[0].reason, 'no_pago');
  await assert.rejects(sancionarNoPago(d, GRUPO, { match_id: MATCH.id, user_id: 'u-gonga', confirmar: true }, null), (e: any) => e.status === 409);
  assert.equal(db.inserts.length, 1);
});

test('el repo de pagos no tiene forma de borrar sanciones', async () => {
  const { d } = deps();
  const metodos = Object.keys(d.repo);
  assert.ok(!metodos.some((k) => /borrarSancion|quitarSancion|perdon|deleteSanc/i.test(k)), metodos.join(','));
});
