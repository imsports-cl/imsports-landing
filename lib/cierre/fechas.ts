/**
 * Fechas de sanción que ya se ganaron por no pagar (opción A).
 * Cada pichanga impaga al cierre suma una. Se cumplen aunque después pague.
 * Si sigue debiendo, después de cumplirlas sigue sancionado hasta que pague.
 * El número lo calcula admin_lineup (campo fechas_pendientes). Acá no se borra.
 */

export interface FechasPendientes {
  user_id: string;
  nombre: string;
  fechas: number;
}

export function textoFechasPendientes(n: number): string {
  const x = Math.floor(n);
  if (x === 1) return '1 fecha de sanción pendiente';
  return `${x} fechas de sanción pendientes`;
}

/** Marcar pagado salda la deuda y deja las fechas pendientes. */
export const CONFIRMACION_MARCAR_PAGADO =
  '¿Marcar la deuda como pagada?\n\n' +
  'Se salda la deuda. Las fechas de sanción pendientes no se borran: se cumplen igual aunque pague. ' +
  'Si no paga, después de cumplirlas sigue sancionado hasta que pague.';

/** Lee fechas_pendientes de cada jugador (y de sanciones) del JSON de admin_lineup. */
export function fechasPendientesDeLineup(data: unknown): FechasPendientes[] {
  const root = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const porId = new Map<string, FechasPendientes>();
  const tomar = (row: unknown) => {
    if (!row || typeof row !== 'object') return;
    const r = row as Record<string, unknown>;
    const userId = typeof r.user_id === 'string' ? r.user_id : '';
    const fechas = Number(r.fechas_pendientes);
    if (!userId || !Number.isFinite(fechas) || fechas <= 0) return;
    const nombre = typeof r.nombre === 'string' && r.nombre.trim() ? r.nombre : 'Jugador';
    const prev = porId.get(userId);
    const n = Math.floor(fechas);
    if (!prev || n > prev.fechas) porId.set(userId, { user_id: userId, nombre, fechas: n });
  };
  for (const lista of [root.jugadores, root.sanciones]) {
    if (!Array.isArray(lista)) continue;
    for (const row of lista) tomar(row);
  }
  return [...porId.values()];
}
