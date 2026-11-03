import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ejecutarCerrarYCopiar } from '../../lib/cierre/cerrar-flujo';
import { mensajeCierre } from '../../lib/cierre/mensaje';
import { sinCierrePago } from '../../lib/mp/cierre';

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

test('cerrar y copiar: un cierre nuevo recalcula con ese instante y copia', async () => {
  const copias: string[] = [];
  let escrituras = 0;
  const r = await ejecutarCerrarYCopiar({
    cierreActual: null,
    cerrar: async () => { escrituras++; return '2026-11-02T23:00:00.000Z'; },
    mensajeConCierre: (en) => `final ${en}`,
    copiar: async (t) => { copias.push(t); },
  });
  assert.equal(escrituras, 1);
  assert.equal(r.ya_existia, false);
  assert.deepEqual(copias, ['final 2026-11-02T23:00:00.000Z']);
});

test('cerrar y copiar: si ya estaba cerrado no vuelve a escribir', async () => {
  let escrituras = 0;
  const r = await ejecutarCerrarYCopiar({
    cierreActual: '2026-11-02T22:00:00.000Z',
    cerrar: async () => { escrituras++; return 'otro'; },
    mensajeConCierre: (en) => `ya ${en}`,
    copiar: async () => {},
  });
  assert.equal(escrituras, 0);
  assert.equal(r.ya_existia, true);
  assert.equal(r.texto, 'ya 2026-11-02T22:00:00.000Z');
});

test('cerrar y copiar: si el cierre falla no copia', async () => {
  let copias = 0;
  await assert.rejects(
    () => ejecutarCerrarYCopiar({
      cierreActual: null,
      cerrar: async () => { throw new Error('no se pudo cerrar el partido'); },
      mensajeConCierre: () => 'no deberia',
      copiar: async () => { copias++; },
    }),
    (e: unknown) => e instanceof Error && e.message === 'no se pudo cerrar el partido',
  );
  assert.equal(copias, 0);
});
