import './_guard';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoPagos, mapearPagador, sancionarNoPago, ErrorPagos, type Deps } from '../../lib/mp/servicio';
import { fakeRepo } from './fake-repo';
import { GRUPO, MATCH, SIGUIENTE, TITULARES, PAGOS_RAW, ADMIN_EMAIL } from './fixtures/pichanga-19oct';

const AHORA = new Date('2026-10-20T13:40:00Z');
function deps(extra: Partial<Parameters<typeof fakeRepo>[0]> = {}, mp: Deps['mp'] | 'default' = 'default') {
  const db = fakeRepo({ partidos: [MATCH, SIGUIENTE], titulares: { [MATCH.id]: TITULARES }, ...extra });
  const llamadas: string[] = [];
  const d: Deps = {
    repo: db.repo,
    mp: mp === 'default' ? {
      async buscarAprobados(desde, hasta) { llamadas.push(`search ${desde} ${hasta}`); return PAGOS_RAW; },
      async pago(id) { llamadas.push(`get ${id}`); return PAGOS_RAW.find((p) => String(p.id) === id)!; },
    } : mp,
    ahora: () => AHORA,
    noPagan: [ADMIN_EMAIL],
  };
  return { d, db, llamadas };
}

test('estado por defecto: la última pichanga que ya empezó (no la futura)', async () => {
  const { d, llamadas } = deps();
  const r = await estadoPagos(d, GRUPO);
  assert.equal(r.partido.id, MATCH.id);
  assert.equal(r.resumen!.pagados, 7);
  assert.equal(r.resumen!.titulares, 11);
  assert.equal(r.fecha_sancion, '2026-10-26');
  assert.equal(llamadas[0], 'search 2026-10-19T20:00:00.000-03:00 2026-10-20T10:40:00.000-03:00');
  const s = JSON.stringify(r);
  assert.ok(!/[a-z0-9._-]{3,}@/i.test(s), 'la respuesta no trae correos completos');
  for (const t of TITULARES) assert.ok(!s.includes(t.email!));
});

test('sin MP_ACCESS_TOKEN: muestra titulares sin estado y no falla', async () => {
  const { d } = deps({}, null);
  const r = await estadoPagos(d, GRUPO, MATCH.id);
  assert.equal(r.configurado, false);
  assert.equal(r.titulares.length, 11);
  assert.equal(r.resumen, null);
});

test('partido de otro grupo → 404', async () => {
  const { d } = deps({ partidos: [{ ...MATCH, group_id: 'otro' }] });
  await assert.rejects(estadoPagos(d, GRUPO, MATCH.id), (e: any) => e instanceof ErrorPagos && e.status === 404);
});

test('sanción no_pago: exige confirmación explícita', async () => {
  const { d, db } = deps();
  for (const confirmar of [undefined, 'true', 1, false]) {
    await assert.rejects(sancionarNoPago(d, GRUPO, { match_id: MATCH.id, user_id: 'u-robert', confirmar }, 'u-zlatan'));
  }
  assert.equal(db.inserts.length, 0);
});

test('sanción no_pago: crea una sola (idempotente) para la fecha siguiente', async () => {
  const { d, db } = deps();
  const a = await sancionarNoPago(d, GRUPO, { match_id: MATCH.id, user_id: 'u-robert', confirmar: true }, 'u-zlatan');
  const b = await sancionarNoPago(d, GRUPO, { match_id: MATCH.id, user_id: 'u-robert', confirmar: true }, 'u-zlatan');
  assert.deepEqual([a.ya_existia, b.ya_existia], [false, true]);
  assert.equal(db.inserts.length, 1);
  assert.deepEqual({ ...db.inserts[0] }, {
    group_id: GRUPO, user_id: 'u-robert', applies_to: '2026-10-26', reason: 'no_pago',
    note: 'No pagó la pichanga del 2026-10-19 (match m-19oct)', created_by: 'u-zlatan',
  });
});

test('sanción no_pago: sin partido siguiente usa fecha + 7 (igual que admin_drop_player)', async () => {
  const { d, db } = deps({ partidos: [MATCH] });
  const r = await sancionarNoPago(d, GRUPO, { match_id: MATCH.id, user_id: 'u-chino', confirmar: true }, null);
  assert.equal(r.applies_to, '2026-10-26');
  assert.equal(db.inserts[0].applies_to, '2026-10-26');
});

test('sanción no_pago: no pisa otra sanción de la misma fecha', async () => {
  const { d, db } = deps({ sanciones: [{ group_id: GRUPO, user_id: 'u-robert', applies_to: '2026-10-26', reason: 'bajo_tarde', note: null }] });
  await assert.rejects(sancionarNoPago(d, GRUPO, { match_id: MATCH.id, user_id: 'u-robert', confirmar: true }, null),
    (e: any) => e.status === 409 && /bajo_tarde/.test(e.message));
  assert.equal(db.inserts.length, 0);
  assert.equal(db.sanciones[0].reason, 'bajo_tarde');
});

test('sanción no_pago: no a quien pagó, ni al admin, ni a la banca, ni sin MP', async () => {
  const { d, db } = deps();
  await assert.rejects(sancionarNoPago(d, GRUPO, { match_id: MATCH.id, user_id: 'u-gonga', confirmar: true }, null), (e: any) => e.status === 409);
  await assert.rejects(sancionarNoPago(d, GRUPO, { match_id: MATCH.id, user_id: 'u-zlatan', confirmar: true }, null));
  await assert.rejects(sancionarNoPago(d, GRUPO, { match_id: MATCH.id, user_id: 'u-boris', confirmar: true }, null));
  const sinMp = deps({}, null);
  await assert.rejects(sancionarNoPago(sinMp.d, GRUPO, { match_id: MATCH.id, user_id: 'u-robert', confirmar: true }, null), (e: any) => e.status === 503);
  assert.equal(db.inserts.length + sinMp.db.inserts.length, 0);
});

test('sanción no_pago: no antes de que se juegue el partido', async () => {
  const { d } = deps({ titulares: { [SIGUIENTE.id]: TITULARES } });
  await assert.rejects(sancionarNoPago(d, GRUPO, { match_id: SIGUIENTE.id, user_id: 'u-robert', confirmar: true }, null), /todavía no/);
});

test('mapear: guarda solo hash del correo, id de pagador y nombre; y el pago pasa a "pagado"', async () => {
  const { d, db, llamadas } = deps({ titulares: { [MATCH.id]: TITULARES } });
  // Pago sin nombre de Thomas, pero lo asignamos a Chino para probar el alias
  await mapearPagador(d, GRUPO, '1007', 'u-chino', 'u-zlatan');
  assert.deepEqual(llamadas, ['get 1007']);
  const a = db.aliases[0];
  assert.equal(a.user_id, 'u-chino');
  assert.equal(a.payer_mp_id, '9005');
  assert.match(a.payer_email_sha256!, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(db.aliases).includes('tomasprieto89@'), 'no guarda el correo en claro');
  const r = await estadoPagos(d, GRUPO, MATCH.id);
  assert.equal(r.titulares.find((f) => f.user_id === 'u-chino')!.estado, 'pagado');
  assert.equal(r.titulares.find((f) => f.user_id === 'u-thomas')!.estado, 'no_pagado');
  assert.equal(r.alias[0].jugador, 'Chino');
});

test('mapear: rechaza jugador fuera del grupo e id de pago raro', async () => {
  const { d } = deps();
  await assert.rejects(mapearPagador(d, GRUPO, '1007', 'u-intruso', null));
  await assert.rejects(mapearPagador(d, GRUPO, '1007/refunds', 'u-chino', null));
});
