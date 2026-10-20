import type { AliasPagador, Titular } from '../../lib/mp/cruce';
import type { Partido, PagosRepo, Sancion } from '../../lib/mp/servicio';

/** BD en memoria. Reproduce el UNIQUE (group_id, user_id, applies_to) de player_sanctions. */
export function fakeRepo(init: { partidos: Partido[]; titulares: Record<string, Titular[]>; miembros?: { user_id: string; nombre: string }[]; sanciones?: (Sancion & { group_id: string })[]; aliases?: (AliasPagador & { id: string; payer_label: string | null; group_id: string })[] }) {
  const sanciones = [...(init.sanciones || [])];
  const aliases = [...(init.aliases || [])];
  const inserts: any[] = [];
  const miembros = init.miembros || Object.values(init.titulares).flat().map((t) => ({ user_id: t.user_id, nombre: t.nombre }));
  const repo: PagosRepo = {
    async partidosRecientes(g, n) { return init.partidos.filter((p) => p.group_id === g).sort((a, b) => b.date.localeCompare(a.date)).slice(0, n); },
    async partido(id) { return init.partidos.find((p) => p.id === id) || null; },
    async titulares(m) { return init.titulares[m.id] || []; },
    async miembros() { return miembros; },
    async aliases(g) { return aliases.filter((a) => a.group_id === g); },
    async siguienteFecha(m) {
      return init.partidos.filter((p) => p.group_id === m.group_id && p.date > m.date && p.status !== 'cancelled')
        .sort((a, b) => a.date.localeCompare(b.date))[0]?.date ?? null;
    },
    async sanciones(g, f) { return sanciones.filter((s) => s.group_id === g && s.applies_to === f); },
    async insertarSancion(s) {
      if (sanciones.some((x) => x.group_id === s.group_id && x.user_id === s.user_id && x.applies_to === s.applies_to)) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      sanciones.push(s); inserts.push(s);
    },
    async guardarAlias(a) {
      for (let i = aliases.length - 1; i >= 0; i--) {
        const x = aliases[i];
        if (x.group_id === a.group_id && ((a.payer_mp_id && x.payer_mp_id === a.payer_mp_id) || (a.payer_email_sha256 && x.payer_email_sha256 === a.payer_email_sha256) || (a.payer_name_norm && x.payer_name_norm === a.payer_name_norm))) aliases.splice(i, 1);
      }
      aliases.push({ ...a, id: `a-${aliases.length + 1}` });
    },
    async borrarAlias(g, id) { const i = aliases.findIndex((a) => a.group_id === g && a.id === id); if (i >= 0) aliases.splice(i, 1); },
  };
  return { repo, sanciones, aliases, inserts };
}
