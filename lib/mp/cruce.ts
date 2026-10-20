/**
 * Cruce de pagos de MercadoPago con los titulares de una pichanga. Módulo puro.
 *
 * Orden de prioridad para asignar un pago a un jugador:
 *   1. alias manual (pagador de MP → jugador), por id de pagador, hash de correo o nombre
 *   2. correo: igual al de la app, o misma parte local (gmail vs hotmail)
 *   3. nombre: primer nombre + apellido (sin acentos, sin mayúsculas). El apellido
 *      puede venir del nombre en la app o de la parte local del correo
 *      ("juanperez89" → Pérez). NUNCA solo por primer nombre: hay varios Gonzalo.
 * Si un pago calza con más de un titular queda "ambiguo" y se asigna a mano.
 */
import { localEmailLetras, normalizarEmail, normalizarNombre, tokensEmail, tokensNombre } from './normalizar';
import type { PagoMp } from './pagos-mp';
import { esPagoTarde, fechaHoraClt } from './cierre';

export interface Titular {
  user_id: string;
  /** Nombre visible: apodo del grupo o display_name */
  nombre: string;
  display_name: string | null;
  nickname: string | null;
  /** SOLO servidor */
  email: string | null;
}

export interface AliasPagador {
  id?: string;
  user_id: string;
  payer_mp_id: string | null;
  payer_email_sha256: string | null;
  payer_name_norm: string | null;
}

export type Via = 'alias' | 'email' | 'nombre';
export type MotivoSinAsignar = 'sin_coincidencia' | 'ambiguo' | 'duplicado' | 'no_titular';

export interface PagoVisible {
  id: string; fecha: string; monto: number; pagador: string;
  /** Fecha/hora de aprobación en hora de Chile, ya formateada ("mar 20-oct 10:44") */
  fecha_clt: string;
  /** Llegó después del cierre de pago (ver lib/mp/cierre.ts) */
  tarde: boolean;
}

/**
 * pagado       = pagó a tiempo (antes o justo en el cierre)
 * pagado_tarde = pagó DESPUÉS del cierre: NO levanta la sanción
 * no_pagado    = sin pago
 */
export type EstadoPago = 'pagado' | 'pagado_tarde' | 'no_pagado';

export interface FilaTitular {
  user_id: string;
  nombre: string;
  estado: EstadoPago;
  pago: (PagoVisible & { via: Via }) | null;
}

export interface PagoSinAsignar extends PagoVisible {
  motivo: MotivoSinAsignar;
  /** Nombres visibles de los posibles jugadores (ambiguo) o del jugador (duplicado / no_titular) */
  candidatos: string[];
}

export interface ResultadoCruce {
  titulares: FilaTitular[];
  sin_asignar: PagoSinAsignar[];
    /** pagados = a tiempo; pagados_tarde aparte (siguen sancionables); no_pagados = sin pago */
  resumen: { titulares: number; pagados: number; pagados_tarde: number; no_pagados: number; sin_asignar: number; recaudado: number };
  /** Cierre de pago usado (ISO UTC) o null si está pendiente */
  cierre: string | null;
}

interface Perfil {
  t: Titular;
  primeros: Set<string>;   // primer nombre (display_name y apodo si es nombre)
  apellidos: Set<string>;  // resto del display_name + tokens del correo
  localLetras: string;     // parte local del correo, solo letras
  email: string;
}

function perfil(t: Titular): Perfil {
  const dn = tokensNombre(t.display_name);
  const primeros = new Set<string>(dn.slice(0, 1));
  const apellidos = new Set<string>(dn.slice(1));
  const et = tokensEmail(t.email);
  // "juan.soto" → primer token = nombre, el resto apellidos
  if (et.length >= 2) {
    if (primeros.size === 0) primeros.add(et[0]);
    et.slice(1).forEach((x) => { if (x.length >= 3) apellidos.add(x); });
  }
  if (primeros.size === 0) tokensNombre(t.nickname).slice(0, 1).forEach((x) => primeros.add(x));
  return { t, primeros, apellidos, localLetras: localEmailLetras(t.email), email: normalizarEmail(t.email) };
}

/** ¿El nombre del pagador calza con este titular (nombre + apellido)? */
function calzaNombre(p: Perfil, nombrePagador: string): boolean {
  const tk = tokensNombre(nombrePagador);
  if (tk.length < 2) return false; // un nombre solo no alcanza (los Gonzalo)
  const primero = tk.find((x) => p.primeros.has(x));
  if (!primero) return false;
  return tk.some((x) => x !== primero && x.length >= 3 && (
    p.apellidos.has(x) ||
    // apellido escondido en el correo: "juanperez89" contiene "perez"
    (p.localLetras.length > x.length && p.localLetras.includes(x))
  ));
}

/** ¿El correo de MP calza con el de la app? Igual, o misma parte local. */
function calzaEmail(p: Perfil, pago: PagoMp): boolean {
  if (!pago.email || !p.email) return false;
  if (pago.email === p.email) return true;
  const a = localEmailLetras(pago.email);
  return a.length >= 5 && a === p.localLetras;
}

/** ¿El correo de MP trae nombre + apellido del titular? "juan.perez@x" */
function calzaNombreEnEmail(p: Perfil, pago: PagoMp): boolean {
  if (!pago.email) return false;
  const tk = tokensEmail(pago.email);
  if (tk.length >= 2 && calzaNombre(p, tk.join(' '))) return true;
  const letras = localEmailLetras(pago.email);
  for (const pr of p.primeros) {
    if (!letras.startsWith(pr)) continue;
    const resto = letras.slice(pr.length);
    for (const ap of p.apellidos) if (ap.length >= 3 && resto.startsWith(ap)) return true;
  }
  return false;
}

const ORDEN: Record<EstadoPago, number> = { no_pagado: 0, pagado_tarde: 1, pagado: 2 };

export function claveNombre(pagador: string): string | null {
  const n = normalizarNombre(pagador);
  return n.split(' ').filter(Boolean).length >= 2 ? n : null;
}

function aliasDe(pago: PagoMp, aliases: AliasPagador[]): AliasPagador | undefined {
  return aliases.find((a) => a.payer_mp_id && pago.payerId && a.payer_mp_id === pago.payerId)
    || aliases.find((a) => a.payer_email_sha256 && pago.emailHash && a.payer_email_sha256 === pago.emailHash)
    || aliases.find((a) => a.payer_name_norm && pago.nombres.some((n) => claveNombre(n) === a.payer_name_norm));
}

const visible = (p: PagoMp, cierre: Date | string | null): PagoVisible => ({
  id: p.id, fecha: p.fecha, monto: p.monto, pagador: p.pagador,
  fecha_clt: fechaHoraClt(p.fecha), tarde: esPagoTarde(p.fecha, cierre),
});

export function cruzarPagos(
  titulares: Titular[],
  pagos: PagoMp[],
  aliases: AliasPagador[] = [],
  nombreDe: (userId: string) => string | undefined = () => undefined,
  /** Cierre de pago (lib/mp/cierre.ts). null/omitido = pendiente: nadie paga tarde. */
  cierre: Date | string | null = null,
): ResultadoCruce {
  const vis = (p: PagoMp) => visible(p, cierre);
  const perfiles = titulares.map(perfil);
  const porUser = new Map(perfiles.map((p) => [p.t.user_id, p]));
  const asignado = new Map<string, PagoVisible & { via: Via }>();
  const sin: PagoSinAsignar[] = [];

  // Por instante (MP mezcla offsets -04:00/-03:00): si un jugador pagó dos veces, vale el primero.
  const t = (x: PagoMp) => { const n = Date.parse(x.fecha); return Number.isNaN(n) ? Infinity : n; };
  const ordenados = [...pagos].sort((a, b) => t(a) - t(b) || a.id.localeCompare(b.id));
  for (const pago of ordenados) {
    let elegido: Perfil | undefined;
    let via: Via | undefined;

    const al = aliasDe(pago, aliases);
    if (al) {
      elegido = porUser.get(al.user_id);
      via = 'alias';
      if (!elegido) {
        sin.push({ ...vis(pago), motivo: 'no_titular', candidatos: [nombreDe(al.user_id) || 'Jugador'] });
        continue;
      }
    }

    if (!elegido) {
      const porEmail = perfiles.filter((p) => calzaEmail(p, pago));
      if (porEmail.length === 1) { elegido = porEmail[0]; via = 'email'; }
    }

    if (!elegido) {
      const porNombre = perfiles.filter((p) =>
        pago.nombres.some((n) => calzaNombre(p, n)) || calzaNombreEnEmail(p, pago));
      if (porNombre.length === 1) { elegido = porNombre[0]; via = 'nombre'; }
      else if (porNombre.length > 1) {
        sin.push({ ...vis(pago), motivo: 'ambiguo', candidatos: porNombre.map((p) => p.t.nombre) });
        continue;
      }
    }

    if (!elegido || !via) {
      sin.push({ ...vis(pago), motivo: 'sin_coincidencia', candidatos: [] });
      continue;
    }
    if (asignado.has(elegido.t.user_id)) {
      sin.push({ ...vis(pago), motivo: 'duplicado', candidatos: [elegido.t.nombre] });
      continue;
    }
    asignado.set(elegido.t.user_id, { ...vis(pago), via });
  }

  const filas: FilaTitular[] = titulares
    .map((t) => {
      const pago = asignado.get(t.user_id) || null;
      const estado: EstadoPago = !pago ? 'no_pagado' : pago.tarde ? 'pagado_tarde' : 'pagado';
      return { user_id: t.user_id, nombre: t.nombre, estado, pago };
    })
    // primero los que no pagaron, después los que pagaron tarde, al final los al día
    .sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || a.nombre.localeCompare(b.nombre, 'es'));

  const cuenta = (e: EstadoPago) => filas.filter((f) => f.estado === e).length;
  return {
    titulares: filas,
    sin_asignar: sin,
    resumen: {
      titulares: filas.length,
      pagados: cuenta('pagado'),
      pagados_tarde: cuenta('pagado_tarde'),
      no_pagados: cuenta('no_pagado'),
      sin_asignar: sin.length,
      recaudado: pagos.reduce((s, p) => s + p.monto, 0),
    },
    cierre: cierre ? new Date(cierre).toISOString() : null,
  };
}
