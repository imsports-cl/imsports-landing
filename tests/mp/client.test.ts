import './_guard';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarPagosAprobados, obtenerPago, MpNoConfigurado, MpError } from '../../lib/mp/client';

const TOKEN = 'APP_USR-test-no-es-real';
function fakeFetch(total: number) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const f = (async (u: string, init: RequestInit) => {
    const url = new URL(u);
    calls.push({ url, init });
    const offset = Number(url.searchParams.get('offset'));
    const limit = Number(url.searchParams.get('limit'));
    const n = Math.max(0, Math.min(limit, total - offset));
    return new Response(JSON.stringify({ paging: { total, offset, limit }, results: Array.from({ length: n }, (_, i) => ({ id: offset + i })) }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test('pagina hasta traer todos los pagos y solo usa GET /v1/payments/search', async () => {
  const { f, calls } = fakeFetch(250);
  const r = await buscarPagosAprobados('2026-10-19T20:00:00.000-03:00', '2026-10-24T20:00:00.000-03:00', { token: TOKEN, fetchImpl: f });
  assert.equal(r.length, 250);
  assert.equal(calls.length, 3);
  for (const c of calls) {
    assert.equal(c.init.method, 'GET');
    assert.equal(c.url.origin + c.url.pathname, 'https://api.mercadopago.com/v1/payments/search');
    assert.equal(c.url.searchParams.get('status'), 'approved');
    assert.equal(c.url.searchParams.get('range'), 'date_approved');
    assert.equal((c.init.headers as any).Authorization, `Bearer ${TOKEN}`);
    assert.ok(!c.url.toString().includes(TOKEN), 'el token no va en la URL');
  }
  assert.deepEqual(calls.map((c) => c.url.searchParams.get('offset')), ['0', '100', '200']);
});

test('GET /v1/payments/{id} valida el id', async () => {
  const { f, calls } = fakeFetch(1);
  await obtenerPago('123', { token: TOKEN, fetchImpl: f });
  assert.equal(calls[0].url.pathname, '/v1/payments/123');
  await assert.rejects(obtenerPago('123/refunds', { token: TOKEN, fetchImpl: f }));
  await assert.rejects(obtenerPago('../v1/advanced_payments', { token: TOKEN, fetchImpl: f }));
  assert.equal(calls.length, 1);
});

test('sin token no sale a la red', async () => {
  const { f, calls } = fakeFetch(1);
  await assert.rejects(buscarPagosAprobados('a', 'b', { fetchImpl: f }), MpNoConfigurado);
  assert.equal(calls.length, 0);
});

test('los errores no incluyen el token', async () => {
  const f = (async () => new Response(`{"message":"bad token ${TOKEN}"}`, { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(buscarPagosAprobados('a', 'b', { token: TOKEN, fetchImpl: f }), (e: any) => {
    assert.ok(e instanceof MpError);
    assert.equal(e.status, 401);
    assert.ok(!String(e.message).includes(TOKEN) && !String(e.stack).includes(TOKEN));
    return true;
  });
  const boom = (async () => { throw new Error(`network Authorization: Bearer ${TOKEN}`); }) as unknown as typeof fetch;
  await assert.rejects(obtenerPago('1', { token: TOKEN, fetchImpl: boom }), (e: any) => !String(e.message).includes(TOKEN));
});
