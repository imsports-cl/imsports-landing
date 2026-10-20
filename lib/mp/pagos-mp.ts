/**
 * Forma mínima de un pago de MercadoPago y su versión normalizada. Módulo puro.
 * El correo y el documento del pagador NUNCA salen de este servidor: al
 * navegador solo va nombre, fecha y monto.
 */
import { hashEmail, normalizarEmail, normalizarNombre } from './normalizar';

export interface PagoMpRaw {
  id: number | string;
  status?: string;
  status_detail?: string;
  date_created?: string;
  date_approved?: string | null;
  transaction_amount?: number;
  transaction_amount_refunded?: number;
  currency_id?: string;
  description?: string | null;
  operation_type?: string;
  payer?: { id?: string | number | null; email?: string | null; first_name?: string | null; last_name?: string | null } | null;
  additional_info?: { payer?: { first_name?: string | null; last_name?: string | null } | null; items?: { title?: string | null }[] | null } | null;
  card?: { cardholder?: { name?: string | null } | null } | null;
  [k: string]: unknown;
}

export interface PagoMp {
  id: string;
  fecha: string;          // ISO date_approved
  monto: number;
  moneda: string;
  descripcion: string;
  /** Nombre visible del pagador (lo mejor que trae MP) */
  pagador: string;
  /** Todos los nombres posibles (payer, additional_info, titular de tarjeta) */
  nombres: string[];
  /** SOLO servidor */
  email: string | null;
  emailHash: string | null;
  payerId: string | null;
  devuelto: number;
}

/** Dominios comunes que no identifican a nadie: se muestran completos. */
const DOMINIOS_COMUNES = new Set(['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'live.com', 'icloud.com', 'me.com', 'msn.com']);

/** "juanperez89@gmail.com" → "ju•••@gmail.com"; "x@empresa.cl" → "x•••@e•••.cl" (para pagos sin nombre) */
export function enmascararEmail(e?: string | null): string | null {
  if (!e || !e.includes('@')) return null;
  const [local, dominio] = e.split('@');
  let dom = dominio;
  if (!DOMINIOS_COMUNES.has(dominio)) {
    const partes = dominio.split('.');
    const tld = partes.length > 1 ? partes.pop() : '';
    dom = `${partes.join('.').slice(0, 1)}•••${tld ? `.${tld}` : ''}`;
  }
  return `${local.slice(0, 2)}•••@${dom}`;
}

const limpio = (...p: (string | null | undefined)[]) => p.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

export function aPagoMp(r: PagoMpRaw): PagoMp {
  const nombres = [
    limpio(r.payer?.first_name, r.payer?.last_name),
    limpio(r.additional_info?.payer?.first_name, r.additional_info?.payer?.last_name),
    limpio(r.card?.cardholder?.name),
  ].filter((n) => n.length > 0);
  const titulo = (r.additional_info?.items || []).map((i) => i?.title || '').join(' ');
  const email = r.payer?.email ? normalizarEmail(r.payer.email) : null;
  return {
    id: String(r.id),
    fecha: r.date_approved || r.date_created || '',
    monto: Number(r.transaction_amount || 0),
    moneda: r.currency_id || '',
    descripcion: limpio(r.description, titulo),
    pagador: nombres[0] || enmascararEmail(email) || 'Sin nombre',
    nombres: Array.from(new Set(nombres)),
    email,
    emailHash: hashEmail(email),
    payerId: r.payer?.id != null && /^\d{1,20}$/.test(String(r.payer.id)) ? String(r.payer.id) : null,
    devuelto: Number(r.transaction_amount_refunded || 0),
  };
}

/**
 * ¿Es un pago de la pichanga? Aprobado, en CLP, no devuelto, y la
 * descripción dice "pichanga" o el monto es el precio del partido.
 */
export function esPagoDePichanga(r: PagoMpRaw, precio: number | null): boolean {
  if (r.status && r.status !== 'approved') return false;
  if (r.currency_id && r.currency_id !== 'CLP') return false;
  if (Number(r.transaction_amount_refunded || 0) > 0) return false;
  const p = aPagoMp(r);
  if (normalizarNombre(p.descripcion).includes('pichanga')) return true;
  return precio != null && precio > 0 && p.monto === precio;
}
