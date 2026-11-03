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
 * Si no hay mensaje match_closed, no hay corte de «tarde»: no se usa el pitazo
 * como reemplazo. Cualquier pago encontrado cuenta a tiempo («mientras no se
 * cierre no es tarde»). Vale igual para la sanción y para el mensaje de cierre.
 *
 * Borde: un pago aprobado EXACTAMENTE en el instante del cierre cuenta a tiempo
 * (tarde = estrictamente después). Se comparan instantes, no textos: MP devuelve
 * fechas en -04:00 y Chile está en -03:00 en verano.
 */
export type FuenteCierre = 'match_closed' | 'inicio_partido' | 'pendiente';

export interface CierrePago {
  /** Instante del cierre (ISO UTC) o null si todavía no se cierra */
  en: string | null;
  fuente: FuenteCierre;
}

/**
 * Cierre de pago de un partido.
 * @param eventoCerrado created_at del primer mensaje match_closed del partido (o null)
 */
export function cierrePago(
  _m: { date: string; time: string | null; phase: string | null; status: string | null },
  eventoCerrado: string | null,
): CierrePago {
  if (eventoCerrado && !Number.isNaN(Date.parse(eventoCerrado))) {
    return { en: new Date(eventoCerrado).toISOString(), fuente: 'match_closed' };
  }
  return { en: null, fuente: 'pendiente' };
}

/** No hay mensaje match_closed: ningún pago cuenta como tarde. */
export function sinCierrePago(cierre: { en?: string | null; fuente?: string } | null | undefined): boolean {
  return !cierre?.en || cierre.fuente !== 'match_closed';
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
