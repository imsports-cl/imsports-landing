/**
 * Sanciones al cierre. El 2-nov (fixture de Barham) deja sancionados a
 * Chino, Chipi, Esteban y Gonzalo. No toca matches ni loguea correos.
 */
import './_guard';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Titular } from '../../lib/mp/cruce';
import type { PagoMpRaw } from '../../lib/mp/pagos-mp';
import {
  aplicarSancionesCierre,
  correrSancionesCierre,
  cronAutorizado,
  GRUPO_GALLETAS,
  planSancionesCierre,
  sancionesAlCierreActivas,
  type TitularAlCierre,
} from '../../lib/mp/sanciones-cierre';
import type { Deps, Partido } from '../../lib/mp/servicio';
import { fakeRepo } from './fake-repo';
import { TITULARES_2NOV } from './fixtures/cierre-2nov';

const GRUPO = GRUPO_GALLETAS;
const MATCH = '3893ee71-1111-4111-8111-111111111111';
const SIGUIENTE = '3893ee71-2222-4222-8222-222222222222';
const CIERRE = '2026-11-03T02:00:00.000Z';
const AHORA = '2026-11-04T16:00:00.000Z';
const ESPERADOS = ['Chino', 'Chipi', 'Esteban', 'Gonzalo'];

const partido = (id: string, date: string, extra: Partial<Partido> = {}): Partido => ({
  id, group_id: GRUPO, date, time: '20:00', price: 5000, status: 'completed', phase: 'closed',
  created_at: '2026-10-30T12:00:00.000Z', ...extra,
});

function titularDe(user_id: string, nombre: string): Titular {
  return { user_id, nombre, display_name: nombre, nickname: nombre, email: `${user_id}@example.test` };
}

function pago(id: number, email: string, fecha: string): PagoMpRaw {
  return {
    id, status: 'approved', currency_id: 'CLP', operation_type: 'regular_payment',
    transaction_amount: 5000, transaction_amount_refunded: 0, date_approved: fecha,
    description: 'Pichanga',
    payer: { id: String(8000 + id), email, first_name: 'Pago', last_name: `N${id}` },
  };
}

function armar(opts: {
  siguientes?: Partido[];
  cierres?: Record<string, string>;
  pagos?: PagoMpRaw[];
  truncado?: boolean;
  titulares?: Record<string, Titular[]>;
  sanciones?: { group_id: string; user_id: string; applies_to: string; reason: string; note: string | null }[];
  mp?: Deps['mp'] | null;
} = {}) {
  const pagos = opts.pagos ?? TITULARES_2NOV
    .filter((t) => t.estado === 'pagado')
    .map((t, i) => pago(100 + i, `${t.user_id}@example.test`, '2026-11-02T18:00:00.000Z'));
  const titulares = opts.titulares ?? {
    [MATCH]: TITULARES_2NOV.map((t) => titularDe(t.user_id!, t.nombre)),
  };
  const db = fakeRepo({
    partidos: [
      partido(MATCH, '2026-11-02T00:00:00+00:00'),
      ...(opts.siguientes ?? [partido(SIGUIENTE, '2026-11-09T00:00:00+00:00', { phase: 'created', status: 'scheduled', created_at: '2026-11-05T12:00:00.000Z' })]),
    ],
    titulares,
    cierres: opts.cierres ?? { [MATCH]: CIERRE },
    sanciones: opts.sanciones,
  });
  let lecturasMp = 0;
  const mp = opts.mp === undefined ? {
    async buscarAprobados() {
      lecturasMp += 1;
      const out = pagos.slice() as PagoMpRaw[] & { truncado?: boolean };
      if (opts.truncado) out.truncado = true;
      return out;
    },
    async pago(id: string) { return pagos.find((p) => String(p.id) === id)!; },
  } : opts.mp;
  const d: Deps = {
    repo: db.repo,
    mp,
    ahora: () => new Date(AHORA),
    noPagan: [],
    sancionesAlCierre: true,
  };
  return { d, db, lecturas: () => lecturasMp };
}

const actor = { by: 'admin-1', via: 'panel' as const };
const sinCorreo = (v: unknown) => {
  const s = JSON.stringify(v);
  assert.equal(s.includes('@'), false, s);
  assert.equal(s.includes('MP_ACCESS_TOKEN'), false);
  assert.equal(s.includes('APP_USR'), false);
  assert.equal(s.includes('example.test'), false);
};

test('flag apagado por defecto', () => {
  assert.equal(sancionesAlCierreActivas({}), false);
  assert.equal(sancionesAlCierreActivas({ SANCIONES_AL_CIERRE: '0' }), false);
  assert.equal(sancionesAlCierreActivas({ SANCIONES_AL_CIERRE: '1' }), true);
  assert.equal(sancionesAlCierreActivas({ SANCIONES_AL_CIERRE: 'true' }), true);
});

test('cron: solo el bearer exacto', () => {
  assert.equal(cronAutorizado(null, undefined), false);
  assert.equal(cronAutorizado('Bearer secreto', ''), false);
  assert.equal(cronAutorizado('Bearer secreto', 'otro'), false);
  assert.equal(cronAutorizado('secreto', 'secreto'), false);
  assert.equal(cronAutorizado('Bearer secreto', 'secreto'), true);
});

test('plan 2-nov: Chino, Chipi, Esteban y Gonzalo, con deuda', () => {
  const plan = planSancionesCierre({
    cerrado: true,
    configurado: true,
    mpIncompleto: false,
    historialIncompleto: false,
    cierreEn: CIERRE,
    fechaSancion: '2026-11-09',
    fechaPartido: '2026-11-02',
    titulares: TITULARES_2NOV.map((t): TitularAlCierre => ({
      user_id: t.user_id!, nombre: t.nombre, estado: t.estado,
    })),
  });
  assert.equal(plan.status, 'applied');
  assert.deepEqual(plan.sancionables.map((s) => s.nombre), ESPERADOS);
  assert.ok(plan.sancionables.every((s) => s.estado === 'no_pagado' && s.deuda));
  sinCorreo(plan);
});

test('plan: pagó tarde sanciona la fecha y no la deuda; solape o incompleto no sancionan', () => {
  const base = {
    cerrado: true, configurado: true, mpIncompleto: false, historialIncompleto: false,
    cierreEn: CIERRE, fechaSancion: '2026-11-09', fechaPartido: '2026-11-02',
  };
  const tarde = planSancionesCierre({
    ...base,
    titulares: [
      { user_id: 'u-alan', nombre: 'Alan', estado: 'pagado' },
      { user_id: 'u-chino', nombre: 'Chino', estado: 'pagado_tarde' },
      { user_id: 'u-chipi', nombre: 'Chipi', estado: 'no_pagado' },
    ],
  });
  assert.equal(tarde.status, 'applied');
  assert.equal(tarde.sancionables.find((s) => s.nombre === 'Chino')!.deuda, false);
  assert.equal(tarde.sancionables.find((s) => s.nombre === 'Chipi')!.deuda, true);
  assert.equal(tarde.sancionables.some((s) => s.nombre === 'Alan'), false);

  const solape = planSancionesCierre({
    ...base,
    titulares: [{ user_id: 'u-chino', nombre: 'Chino', estado: 'no_pagado', solape: true }],
  });
  assert.equal(solape.status, 'alert');
  assert.deepEqual(solape.sancionables, []);

  const incompleto = planSancionesCierre({
    ...base, mpIncompleto: true, historialIncompleto: true,
    titulares: [{ user_id: 'u-chino', nombre: 'secreto@example.test', estado: 'no_pagado', solape: true }],
  });
  assert.equal(incompleto.status, 'skipped_incomplete');
  assert.deepEqual(incompleto.sancionables, []);
  sinCorreo(incompleto);

  assert.equal(planSancionesCierre({ ...base, cerrado: false, titulares: [] }).status, 'sin_cierre');
  assert.equal(planSancionesCierre({ ...base, configurado: false, titulares: [{ user_id: 'u-chino', nombre: 'Chino', estado: 'no_pagado' }] }).status, 'skipped_incomplete');
});

test('2-nov: aplica no_pago a Chino, Chipi, Esteban y Gonzalo y la deuda', async () => {
  const { d, db, lecturas } = armar();
  const r = await aplicarSancionesCierre(d, GRUPO, MATCH, actor);
  assert.equal(r.status, 'applied');
  assert.equal(r.ya_aplicado, false);
  assert.equal(r.applies_to, '2026-11-09');
  assert.deepEqual(r.sancionados!.map((s) => s.nombre), ESPERADOS);
  assert.ok(r.sancionados!.every((s) => s.deuda && s.estado === 'no_pagado'));
  assert.equal(db.inserts.length, 4);
  assert.ok(db.inserts.every((s) => s.reason === 'no_pago' && s.applies_to === '2026-11-09' && s.created_by === 'admin-1'));
  assert.deepEqual(db.deudas.map((x) => x.user_id).sort(), ['u-chino', 'u-chipi', 'u-esteban', 'u-gonzalo']);
  assert.equal(db.cierreFilas.length, 1);
  assert.equal(db.cierreFilas[0].status, 'applied');
  assert.equal(db.cierreFilas[0].processed_by, 'admin-1');
  assert.ok(db.escrituras.every((t) => t === 'player_sanctions' || t === 'player_debts' || t === 'cierre_sanciones'));
  sinCorreo({ r, inserts: db.inserts, filas: db.cierreFilas, deudas: db.deudas });

  const otra = await aplicarSancionesCierre(d, GRUPO, MATCH, actor);
  assert.equal(otra.ya_aplicado, true);
  assert.equal(db.inserts.length, 4);
  assert.equal(db.deudas.length, 4);
  assert.equal(lecturas(), 1);
});

test('la fecha de la sanción es la del partido siguiente', async () => {
  const { d, db } = armar({
    siguientes: [partido(SIGUIENTE, '2026-12-01T00:00:00+00:00', { phase: 'created', status: 'scheduled', created_at: '2026-11-20T12:00:00.000Z' })],
  });
  const r = await aplicarSancionesCierre(d, GRUPO, MATCH, actor);
  assert.equal(r.applies_to, '2026-12-01');
  assert.ok(db.inserts.every((s) => s.applies_to === '2026-12-01'));
});

test('pagó tarde: sanción de la fecha, sin deuda', async () => {
  const base = TITULARES_2NOV.filter((t) => t.estado === 'pagado')
    .map((t, i) => pago(100 + i, `${t.user_id}@example.test`, '2026-11-02T18:00:00.000Z'));
  const tarde = pago(199, 'u-gonzalo@example.test', '2026-11-03T03:00:00.000Z');
  const { d, db } = armar({ pagos: [...base, tarde] });
  const r = await aplicarSancionesCierre(d, GRUPO, MATCH, actor);
  assert.deepEqual(r.sancionados!.map((s) => s.nombre), ESPERADOS);
  const g = r.sancionados!.find((s) => s.nombre === 'Gonzalo')!;
  assert.equal(g.estado, 'pagado_tarde');
  assert.equal(g.deuda, false);
  assert.ok(r.sancionados!.filter((s) => s.nombre !== 'Gonzalo').every((s) => s.deuda));
  assert.equal(db.deudas.some((x) => x.user_id === 'u-gonzalo'), false);
  sinCorreo(r);
});

test('Mercado Pago incompleto: no sanciona y deja skipped_incomplete', async () => {
  const { d, db } = armar({ truncado: true });
  const r = await aplicarSancionesCierre(d, GRUPO, MATCH, actor);
  assert.equal(r.status, 'skipped_incomplete');
  assert.equal(db.inserts.length, 0);
  assert.equal(db.deudas.length, 0);
  assert.equal(db.cierreFilas[0].status, 'skipped_incomplete');
  assert.match(db.cierreFilas[0].note || '', /incompleta/);
  sinCorreo(db.cierreFilas[0]);
});

test('sin Mercado Pago no sanciona; al reconectar, el reintento sí', async () => {
  const hecho = armar();
  hecho.d.mp = null;
  const primero = await aplicarSancionesCierre(hecho.d, GRUPO, MATCH, actor);
  assert.equal(primero.status, 'skipped_incomplete');
  assert.equal(hecho.db.inserts.length, 0);
  hecho.d.mp = armar().d.mp;
  const segundo = await aplicarSancionesCierre(hecho.d, GRUPO, MATCH, actor);
  assert.equal(segundo.status, 'applied');
  assert.deepEqual(segundo.sancionados!.map((s) => s.nombre), ESPERADOS);
});

test('pago en solape: alerta y no sanciona a nadie', async () => {
  const viejo = '3893ee71-3333-4333-8333-333333333333';
  const chino = titularDe('u-chino', 'Chino');
  const diego = titularDe('u-diego', 'Diego');
  const actual = partido(MATCH, '2026-11-04T00:00:00+00:00', { created_at: '2026-11-01T12:00:00.000Z' });
  const db = fakeRepo({
    partidos: [partido(viejo, '2026-11-02T00:00:00+00:00', { created_at: '2026-10-30T12:00:00.000Z' }), actual],
    titulares: { [MATCH]: [chino, diego], [viejo]: [chino] },
    cierres: { [MATCH]: '2026-11-05T02:00:00.000Z' },
  });
  const d: Deps = {
    repo: db.repo,
    mp: { async buscarAprobados() { return [pago(50, chino.email!, '2026-11-03T12:00:00.000Z')]; }, async pago() { throw new Error('no'); } },
    ahora: () => new Date('2026-11-05T15:00:00.000Z'),
    noPagan: [],
    sancionesAlCierre: true,
  };
  const r = await aplicarSancionesCierre(d, GRUPO, MATCH, actor);
  assert.equal(r.status, 'alert');
  assert.equal(db.inserts.length, 0);
  assert.equal(db.deudas.length, 0);
  assert.match(r.note || '', /solape/);
  sinCorreo(r);
});

test('si la deuda no se puede anotar, la sanción de la fecha queda y la nota lo dice', async () => {
  const { d, db } = armar();
  d.repo.registrarDeuda = async () => ({ ok: false, omitida: true });
  const r = await aplicarSancionesCierre(d, GRUPO, MATCH, actor);
  assert.equal(r.status, 'applied');
  assert.equal(db.inserts.length, 4);
  assert.ok(r.sancionados!.every((s) => s.deuda === false));
  assert.match(r.note || '', /No quedó registrada la deuda/);
  sinCorreo(r);
});

test('no pisa otra sanción y no corre sin cierre, cancelado, flag o grupo', async () => {
  const { d, db } = armar({
    sanciones: [{ group_id: GRUPO, user_id: 'u-chino', applies_to: '2026-11-09', reason: 'manual', note: null }],
  });
  const r = await aplicarSancionesCierre(d, GRUPO, MATCH, actor);
  assert.equal(r.status, 'applied');
  assert.equal(r.sancionados!.some((s) => s.nombre === 'Chino'), false);
  assert.deepEqual(db.inserts.map((s) => s.user_id).sort(), ['u-chipi', 'u-esteban', 'u-gonzalo']);
  assert.match(db.cierreFilas[0].note || '', /Chino/);

  const sin = armar({ cierres: {} });
  await assert.rejects(aplicarSancionesCierre(sin.d, GRUPO, MATCH, actor), (e: any) => e.status === 409);
  assert.equal(sin.db.inserts.length, 0);
  assert.equal(sin.db.cierreFilas.length, 0);

  const cancelado = armar();
  const p = await cancelado.d.repo.partido(MATCH);
  (p as Partido).status = 'cancelled';
  await assert.rejects(aplicarSancionesCierre(cancelado.d, GRUPO, MATCH, actor), (e: any) => e.status === 409);
  assert.equal(cancelado.db.escrituras.length, 0);

  const apagado = armar();
  apagado.d.sancionesAlCierre = false;
  const o = await aplicarSancionesCierre(apagado.d, GRUPO, MATCH, actor);
  assert.equal(o.omitido, true);
  assert.equal(apagado.db.escrituras.length, 0);

  const otro = await aplicarSancionesCierre(armar().d, 'otro-grupo', MATCH, actor);
  assert.equal(otro.omitido, true);
});

test('cron: el 2-nov entra; un cierre viejo, uno cancelado y uno ya aplicado no', async () => {
  const viejo = '3893ee71-4444-4444-8444-444444444444';
  const cancelado = '3893ee71-5555-4555-8555-555555555555';
  const ya = '3893ee71-6666-4666-8666-666666666666';
  const { d, db } = armar({
    siguientes: [
      partido(SIGUIENTE, '2026-11-09T00:00:00+00:00', { phase: 'created', status: 'scheduled', created_at: '2026-11-05T12:00:00.000Z' }),
      partido(viejo, '2026-08-01T00:00:00+00:00', { created_at: '2026-07-20T12:00:00.000Z' }),
      partido(cancelado, '2026-11-02T00:00:00+00:00', { status: 'cancelled' }),
      partido(ya, '2026-10-26T00:00:00+00:00', { created_at: '2026-10-20T12:00:00.000Z' }),
    ],
    cierres: {
      [MATCH]: CIERRE,
      [viejo]: '2026-08-02T02:00:00.000Z',
      [cancelado]: '2026-11-03T03:00:00.000Z',
      [ya]: '2026-10-27T02:00:00.000Z',
    },
  });
  db.cierreFilas.push({
    match_id: ya, group_id: GRUPO, processed_at: AHORA, processed_by: null,
    snapshot: {}, status: 'applied', note: null,
  });
  d.ahora = () => new Date('2026-11-09T15:00:00.000Z');
  const r = await correrSancionesCierre(d, new Date('2026-11-09T15:00:00.000Z'));
  assert.equal(r.omitido, false);
  assert.deepEqual(r.resultados.map((x) => x.match_id), [MATCH]);
  assert.equal(r.resultados[0].status, 'applied');
  assert.equal(r.resultados[0].sancionados, 4);
  assert.deepEqual(db.inserts.map((s) => s.user_id).sort(), ['u-chino', 'u-chipi', 'u-esteban', 'u-gonzalo']);
  sinCorreo(r);

  const segunda = await correrSancionesCierre(d, new Date('2026-11-09T15:00:00.000Z'));
  assert.deepEqual(segunda.resultados, []);
  assert.equal(db.inserts.length, 4);

  const temprano = armar();
  const antes = await correrSancionesCierre(temprano.d, new Date('2026-11-04T16:00:00.000Z'));
  assert.deepEqual(antes.resultados, []);
  assert.equal(temprano.db.inserts.length, 0);

  d.sancionesAlCierre = false;
  d.repo.partidosPendientesCierre = async () => { throw new Error('no debía leer'); };
  const apagado = await correrSancionesCierre(d, new Date('2026-11-09T15:00:00.000Z'));
  assert.equal(apagado.omitido, true);
});

test('el repo de cierre no escribe en matches y el cron no loguea el secreto', () => {
  const repo = readFileSync(new URL('../../lib/mp/repo-supabase.ts', import.meta.url), 'utf8');
  assert.equal(/from\('matches'\)[^;]{0,120}\.(update|insert|delete)\(/.test(repo), false);
  const cron = readFileSync(new URL('../../app/api/cron/sanciones-cierre/route.ts', import.meta.url), 'utf8');
  assert.equal(cron.includes('MP_ACCESS_TOKEN'), false);
  assert.equal(cron.includes('console.log'), false);
  assert.equal(cron.includes('CRON_SECRET'), true);
  const panel = readFileSync(new URL('../../app/admin/Pagos.tsx', import.meta.url), 'utf8');
  assert.match(panel, /Aplicar sanciones del cierre/);
});
