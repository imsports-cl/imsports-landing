import { ErrorPagos } from './servicio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esIdPartido(id: string): boolean {
  return UUID.test(id);
}

/** Un match_id que no es uuid revienta Postgres (22P02) y el API lo devolvía 500. */
export function exigirMatchId(id: string): void {
  if (!esIdPartido(id)) throw new ErrorPagos('match_id inválido', 400);
}
