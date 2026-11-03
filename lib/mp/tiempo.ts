/**
 * Horas de la pichanga en America/Santiago → UTC. Módulo puro.
 *
 * matches.date es un timestamp cuyo DÍA en UTC es el día real (la app guarda
 * 00:00Z) y matches.time es texto "HH:MM" en hora de Chile.
 *
 * Ventana de UNA pichanga, intervalo semiabierto [convocatoria, pitazo + 5 días).
 * No se recorta con la pichanga siguiente: el estado no cambia porque después
 * se convoque o se cree otro partido. Si dos ventanas se pisan, el servicio
 * asigna el pago a la más antigua que ese jugador todavía no tiene pagada
 * y el panel marca solapa.
 *   - desde = primer mensaje match_convocatoria; si falta, matches.created_at.
 *     Si ese instante es posterior al pitazo (partidos importados), se acota
 *     al pitazo.
 *   - fin = pitazo + 5 días (exclusivo). hasta = min(fin, ahora), para mostrar.
 * Un pago fuera de [desde, fin) no se asigna: se muestra «fuera de ventana».
 * «Pagó tarde» sigue siendo el cierre, no el pitazo.
 */
const TZ = 'America/Santiago';

/** Offset (minutos) de Santiago respecto de UTC en ese instante. Ej: -180. */
function offsetMin(utcMs: number): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const local = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return Math.round((local - utcMs) / 60000);
}

/** "2026-10-19" + "20:00" (hora de Chile) → Date en UTC */
export function santiagoAUtc(ymd: string, hhmm?: string | null): Date {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const hm = /^(\d{1,2}):(\d{2})/.exec(hhmm || '') || [];
  const h = Number(hm[1] ?? 0);
  const mi = Number(hm[2] ?? 0);
  const comoUtc = Date.UTC(y, m - 1, d, h, mi);
  let utc = comoUtc - offsetMin(comoUtc) * 60000;
  utc = comoUtc - offsetMin(utc) * 60000; // segunda pasada por si cae en cambio de hora
  return new Date(utc);
}

/** ISO con el offset de Chile: 2026-10-19T20:00:00.000-03:00 (formato que pide MP) */
export function isoSantiago(d: Date): string {
  const off = offsetMin(d.getTime());
  const local = new Date(d.getTime() + off * 60000);
  const sign = off <= 0 ? '-' : '+';
  const a = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, '0');
  return local.toISOString().replace('Z', '') + `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export const DIAS_VENTANA = 5;

export interface VentanaOpts {
  /**
   * Instante de la convocatoria: primer mensaje match_convocatoria, o
   * matches.created_at si no hay mensaje. null = sin dato (se usa el pitazo).
   */
  convocatoria?: Date | string | null;
}

function instante(v: Date | string | null | undefined): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Ventana de una pichanga. [desde, fin) semiabierto: el instante pitazo+5d
 * no entra. No mira otras pichangas. solapa lo calcula el servicio.
 * hasta es el fin visible: min(fin, ahora).
 */
export function ventanaPagos(
  matchDate: string,
  matchTime: string | null,
  ahora: Date,
  opts?: VentanaOpts,
) {
  const inicio = santiagoAUtc(matchDate.slice(0, 10), matchTime);
  const fin = new Date(inicio.getTime() + DIAS_VENTANA * 86400000);
  const conv = instante(opts?.convocatoria);
  // Posterior al pitazo (imports): no abrir la ventana después del partido.
  const desde = conv && conv.getTime() < inicio.getTime() ? conv : inicio;
  const hasta = fin.getTime() > ahora.getTime() ? ahora : fin;
  return { desde, fin, hasta, cerrada: fin.getTime() <= ahora.getTime(), solapa: false };
}

/**
 * Hora de Chile "HH:MM" (24 h) de un instante ISO. Para «Última revisión: 13:45».
 * Pura y sin dependencias de servidor: la usa también el panel (cliente).
 */
export function horaClt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${g('hour')}:${g('minute')}`;
}
