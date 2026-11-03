/**
 * Sanción por no pago que dura hasta que el jugador pague (041).
 * Apagado por defecto: SANCION_HASTA_PAGAR no está en el entorno.
 * No crea tablas: las RPC y player_debts viven en la migración, que no se aplica acá.
 */
import { identificarPago, type AliasPagador, type Titular } from './cruce';
import type { PagoMp } from './pagos-mp';
import { isoSantiago } from './tiempo';

export function sancionHastaPagarActiva(env?: { SANCION_HASTA_PAGAR?: string }): boolean {
  const v = env ? env.SANCION_HASTA_PAGAR : process.env.SANCION_HASTA_PAGAR;
  return v === '1' || v === 'true';
}

/** Solo un no_pagado, y solo después del pitazo. Pagó tarde ya pagó: no hay deuda. */
export function debeRegistrarDeuda(p: { activa: boolean; estado: string | null; partidoEmpezo: boolean }): boolean {
  return p.activa && p.partidoEmpezo && p.estado === 'no_pagado';
}

/**
 * Búsqueda de conciliación: desde el día del partido impago más antiguo
 * hasta ahora. No recorta a DIAS_VENTANA (5 días).
 */
export function ventanaConciliacion(fechas: string[], ahora: Date): { desde: string; hasta: string } {
  const desde = fechas.map((f) => f.slice(0, 10)).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort()[0];
  if (!desde) throw new Error('sin fecha de deuda');
  return {
    desde: isoSantiago(new Date(`${desde}T00:00:00.000Z`)),
    hasta: isoSantiago(ahora),
  };
}

export interface DeudaPago {
  id: string;
  user_id: string;
  nombre: string;
  /** YYYY-MM-DD del partido impago. */
  fecha: string;
  status: 'activa' | 'saldada' | 'condonada';
  mp_payment_id?: string | null;
}

export interface PagoParaDeuda {
  id: string;
  /** ISO de date_approved. */
  fecha: string;
  pago: PagoMp;
}

/**
 * Asigna pagos a deudas activas, de la más antigua a la más nueva.
 * Un mp_payment_id salda como mucho una deuda. El pago tiene que ser
 * de ese jugador (alias, correo o nombre) y no anterior al partido impago.
 */
export function asignarPagosADeudas(input: {
  deudas: DeudaPago[];
  pagos: PagoParaDeuda[];
  perfiles: Titular[];
  aliases?: AliasPagador[];
}): { debtId: string; userId: string; paymentId: string; settledAt: string }[] {
  const usados = new Set<string>();
  for (const d of input.deudas) if (d.mp_payment_id) usados.add(d.mp_payment_id);
  const pagos = [...input.pagos].sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha) || a.id.localeCompare(b.id));
  const deudas = input.deudas.filter((d) => d.status === 'activa').sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
  const porId = new Map(input.perfiles.map((t) => [t.user_id, t]));
  const out: { debtId: string; userId: string; paymentId: string; settledAt: string }[] = [];
  for (const d of deudas) {
    const perfil = porId.get(d.user_id) || {
      user_id: d.user_id, nombre: d.nombre, display_name: d.nombre, nickname: d.nombre, email: null,
    };
    const desde = Date.parse(`${d.fecha.slice(0, 10)}T00:00:00.000Z`);
    const pago = pagos.find((p) => {
      if (usados.has(p.id)) return false;
      if (Date.parse(p.fecha) < desde) return false;
      const idn = identificarPago([perfil], p.pago, input.aliases || []);
      return idn.tipo === 'unico' && idn.userId === d.user_id;
    });
    if (!pago) continue;
    usados.add(pago.id);
    out.push({ debtId: d.id, userId: d.user_id, paymentId: pago.id, settledAt: pago.fecha });
  }
  return out;
}
