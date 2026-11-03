/**
 * Arma el mensaje de cierre con lecturas que el panel ya usa.
 * Solo lectura: admin_lineup (cupos asegurados) y las pichangas futuras.
 * Si una lectura falla, el texto de «pierde cupo» igual sale y «asegura» queda vacío.
 */
import 'server-only';
import { supabase } from '../supabase';
import { mensajeCierre, mensajeCierreBloqueado, type CupoAsegurado, type FechaFutura, type TitularCierre } from './mensaje';

const FUTUROS_MAX = 60;

export async function mensajeDePagos(
  estado: {
    partido: { id: string; fecha: string };
    titulares: TitularCierre[];
    historial_incompleto?: boolean;
    mp_incompleto?: boolean;
  },
  groupId: string,
) {
  const cupos: CupoAsegurado[] = [];
  const futuros: FechaFutura[] = [];
  try {
    const [lineup, matches] = await Promise.all([
      supabase.rpc('admin_lineup', { p_group_id: groupId, p_match_id: estado.partido.id, p_cupos: 12 }),
      supabase.from('matches').select('id, date')
        .eq('group_id', groupId)
        .gt('date', estado.partido.fecha)
        .neq('status', 'cancelled')
        .order('date', { ascending: true })
        .limit(FUTUROS_MAX),
    ]);
    if (lineup.error) console.error('[admin/pagos] admin_lineup', lineup.error.code ?? 'error');
    else {
      const rows = ((lineup.data as { cupos_asegurados?: { user_id?: string; nombre?: string; hasta?: string }[] } | null)?.cupos_asegurados) || [];
      for (const r of rows) {
        if (!r.user_id || !r.hasta) continue;
        cupos.push({ user_id: r.user_id, nombre: r.nombre || 'Jugador', hasta: String(r.hasta).slice(0, 10) });
      }
    }
    if (matches.error) console.error('[admin/pagos] partidos futuros', matches.error.code ?? 'error');
    else {
      for (const m of matches.data || []) futuros.push({ fecha: String((m as { date: string }).date).slice(0, 10) });
    }
  } catch (e) {
    console.error('[admin/pagos] mensaje cierre', (e as { message?: string })?.message ?? 'error');
  }
  return {
    mensaje_cierre: mensajeCierre({
      titulares: estado.titulares,
      cupos,
      futuros,
      fechaPartido: estado.partido.fecha,
    }),
    mensaje_cierre_bloqueado: mensajeCierreBloqueado(estado),
  };
}
