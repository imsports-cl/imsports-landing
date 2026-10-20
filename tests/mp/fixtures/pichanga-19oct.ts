/**
 * Fixture ANONIMIZADO de la pichanga del 19-oct-2026
 * (match 3893ee71-b6c6-476d-ac59-2e07c23c281a, Galletas + Ibáñez).
 *
 * Misma estructura que los datos reales (validado contra BD y MercadoPago el
 * 20-oct), pero con apellidos, correos e ids inventados: este repo es público.
 *   - 12 titulares en la BD, incluido el organizador (admin, no paga) → 11 pagan.
 *   - 9 pagos aprobados en la ventana: 7 de $5.000 "Pichanga Conecta",
 *     1 reserva de cancha y 1 money_transfer de $7 (no son de la pichanga).
 *   - 5 pagos traen nombre (en mayúsculas, sin tildes ni ñ, con segundo apellido);
 *     2 no traen nombre y solo calzan por correo.
 *   - Tres Gonzalo titulares: uno pagó (apellido distinto), dos no.
 *   - Dos Alejandro titulares: los dos pagaron.
 * Resultado esperado: 7 de 11 pagaron. Faltan Gonzalo Soto, Chino, Gonzalo y Robert.
 */
import type { Titular } from '../../../lib/mp/cruce';
import type { PagoMpRaw } from '../../../lib/mp/pagos-mp';
import type { Partido } from '../../../lib/mp/servicio';

export const GRUPO = 'g-galletas';
export const MATCH: Partido = {
  id: 'm-19oct', group_id: GRUPO, date: '2026-10-19T00:00:00+00:00', time: '20:00',
  price: 5000, status: 'scheduled', phase: 'voting',
};
export const SIGUIENTE: Partido = { ...MATCH, id: 'm-26oct', date: '2026-10-26T00:00:00+00:00', phase: 'created' };
export const ADMIN_EMAIL = 'organizador@example.test';

const t = (user_id: string, nickname: string, display_name: string, email: string): Titular =>
  ({ user_id, nombre: nickname || display_name, nickname, display_name, email });

export const TITULARES: Titular[] = [
  t('u-zlatan', 'Zlatan', 'Barham', ADMIN_EMAIL),                           // admin, no paga
  t('u-spid', 'Spid', 'Pablo Muñoz', 'pablo.munozd@example.test'),            // paga con otro correo
  t('u-esteban', 'Esteban', 'Esteban  Zamora', 'ezamora16@example.test'),    // doble espacio
  t('u-scott', 'Scott', 'Alejandro Bravo', 'a.bravo.l@example.test'),
  t('u-alan', 'Alan', 'Alan Hertz', 'alan@example.test'),
  t('u-thomas', 'Thomas', 'Thomas', 'tomasprieto89@example.test'),          // sin apellido en la app
  t('u-chipi', 'Chipi', 'Alejandro', 'alejandrocortes83@example.test'),     // sin apellido en la app
  t('u-gonga', 'Gonga', 'Gonzalo Gálvez', 'gonga11@example.test'),
  t('u-gsoto', 'Gonzalo Soto', 'Gonzalo Soto', 'gonzalo.soto1989@example.test'),
  t('u-chino', 'Chino', 'Francisco', 'fvera11@example.test'),
  t('u-gonzalo', 'Gonzalo', 'Gonzalo', 'gonzalomoya@example.test'),
  t('u-robert', 'Robert', 'Roberto Mella', 'roberto.mella3030@example.test'),
];

const base = { status: 'approved', currency_id: 'CLP', operation_type: 'regular_payment', transaction_amount_refunded: 0 };
const pichanga = (id: number, date_approved: string, payer: PagoMpRaw['payer']): PagoMpRaw => ({
  ...base, id, date_approved, transaction_amount: 5000, description: 'Pichanga Conecta',
  additional_info: { items: [{ title: 'Pichanga Conecta' }] }, payer,
});

/** Lo que devuelve /v1/payments/search para la ventana 19-oct 20:00 → +5 días */
export const PAGOS_RAW: PagoMpRaw[] = [
  { ...base, id: 1001, date_approved: '2026-10-19T19:01:00.000-04:00', transaction_amount: 37800,
    description: 'Reserva Cancha 4 futbolito - Club', payer: null },
  pichanga(1002, '2026-10-19T20:34:01.000-04:00', { id: '9001', email: 'pid.personal@example.test', first_name: 'Pablo', last_name: 'Munoz Diaz' }),
  pichanga(1003, '2026-10-19T22:00:56.000-04:00', { id: '9002', email: 'otro.correo@example.test', first_name: 'ESTEBAN', last_name: 'ZAMORA' }),
  pichanga(1004, '2026-10-19T22:17:01.000-04:00', { id: '9003', email: 'ab.trabajo@example.test', first_name: 'ALEJANDRO', last_name: 'BRAVO' }),
  { ...base, id: 1005, date_approved: '2026-10-19T22:45:52.000-04:00', transaction_amount: 7,
    description: 'partition_payment', operation_type: 'money_transfer', payer: { id: '9100', email: 'x@example.test' } },
  pichanga(1006, '2026-10-19T23:16:15.000-04:00', { id: '9004', email: 'ah.mp@example.test', first_name: 'ALAN', last_name: 'HERTZ' }),
  pichanga(1007, '2026-10-20T06:03:33.000-04:00', { id: '9005', email: 'tomasprieto89@example.test', first_name: null, last_name: null }),
  pichanga(1008, '2026-10-20T06:11:30.000-04:00', { id: '9006', email: 'gg.mp@example.test', first_name: 'GONZALO', last_name: 'GALVEZ' }),
  pichanga(1009, '2026-10-20T08:09:04.000-04:00', { id: '9007', email: 'alejandrocortes83@example.test', first_name: '', last_name: '' }),
];

export const PAGARON = ['u-spid', 'u-esteban', 'u-scott', 'u-alan', 'u-thomas', 'u-chipi', 'u-gonga'];
export const NO_PAGARON = ['u-gsoto', 'u-chino', 'u-gonzalo', 'u-robert'];

/**
 * Cierre de pago real del 19-oct: primer mensaje system match_closed del partido
 * (group_messages.created_at = 2026-10-20 10:43:40 CLT).
 */
export const CIERRE_19OCT = '2026-10-20T13:43:40.127Z';

/** Robert pagó el 20-oct 10:44 CLT (MP lo devuelve en -04:00): después del cierre → «pagó tarde». */
export const PAGO_ROBERT_TARDE: PagoMpRaw = pichanga(1010, '2026-10-20T09:44:10.000-04:00',
  { id: '9008', email: 'rm.pagos@example.test', first_name: 'ROBERTO', last_name: 'MELLA' });
