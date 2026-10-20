/**
 * Implementación de PagosRepo con el cliente service-role (solo servidor).
 */
import 'server-only';
import { supabase as db } from '../supabase';
import type { PagosRepo, Partido } from './servicio';

const PARTIDO = 'id, group_id, date, time, price, status, phase';

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
    const [{ data: confs, error }, { data: members }] = await Promise.all([
      db.from('match_confirmations')
        .select('user_id, user:users(display_name, email)')
        .eq('match_id', m.id).eq('status', 'confirmed').eq('is_starter', true),
      db.from('group_members').select('user_id, nickname').eq('group_id', m.group_id),
    ]);
    err(error);
    const nick = new Map((members || []).map((x: any) => [x.user_id, x.nickname as string | null]));
    return (confs || []).map((c: any) => ({
      user_id: c.user_id,
      nombre: nick.get(c.user_id) || c.user?.display_name || 'Jugador',
      display_name: c.user?.display_name ?? null,
      nickname: nick.get(c.user_id) ?? null,
      email: c.user?.email ?? null,
    }));
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
