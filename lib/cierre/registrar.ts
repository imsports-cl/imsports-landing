/**
 * Escribe el cierre de pago: el primer mensaje system match_closed del partido.
 * Si ya existe, no inserta otro. No toca sanciones ni cupos.
 */
import 'server-only';
import { supabase } from '../supabase';
import { ErrorPagos } from '../mp/servicio';

export async function asegurarCierrePartido(groupId: string, matchId: string): Promise<{ en: string; ya_existia: boolean }> {
  const { data: match, error: me } = await supabase.from('matches')
    .select('id, group_id, status, phase')
    .eq('id', matchId).maybeSingle();
  if (me) throw new ErrorPagos('no se pudo leer el partido', 500);
  const fila = match as { id: string; group_id: string; status: string | null; phase: string | null } | null;
  if (!fila || fila.group_id !== groupId) throw new ErrorPagos('partido no encontrado', 404);
  if (fila.status === 'cancelled') throw new ErrorPagos('el partido está cancelado', 400);

  const previo = await primerCierre(groupId, matchId);
  if (previo) return { en: previo, ya_existia: true };

  const { data: inserted, error: ie } = await supabase.from('group_messages').insert({
    group_id: groupId,
    type: 'system',
    content: '🏆 Partido cerrado. Pierden cupo por no pago.',
    metadata: { kind: 'match_closed', match_id: matchId },
  }).select('created_at').single();
  if (ie || !(inserted as { created_at?: string } | null)?.created_at) throw new ErrorPagos('no se pudo cerrar el partido', 500);

  if (fila.phase !== 'closed' || fila.status !== 'completed') {
    const { error: ue } = await supabase.from('matches')
      .update({ phase: 'closed', status: 'completed' })
      .eq('id', matchId).eq('group_id', groupId);
    if (ue) console.error('[admin/pagos] cerrar partido', ue.code ?? 'error');
  }
  return { en: (inserted as { created_at: string }).created_at, ya_existia: false };
}

async function primerCierre(groupId: string, matchId: string): Promise<string | null> {
  const { data, error } = await supabase.from('group_messages').select('created_at')
    .eq('group_id', groupId).eq('type', 'system')
    .eq('metadata->>kind', 'match_closed').eq('metadata->>match_id', matchId)
    .order('created_at', { ascending: true }).limit(1);
  if (error) throw new ErrorPagos('no se pudo leer el cierre', 500);
  return (data?.[0] as { created_at?: string } | undefined)?.created_at ?? null;
}
