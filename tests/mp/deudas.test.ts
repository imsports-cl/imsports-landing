import './_guard';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fechasPendientesDeLineup, textoFechasPendientes, CONFIRMACION_MARCAR_PAGADO } from '../../lib/cierre/fechas';
import { mensajeCierre } from '../../lib/cierre/mensaje';
import {
  asignarPagosADeudas,
  debeRegistrarDeuda,
  sancionHastaPagarActiva,
  ventanaConciliacion,
  type DeudaPago,
} from '../../lib/mp/deudas';
import { aPagoMp, type PagoMpRaw } from '../../lib/mp/pagos-mp';
import { sancionarNoPago, type Deps } from '../../lib/mp/servicio';
import { DIAS_VENTANA } from '../../lib/mp/tiempo';
import { BANCA_2NOV, CUPOS_2NOV, TITULARES_2NOV } from './fixtures/cierre-2nov';
import { ADMIN_EMAIL, CIERRE_19OCT, GRUPO, MATCH, PAGOS_RAW, PAGO_ROBERT_TARDE, SIGUIENTE, TITULARES } from './fixtures/pichanga-19oct';
import { fakeRepo } from './fake-repo';

const GOLDEN_2NOV = [
  'Pierde cupo por no pago:',
  'Chino, Chipi, Esteban, Gonzalo',
  '',
  'Asegura cupo hasta:',
  '9 de noviembre',
  'Talo',
  '16 de noviembre',
  'Boris, Chalo',
  '30 de noviembre',
  'Michel, Villa, Roberto',
].join('\n');

const perfil = (user_id: string, nombre: string, email: string | null = null) =>
  ({ user_id, nombre, display_name: nombre, nickname: nombre, email });

function pago(id: string, date_approved: string, payer: PagoMpRaw['payer']) {
  const raw: PagoMpRaw = {
    id, status: 'approved', currency_id: 'CLP', date_approved,
    transaction_amount: 5000, description: 'Pichanga Conecta',
    additional_info: { items: [{ title: 'Pichanga Conecta' }] },
    transaction_amount_refunded: 0,
    payer,
  };
  const p = aPagoMp(raw);
  return { id: p.id, fecha: p.fecha, pago: p, raw };
}

const deuda = (id: string, user_id: string, fecha: string, extra: Partial<DeudaPago> = {}): DeudaPago =>
  ({ id, user_id, nombre: user_id, fecha, status: 'activa', ...extra });

test('el flag solo prende con 1 o true', () => {
  assert.equal(sancionHastaPagarActiva({}), false);
  assert.equal(sancionHastaPagarActiva({ SANCION_HASTA_PAGAR: '0' }), false);
  assert.equal(sancionHastaPagarActiva({ SANCION_HASTA_PAGAR: 'yes' }), false);
  assert.equal(sancionHastaPagarActiva({ SANCION_HASTA_PAGAR: '1' }), true);
  assert.equal(sancionHastaPagarActiva({ SANCION_HASTA_PAGAR: 'true' }), true);
});

test('la deuda no se crea antes del pitazo ni si pagó tarde o el flag está apagado', () => {
  assert.equal(debeRegistrarDeuda({ activa: true, estado: 'no_pagado', partidoEmpezo: false }), false);
  assert.equal(debeRegistrarDeuda({ activa: true, estado: 'pagado_tarde', partidoEmpezo: true }), false);
  assert.equal(debeRegistrarDeuda({ activa: true, estado: 'pagado', partidoEmpezo: true }), false);
  assert.equal(debeRegistrarDeuda({ activa: false, estado: 'no_pagado', partidoEmpezo: true }), false);
  assert.equal(debeRegistrarDeuda({ activa: true, estado: 'no_pagado', partidoEmpezo: true }), true);
});

test('un mp_payment_id no salda dos deudas; un pago sin mapear no salda; settled_at es date_approved', () => {
  const perfiles = [perfil('u-robert', 'Roberto Mella', 'roberto@example.test'), perfil('u-chino', 'Francisco', 'fvera@example.test')];
  const vieja = deuda('d-vieja', 'u-robert', '2026-10-05', { nombre: 'Robert' });
  const nueva = deuda('d-nueva', 'u-robert', '2026-10-19', { nombre: 'Robert' });
  const chino = deuda('d-chino', 'u-chino', '2026-10-05', { nombre: 'Chino' });
  const aprobado = '2026-11-02T15:00:00.000Z';
  const p = pago('900', aprobado, { id: '1', email: 'otro@example.test', first_name: 'ROBERTO', last_name: 'MELLA' });
  assert.equal(p.fecha, aprobado);
  const uno = asignarPagosADeudas({ deudas: [nueva, vieja, chino], pagos: [p], perfiles });
  assert.deepEqual(uno, [{ debtId: 'd-vieja', userId: 'u-robert', paymentId: '900', settledAt: aprobado }]);

  const yaUsado = deuda('d-otra', 'u-chino', '2026-10-01', { nombre: 'Chino', status: 'saldada', mp_payment_id: '900' });
  const otraVez = asignarPagosADeudas({ deudas: [yaUsado, vieja], pagos: [p], perfiles });
  assert.deepEqual(otraVez, []);

  const suelto = pago('901', aprobado, { id: '2', email: 'nadie@example.test', first_name: 'JUAN', last_name: 'PEREZ' });
  assert.deepEqual(asignarPagosADeudas({ deudas: [vieja], pagos: [suelto], perfiles }), []);

  const antes = pago('902', '2026-10-04T12:00:00.000Z', { id: '3', first_name: 'ROBERTO', last_name: 'MELLA' });
  assert.deepEqual(asignarPagosADeudas({ deudas: [vieja], pagos: [antes], perfiles }), []);

  const tarde = pago('903', '2026-11-20T12:00:00.000Z', { id: '4', first_name: 'ROBERTO', last_name: 'MELLA' });
  const lejos = asignarPagosADeudas({ deudas: [vieja], pagos: [tarde], perfiles });
  assert.equal(lejos[0]?.settledAt, '2026-11-20T12:00:00.000Z');
  assert.ok((Date.parse(tarde.fecha) - Date.parse('2026-10-05T00:00:00.000Z')) / 86400000 > DIAS_VENTANA);
});

test('la ventana de conciliación parte en el partido impago y pasa los 5 días', () => {
  const v = ventanaConciliacion(['2026-11-02', '2026-10-19'], new Date('2026-11-03T18:00:00.000Z'));
  assert.match(v.desde, /^2026-10-1[89]T/);
  const dias = (Date.parse(v.hasta) - Date.parse(v.desde)) / 86400000;
  assert.ok(dias > DIAS_VENTANA);
  assert.equal(DIAS_VENTANA, 5);
});

function armar(opt: { sancionHastaPagar: boolean; cierres?: Record<string, string>; pagos?: PagoMpRaw[]; match?: typeof MATCH; titulares?: typeof TITULARES }) {
  const match = opt.match || MATCH;
  const db = fakeRepo({
    partidos: [MATCH, SIGUIENTE],
    titulares: { [match.id]: opt.titulares || TITULARES },
    cierres: opt.cierres,
  });
  const deudas: { match_id: string; user_id: string; created_by: string | null }[] = [];
  db.repo.registrarDeuda = async (p) => { deudas.push(p); return { ok: true }; };
  const pagos = opt.pagos || PAGOS_RAW;
  const d: Deps = {
    repo: db.repo,
    mp: {
      async buscarAprobados() { return pagos; },
      async pago(id) { return pagos.find((p) => String(p.id) === id)!; },
    },
    ahora: () => new Date('2026-10-20T15:00:00Z'),
    noPagan: [ADMIN_EMAIL],
    sancionHastaPagar: opt.sancionHastaPagar,
  };
  return { d, db, deudas };
}

test('flag apagado: la sanción de una fecha queda y no se registra deuda', async () => {
  const { d, db, deudas } = armar({ sancionHastaPagar: false });
  const r = await sancionarNoPago(d, GRUPO, { match_id: MATCH.id, user_id: 'u-chino', confirmar: true }, 'admin');
  assert.equal(r.ya_existia, false);
  assert.equal(db.inserts.length, 1);
  assert.equal(db.inserts[0].reason, 'no_pago');
  assert.equal(db.inserts[0].applies_to, '2026-10-26');
  assert.deepEqual(deudas, []);
});

test('no_pagado crea la sanción de la fecha siguiente y la deuda', async () => {
  const { d, db, deudas } = armar({ sancionHastaPagar: true });
  await sancionarNoPago(d, GRUPO, { match_id: MATCH.id, user_id: 'u-chino', confirmar: true }, 'admin');
  assert.equal(db.inserts[0].reason, 'no_pago');
  assert.equal(db.inserts[0].applies_to, '2026-10-26');
  assert.deepEqual(deudas, [{ match_id: MATCH.id, user_id: 'u-chino', created_by: 'admin' }]);
});

test('pagado_tarde crea solo la sanción de una fecha, sin deuda', async () => {
  const { d, db, deudas } = armar({
    sancionHastaPagar: true,
    cierres: { [MATCH.id]: CIERRE_19OCT },
    pagos: [...PAGOS_RAW, PAGO_ROBERT_TARDE],
  });
  const r = await sancionarNoPago(d, GRUPO, { match_id: MATCH.id, user_id: 'u-robert', confirmar: true }, 'admin');
  assert.equal(r.ya_existia, false);
  assert.equal(db.inserts[0].reason, 'no_pago');
  assert.deepEqual(deudas, []);
});

test('antes del pitazo no se crea deuda aunque el flag esté prendido', async () => {
  const { d, db, deudas } = armar({ sancionHastaPagar: true, match: SIGUIENTE, titulares: TITULARES });
  await assert.rejects(
    sancionarNoPago(d, GRUPO, { match_id: SIGUIENTE.id, user_id: 'u-chino', confirmar: true }, 'admin'),
    /todavía no/,
  );
  assert.equal(db.inserts.length, 0);
  assert.deepEqual(deudas, []);
});

test('si la RPC no existe, la sanción de una fecha igual queda', async () => {
  const { d, db } = armar({ sancionHastaPagar: true });
  d.repo.registrarDeuda = async () => { throw Object.assign(new Error('no existe'), { code: 'PGRST202' }); };
  const r = await sancionarNoPago(d, GRUPO, { match_id: MATCH.id, user_id: 'u-chino', confirmar: true }, null);
  assert.equal(r.ok, true);
  assert.equal(db.inserts.length, 1);
});

test('golden 2-nov intacto con el flag apagado, aunque haya deudas', () => {
  const deudas = [{ user_id: 'u-talo', nombre: 'Talo', fecha: '2026-10-26' }];
  const cupos = CUPOS_2NOV.map((c) => ({ ...c }));
  const antes = JSON.stringify(cupos);
  const off = mensajeCierre({
    titulares: TITULARES_2NOV, cupos, banca: BANCA_2NOV, fechaPartido: '2026-11-02',
    deudas, sancionHastaPagar: false,
  });
  assert.equal(off.texto, GOLDEN_2NOV);
  const sinFlag = mensajeCierre({
    titulares: TITULARES_2NOV, cupos, banca: BANCA_2NOV, fechaPartido: '2026-11-02', deudas,
  });
  assert.equal(sinFlag.texto, GOLDEN_2NOV);
  assert.equal(JSON.stringify(cupos), antes);
});

test('con el flag, el deudor de una fecha anterior pierde cupo y se netea, sin borrar el cupo', () => {
  const deudas = [{ user_id: 'u-talo', nombre: 'Talo', fecha: '2026-10-26' }];
  const cupos = CUPOS_2NOV.map((c) => ({ ...c }));
  const antes = JSON.stringify(cupos);
  const on = mensajeCierre({
    titulares: TITULARES_2NOV, cupos, banca: BANCA_2NOV, fechaPartido: '2026-11-02',
    deudas, sancionHastaPagar: true,
  });
  assert.match(on.texto, /^Pierde cupo por no pago \(hasta que pague\):\nChino, Chipi, Esteban, Gonzalo, Talo\n/);
  assert.equal(on.texto.includes('9 de noviembre'), false);
  assert.match(on.texto, /16 de noviembre\nBoris, Chalo\n30 de noviembre\nMichel, Villa, Roberto$/);
  assert.equal(JSON.stringify(cupos), antes);
  assert.equal(cupos.find((c) => c.user_id === 'u-talo')!.hasta, '2026-11-09');
});

test('una deuda de la misma fecha no mete en pierde a quien ya pagó', () => {
  const on = mensajeCierre({
    titulares: TITULARES_2NOV,
    cupos: CUPOS_2NOV,
    banca: BANCA_2NOV,
    fechaPartido: '2026-11-02',
    deudas: [{ user_id: 'u-talo', nombre: 'Talo', fecha: '2026-11-02' }],
    sancionHastaPagar: true,
  });
  assert.match(on.texto, /Pierde cupo por no pago \(hasta que pague\):\nChino, Chipi, Esteban, Gonzalo\n/);
  assert.match(on.texto, /9 de noviembre\nTalo/);
});

test('los textos publicados de la sanción hasta pagar están en el panel', () => {
  const page = readFileSync(new URL('../../app/admin/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /deuda_no_pago: '💸 Debe una pichanga · hasta que pague'/);
  assert.match(page, /debe la del \$\{fechaCorta\(s\.fecha_deuda\)\}/);
  assert.match(page, /suma 1 fecha por pichanga y se acumulan/);
  assert.match(page, /se cumplen igual aunque pague/);
  assert.match(page, /Mientras no se\s+cierre, no es tarde/);
  assert.match(page, /4 fechas = 28 días/);
  assert.match(page, /fechas de sanción/);
  assert.match(page, /Marcar pagado/);
  assert.match(page, /CONFIRMACION_MARCAR_PAGADO/);
  assert.match(page, /textoFechasPendientes/);
  const pagos = readFileSync(new URL('../../app/admin/Pagos.tsx', import.meta.url), 'utf8');
  assert.match(pagos, /Conciliar deudas/);
  assert.match(pagos, /Marcar pagado/);
  assert.match(pagos, /debe la del/);
  assert.match(pagos, /sancion_hasta_pagar/);
  assert.match(pagos, /textoFechasPendientes/);
  assert.match(pagos, /CONFIRMACION_MARCAR_PAGADO/);
  assert.match(CONFIRMACION_MARCAR_PAGADO, /no se borran/);
  assert.match(CONFIRMACION_MARCAR_PAGADO, /se cumplen igual aunque pague/);
  const route = readFileSync(new URL('../../app/admin/api/pagos/route.ts', import.meta.url), 'utf8');
  const saldar = route.slice(route.indexOf("case 'saldar_deuda'"), route.indexOf("case 'conciliar_deudas'"));
  assert.match(saldar, /saldarDeuda/);
  assert.equal(/from\('player_sanctions'\)|\.delete\(/.test(saldar), false);
  const client = readFileSync(new URL('../../lib/mp/client.ts', import.meta.url), 'utf8');
  assert.equal(client.includes("method: 'GET'"), true);
  assert.equal(/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(client), false);
});

test('el texto de fechas pendientes distingue una y varias', () => {
  assert.equal(textoFechasPendientes(1), '1 fecha de sanción pendiente');
  assert.equal(textoFechasPendientes(3), '3 fechas de sanción pendientes');
});

test('admin_lineup: fechas_pendientes por jugador, ignora cero y junta sanciones', () => {
  const lista = fechasPendientesDeLineup({
    jugadores: [
      { user_id: 'u-boris', nombre: 'Boris', fechas_pendientes: 2 },
      { user_id: 'u-talo', nombre: 'Talo', fechas_pendientes: 0 },
      { user_id: 'u-alan', nombre: 'Alan' },
    ],
    sanciones: [
      { user_id: 'u-boris', nombre: 'Boris', fechas_pendientes: 1 },
      { user_id: 'u-chalo', nombre: 'Chalo', fechas_pendientes: '2' },
    ],
  });
  assert.deepEqual(lista.sort((a, b) => a.user_id.localeCompare(b.user_id)), [
    { user_id: 'u-boris', nombre: 'Boris', fechas: 2 },
    { user_id: 'u-chalo', nombre: 'Chalo', fechas: 2 },
  ]);
  assert.deepEqual(fechasPendientesDeLineup(null), []);
  assert.deepEqual(fechasPendientesDeLineup({ jugadores: [] }), []);
});

test('flag apagado: fechas pendientes no cambian el golden del 2-nov', () => {
  const cupos = CUPOS_2NOV.map((c) => ({ ...c }));
  const antes = JSON.stringify(cupos);
  const off = mensajeCierre({
    titulares: TITULARES_2NOV,
    cupos,
    banca: BANCA_2NOV,
    fechaPartido: '2026-11-02',
    fechasPendientes: [{ user_id: 'u-boris', nombre: 'Boris', fechas: 2 }],
    sancionHastaPagar: false,
  });
  assert.equal(off.texto, GOLDEN_2NOV);
  assert.equal(JSON.stringify(cupos), antes);
});

test('con el flag, deuda activa o fechas pendientes entran en pierde y se netean sin borrar el cupo', () => {
  const cupos = CUPOS_2NOV.map((c) => ({ ...c }));
  const antes = JSON.stringify(cupos);
  const on = mensajeCierre({
    titulares: TITULARES_2NOV,
    cupos,
    banca: BANCA_2NOV,
    fechaPartido: '2026-11-02',
    deudas: [{ user_id: 'u-talo', nombre: 'Talo', fecha: '2026-10-26' }],
    fechasPendientes: [
      { user_id: 'u-boris', nombre: 'Boris', fechas: 2 },
      { user_id: 'u-talo', nombre: 'Talo', fechas: 1 },
    ],
    sancionHastaPagar: true,
  });
  assert.match(on.texto, /^Pierde cupo por no pago \(hasta que pague\):\nChino, Chipi, Esteban, Gonzalo, Talo, Boris\n/);
  assert.equal(on.texto.includes('9 de noviembre'), false);
  assert.match(on.texto, /16 de noviembre\nChalo\n/);
  assert.equal(on.texto.split('Boris').length - 1, 1);
  assert.equal(on.texto.split('Talo').length - 1, 1);
  assert.equal(JSON.stringify(cupos), antes);
  assert.equal(cupos.find((c) => c.user_id === 'u-boris')!.hasta, '2026-11-16');
  assert.equal(cupos.find((c) => c.user_id === 'u-talo')!.hasta, '2026-11-09');
});

test('quien ya pagó y todavía tiene fechas pendientes sigue en pierde', () => {
  const on = mensajeCierre({
    titulares: [{ user_id: 'u-boris', nombre: 'Boris', estado: 'pagado' }],
    cupos: [{ user_id: 'u-boris', nombre: 'Boris', hasta: '2026-11-16' }],
    fechaPartido: '2026-11-02',
    fechasPendientes: [{ user_id: 'u-boris', nombre: 'Boris', fechas: 1 }],
    sancionHastaPagar: true,
  });
  assert.match(on.texto, /Pierde cupo por no pago \(hasta que pague\):\nBoris\n/);
  assert.equal(on.texto.includes('16 de noviembre'), false);
});
