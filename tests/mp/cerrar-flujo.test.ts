import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mensajeCierre } from '../../lib/cierre/mensaje';
import { sinCierrePago } from '../../lib/mp/cierre';
import { exigirMatchId } from '../../lib/mp/ids';
import { ErrorPagos } from '../../lib/mp/servicio';

test('previsualización sin cierre: los impagos salen y copiar no está bloqueado', () => {
  assert.equal(sinCierrePago({ en: null, fuente: 'pendiente' }), true);
  const r = mensajeCierre({
    titulares: [
      { user_id: 'u-alan', nombre: 'Alan', estado: 'pagado' },
      { user_id: 'u-chino', nombre: 'Chino', estado: 'no_pagado' },
    ],
    cupos: [],
    fechaPartido: '2026-11-02',
    partidoEmpezo: true,
  });
  assert.match(r.texto, /Pierde cupo por no pago:\nChino\n/);
  assert.equal(r.bloqueo, null);
  assert.equal(r.bloqueado, false);
});

test('el panel no cierra partidos: solo previsualiza y copia', () => {
  const pagos = readFileSync(new URL('../../app/admin/Pagos.tsx', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../../app/admin/api/pagos/route.ts', import.meta.url), 'utf8');
  assert.equal(pagos.includes('Cerrar y copiar'), false);
  assert.match(pagos, /Copia este mensaje y después cierra la pichanga en la app\./);
  assert.equal(route.includes('cerrar_mensaje'), false);
  assert.equal(route.includes('registrar'), false);
});

test('match_id inválido es 400', () => {
  assert.throws(() => exigirMatchId('no-es-uuid'), (e: unknown) => e instanceof ErrorPagos && e.status === 400);
  assert.throws(() => exigirMatchId(''), (e: unknown) => e instanceof ErrorPagos && e.status === 400);
  exigirMatchId('3893ee71-b6c6-476d-ac59-2e07c23c281a');
});
