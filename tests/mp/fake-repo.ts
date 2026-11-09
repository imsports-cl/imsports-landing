import type { AliasPagador, Titular } from '../../lib/mp/cruce';
import { inicioPartido, type CierreSancionFila, type Partido, type PagosRepo, type Sancion } from '../../lib/mp/servicio';

/** BD en memoria. Reproduce el UNIQUE (group_id, user_id, applies_to) de player_sanctions. */
export function fakeRepo(init: { partidos: Partido[]; titulares: Record<string, Titular[]>; miembros?: { user_id: string; nombre: string }[]; sanciones?: (Sancion & { group_id: string })[]; aliases?: (AliasPagador & { id: string; payer_label: string | null; group_id: string })[]; cierres?: Record<string, string>; convocatorias?: Record<string, string | null>; cierreSanciones?: CierreSancionFila[] }) {
  const sanciones = [...(init.sanciones || [])];
  const aliases = [...(init.aliases || [])];
  const inserts: any[] = [];
  const deudas: { match_id: string; user_id: string; created_by: string | null }[] = [];
  const cierreFilas: CierreSancionFila[] = [...(init.cierreSanciones || [])];
  /** Tablas escritas. Nunca debe aparecer `matches`. */
  const escrituras: string[] = [];
  const miembros = init.miembros || Object.values(init.titulares).flat().map((t) => ({ user_id: t.user_id, nombre: t.nombre }));
  const repo: PagosRepo = {
    async partidosRecientes(g, n) { return init.partidos.filter((p) => p.group_id === g).sort((a, b) => b.date.localeCompare(a.date)).slice(0, n); },
    async partido(id) { return init.partidos.find((p) => p.id === id) || null; },
    async titulares(m) { return init.titulares[m.id] || []; },
    async titularesDe(matches) {
      const out: Record<string, Titular[]> = {};
      for (const m of matches) out[m.id] = init.titulares[m.id] || [];
      return out;
    },
    async miembros() { return miembros; },
    async aliases(g) { return aliases.filter((a) => a.group_id === g); },
    async siguienteFecha(m) {
      return init.partidos.filter((p) => p.group_id === m.group_id && p.date > m.date && p.status !== 'cancelled')
        .sort((a, b) => a.date.localeCompare(b.date))[0]?.date ?? null;
    },
    async eventoCierre(m) { return init.cierres?.[m.id] ?? null; },
    async eventoConvocatoria(m) { return init.convocatorias?.[m.id] ?? null; },
    async partidoAnterior(m) {
      const inicio = inicioPartido(m).getTime();
      return init.partidos
        .filter((p) => p.group_id === m.group_id && p.id !== m.id && p.status !== 'cancelled' && inicioPartido(p).getTime() < inicio)
        .sort((a, b) => inicioPartido(b).getTime() - inicioPartido(a).getTime())[0] ?? null;
    },
    async partidosActivos(g, desde, hasta, limite) {
      const a = Date.parse(desde);
      const b = Date.parse(hasta);
      return init.partidos.filter((p) => p.group_id === g && p.status !== 'cancelled'
        && inicioPartido(p).getTime() >= a && inicioPartido(p).getTime() < b)
        .sort((x, y) => inicioPartido(y).getTime() - inicioPartido(x).getTime())
        .slice(0, limite)
        .sort((x, y) => inicioPartido(x).getTime() - inicioPartido(y).getTime());
    },
    async convocatorias(g, ids) {
      const set = new Set(ids);
      const out: Record<string, string> = {};
      const pares = init.partidos
        .filter((p) => p.group_id === g && set.has(p.id) && init.convocatorias?.[p.id])
        .map((p) => ({ id: p.id, at: init.convocatorias![p.id] as string }))
        .sort((x, y) => x.at.localeCompare(y.at));
      for (const p of pares) if (!out[p.id]) out[p.id] = p.at;
      return out;
    },
    async partidoSiguiente(m) {
      const inicio = inicioPartido(m).getTime();
      return init.partidos
        .filter((p) => p.group_id === m.group_id && p.id !== m.id && p.status !== 'cancelled' && inicioPartido(p).getTime() > inicio)
        .sort((a, b) => inicioPartido(a).getTime() - inicioPartido(b).getTime())[0] ?? null;
    },
    async sanciones(g, f) { return sanciones.filter((s) => s.group_id === g && s.applies_to === f); },
    async insertarSancion(s) {
      if (sanciones.some((x) => x.group_id === s.group_id && x.user_id === s.user_id && x.applies_to === s.applies_to)) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      sanciones.push(s); inserts.push(s);
      escrituras.push('player_sanctions');
    },
    async guardarAlias(a) {
      for (let i = aliases.length - 1; i >= 0; i--) {
        const x = aliases[i];
        if (x.group_id === a.group_id && ((a.payer_mp_id && x.payer_mp_id === a.payer_mp_id) || (a.payer_email_sha256 && x.payer_email_sha256 === a.payer_email_sha256) || (a.payer_name_norm && x.payer_name_norm === a.payer_name_norm))) aliases.splice(i, 1);
      }
      aliases.push({ ...a, id: `a-${aliases.length + 1}` });
    },
    async borrarAlias(g, id) { const i = aliases.findIndex((a) => a.group_id === g && a.id === id); if (i >= 0) aliases.splice(i, 1); },
    async deudas() { return []; },
    async registrarDeuda(p) {
      deudas.push(p);
      escrituras.push('player_debts');
      return { ok: true };
    },
    async saldarDeuda() { return { ok: true }; },
    async cierreSancion(matchId) {
      const fila = cierreFilas.find((f) => f.match_id === matchId);
      return fila ? { ...fila, snapshot: { ...fila.snapshot } } : null;
    },
    async guardarCierreSancion(fila) {
      escrituras.push('cierre_sanciones');
      const processed_at = fila.processed_at || new Date().toISOString();
      const i = cierreFilas.findIndex((f) => f.match_id === fila.match_id);
      if (i >= 0 && cierreFilas[i].status === 'applied') return { ...cierreFilas[i], snapshot: { ...cierreFilas[i].snapshot } };
      const row: CierreSancionFila = { ...fila, processed_at, snapshot: fila.snapshot };
      if (i >= 0) cierreFilas[i] = row;
      else cierreFilas.push(row);
      return { ...row, snapshot: { ...row.snapshot } };
    },
    async partidosPendientesCierre(groupId, desdeIso, limite) {
      const desde = Date.parse(desdeIso);
      const ya = new Set(cierreFilas.map((f) => f.match_id));
      return init.partidos
        .filter((p) => p.group_id === groupId && p.status !== 'cancelled' && init.cierres?.[p.id] && !ya.has(p.id))
        .map((p) => ({ id: p.id, cerrado_en: init.cierres![p.id] }))
        .filter((p) => Date.parse(p.cerrado_en) >= desde)
        .sort((a, b) => b.cerrado_en.localeCompare(a.cerrado_en))
        .slice(0, limite);
    },
  };
  return { repo, sanciones, aliases, inserts, deudas, cierreFilas, escrituras };
}
