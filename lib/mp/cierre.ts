/**
 * CIERRE DE PAGO de una pichanga. Módulo puro.
 *
 * Regla (Barham, 20-oct-2026): un pago que llega DESPUÉS del cierre NO levanta
 * la sanción. Se muestra como «pagó tarde» (distinto de «pagó» y «no pagó») y
 * el panel nunca quita ni perdona sanciones por su cuenta.
 *
 * ¿Qué es el cierre? En la BD no hay columna de plazo de pago (payment_deadline,
 * closes_at, etc.). La regla de las 13:00 (sancionar_si_se_baja_tarde) es para
 * BAJARSE, no para pagar. El cierre de pago es el momento en que el admin
 * CIERRA el partido en la app: la app inserta en group_messages un mensaje
 * system con metadata.kind = 'match_closed' («🏆 Partido cerrado … Pierden cupo
 * … por no pago»), que es justamente donde se anuncian las sanciones por no pago.
 * Se usa el PRIMERO de esos mensajes del partido (si se re-cierra, manda el original).
 *   Ej. 19-oct: cerrado el 20-oct 10:43:40 CLT; Robert pagó 10:44 → pagó tarde.
 *
 * Si el partido todavía no se cierra, el cierre está pendiente: nadie paga tarde.
 * Si el partido figura cerrado/completado pero no hay mensaje match_closed
 * (cierre hecho por otra vía), se usa CIERRE_SIN_EVENTO = inicio del partido
 * (fecha + hora en America/Santiago): conservador, marca tarde y no perdona.
 *
 * Borde: un pago aprobado EXACTAMENTE en el instante del cierre cuenta a tiempo
 * (tarde = estrictamente después). Se comparan instantes, no textos: MP devuelve
 * fechas en -04:00 y Chile está en -03:00 en verano.
 */
import { santiagoAUtc } from './tiempo';

export type FuenteCierre = 'match_closed' | 'inicio_partido' | 'pendiente';

export interface CierrePago {
  /** Instante del cierre (ISO UTC) o null si todavía no se cierra */
  en: string | null;
  fuente: FuenteCierre;
}

/** Default documentado cuando el partido está cerrado pero no hay evento match_closed. */
export const CIERRE_SIN_EVENTO = 'inicio_partido' as const;

const CERRADO = (phase: string | null, status: string | null) => phase === 'closed' || status === 'completed';

/**
 * Cierre de pago de un partido.
 * @param eventoCerrado created_at del primer mensaje match_closed del partido (o null)
 */
export function cierrePago(
  m: { date: string; time: string | null; phase: string | null; status: string | null },
  eventoCerrado: string | null,
): CierrePago {
  if (eventoCerrado && !Number.isNaN(Date.parse(eventoCerrado))) {
    return { en: new Date(eventoCerrado).toISOString(), fuente: 'match_closed' };
  }
  if (CERRADO(m.phase, m.status)) {
    return { en: santiagoAUtc(m.date.slice(0, 10), m.time).toISOString(), fuente: CIERRE_SIN_EVENTO };
  }
  return { en: null, fuente: 'pendiente' };
}

/** ¿El pago llegó después del cierre? Estrictamente después; sin cierre → no. */
export function esPagoTarde(fechaPago: string, cierre: Date | string | null | undefined): boolean {
  if (!cierre) return false;
  const c = typeof cierre === 'string' ? Date.parse(cierre) : cierre.getTime();
  const p = Date.parse(fechaPago);
  if (Number.isNaN(c) || Number.isNaN(p)) return false;
  return p > c;
}

/** "lun 20-oct 10:44" en hora de Chile (CLT/CLST según la fecha) */
export function fechaHoraClt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago', hourCycle: 'h23', weekday: 'short',
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => (p.find((x) => x.type === t)?.value || '').replace('.', '');
  return `${g('weekday')} ${g('day')}-${g('month')} ${g('hour')}:${g('minute')}`;
}
