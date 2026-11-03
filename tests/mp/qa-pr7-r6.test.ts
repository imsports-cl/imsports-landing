/** Re-test PR #7 @ 1942870. Datos ficticios. Cadena natural, sin ventana deslizante. */
import './_guard';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoPagos, sancionarNoPago, type Deps, type Partido } from '../../lib/mp/servicio';
import { fakeRepo } from './fake-repo';
import type { Titular } from '../../lib/mp/cruce';
import type { PagoMpRaw } from '../../lib/mp/pagos-mp';

const G = 'g-lunes';
const partido = (id: string, date: string, extra: Partial<Partido> = {}): Partido => ({
  id, group_id: G, date, time: '20:00', price: 5000, status: 'scheduled', phase: 'voting', ...extra,
});
const tit = (user_id: string, n: string, a: string): Titular =>
  ({ user_id, nombre: n, nickname: n, display_name: `${n} ${a}`, email: `${n}.${a}@example.test`.toLowerCase() });
const NICO = tit('u-nico', 'Nico', 'Soto');
const pago = (id: number, fecha: string, t: Titular): PagoMpRaw => ({
  id, status: 'approved', currency_id: 'CLP', transaction_amount_refunded: 0, transaction_amount: 5000,
  description: 'Pichanga Conecta', date_approved: fecha,
  payer: { id: String(9000 + id % 100), email: t.email, first_name: t.nombre.toUpperCase(), last_name: t.display_name!.split(' ')[1].toUpperCase() },
});
function armar(partidos: Partido[], titulares: Record<string, Titular[]>, pagos: PagoMpRaw[], conv: Record<string, string>, cierres: Record<string, string> = {}, ahora = new Date('2026-11-03T16:00:00Z')) {
  const db = fakeRepo({ partidos, titulares, convocatorias: conv, cierres });
  const d: Deps = {
    repo: db.repo,
    mp: { async buscarAprobados() { return pagos; }, async pago(id) { return pagos.find((p) => String(p.id) === id)!; } },
    ahora: () => ahora, noPagan: [],
  };
  return d;
}
const sanc = (d: Deps, m: string) => sancionarNoPago(d, G, { match_id: m, user_id: NICO.user_id, confirmar: true }, null)
  .then((r: any) => `SANCIONADO applies_to=${r.applies_to}`, (e) => `rechazado(${e.status}): ${e.message}`);

const A = partido('m-a', '2026-10-26T00:00:00+00:00', { status: 'completed', phase: 'closed', created_at: '2026-10-20T12:00:00Z' });
const B = partido('m-b', '2026-11-02T00:00:00+00:00', { created_at: '2026-10-27T12:00:00Z' });
const CIERRE_A = '2026-10-27T13:43:00Z'; // mar 27-oct 10:43 CLT
const RAFA = tit('u-rafa', 'Rafa', 'Mora');
const DIA = 86400000;
// Lunes 20:00 CLT, convocado el martes anterior 09:00 CLT (todas las ventanas se solapan con la siguiente).
function lunes(desdeYmd: string, n: number, cada = 7) {
  const out: { m: Partido; conv: string }[] = [];
  const t0 = Date.parse(`${desdeYmd}T23:00:00Z`);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * cada * DIA; const ymd = new Date(t).toISOString().slice(0, 10);
    const conv = new Date(t - 6 * DIA - 11 * 3600000).toISOString(); // martes previo 09:00 CLT
    out.push({ m: partido(`m${ymd}`, `${ymd}T00:00:00+00:00`, { status: 'completed', phase: 'closed', created_at: conv }), conv });
  }
  return out;
}
const armarW = (ws: { m: Partido; conv: string }[], ts: Titular[], pagos: PagoMpRaw[], ahora: Date) =>
  armar(ws.map((w) => w.m), Object.fromEntries(ws.map((w) => [w.m.id, ts])), pagos, Object.fromEntries(ws.map((w) => [w.m.id, w.conv])), {}, ahora);
const est = async (d: Deps, id: string) => { const r = await estadoPagos(d, G, id); return Object.fromEntries(r.titulares.map((t: any) => [t.user_id, `${t.estado}:${t.pago?.id ?? '-'}${t.solape ? ':solape' : ''}`])); };
const sancU = (d: Deps, m: string, u: string) => sancionarNoPago(d, G, { match_id: m, user_id: u, confirmar: true }, null).then(() => 'SANCIONADO', (e) => `${e.status}`);

const wed = (ymd: string) => new Date(Date.parse(`${ymd}T13:00:00Z`) + 2 * DIA).toISOString(); // miércoles 10:00 CLT tras el lunes
const ini = '2026-01-05';
const W = lunes(ini, 52); const ids = W.map((w) => w.m.id); const ymdOf = (id: string) => id.slice(1);
const FIN = new Date('2027-01-20T16:00:00Z');

test('D1 cerrado N: pagó solo una vez (miércoles tras N-1), nunca pagó N → sancionable en N', async () => {
  const ws = lunes('2026-10-12', 5);
  const d = armarW(ws, [NICO, RAFA], [pago(601, wed('2026-10-26'), NICO)], new Date('2026-12-10T16:00:00Z'));
  const a = await est(d, 'm2026-10-26'), b = await est(d, 'm2026-11-02');
  const s = await sancU(d, 'm2026-11-02', 'u-nico');
  console.log('D1 N-1', a, '| N', b, '| sanc Nico N', s);
  assert.equal(s, 'SANCIONADO');
});
test('D2 Bug2 con ventana de B abierta (ahora = jueves)', async () => {
  const ws = lunes('2026-10-26', 2);
  const d = armarW(ws, [NICO, RAFA], [pago(602, wed('2026-10-26'), NICO)], new Date('2026-10-29T16:00:00Z'));
  console.log('D2 A', await est(d, 'm2026-10-26'), '| B', await est(d, 'm2026-11-02'), '| sanc B', await sancU(d, 'm2026-11-02', 'u-nico'));
});
const perfiles: Record<string, (i: number) => string[]> = {
  siempre: (i) => [new Date(Date.parse(W[i].conv) + DIA).toISOString()],
  nunca: () => [],
  atrasado1: (i) => [wed(ymdOf(ids[i]))],
  dos_de_golpe: (i) => (i % 2 === 1 ? [wed(ymdOf(ids[i])), new Date(Date.parse(wed(ymdOf(ids[i]))) + 60000).toISOString()] : []),
};
for (const [nom, f] of Object.entries(perfiles)) {
  test(`D3 perfil ${nom}: 409 indebidos en 52 lunes`, async () => {
    let k = 700; const pagos = W.flatMap((_, i) => f(i).map((t) => pago(k++, t, NICO)));
    const d = armarW(W, [NICO, RAFA], pagos, FIN);
    const cnt: Record<string, number> = {}; const malos: string[] = [];
    for (const id of ids) {
      const e = (await est(d, id))['u-nico']; const s = await sancU(d, id, 'u-nico');
      const k2 = `${e.split(':')[0]}${e.includes('solape') ? '+sc' : ''}→${s}`; cnt[k2] = (cnt[k2] || 0) + 1;
      // pagado a tiempo → 409 correcto; cualquier otro 409 es indebido
      if (s === '409' && !e.startsWith('pagado:')) malos.push(ymdOf(id));
    }
    console.log(`D3 ${nom}`, JSON.stringify(cnt), 'indebidos', malos.length, malos.slice(0, 6).join(' '));
    assert.equal(malos.length, 0);
  });
}
test('E1 atrasado1: estado de N visto desde N vs el pago que N+1 se queda (doble conteo/corrimiento)', async () => {
  let k = 800; const pagos = W.slice(0, 12).map((w) => pago(k++, wed(ymdOf(w.m.id)), NICO));
  const d = armarW(W.slice(0, 13), [NICO], pagos, FIN);
  const rows: string[] = []; let dup = 0;
  for (let i = 6; i < 12; i++) {
    const n = (await est(d, ids[i]))['u-nico'], n1 = (await est(d, ids[i + 1]))['u-nico'];
    rows.push(`${ymdOf(ids[i])} N=${n} N+1=${n1}`);
    if (n.split(':')[1] !== '-' && n.split(':')[1] === n1.split(':')[1]) dup++;
  }
  const ult = (await est(d, ids[12]))['u-nico'];
  console.log('E1', rows.join(' | '), '| idx12 (sin pago propio)', ult);
  assert.equal(dup, 0); assert.ok(!ult.startsWith('pagado'), `idx12 nunca pagó y sale ${ult}`);
});
for (const n of [7, 10, 13]) test(`E2 cadena ${n}: N desde N vs. pago que ve N+1 (pago en cada solape, deudas alternas)`, async () => {
  const ws = lunes('2026-08-03', n + 1); let k = 900;
  const pagos = ws.slice(0, n).filter((_, i) => i % 3 !== 2).map((w) => pago(k++, wed(ymdOf(w.m.id)), NICO));
  const d = armarW(ws, [NICO], pagos, FIN); const usados = new Map<string, string[]>();
  for (const w of ws) { const e = (await est(d, w.m.id))['u-nico']; const p = e.split(':')[1]; if (p !== '-') usados.set(p, [...(usados.get(p) || []), ymdOf(w.m.id)]); }
  const dobles = [...usados].filter(([, v]) => v.length > 1);
  console.log(`E2 n=${n} dobles`, JSON.stringify(dobles));
  assert.equal(dobles.length, 0);
});
test('E3 pichanga 22:30 CLT (01:30Z del día siguiente) entra en la ventana hacia atrás de la siguiente', async () => {
  const a = partido('mA', '2026-11-16T00:00:00+00:00', { status: 'completed', phase: 'closed', time: '22:30' } as any);
  const ws = [{ m: a, conv: '2026-11-10T12:00:00Z' }, ...lunes('2026-11-23', 1)];
  const d = armarW(ws, [NICO], [pago(951, '2026-11-18T10:00:00-03:00', NICO)], FIN);
  const ea = await est(d, 'mA'), eb = await est(d, 'm2026-11-23');
  console.log('E3 A', ea, '| B', eb);
  assert.ok(!(ea['u-nico'].includes(':951') && eb['u-nico'].includes(':951')));
});
test('F1 rendimiento: partidosActivos acotado al tope y una sola titularesDe', async () => {
  const d = armarW(W, [NICO], [], FIN); const r: any = d.repo; const lim: number[] = []; let td = 0;
  const pa = r.partidosActivos.bind(r); r.partidosActivos = (g: string, a: string, b: string, l: number) => { lim.push(l); return pa(g, a, b, l); };
  const tdo = r.titularesDe.bind(r); r.titularesDe = (m: any) => { td++; return tdo(m); };
  await estadoPagos(d, G, ids[40]);
  console.log('F1 limites', lim, 'titularesDe', td);
  // El «límite 7 / ≤20» era la ventana deslizante, ya retirada. El tope nuevo es 201 (200 + 1 para ver si hay más).
  assert.ok(lim.length > 0 && lim.every((l) => l <= 201) && td <= 2);
});
