/** QA PR7 paginación de titularesDe con mock de PostgREST. P5 = conteo null. P9 = alta/baja entre páginas. */
import './_supabase-env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from '../../lib/supabase';
import { repoSupabase } from '../../lib/mp/repo-supabase';
import { TITULARES_INCOMPLETO } from '../../lib/mp/servicio';

type Opt = { maxRows: number; count: 'exact' | 'null' | 'wrong'; mutar?: (pagina: number, rows: any[]) => void };
const calls: string[] = [];
function instalar(rows: any[], o: Opt) {
  let paginaN = 0;
  (supabase as any).from = (tabla: string) => {
    const q: any = { f: [] as ((r: any) => boolean)[], ord: [] as string[], r: null as null | [number, number], wantCount: false };
    const b: any = {
      select(_c: string, opts?: any) { q.wantCount = opts?.count === 'exact'; return b; },
      in(col: string, v: string[]) { const s = new Set(v); q.f.push((r: any) => s.has(r[col])); return b; },
      eq(col: string, v: any) { if (tabla === 'match_confirmations') q.f.push((r: any) => r[col] === v); return b; },
      order(col: string) { q.ord.push(col); return b; },
      range(a: number, z: number) { q.r = [a, z]; return b; },
      then(res: any, rej: any) {
        if (tabla !== 'match_confirmations') return Promise.resolve({ data: [], error: null }).then(res, rej);
        if (o.mutar) o.mutar(paginaN, rows);
        paginaN++;
        let all = rows.filter((r) => q.f.every((f: any) => f(r)));
        all = [...all].sort((x, y) => { for (const c of q.ord) { const k = String(x[c]).localeCompare(String(y[c])); if (k) return k; } return 0; });
        const [a, z] = q.r ?? [0, all.length - 1];
        const data = all.slice(a, Math.min(z + 1, a + o.maxRows));
        calls.push(`${a}-${z}:${data.length}`);
        const count = !q.wantCount ? null : o.count === 'exact' ? all.length : o.count === 'wrong' ? all.length + 1 : null;
        return Promise.resolve({ data, error: null, count }).then(res, rej);
      },
    };
    return b;
  };
}
const filas = (nMatch: number, nPorMatch: number) => {
  const out: any[] = [];
  for (let m = 0; m < nMatch; m++) for (let u = 0; u < nPorMatch; u++)
    out.push({ match_id: `m${String(m).padStart(3, '0')}`, user_id: `u${String(u).padStart(3, '0')}`, status: 'confirmed', is_starter: true, user: { display_name: `J${u}`, email: null } });
  return out;
};
const ms = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${String(i).padStart(3, '0')}`, group_id: 'g' })) as any[];
async function leer(nMatch: number, nPor: number, o: Opt) {
  calls.length = 0; const rows = filas(nMatch, nPor); instalar(rows, o);
  const out: any = await repoSupabase.titularesDe(ms(nMatch));
  const n = Object.values(out).reduce((s: number, v: any) => s + v.length, 0);
  const claves = new Set<string>(); let dup = 0;
  for (const [mid, v] of Object.entries(out) as any) for (const t of v) { const k = `${mid}/${t.user_id}`; if (claves.has(k)) dup++; claves.add(k); }
  return { n, esperado: rows.length, dup, inc: Boolean(out[TITULARES_INCOMPLETO]), calls: [...calls] };
}
const casos: [string, number, number, Opt, (r: any) => boolean][] = [
  ['P1 2.500 filas, max 1000, count ok', 125, 20, { maxRows: 1000, count: 'exact' }, (r) => r.n === r.esperado && !r.inc && !r.dup],
  ['P2 exacto 1000 filas', 50, 20, { maxRows: 1000, count: 'exact' }, (r) => r.n === 1000 && !r.inc],
  ['P3 exacto 1000 filas, count null', 50, 20, { maxRows: 1000, count: 'null' }, (r) => r.n === 1000],
  ['P4 2.500 filas, max-rows 500, count ok', 125, 20, { maxRows: 500, count: 'exact' }, (r) => r.n === r.esperado || r.inc],
  ['P5 2.500 filas, max-rows 500, count NULL', 125, 20, { maxRows: 500, count: 'null' }, (r) => r.n === r.esperado || r.inc],
  ['P6 2.500 filas, max 1000, count NULL', 125, 20, { maxRows: 1000, count: 'null' }, (r) => r.n === r.esperado || r.inc],
  ['P7 count no cuadra (+1)', 60, 14, { maxRows: 1000, count: 'wrong' }, (r) => r.inc],
  ['P8 inserción entre páginas (fila nueva al inicio)', 125, 20, { maxRows: 1000, count: 'exact', mutar: (p, rows) => { if (p === 1) rows.push({ ...rows[0], user_id: 'u000a' }); } }, (r) => r.inc || (r.dup === 0 && r.n >= r.esperado)],
  ['P9 insert + delete entre páginas', 125, 20, { maxRows: 1000, count: 'exact', mutar: (p, rows) => { if (p === 1) { rows.push({ ...rows[0], user_id: 'u000a' }); rows.splice(rows.length - 2, 1); } } }, (r) => r.inc || r.dup === 0],
];
for (const [nom, a, b, o, ok] of casos) test(nom, async () => {
  const r = await leer(a, b, o);
  console.log(nom, JSON.stringify({ n: r.n, esperado: r.esperado, dup: r.dup, inc: r.inc, calls: r.calls }));
  assert.ok(ok(r));
});
