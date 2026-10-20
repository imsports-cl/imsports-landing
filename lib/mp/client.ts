/**
 * Cliente MercadoPago SOLO LECTURA. Server-only.
 *
 * El token (MP_ACCESS_TOKEN, sin prefijo NEXT_PUBLIC_) también sirve para
 * cobrar y devolver plata, así que este módulo solo permite dos llamadas:
 *   GET /v1/payments/search
 *   GET /v1/payments/{id}
 * Cualquier otro método o ruta se rechaza antes de salir a la red.
 * El token nunca se loguea ni se incluye en mensajes de error.
 */
import 'server-only';
import type { PagoMpRaw } from './pagos-mp';

const MP_API = 'https://api.mercadopago.com';
const RUTAS_PERMITIDAS = [/^\/v1\/payments\/search$/, /^\/v1\/payments\/\d{1,20}$/];
const LIMITE_PAGINA = 100;
const MAX_PAGINAS = 30; // tope de seguridad: 3.000 pagos por ventana

export class MpNoConfigurado extends Error {
  constructor() { super('MercadoPago no está configurado (falta MP_ACCESS_TOKEN)'); }
}
export class MpError extends Error {
  constructor(public status: number) { super(`MercadoPago respondió ${status}`); }
}

export interface MpOpciones {
  /** Para tests. Por defecto process.env.MP_ACCESS_TOKEN */
  token?: string;
  /** Para tests. Por defecto fetch global */
  fetchImpl?: typeof fetch;
}

export function mpConfigurado(): boolean {
  return Boolean(process.env.MP_ACCESS_TOKEN);
}

async function mpGet(path: string, params: Record<string, string>, op: MpOpciones = {}) {
  if (!RUTAS_PERMITIDAS.some((r) => r.test(path))) {
    throw new Error('Ruta de MercadoPago no permitida (solo lectura de pagos)');
  }
  const token = op.token ?? process.env.MP_ACCESS_TOKEN;
  if (!token) throw new MpNoConfigurado();
  const url = new URL(MP_API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const f = op.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    } as RequestInit);
  } catch {
    // No propagar el error original: podría arrastrar headers.
    throw new MpError(0);
  }
  if (!res.ok) throw new MpError(res.status);
  return res.json();
}

/** Pagos APROBADOS en la ventana (por fecha de aprobación), todas las páginas. */
export async function buscarPagosAprobados(desdeIso: string, hastaIso: string, op: MpOpciones = {}): Promise<PagoMpRaw[]> {
  const out: PagoMpRaw[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const offset = pagina * LIMITE_PAGINA;
    const j = await mpGet('/v1/payments/search', {
      status: 'approved',
      range: 'date_approved',
      begin_date: desdeIso,
      end_date: hastaIso,
      sort: 'date_approved',
      criteria: 'asc',
      limit: String(LIMITE_PAGINA),
      offset: String(offset),
    }, op);
    const res: PagoMpRaw[] = Array.isArray(j?.results) ? j.results : [];
    out.push(...res);
    const total = Number(j?.paging?.total ?? 0);
    if (res.length < LIMITE_PAGINA || offset + res.length >= total) break;
  }
  return out;
}

/** Un pago por id (para mapear un pagador sin mandar su correo al navegador). */
export async function obtenerPago(id: string, op: MpOpciones = {}): Promise<PagoMpRaw> {
  if (!/^\d{1,20}$/.test(id)) throw new Error('id de pago inválido');
  return mpGet(`/v1/payments/${id}`, {}, op);
}
