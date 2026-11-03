/**
 * Arma el mensaje de cierre con lecturas que el panel ya usa.
 * Solo lectura. El +28 de la banca es texto: en la base lo calcula
 * admin_lineup cuando el partido queda completado.
 * Si admin_lineup o la banca fallan, no se inventa «Nadie».
 */
import 'server-only';
import { supabase } from '../supabase';
import { sinCierrePago } from '../mp/cierre';
import { santiagoAUtc } from '../mp/tiempo';
import { fechasPendientesDeLineup, type FechasPendientes } from './fechas';
import {
  mensajeCierre,
  type BancaCierre,
  type CupoAsegurado,
  type TitularCierre,
} from './mensaje';

export async function mensajeDePagos(
  estado: {
    configurado: boolean;
    historial_incompleto?: boolean;
    mp_incompleto?: boolean;
    partido: { id: string; fecha: string; hora: string | null; cierre?: { en?: string | null; fuente?: string } | null };
    titulares: TitularCierre[];
  },
  groupId: string,
  extra?: { deudas?: { user_id: string; nombre: string; fecha: string }[]; sancionHastaPagar?: boolean },
) {
  const cupos: CupoAsegurado[] = [];
  const banca: BancaCierre[] = [];
  let fechasPendientes: FechasPendientes[] = [];
  let cuposDisponibles = true;
  try {
    const [lineup, confs, partido, members, sanciones] = await Promise.all([
      supabase.rpc('admin_lineup', { p_group_id: groupId, p_match_id: estado.partido.id, p_cupos: 12 }),
      supabase.from('match_confirmations')
        .select('user_id, responded_at, user:users(display_name)')
        .eq('match_id', estado.partido.id)
        .eq('status', 'confirmed')
        .eq('is_starter', false)
        .order('responded_at', { ascending: true }),
      supabase.from('matches').select('starters_announced_at').eq('id', estado.partido.id).maybeSingle(),
      supabase.from('group_members').select('user_id, nickname').eq('group_id', groupId),
      supabase.from('player_sanctions').select('user_id')
        .eq('group_id', groupId)
        .eq('applies_to', estado.partido.fecha),
    ]);
    if (lineup.error || confs.error || partido.error || sanciones.error) {
      cuposDisponibles = false;
      console.error('[admin/pagos] cupos', lineup.error?.code || confs.error?.code || partido.error?.code || sanciones.error?.code || 'error');
    } else {
      fechasPendientes = fechasPendientesDeLineup(lineup.data);
      const rows = ((lineup.data as { cupos_asegurados?: { user_id?: string; nombre?: string; hasta?: string; manual?: boolean; es_mvp?: boolean; es_organizador?: boolean }[] } | null)?.cupos_asegurados) || [];
      for (const r of rows) {
        if (!r.user_id || !r.hasta) continue;
        cupos.push({
          user_id: r.user_id,
          nombre: r.nombre || 'Jugador',
          hasta: String(r.hasta).slice(0, 10),
          manual: Boolean(r.manual),
          es_mvp: Boolean(r.es_mvp),
          es_organizador: Boolean(r.es_organizador),
        });
      }
      const nick = new Map<string, string>();
      for (const m of members.data || []) {
        const row = m as { user_id: string; nickname: string | null };
        if (row.nickname) nick.set(row.user_id, row.nickname);
      }
      const anunciado = partido.data?.starters_announced_at ? Date.parse(partido.data.starters_announced_at) : NaN;
      const sancionados = new Set((sanciones.data || []).map((s) => (s as { user_id: string }).user_id));
      for (const c of confs.data || []) {
        const row = c as { user_id: string; responded_at: string | null; user?: { display_name?: string | null } | null };
        const respondio = row.responded_at ? Date.parse(row.responded_at) : NaN;
        banca.push({
          user_id: row.user_id,
          nombre: nick.get(row.user_id) || row.user?.display_name || 'Jugador',
          responded_at: row.responded_at || '',
          confirmo_tarde: Number.isFinite(anunciado) && Number.isFinite(respondio) && respondio > anunciado,
          sancionado: sancionados.has(row.user_id),
        });
      }
    }
  } catch (e) {
    cuposDisponibles = false;
    console.error('[admin/pagos] mensaje cierre', (e as { message?: string })?.message ?? 'error');
  }
  const partidoEmpezo = santiagoAUtc(estado.partido.fecha, estado.partido.hora).getTime() <= Date.now();
  const listo = mensajeCierre({
    titulares: estado.titulares,
    cupos,
    banca,
    fechaPartido: estado.partido.fecha,
    configurado: estado.configurado,
    historialIncompleto: estado.historial_incompleto,
    mpIncompleto: estado.mp_incompleto,
    partidoEmpezo,
    cuposDisponibles,
    deudas: extra?.deudas,
    fechasPendientes: extra?.sancionHastaPagar ? fechasPendientes : [],
    sancionHastaPagar: extra?.sancionHastaPagar,
  });
  return {
    mensaje_cierre: listo.texto,
    mensaje_cierre_bloqueado: listo.bloqueado,
    mensaje_cierre_aviso: listo.aviso,
    bloqueo: listo.bloqueo,
    sin_cierre: sinCierrePago(estado.partido.cierre),
    fechas_pendientes: extra?.sancionHastaPagar ? fechasPendientes : [],
  };
}
