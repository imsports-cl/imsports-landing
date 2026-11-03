/**
 * Ventana de pagos desde la convocatoria (no desde el pitazo).
 * Datos ficticios, al estilo de la pichanga del 2-nov-2026: pago ~33 min
 * antes del inicio, correo del pago = correo de la app. Sin datos reales.
 *
 * Inicio de ventana: primer mensaje match_convocatoria; si falta,
 * matches.created_at, acotado al inicio del partido si es posterior.
 * Solape: desde = max(esa convocatoria, fin de la ventana del partido
 * anterior no cancelado), sin pasar del pitazo. Si la anterior sigue
 * abierta al pitazo, solapa = true (el panel lo avisa).
 */
import './_guard';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoSantiago, santiagoAUtc, ventanaPagos, DIAS_VENTANA } from '../../lib/mp/tiempo';
import { estadoPagos, sancionarNoPago, type Deps, type Partido } from '../../lib/mp/servicio';
import { fakeRepo } from './fake-repo';
import type { Titular } from '../../lib/mp/cruce';
import type { PagoMpRaw } from '../../lib/mp/pagos-mp';

const G = 'g-lunes';
const AHORA = new Date('2026-11-03T16:00:00.000Z');
const CONV = '2026-11-01T12:07:19.000Z'; // 09:07 CLT
const CREATED = '2026-11-01T12:07:06.000Z'; // ~13 s antes del mensaje

const partido = (id: string, date: string, extra: Partial<Partido> = {}): Partido => ({
  id, group_id: G, date, time: '20:00', price: 5000, status: 'scheduled', phase: 'voting', ...extra,
});

const M2 = partido('m-2nov', '2026-11-02T00:00:00+00:00', { created_at: CREATED });
const M19 = partido('m-19oct', '2026-10-19T00:00:00+00:00', {
  status: 'completed', phase: 'closed', created_at: '2026-10-18T12:00:00.000Z',
});
const CANCEL = partido('m-cancel', '2026-10-31T00:00:00+00:00', { status: 'cancelled', phase: 'closed' });

const titular = (user_id: string, nombre: string, display: string, email: string): Titular =>
  ({ user_id, nombre, nickname: nombre, display_name: display, email });

const ALAN = titular('u-alan', 'Alan', 'Alan Vega', 'alan.vega@example.test');
const RAFA = titular('u-rafa', 'Rafa', 'Rafa Mora', 'rafa.mora@example.test');
const NICO = titular('u-nico', 'Nico', 'Nico Soto', 'nico.soto@example.test');

const base = { status: 'approved', currency_id: 'CLP', operation_type: 'regular_payment', transaction_amount_refunded: 0 };
const pago = (id: number, date_approved: string, payer: PagoMpRaw['payer'], extra: Partial<PagoMpRaw> = {}): PagoMpRaw => ({
  ...base, id, date_approved, transaction_amount: 5000, description: 'Pichanga Conecta', payer, ...extra,
});

const PAGO_ALAN = pago(2001, '2026-11-02T18:26:49.000-04:00', {
  id: '9101', email: 'alan.vega@example.test', first_name: 'ALAN', last_name: 'VEGA',
});
const PAGO_ANTES = pago(2000, '2026-10-19T23:18:00.000-04:00', {
  id: '9101', email: 'alan.vega@example.test', first_name: 'ALAN', last_name: 'VEGA',
});

function armar(opts: {
  partidos: Partido[];
  titulares: Record<string, Titular[]>;
  pagos: PagoMpRaw[];
  convocatorias?: Record<string, string>;
  cierres?: Record<string, string>;
  ahora?: Date;
}) {
  const db = fakeRepo({
    partidos: opts.partidos,
    titulares: opts.titulares,
    convocatorias: opts.convocatorias,
    cierres: opts.cierres,
  });
  const llamadas: string[] = [];
  const ahora = opts.ahora ?? AHORA;
  const d: Deps = {
    repo: db.repo,
    mp: {
      async buscarAprobados(desde, hasta) { llamadas.push(`search ${desde} ${hasta}`); return opts.pagos; },
      async pago(id) { return opts.pagos.find((p) => String(p.id) === id)!; },
    },
    ahora: () => ahora,
    noPagan: [],
  };
  return { d, db, llamadas, ahora };
}

const sinCorreoNiToken = (r: unknown) => {
  const s = JSON.stringify(r);
  assert.equal(/[a-z0-9._-]{3,}@/i.test(s), false, 'el JSON no trae correos completos');
  assert.equal(s.includes('example.test'), false);
  assert.equal(/APP_USR|MP_ACCESS_TOKEN|Bearer /i.test(s), false, 'el JSON no trae el token');
};

// ---- definición de la ventana ----

test('ventana: la convocatoria adelanta el inicio; el fin sigue siendo el pitazo + 5 días', () => {
  const v = ventanaPagos(M2.date, M2.time, AHORA, { convocatoria: CONV });
  assert.equal(v.desde.toISOString(), CONV);
  assert.equal(isoSantiago(v.desde), '2026-11-01T09:07:19.000-03:00');
  assert.equal(v.hasta.toISOString(), AHORA.toISOString());
  assert.equal(v.cerrada, false);
  assert.equal(v.solapa, false);
  const fin = new Date(santiagoAUtc('2026-11-02', '20:00').getTime() + DIAS_VENTANA * 86400000);
  assert.equal(fin.toISOString(), '2026-11-07T23:00:00.000Z');
});

test('ventana: sin mensaje se usa created_at; si es posterior al pitazo se acota al inicio', () => {
  const antes = ventanaPagos(M2.date, '20:00', AHORA, { convocatoria: CREATED });
  assert.equal(antes.desde.toISOString(), CREATED);
  const importado = ventanaPagos(M2.date, '20:00', AHORA, { convocatoria: '2026-11-03T15:00:00.000Z' });
  assert.equal(importado.desde.toISOString(), '2026-11-02T23:00:00.000Z');
  assert.equal(isoSantiago(importado.desde), '2026-11-02T20:00:00.000-03:00');
});

test('ventana: el fin de la anterior corre el inicio, con tope en el pitazo', () => {
  const finSabado = new Date(santiagoAUtc('2026-10-26', '20:00').getTime() + DIAS_VENTANA * 86400000);
  assert.equal(isoSantiago(finSabado), '2026-10-31T20:00:00.000-03:00');
  // Convocatoria dentro de la ventana anterior, pero el fin cae antes del pitazo.
  const v = ventanaPagos('2026-11-02', '20:00', AHORA, { convocatoria: '2026-10-30T12:00:00.000Z', finAnterior: finSabado });
  assert.equal(v.desde.toISOString(), finSabado.toISOString());
  assert.equal(v.solapa, false);
  // Dos partidos en la semana: la anterior sigue abierta al pitazo → no pasar del inicio, y avisar.
  const finLargo = new Date(santiagoAUtc('2026-11-02', '20:00').getTime() + DIAS_VENTANA * 86400000);
  const cerca = ventanaPagos('2026-11-05', '20:00', AHORA, { convocatoria: '2026-11-04T12:00:00.000Z', finAnterior: finLargo });
  assert.equal(cerca.desde.toISOString(), '2026-11-05T23:00:00.000Z');
  assert.equal(cerca.solapa, true);
});

test('borde de huso: el instante exacto de la convocatoria (-04:00 de MP = -03:00 de Chile) entra; 1 ms antes no', () => {
  const conv = new Date(CONV);
  assert.equal(isoSantiago(conv), '2026-11-01T09:07:19.000-03:00');
  const exacto = '2026-11-01T08:07:19.000-04:00';
  const antes = '2026-11-01T08:07:18.999-04:00';
  assert.equal(Date.parse(exacto), conv.getTime());
  assert.ok(Date.parse(antes) < conv.getTime());
  const { d, llamadas } = armar({
    partidos: [M2, M19, CANCEL],
    titulares: { [M2.id]: [ALAN] },
    convocatorias: { [M2.id]: CONV },
    pagos: [
      pago(2010, antes, { id: '9101', email: 'alan.vega@example.test', first_name: 'ALAN', last_name: 'VEGA' }),
      pago(2011, exacto, { id: '9101', email: 'alan.vega@example.test', first_name: 'ALAN', last_name: 'VEGA' }),
    ],
  });
  return estadoPagos(d, G, M2.id).then((r) => {
    assert.equal(llamadas[0], `search ${isoSantiago(conv)} ${isoSantiago(AHORA)}`);
    const alan = r.titulares.find((f) => f.user_id === 'u-alan')!;
    assert.equal(alan.estado, 'pagado');
    assert.equal(alan.pago!.id, '2011');
    assert.equal(JSON.stringify(r).includes('2010'), false);
    sinCorreoNiToken(r);
  });
});

// ---- caso del pago anticipado ----

test('pago entre la convocatoria y el pitazo queda pagado (a tiempo) por correo; uno anterior a la convocatoria no cuenta', async () => {
  const { d, llamadas } = armar({
    partidos: [M2, M19, CANCEL],
    titulares: { [M2.id]: [ALAN, RAFA] },
    convocatorias: { [M2.id]: CONV },
    pagos: [PAGO_ANTES, PAGO_ALAN],
  });
  const r = await estadoPagos(d, G, M2.id);
  assert.equal(llamadas[0], `search ${isoSantiago(new Date(CONV))} ${isoSantiago(AHORA)}`);
  assert.equal(r.partido.ventana.desde, CONV);
  assert.equal(r.partido.ventana.solapa, false);
  assert.equal(r.partido.cierre.fuente, 'pendiente');
  const alan = r.titulares.find((f) => f.user_id === 'u-alan')!;
  assert.equal(alan.estado, 'pagado');
  assert.equal(alan.pago!.tarde, false);
  assert.equal(alan.pago!.via, 'email');
  assert.equal(alan.pago!.id, '2001');
  assert.equal(JSON.stringify(r).includes('2000'), false, 'el pago anterior a la convocatoria no entra');
  assert.equal(r.titulares.find((f) => f.user_id === 'u-rafa')!.estado, 'no_pagado');
  sinCorreoNiToken(r);
});

test('sin mensaje match_convocatoria manda created_at; uno entre created_at y el mensaje no cuenta si el mensaje existe', async () => {
  const entre = '2026-11-01T08:07:10.000-04:00'; // 12:07:10Z, entre created_at y el mensaje
  const { d: conMensaje } = armar({
    partidos: [M2],
    titulares: { [M2.id]: [ALAN] },
    convocatorias: { [M2.id]: CONV },
    pagos: [pago(2020, entre, { id: '9101', email: 'alan.vega@example.test', first_name: 'ALAN', last_name: 'VEGA' })],
  });
  const a = await estadoPagos(conMensaje, G, M2.id);
  assert.equal(a.titulares[0].estado, 'no_pagado');

  const { d: sinMensaje, llamadas } = armar({
    partidos: [M2],
    titulares: { [M2.id]: [ALAN] },
    pagos: [pago(2020, entre, { id: '9101', email: 'alan.vega@example.test', first_name: 'ALAN', last_name: 'VEGA' })],
  });
  const b = await estadoPagos(sinMensaje, G, M2.id);
  assert.equal(llamadas[0].startsWith(`search ${isoSantiago(new Date(CREATED))} `), true);
  assert.equal(b.titulares[0].estado, 'pagado');
  assert.equal(b.titulares[0].pago!.id, '2020');
});

test('created_at posterior al pitazo no adelanta ni atrasa: el pago de antes del inicio no cuenta', async () => {
  const tardeCreado = partido('m-imp', '2026-11-02T00:00:00+00:00', { created_at: '2026-11-03T15:00:00.000Z' });
  const { d, llamadas } = armar({
    partidos: [tardeCreado],
    titulares: { [tardeCreado.id]: [ALAN] },
    pagos: [
      PAGO_ALAN,
      pago(2030, '2026-11-02T21:30:00.000-04:00', { id: '9101', email: 'alan.vega@example.test', first_name: 'ALAN', last_name: 'VEGA' }),
    ],
  });
  const r = await estadoPagos(d, G, tardeCreado.id);
  assert.equal(llamadas[0].startsWith('search 2026-11-02T20:00:00.000-03:00 '), true);
  assert.equal(r.titulares[0].estado, 'pagado');
  assert.equal(r.titulares[0].pago!.id, '2030');
  assert.equal(JSON.stringify(r).includes('2001'), false);
});

test('un partido cancelado no recorta la ventana de la siguiente', async () => {
  const { d } = armar({
    partidos: [M2, CANCEL, M19],
    titulares: { [M2.id]: [ALAN] },
    convocatorias: { [M2.id]: CONV },
    pagos: [PAGO_ALAN],
  });
  const r = await estadoPagos(d, G, M2.id);
  assert.equal(r.partido.ventana.solapa, false);
  assert.equal(r.titulares[0].estado, 'pagado');
  assert.equal(r.titulares[0].pago!.id, '2001');
});

// ---- solape entre dos pichangas del mismo grupo ----

test('dos pichangas seguidas: un pago queda en una sola (la ventana nueva parte cuando termina la anterior)', async () => {
  const ma = partido('m-a', '2026-10-26T00:00:00+00:00', { created_at: '2026-10-25T12:00:00.000Z' });
  const mb = partido('m-b', '2026-11-02T00:00:00+00:00', { created_at: '2026-10-30T12:00:00.000Z' });
  const convA = '2026-10-25T12:00:00.000Z';
  const convB = '2026-10-30T12:00:00.000Z'; // domingo dentro de la ventana del lunes anterior
  const finA = new Date(santiagoAUtc(ma.date, ma.time).getTime() + DIAS_VENTANA * 86400000);
  const enA = pago(3001, '2026-10-30T17:00:00.000-04:00', { id: '9200', email: 'nico.soto@example.test', first_name: 'NICO', last_name: 'SOTO' });
  const enB = pago(3002, '2026-11-01T09:00:00.000-04:00', { id: '9200', email: 'nico.soto@example.test', first_name: 'NICO', last_name: 'SOTO' });
  const { d } = armar({
    partidos: [ma, mb],
    titulares: { [ma.id]: [NICO], [mb.id]: [NICO] },
    convocatorias: { [ma.id]: convA, [mb.id]: convB },
    pagos: [enA, enB],
    ahora: new Date('2026-11-03T16:00:00.000Z'),
  });
  const a = await estadoPagos(d, G, ma.id);
  const b = await estadoPagos(d, G, mb.id);
  assert.equal(a.partido.ventana.solapa, false);
  assert.equal(b.partido.ventana.solapa, false);
  assert.equal(b.partido.ventana.desde, finA.toISOString());
  assert.equal(a.titulares[0].pago!.id, '3001');
  assert.equal(b.titulares[0].pago!.id, '3002');
  assert.equal(b.titulares[0].estado, 'pagado');
  assert.equal(JSON.stringify(a).includes('3002'), false);
  assert.equal(JSON.stringify(b).includes('3001'), false);
});

test('dos pichangas en la misma semana: el tramo que pasa del pitazo se avisa (solapa) y no se recorta', async () => {
  const ma = partido('m-lun', '2026-11-02T00:00:00+00:00');
  const mb = partido('m-jue', '2026-11-05T00:00:00+00:00');
  const compartido = pago(3010, '2026-11-05T20:00:00.000-04:00', {
    id: '9201', email: 'nico.soto@example.test', first_name: 'NICO', last_name: 'SOTO',
  });
  const { d } = armar({
    partidos: [ma, mb],
    titulares: { [ma.id]: [NICO], [mb.id]: [NICO] },
    convocatorias: { [ma.id]: '2026-11-01T12:00:00.000Z', [mb.id]: '2026-11-04T12:00:00.000Z' },
    pagos: [compartido],
    ahora: new Date('2026-11-08T16:00:00.000Z'),
  });
  const a = await estadoPagos(d, G, ma.id);
  const b = await estadoPagos(d, G, mb.id);
  assert.equal(a.partido.ventana.solapa, false);
  assert.equal(b.partido.ventana.solapa, true, 'el panel marca el solape');
  assert.equal(b.partido.ventana.desde, santiagoAUtc('2026-11-05', '20:00').toISOString());
  assert.equal(a.titulares[0].estado, 'pagado');
  assert.equal(b.titulares[0].estado, 'pagado');
  assert.equal(a.titulares[0].pago!.id, '3010');
  assert.equal(b.titulares[0].pago!.id, '3010');
});

// ---- montos ajenos y recaudado ----

test('un pago del mismo monto sin identidad no se asigna y no infla el recaudado', async () => {
  const ajeno = pago(2002, '2026-11-02T15:00:00.000-04:00', {
    id: '9300', email: 'caja.random@example.test', first_name: 'Pedro', last_name: 'Nadie',
  }, { description: 'Supermercado' });
  const soloNombre = pago(2003, '2026-11-02T16:00:00.000-04:00', {
    id: '9301', email: 'zzz@example.test', first_name: 'Alan', last_name: '',
  }, { description: 'Varios' });
  const { d } = armar({
    partidos: [M2],
    titulares: { [M2.id]: [ALAN] },
    convocatorias: { [M2.id]: CONV },
    pagos: [PAGO_ALAN, ajeno, soloNombre],
  });
  const r = await estadoPagos(d, G, M2.id);
  assert.equal(r.titulares[0].estado, 'pagado');
  assert.equal(r.titulares[0].pago!.id, '2001');
  assert.equal(r.titulares[0].pago!.via, 'email');
  assert.deepEqual(r.sin_asignar.map((s) => s.id).sort(), ['2002', '2003']);
  assert.ok(r.sin_asignar.every((s) => s.motivo === 'sin_coincidencia'));
  assert.equal(r.resumen!.recaudado, 5000);
  assert.equal(r.resumen!.pagados, 1);
});

// ---- cierre y sanciones, sin cambio de regla ----

test('el pago anticipado bloquea la sanción; uno posterior al cierre sigue siendo tarde y sí se puede sancionar', async () => {
  const cierre = '2026-11-03T14:00:00.000Z'; // 11:00 CLT
  const tarde = pago(2040, '2026-11-03T10:30:00.000-04:00', {
    id: '9400', email: 'rafa.mora@example.test', first_name: 'RAFA', last_name: 'MORA',
  });
  const { d, db } = armar({
    partidos: [{ ...M2, phase: 'closed', status: 'completed' }, M19],
    titulares: { [M2.id]: [ALAN, RAFA] },
    convocatorias: { [M2.id]: CONV },
    cierres: { [M2.id]: cierre },
    pagos: [PAGO_ALAN, tarde],
  });
  const r = await estadoPagos(d, G, M2.id);
  const alan = r.titulares.find((f) => f.user_id === 'u-alan')!;
  const rafa = r.titulares.find((f) => f.user_id === 'u-rafa')!;
  assert.equal(alan.estado, 'pagado');
  assert.equal(alan.pago!.tarde, false);
  assert.equal(rafa.estado, 'pagado_tarde');
  assert.equal(rafa.pago!.tarde, true);
  assert.equal(rafa.pago!.fecha_clt, 'mar 03-nov 11:30');
  assert.deepEqual(r.partido.cierre, { en: cierre, fuente: 'match_closed' });
  assert.equal(r.resumen!.recaudado, 10000);

  await assert.rejects(
    sancionarNoPago(d, G, { match_id: M2.id, user_id: 'u-alan', confirmar: true }, null),
    (e: any) => e.status === 409,
  );
  assert.equal(db.inserts.length, 0);
  const s = await sancionarNoPago(d, G, { match_id: M2.id, user_id: 'u-rafa', confirmar: true }, 'u-admin');
  assert.equal(s.ya_existia, false);
  assert.equal(db.inserts.length, 1);
  assert.equal(db.inserts[0].user_id, 'u-rafa');
  assert.equal(db.inserts[0].reason, 'no_pago');
  sinCorreoNiToken(r);
});
