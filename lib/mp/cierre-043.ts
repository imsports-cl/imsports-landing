/**
 * Espejo de la validación de public.registrar_cierre_sanciones
 * en imsports-app, migración 043, líneas 109-117.
 *
 * Con status 'applied' el SQL recorre el arreglo y, si una fila no trae
 * user_id o `pagado` boolean, hace
 *   RAISE EXCEPTION 'cada titular necesita user_id y pagado' USING ERRCODE = 'P0001'.
 * Otros status no entran a ese loop.
 *
 * El CHECK de la 043 se llama ck_cierre_sanciones_status.
 * La 044 (imsports-app PR #24, SHA 5edcf93, rama cursor/cierre-sanciones-processing-0790)
 * lo amplía a processing | applied | skipped_incomplete | alert.
 * registrar_cierre_sanciones retoma processing de más de 10 min, alert y skipped_incomplete.
 * Un applied es inmutable. actualizar_cierre_sanciones valida el lease con p_claimed_at.
 */

/** La 044 retoma un processing cuyo processed_at tiene más de 10 minutos. */
export const MINUTOS_LEASE_044 = 10;
/** Estados que el CHECK de la 043 acepta hoy. `processing` no está. */
export const ESTADOS_CIERRE_043 = ['applied', 'skipped_incomplete', 'alert'] as const;

export class ErrorCierre043 extends Error {
  code = 'P0001';
  constructor(message = 'cada titular necesita user_id y pagado') {
    super(message);
  }
}

/**
 * Misma regla que 043:109-117. Lanza ErrorCierre043 (P0001) si un applied
 * no trae, en cada fila, user_id no vacío y pagado boolean.
 */
export function validarSnapshotCierre043(status: string, snapshot: unknown): void {
  if (status !== 'applied') return;
  if (!Array.isArray(snapshot)) throw new ErrorCierre043();
  for (const row of snapshot) {
    if (!row || typeof row !== 'object') throw new ErrorCierre043();
    const userId = (row as { user_id?: unknown }).user_id;
    const pagado = (row as { pagado?: unknown }).pagado;
    if (typeof userId !== 'string' || userId.trim() === '') throw new ErrorCierre043();
    if (typeof pagado !== 'boolean') throw new ErrorCierre043();
  }
}

export function estadoPermitido043(status: string): boolean {
  return (ESTADOS_CIERRE_043 as readonly string[]).includes(status);
}
