/**
 * Espejo de la validación de public.registrar_cierre_sanciones
 * en imsports-app, migración 043, líneas 109-117.
 *
 * Con status 'applied' el SQL recorre el arreglo y, si una fila no trae
 * user_id o `pagado` boolean, hace
 *   RAISE EXCEPTION 'cada titular necesita user_id y pagado' USING ERRCODE = 'P0001'.
 * Otros status no entran a ese loop.
 *
 * El CHECK de status de la 043 es applied | skipped_incomplete | alert.
 * 'processing' no pasa ese CHECK. Hace falta una 044, sin aplicar acá:
 *
 *   ALTER TABLE public.cierre_sanciones DROP CONSTRAINT IF EXISTS cierre_sanciones_status_check;
 *   ALTER TABLE public.cierre_sanciones ADD CONSTRAINT cierre_sanciones_status_check
 *     CHECK (status IN ('processing', 'applied', 'skipped_incomplete', 'alert'));
 *
 *   Y en registrar_cierre_sanciones, aceptar p_status = 'processing'
 *   sin entrar al loop de pagado (ese loop sigue solo para 'applied').
 */
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
