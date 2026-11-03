/**
 * Implementación de PagosRepo con el cliente service-role (solo servidor).
 */
import 'server-only';
import { supabase as db } from '../supabase';
import { inicioPartido, TITULARES_INCOMPLETO, type PagosRepo, type Partido } from './servicio';

const PARTIDO = 'id, group_id, date, time, price, status, phase, created_at';

function err(e: any) {
  if (e) { const x: any = new Error(e.message || 'error de base de datos'); x.code = e.code; throw x; }
}

export const repoSupabase: PagosRepo = {
  async partidosRecientes(groupId, limite) {
    const { data, error } = await db.from('matches').select(PARTIDO)
      .eq('group_id', groupId).lte('date', new Date(Date.now() + 86400000).toISOString())
      .order('date', { ascending: false }).limit(limite);
    err(error);
    return (data || []) as Partido[];
  },
  async partido(matchId) {
    const { data, error } = await db.from('matches').select(PARTIDO).eq('id', matchId).maybeSingle();
    err(error);
    return (data as Partido) || null;
  },
  async titulares(m) {
    const todos = await this.titularesDe([m]);
    return todos[m.id] || [];
  },
  async titularesDe(matches) {
    if (!matches.length) return {};
    const ids = matches.map((m) => m.id);
    const PAGINA = 1000;
    const confs: any[] = [];
    let total: number | null = null;
    let members: any[] = [];
    let desde = 0;
    let cortado = false;
    for (let pagina = 0; pagina < 30; pagina++) {
      const confirmaciones = db.from('match_confirmations')
        .select('match_id, user_id, user:users(display_name, email)', { count: 'exact' })
        .in('match_id', ids).eq('status', 'confirmed').eq('is_starter', true)
        .order('match_id', { ascending: true })
        .order('user_id', { ascending: true })
        .range(desde, desde + PAGINA - 1);
      const miembros = pagina === 0
        ? db.from('group_members').select('user_id, nickname').eq('group_id', matches[0].group_id)
        : null;
      const [confRes, memRes] = await Promise.all([
        confirmaciones,
        miembros ?? Promise.resolve({ data: members, error: null }),
      ]);
      err(confRes.error);
      if (memRes) err((memRes as { error: any }).error);
      if (pagina === 0) members = (memRes as { data: any[] | null }).data || [];
      if (total == null && typeof confRes.count === 'number') total = confRes.count;
      const page = confRes.data || [];
      confs.push(...page);
      if (page.length < PAGINA) break;
      desde += PAGINA;
      if (total != null && confs.length >= total) break;
      if (pagina === 29) cortado = true;
    }
    const nick = new Map((members || []).map((x: any) => [x.user_id, x.nickname as string | null]));
    const out: Record<string, { user_id: string; nombre: string; display_name: string | null; nickname: string | null; email: string | null }[]> = {};
    for (const id of ids) out[id] = [];
    for (const c of confs) {
      const fila = {
        user_id: c.user_id,
        nombre: nick.get(c.user_id) || c.user?.display_name || 'Jugador',
        display_name: c.user?.display_name ?? null,
        nickname: nick.get(c.user_id) ?? null,
        email: c.user?.email ?? null,
      };
      (out[c.match_id] ||= []).push(fila);
    }
    if (cortado || (total != null && confs.length !== total)) {
      (out as any)[TITULARES_INCOMPLETO] = true;
    }
    return out;
  },
  async miembros(groupId) {
    const { data, error } = await db.from('group_members')
      .select('user_id, nickname, user:users(display_name)')
      .eq('group_id', groupId).eq('is_active', true);
    err(error);
    return (data || [])
      .map((x: any) => ({ user_id: x.user_id, nombre: x.nickname || x.user?.display_name || 'Jugador' }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  },
  async aliases(groupId) {
    const { data, error } = await db.from('mp_payer_aliases')
      .select('id, user_id, payer_mp_id, payer_email_sha256, payer_name_norm, payer_label')
      .eq('group_id', groupId);
    // Si la migración todavía no está aplicada, el panel funciona sin alias.
    if (error?.code === '42P01' || error?.code === 'PGRST205') return [];
    err(error);
    return (data || []) as any;
  },
  async siguienteFecha(m) {
    const { data, error } = await db.from('matches').select('date')
      .eq('group_id', m.group_id).gt('date', m.date).neq('status', 'cancelled')
      .order('date', { ascending: true }).limit(1);
    err(error);
    return (data?.[0] as any)?.date ?? null;
  },
  async eventoCierre(m) {
    // Mensaje system que inserta la app al cerrar el partido (create_match_system_message, kind match_closed).
    const { data, error } = await db.from('group_messages').select('created_at')
      .eq('group_id', m.group_id).eq('type', 'system')
      .eq('metadata->>kind', 'match_closed').eq('metadata->>match_id', m.id)
      .order('created_at', { ascending: true }).limit(1);
    err(error);
    return (data?.[0] as any)?.created_at ?? null;
  },
  async eventoConvocatoria(m) {
    // Primer aviso de convocatoria de ESTE partido (kind match_convocatoria).
    const { data, error } = await db.from('group_messages').select('created_at')
      .eq('group_id', m.group_id).eq('type', 'system')
      .eq('metadata->>kind', 'match_convocatoria').eq('metadata->>match_id', m.id)
      .order('created_at', { ascending: true }).limit(1);
    err(error);
    return (data?.[0] as any)?.created_at ?? null;
  },
  async partidoAnterior(m) {
    const { data, error } = await db.from('matches').select(PARTIDO)
      .eq('group_id', m.group_id).lte('date', m.date).neq('id', m.id).neq('status', 'cancelled')
      .order('date', { ascending: false }).limit(15);
    err(error);
    const inicio = inicioPartido(m).getTime();
    return ((data || []) as Partido[])
      .filter((p) => inicioPartido(p).getTime() < inicio)
      .sort((a, b) => inicioPartido(b).getTime() - inicioPartido(a).getTime())[0] ?? null;
  },
  async partidosActivos(groupId, desde, hasta, limite) {
    const { data, error } = await db.from('matches').select(PARTIDO)
      .eq('group_id', groupId).neq('status', 'cancelled')
      .gte('date', desde).lt('date', hasta)
      .order('date', { ascending: false }).limit(limite);
    err(error);
    return ((data || []) as Partido[])
      .sort((a, b) => inicioPartido(a).getTime() - inicioPartido(b).getTime());
  },
  async convocatorias(groupId, matchIds) {
    const out: Record<string, string> = {};
    if (!matchIds.length) return out;
    const { data, error } = await db.from('group_messages').select('created_at, metadata')
      .eq('group_id', groupId).eq('type', 'system')
      .eq('metadata->>kind', 'match_convocatoria')
      .in('metadata->>match_id', matchIds)
      .order('created_at', { ascending: true });
    err(error);
    for (const row of (data || []) as { created_at?: string; metadata?: { match_id?: string } }[]) {
      const id = row.metadata?.match_id;
      const at = row.created_at;
      if (!id || !at || out[id]) continue; // ya ordenado: el primero es el más antiguo
      out[id] = at;
    }
    return out;
  },
  async partidoSiguiente(m) {
    const { data, error } = await db.from('matches').select(PARTIDO)
      .eq('group_id', m.group_id).gte('date', m.date).neq('id', m.id).neq('status', 'cancelled')
      .order('date', { ascending: true }).limit(15);
    err(error);
    const inicio = inicioPartido(m).getTime();
    return ((data || []) as Partido[])
      .filter((p) => inicioPartido(p).getTime() > inicio)
      .sort((a, b) => inicioPartido(a).getTime() - inicioPartido(b).getTime())[0] ?? null;
  },
  async sanciones(groupId, appliesTo) {
    const { data, error } = await db.from('player_sanctions')
      .select('user_id, applies_to, reason, note').eq('group_id', groupId).eq('applies_to', appliesTo);
    err(error);
    return (data || []) as any;
  },
  async insertarSancion(s) {
    const { error } = await db.from('player_sanctions').insert(s);
    err(error);
  },
  async guardarAlias(a) {
    // Un pagador apunta a un solo jugador: borrar alias previos con cualquiera de sus claves.
    const ors = [
      a.payer_mp_id && `payer_mp_id.eq.${a.payer_mp_id}`,
      a.payer_email_sha256 && `payer_email_sha256.eq.${a.payer_email_sha256}`,
      a.payer_name_norm && `payer_name_norm.eq."${a.payer_name_norm.replace(/"/g, '')}"`,
    ].filter(Boolean).join(',');
    if (ors) {
      const { error: e1 } = await db.from('mp_payer_aliases').delete().eq('group_id', a.group_id).or(ors);
      err(e1);
    }
    const { error } = await db.from('mp_payer_aliases').insert(a);
    err(error);
  },
  async borrarAlias(groupId, aliasId) {
    const { error } = await db.from('mp_payer_aliases').delete().eq('group_id', groupId).eq('id', aliasId);
    err(error);
  },
};
