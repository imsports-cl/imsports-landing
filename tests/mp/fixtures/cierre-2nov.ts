/**
 * Pichanga del 2-nov, como la repasó Barham: pagaron Alan, Spid, Diego,
 * Gonga, Boris, Talo y Thomas. No pagaron Chino, Chipi, Esteban y Gonzalo.
 * El orden del arreglo es el de la tabla del panel.
 */
import type { TitularCierre } from '../../../lib/cierre/mensaje';

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
