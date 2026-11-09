/**
 * Implementación de PagosRepo con el cliente service-role (solo servidor).
 */
import 'server-only';
import { supabase as db } from '../supabase';
import { validarSnapshotCierre043 } from './cierre-043';
import { exigirMatchId } from './ids';
import {
  inicioPartido, ErrorPagos, TITULARES_INCOMPLETO,
  type CierreSancionFila, type CierreSancionSnapshot, type PagosRepo, type Partido,
} from './servicio';

const PARTIDO = 'id, group_id, date, time, price, status, phase, created_at';

function err(e: any) {
  if (!e) return;
  if (e.code === '22P02') throw new ErrorPagos('match_id inválido', 400);
  const x: any = new Error(e.message || 'error de base de datos');
  x.code = e.code;
  throw x;
}

function snapshotCierre(raw: unknown): CierreSancionSnapshot {
  const valor = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : raw;
  if (!Array.isArray(valor)) return [];
  return valor.filter((x) => x && typeof x === 'object').map((x) => ({
    user_id: String(x.user_id || ''),
    nombre: String(x.nombre || ''),
    estado: x.estado === 'pagado' || x.estado === 'pagado_tarde' ? x.estado : 'no_pagado',
    pagado: x.pagado === true,
    sancion: Boolean(x.sancion),
    deuda: Boolean(x.deuda),
  }));
}

function creadaDe(data: unknown): boolean {
  if (data === true) return true;
  if (data && typeof data === 'object' && !Array.isArray(data) && 'creada' in data) return Boolean((data as { creada?: boolean }).creada);
  if (Array.isArray(data) && data[0] && typeof data[0] === 'object') return Boolean((data[0] as { creada?: boolean }).creada);
  return false;
}

function filaCierre(raw: {
  match_id: string; group_id: string; processed_at: string; processed_by?: string | null;
  snapshot?: unknown; status: CierreSancionFila['status']; note?: string | null;
}): CierreSancionFila {
  return {
    match_id: raw.match_id,
    group_id: raw.group_id,
    processed_at: raw.processed_at,
    processed_by: raw.processed_by || '',
    snapshot: snapshotCierre(raw.snapshot),
    status: raw.status,
    note: raw.note ?? null,
  };
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
    exigirMatchId(matchId);
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
  async deudas(groupId) {
    const { data, error } = await db.from('player_debts')
      .select('id, user_id, match_id, status, mp_payment_id, match:matches(date)')
      .eq('group_id', groupId).eq('status', 'activa');
    if (error?.code === '42P01' || error?.code === 'PGRST205') return [];
    err(error);
    const ids = [...new Set((data || []).map((r: any) => r.user_id))];
    const { data: miembros } = ids.length
      ? await db.from('group_members').select('user_id, nickname, user:users(display_name)').eq('group_id', groupId).in('user_id', ids)
      : { data: [] as any[] };
    const nombre = new Map<string, string>();
    for (const m of (miembros || []) as any[]) nombre.set(m.user_id, m.nickname || m.user?.display_name || 'Jugador');
    return ((data || []) as any[]).map((r) => ({
      id: r.id, user_id: r.user_id, match_id: r.match_id,
      fecha: String(r.match?.date || '').slice(0, 10),
      nombre: nombre.get(r.user_id) || 'Jugador',
      status: r.status, mp_payment_id: r.mp_payment_id ?? null,
    }));
  },
  async registrarDeuda(p) {
    const { error } = await db.rpc('registrar_deuda_no_pago', {
      p_match_id: p.match_id, p_user_id: p.user_id, p_created_by: p.created_by, p_note: null,
    });
    if (error?.code === 'PGRST202' || error?.code === '42883' || error?.code === '42P01') return { ok: false, omitida: true };
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return { ok: true };
  },
  async cierreSancion(matchId) {
    const { data, error } = await db.from('cierre_sanciones')
      .select('match_id, group_id, processed_at, processed_by, snapshot, status, note')
      .eq('match_id', matchId).maybeSingle();
    if (error?.code === '42P01' || error?.code === 'PGRST205') {
      throw new ErrorPagos('falta la tabla cierre_sanciones', 503);
    }
    err(error);
    if (!data) return null;
    return filaCierre(data);
  },
  async reclamarCierre(p) {
    validarSnapshotCierre043(p.status, p.snapshot);
    const { data, error } = await db.rpc('registrar_cierre_sanciones', {
      p_match_id: p.match_id,
      p_processed_by: p.processed_by,
      p_snapshot: p.snapshot,
      p_status: p.status,
      p_note: p.note,
    });
    if (error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST202' || error?.code === '42883') {
      throw new ErrorPagos('falta registrar_cierre_sanciones', 503);
    }
    if (error?.code === '23514') throw new ErrorPagos('falta permitir status processing (migración 044)', 503);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return { creada: creadaDe(data) };
  },
  async guardarCierreSancion(fila, opts) {
    validarSnapshotCierre043(fila.status, fila.snapshot);
    // Solo cierre_sanciones. matches no se toca.
    const processed_at = fila.processed_at || new Date().toISOString();
    const row = {
      match_id: fila.match_id,
      group_id: fila.group_id,
      processed_at,
      processed_by: fila.processed_by,
      snapshot: fila.snapshot,
      status: fila.status,
      note: fila.note,
    };
    const { data: prev, error: e0 } = await db.from('cierre_sanciones')
      .select('status').eq('match_id', fila.match_id).maybeSingle();
    if (e0?.code === '42P01' || e0?.code === 'PGRST205') throw new ErrorPagos('falta la tabla cierre_sanciones', 503);
    err(e0);
    if ((prev as { status?: string } | null)?.status === 'applied' && fila.status !== 'applied' && !opts?.forzar) {
      const vigente = await this.cierreSancion(fila.match_id);
      if (!vigente) throw new ErrorPagos('no se pudo leer cierre_sanciones', 503);
      return vigente;
    }
    if (!prev) {
      const { error } = await db.from('cierre_sanciones').insert(row);
      if (error?.code === '23505') {
        const vigente = await this.cierreSancion(fila.match_id);
        if (vigente?.status === 'applied') return vigente;
      } else {
        err(error);
        return filaCierre(row);
      }
    }
    let update = db.from('cierre_sanciones').update({
      group_id: row.group_id,
      processed_at: row.processed_at,
      processed_by: row.processed_by,
      snapshot: row.snapshot,
      status: row.status,
      note: row.note,
    }).eq('match_id', fila.match_id);
    if (!opts?.forzar && fila.status !== 'applied') update = update.neq('status', 'applied');
    const { error } = await update;
    err(error);
    return (await this.cierreSancion(fila.match_id)) || filaCierre(row);
  },
  async partidosPendientesCierre(groupId, desdeIso, limite, reintentoAntesIso) {
    const { data, error } = await db.from('group_messages')
      .select('created_at, metadata')
      .eq('group_id', groupId).eq('type', 'system')
      .eq('metadata->>kind', 'match_closed')
      .gte('created_at', desdeIso)
      .order('created_at', { ascending: false })
      .limit(200);
    err(error);
    const porMatch = new Map<string, string>();
    for (const row of (data || []) as { created_at?: string; metadata?: { match_id?: string } }[]) {
      const id = row.metadata?.match_id;
      const at = row.created_at;
      if (!id || !at) continue;
      const prev = porMatch.get(id);
      if (!prev || at < prev) porMatch.set(id, at);
    }
    const ids = [...porMatch.keys()];
    if (!ids.length) return [];
    const { data: hechos, error: e2 } = await db.from('cierre_sanciones')
      .select('match_id, status, processed_at').in('match_id', ids);
    if (e2?.code === '42P01' || e2?.code === 'PGRST205') throw new ErrorPagos('falta la tabla cierre_sanciones', 503);
    err(e2);
    const corte = reintentoAntesIso ? Date.parse(reintentoAntesIso) : 0;
    const excluir = new Set<string>();
    for (const r of (hechos || []) as { match_id: string; status?: string; processed_at?: string }[]) {
      if (r.status === 'applied') excluir.add(r.match_id);
      else if (r.status === 'processing' && Date.parse(r.processed_at || '') >= corte) excluir.add(r.match_id);
    }
    const candidatos = ids.filter((id) => !excluir.has(id));
    if (!candidatos.length) return [];
    const { data: partidos, error: e3 } = await db.from('matches').select('id, status').in('id', candidatos);
    err(e3);
    const vivos = new Set(((partidos || []) as { id: string; status: string | null }[])
      .filter((p) => p.status !== 'cancelled').map((p) => p.id));
    return candidatos
      .filter((id) => vivos.has(id))
      .map((id) => ({ id, cerrado_en: porMatch.get(id)! }))
      .sort((a, b) => b.cerrado_en.localeCompare(a.cerrado_en))
      .slice(0, limite);
  },
  async saldarDeuda(p) {
    const { data, error } = await db.rpc('saldar_deuda', {
      p_debt_id: p.debt_id, p_via: p.via, p_settled_at: p.settled_at ?? null,
      p_mp_payment_id: p.mp_payment_id ?? null, p_condonar: false, p_by: p.by ?? null, p_note: null,
    });
    if (error?.code === 'PGRST202' || error?.code === '42883' || error?.code === '42P01') return { ok: false };
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return (data as { ok: boolean; ya_saldada?: boolean }) || { ok: true };
  },
};
