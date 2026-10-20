/**
 * Botón «Revisar pagos»: la respuesta trae revisado_at (hora del servidor al
 * consultar MP) y el panel la muestra en hora de Chile (America/Santiago).
 */
import './_guard';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horaClt } from '../../lib/mp/tiempo';
import { estadoPagos, type Deps } from '../../lib/mp/servicio';
import { fakeRepo } from './fake-repo';
import { GRUPO, MATCH, SIGUIENTE, TITULARES, PAGOS_RAW, ADMIN_EMAIL } from './fixtures/pichanga-19oct';

test('horaClt: hora de Chile en 24 h, con y sin horario de verano', () => {
  assert.equal(horaClt('2026-10-20T16:45:00Z'), '13:45'); // verano: UTC-3
  assert.equal(horaClt('2026-07-01T17:45:00Z'), '13:45'); // invierno: UTC-4
  assert.equal(horaClt('2026-10-20T03:05:00Z'), '00:05'); // medianoche: 00, no 24
  assert.equal(horaClt('no-es-fecha'), '—');
});

test('estadoPagos trae revisado_at = hora del servidor al consultar', async () => {
  const AHORA = new Date('2026-10-20T16:45:00Z');
  const db = fakeRepo({ partidos: [MATCH, SIGUIENTE], titulares: { [MATCH.id]: TITULARES } });
  const d: Deps = {
    repo: db.repo,
    mp: { async buscarAprobados() { return PAGOS_RAW; }, async pago(id) { return PAGOS_RAW.find((p) => String(p.id) === id)!; } },
    ahora: () => AHORA,
    noPagan: [ADMIN_EMAIL],
  };
  const r = await estadoPagos(d, GRUPO, MATCH.id);
  assert.equal(r.revisado_at, '2026-10-20T16:45:00.000Z');
  assert.equal(horaClt(r.revisado_at), '13:45');
  // sin MP también informa la hora (el panel la muestra igual)
  const r2 = await estadoPagos({ ...d, mp: null }, GRUPO, MATCH.id);
  assert.equal(r2.revisado_at, '2026-10-20T16:45:00.000Z');
});
