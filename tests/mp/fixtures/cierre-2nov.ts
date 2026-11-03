/**
 * Pichanga del 2-nov, como la repasó Barham: pagaron Alan, Spid, Diego,
 * Gonga, Boris, Talo y Thomas. No pagaron Chino, Chipi, Esteban y Gonzalo.
 * El orden del arreglo es el de la tabla del panel.
 */
import type { BancaCierre, CupoAsegurado, TitularCierre } from '../../../lib/cierre/mensaje';

const fila = (user_id: string, nombre: string, estado: TitularCierre['estado']): TitularCierre =>
  ({ user_id, nombre, estado });

export const TITULARES_2NOV: TitularCierre[] = [
  fila('u-alan', 'Alan', 'pagado'),
  fila('u-chino', 'Chino', 'no_pagado'),
  fila('u-spid', 'Spid', 'pagado'),
  fila('u-chipi', 'Chipi', 'no_pagado'),
  fila('u-diego', 'Diego', 'pagado'),
  fila('u-gonga', 'Gonga', 'pagado'),
  fila('u-esteban', 'Esteban', 'no_pagado'),
  fila('u-boris', 'Boris', 'pagado'),
  fila('u-talo', 'Talo', 'pagado'),
  fila('u-thomas', 'Thomas', 'pagado'),
  fila('u-gonzalo', 'Gonzalo', 'no_pagado'),
];

/**
 * Cupos de prod al cerrar el 2-nov, sin pichangas creadas después.
 * Esteban y Gonzalo también aseguran hasta el 9-nov, pero pierden cupo
 * por no pago y no deben salir en «Asegura».
 */
export const CUPOS_2NOV: CupoAsegurado[] = [
  { user_id: 'u-esteban', nombre: 'Esteban', hasta: '2026-11-09' },
  { user_id: 'u-gonzalo', nombre: 'Gonzalo', hasta: '2026-11-09' },
  { user_id: 'u-talo', nombre: 'Talo', hasta: '2026-11-09' },
  { user_id: 'u-boris', nombre: 'Boris', hasta: '2026-11-16' },
  { user_id: 'u-chalo', nombre: 'Chalo', hasta: '2026-11-16' },
];

/** Banca del 2-nov, en orden de confirmación. Chalo ya tenía cupo automático. */
export const BANCA_2NOV: BancaCierre[] = [
  { user_id: 'u-chalo', nombre: 'Chalo', responded_at: '2026-11-01T12:00:00.000Z' },
  { user_id: 'u-michel', nombre: 'Michel', responded_at: '2026-11-01T13:00:00.000Z' },
  { user_id: 'u-villa', nombre: 'Villa', responded_at: '2026-11-01T14:00:00.000Z' },
  { user_id: 'u-roberto', nombre: 'Roberto', responded_at: '2026-11-01T15:00:00.000Z' },
];
