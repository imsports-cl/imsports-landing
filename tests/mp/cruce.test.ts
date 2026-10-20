import './_guard';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cruzarPagos } from '../../lib/mp/cruce';
import { aPagoMp, esPagoDePichanga } from '../../lib/mp/pagos-mp';
import { hashEmail } from '../../lib/mp/normalizar';
import { TITULARES, PAGOS_RAW, PAGARON, NO_PAGARON, ADMIN_EMAIL } from './fixtures/pichanga-19oct';

const titularesQuePagan = TITULARES.filter((t) => t.email !== ADMIN_EMAIL);
const pagos19 = PAGOS_RAW.filter((r) => esPagoDePichanga(r, 5000)).map(aPagoMp);
const pago = (id: number, payer: any, monto = 5000) => aPagoMp({ id, status: 'approved', currency_id: 'CLP', transaction_amount: monto, date_approved: `2026-10-20T0${id % 10}:00:00.000-04:00`, description: 'Pichanga Conecta', payer });

test('19-oct: 7 de 11 titulares pagaron', () => {
  assert.equal(pagos19.length, 7, 'la reserva de cancha y el money_transfer no cuentan');
  const r = cruzarPagos(titularesQuePagan, pagos19);
  assert.equal(r.resumen.titulares, 11);
  assert.equal(r.resumen.pagados, 7);
  assert.deepEqual(r.titulares.filter((f) => f.estado === 'pagado').map((f) => f.user_id).sort(), [...PAGARON].sort());
  assert.deepEqual(r.titulares.filter((f) => f.estado === 'no_pagado').map((f) => f.user_id).sort(), [...NO_PAGARON].sort());
  assert.equal(r.sin_asignar.length, 0);
  assert.equal(r.resumen.recaudado, 35000);
});

test('19-oct: los pagos sin nombre calzan por correo; el resto por nombre aunque el correo sea otro', () => {
  const r = cruzarPagos(titularesQuePagan, pagos19);
  const via = Object.fromEntries(r.titulares.filter((f) => f.pago).map((f) => [f.user_id, f.pago!.via]));
  assert.equal(via['u-thomas'], 'email');
  assert.equal(via['u-chipi'], 'email');
  assert.equal(via['u-spid'], 'nombre');
  assert.equal(via['u-gonga'], 'nombre');
});

test('19-oct sin correos: solo por nombre quedan 5 y los 2 sin nombre van a "sin asignar"', () => {
  const sinCorreo = pagos19.map((p) => ({ ...p, email: null, emailHash: null }));
  const r = cruzarPagos(titularesQuePagan, sinCorreo);
  assert.equal(r.resumen.pagados, 5);
  assert.equal(r.sin_asignar.filter((s) => s.motivo === 'sin_coincidencia').length, 2);
});

test('el admin organizador no aparece entre los que pagan', () => {
  const r = cruzarPagos(titularesQuePagan, pagos19);
  assert.ok(!r.titulares.some((f) => f.user_id === 'u-zlatan'));
});

test('los Gonzalo: un pago con solo "Gonzalo" no se asigna a nadie', () => {
  const r = cruzarPagos(titularesQuePagan, [pago(1, { id: '1', first_name: 'Gonzalo', last_name: '' })]);
  assert.equal(r.resumen.pagados, 0);
  assert.equal(r.sin_asignar[0].motivo, 'sin_coincidencia');
});

test('los Gonzalo: cada apellido va a su Gonzalo (también el apellido escondido en el correo)', () => {
  const r = cruzarPagos(titularesQuePagan, [
    pago(1, { id: '1', first_name: 'GONZALO', last_name: 'SOTO PEREZ' }),
    pago(2, { id: '2', first_name: 'Gonzalo', last_name: 'Moya' }),
  ]);
  const pagados = r.titulares.filter((f) => f.estado === 'pagado').map((f) => f.user_id).sort();
  assert.deepEqual(pagados, ['u-gonzalo', 'u-gsoto']);
  assert.equal(r.titulares.find((f) => f.user_id === 'u-gonga')!.estado, 'no_pagado');
});

test('los Alejandro: el apellido decide', () => {
  const r = cruzarPagos(titularesQuePagan, [pago(1, { id: '1', first_name: 'Alejandro', last_name: 'Cortés Rojas' })]);
  assert.equal(r.titulares.find((f) => f.user_id === 'u-chipi')!.estado, 'pagado');
  assert.equal(r.titulares.find((f) => f.user_id === 'u-scott')!.estado, 'no_pagado');
});

test('nombre que calza con dos titulares queda ambiguo', () => {
  const dos = [...titularesQuePagan, { user_id: 'u-otro', nombre: 'Otro', nickname: 'Otro', display_name: 'Gonzalo Soto', email: null }];
  const r = cruzarPagos(dos, [pago(1, { id: '1', first_name: 'Gonzalo', last_name: 'Soto' })]);
  assert.equal(r.sin_asignar[0].motivo, 'ambiguo');
  assert.deepEqual(r.sin_asignar[0].candidatos.sort(), ['Gonzalo Soto', 'Otro']);
});

test('alias manual: paga otra persona (por id de pagador, hash de correo o nombre)', () => {
  const p = pago(1, { id: '777', email: 'pareja@example.test', first_name: 'María', last_name: 'Pérez' });
  for (const a of [
    { user_id: 'u-chino', payer_mp_id: '777', payer_email_sha256: null, payer_name_norm: null },
    { user_id: 'u-chino', payer_mp_id: null, payer_email_sha256: hashEmail('pareja@example.test'), payer_name_norm: null },
    { user_id: 'u-chino', payer_mp_id: null, payer_email_sha256: null, payer_name_norm: 'maria perez' },
  ]) {
    const r = cruzarPagos(titularesQuePagan, [p], [a]);
    const f = r.titulares.find((x) => x.user_id === 'u-chino')!;
    assert.equal(f.estado, 'pagado');
    assert.equal(f.pago!.via, 'alias');
  }
});

test('alias a alguien de la banca: queda "no_titular" (la banca no paga)', () => {
  const p = pago(1, { id: '888', first_name: 'Boris', last_name: 'Antic' });
  const r = cruzarPagos(titularesQuePagan, [p], [{ user_id: 'u-boris', payer_mp_id: '888', payer_email_sha256: null, payer_name_norm: null }], () => 'Boris');
  assert.equal(r.sin_asignar[0].motivo, 'no_titular');
  assert.deepEqual(r.sin_asignar[0].candidatos, ['Boris']);
});

test('segundo pago del mismo jugador queda como duplicado', () => {
  const r = cruzarPagos(titularesQuePagan, [
    pago(1, { id: '1', first_name: 'Alan', last_name: 'Hertz' }),
    pago(2, { id: '1', first_name: 'Alan', last_name: 'Hertz' }),
  ]);
  assert.equal(r.resumen.pagados, 1);
  assert.equal(r.sin_asignar[0].motivo, 'duplicado');
});

test('lo que sale del cruce no trae correos', () => {
  const r = cruzarPagos(titularesQuePagan, pagos19);
  const s = JSON.stringify(r);
  // A lo más el correo enmascarado de un pagador sin nombre ("ju•••@dominio")
  assert.ok(!/[a-z0-9._-]{3,}@/i.test(s), 'sin correos completos');
  for (const p of PAGOS_RAW) if (p.payer?.email) assert.ok(!s.includes(p.payer.email));
  for (const t of TITULARES) assert.ok(!s.includes(t.email!));
});
