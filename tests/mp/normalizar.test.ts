import './_guard';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarNombre, tokensEmail, localEmailLetras, hashEmail } from '../../lib/mp/normalizar';
import { santiagoAUtc, isoSantiago, ventanaPagos } from '../../lib/mp/tiempo';
import { aPagoMp, esPagoDePichanga, enmascararEmail } from '../../lib/mp/pagos-mp';

test('normaliza acentos, ñ, mayúsculas y espacios', () => {
  assert.equal(normalizarNombre('  GONZALO  Gálvez-Muñoz '), 'gonzalo galvez munoz');
  assert.equal(normalizarNombre('Gonzalo Pérëz'), 'gonzalo perez');
  assert.equal(normalizarNombre(null), '');
});

test('tokens y letras del correo', () => {
  assert.deepEqual(tokensEmail('juan.soto1989@x.cl'), ['juan', 'soto']);
  assert.equal(localEmailLetras('Juan.Perez89@x.cl'), 'juanperez');
  assert.equal(hashEmail(' A@B.cl '), hashEmail('a@b.cl'));
  assert.equal(hashEmail('sin-arroba'), null);
});

test('hora de Chile → UTC (horario de verano y de invierno)', () => {
  assert.equal(santiagoAUtc('2026-10-19', '20:00').toISOString(), '2026-10-19T23:00:00.000Z'); // UTC-3
  assert.equal(santiagoAUtc('2026-06-15', '20:00').toISOString(), '2026-06-16T00:00:00.000Z'); // UTC-4
  assert.equal(isoSantiago(new Date('2026-10-19T23:00:00Z')), '2026-10-19T20:00:00.000-03:00');
});

test('ventana: desde la hora del partido hasta +5 días, sin pasar de ahora', () => {
  const ahora = new Date('2026-10-20T13:40:00Z');
  const v = ventanaPagos('2026-10-19T00:00:00+00:00', '20:00', ahora);
  assert.equal(v.desde.toISOString(), '2026-10-19T23:00:00.000Z');
  assert.equal(v.hasta.toISOString(), ahora.toISOString());
  assert.equal(v.cerrada, false);
  const v2 = ventanaPagos('2026-10-19', '20:00', new Date('2026-11-01T00:00:00Z'));
  assert.equal(v2.hasta.toISOString(), '2026-10-24T23:00:00.000Z');
  assert.equal(v2.cerrada, true);
});

test('pago de pichanga: aprobado, CLP, sin devolución, por descripción o monto', () => {
  const p = { id: 1, status: 'approved', currency_id: 'CLP', transaction_amount: 5000, description: 'Otra cosa' };
  assert.equal(esPagoDePichanga(p, 5000), true);
  assert.equal(esPagoDePichanga({ ...p, transaction_amount: 7000 }, 5000), false);
  assert.equal(esPagoDePichanga({ ...p, transaction_amount: 10000, description: 'Pichanga Conecta' }, 5000), true);
  assert.equal(esPagoDePichanga({ ...p, status: 'refunded' }, 5000), false);
  assert.equal(esPagoDePichanga({ ...p, transaction_amount_refunded: 5000 }, 5000), false);
  assert.equal(esPagoDePichanga({ ...p, currency_id: 'USD' }, 5000), false);
});

test('el pagador sin nombre se muestra con el correo enmascarado', () => {
  assert.equal(enmascararEmail('juanperez89@gmail.com'), 'ju•••@gmail.com');
  assert.equal(enmascararEmail('jperez@empresa.cl'), 'jp•••@e•••.cl');
  const p = aPagoMp({ id: 5, payer: { id: '12', email: 'juanperez89@gmail.com', first_name: '', last_name: '' } });
  assert.equal(p.pagador, 'ju•••@gmail.com');
  assert.equal(aPagoMp({ id: 6, payer: { id: 'x;drop' } }).payerId, null);
});
