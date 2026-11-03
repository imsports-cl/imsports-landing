/**
 * Texto de WhatsApp para cerrar una pichanga. Función pura: no lee la base
 * ni Mercado Pago.
 *
 * «Pierde cupo por no pago» son los titulares que el panel no marca «pagó»
 * a tiempo (`pagado`). «Pagó tarde» tampoco cuenta: pagar después del cierre
 * no levanta la sanción, igual que en el panel.
 *
 * «Asegura cupo hasta» junta dos cosas, agrupadas por la fecha misma
 * (no por partidos que todavía no existen):
 * - Quien quedó en la banca hoy (confirmado, is_starter false, y no
 *   confirmo_tarde si EXCLUIR_BANCA_CONFIRMO_TARDE) asegura hasta
 *   esta fecha + 28 días solo si no tenía un cupo todavía vigente.
 *   Si lo tenía, no se corre la fecha: se conserva la original. El cupo
 *   no se gasta por haber quedado en la banca.
 * - Quien está en «Pierde cupo» (neteo) pierde el cupo asegurado, manual
 *   o automático. Organizador y MVP de un solo partido no se tocan.
 * Cada jugador sale una vez, en la fecha más tardía. Nadie solo si los
 * datos cargaron y el conjunto está vacío.
 */

import { rechazoSancionNoPago } from '../mp/servicio';

export type EstadoPagoCierre = 'pagado' | 'pagado_tarde' | 'no_pagado';

/** La banca que confirmó después del anuncio no asegura. Una sola llave, por si Barham la da vuelta. */
export const EXCLUIR_BANCA_CONFIRMO_TARDE = true;
/** Cuatro fechas semanales. */
export const DIAS_CUPO_BANCA = 28;

export interface TitularCierre {
  user_id?: string;
  nombre: string;
  estado: EstadoPagoCierre;
  /** Pago en solape u otra duda: el botón de sanción responde 409. */
  solape?: boolean;
}

/** Confirmado y no titular. El orden es responded_at. */
export interface BancaCierre {
  user_id: string;
  nombre: string;
  responded_at: string;
  confirmo_tarde?: boolean;
  /** Sanción de esta misma fecha (player_sanctions.applies_to). No genera +28. */
  sancionado?: boolean;
}

export type BloqueoMensaje =
  | 'historial_incompleto'
  | 'mp_no_configurado'
  | 'mp_incompleto'
  | 'cupos_no_disponibles'
  | 'sin_certeza'
  | null;

export interface CupoAsegurado {
  user_id: string;
  nombre: string;
  /** YYYY-MM-DD. Hasta qué día (inclusive) le dura el cupo. */
  hasta: string;
  /** guaranteed_spots.until_date. No se pierde por quedar en la banca. */
  manual?: boolean;
  /** Cupo de un solo partido (organizador o MVP). No se alarga ni se borra. */
  es_organizador?: boolean;
  es_mvp?: boolean;
}

export interface FechaFutura {
  /** YYYY-MM-DD del partido, el día real guardado en matches.date. */
  fecha: string;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Día de calendario. Un ISO con hora se lee en America/Santiago (23:30 CLT no cambia de día). */
export function fechaMensaje(fecha: string): string {
  const dia = diaCalendario(fecha);
  const [, m, d] = dia.split('-').map(Number);
  return `${d} de ${MESES[m - 1]}`;
}

function diaCalendario(fecha: string): string {
  // matches.date es 00:00Z del día real: no se convierte, o Santiago lo corre al día anterior.
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha) || /T00:00:00(?:\.000)?(?:Z|\+00:00)?$/.test(fecha)) return fecha.slice(0, 10);
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(fecha));
  return ymd;
}

export function mensajeCierreBloqueado(v: { historial_incompleto?: boolean; mp_incompleto?: boolean; configurado?: boolean; cuposDisponibles?: boolean }): boolean {
  return Boolean(v.historial_incompleto || v.mp_incompleto || v.configurado === false || v.cuposDisponibles === false);
}

export interface MensajeCierreListo {
  texto: string;
  bloqueado: boolean;
  aviso: string | null;
  bloqueo: BloqueoMensaje;
}

export function mensajeCierre(input: {
  titulares: TitularCierre[];
  cupos: CupoAsegurado[];
  /** Banca de esta pichanga, ya en orden de confirmación. */
  banca?: BancaCierre[];
  futuros?: FechaFutura[];
  /** YYYY-MM-DD de la pichanga que se cierra. */
  fechaPartido: string;
  configurado?: boolean;
  historialIncompleto?: boolean;
  mpIncompleto?: boolean;
  partidoEmpezo?: boolean;
  /** false si admin_lineup o la banca no se pudieron leer. */
  cuposDisponibles?: boolean;
}): MensajeCierreListo {
  const configurado = input.configurado !== false;
  const historialIncompleto = Boolean(input.historialIncompleto);
  const mpIncompleto = Boolean(input.mpIncompleto);
  const partidoEmpezo = input.partidoEmpezo !== false;
  const cuposDisponibles = input.cuposDisponibles !== false;
  const sancionables = input.titulares.filter((t) => sancionable(t, { configurado, historialIncompleto, partidoEmpezo }));
  const pagosConfiables = configurado && !historialIncompleto && !mpIncompleto && partidoEmpezo;
  const hayDuda = input.titulares.some((t) => t.estado !== 'pagado' && !sancionable(t, { configurado, historialIncompleto, partidoEmpezo }));
  const bloqueo = bloqueoMensaje({ historialIncompleto, configurado, mpIncompleto, cuposDisponibles, partidoEmpezo, hayDuda });
  const aviso = textoBloqueo(bloqueo);
  const lineas = ['Pierde cupo por no pago:'];
  if (sancionables.length) lineas.push(sancionables.map((t) => t.nombre).join(', '));
  else if (pagosConfiables && !hayDuda) lineas.push('Nadie');
  lineas.push('', 'Asegura cupo hasta:');
  const grupos = cuposDisponibles ? gruposAsegura(input) : [];
  if (cuposDisponibles && !grupos.length) lineas.push('Nadie');
  else for (const g of grupos) lineas.push(fechaMensaje(g.fecha), g.nombres.join(', '));
  return { texto: lineas.join('\n'), bloqueado: bloqueo != null, aviso, bloqueo };
}

function sancionable(t: TitularCierre, ctx: { configurado: boolean; historialIncompleto: boolean; partidoEmpezo: boolean }): boolean {
  return rechazoSancionNoPago({
    partidoEmpezo: ctx.partidoEmpezo,
    configurado: ctx.configurado,
    historialIncompleto: ctx.historialIncompleto,
    estado: t.estado,
    sinCerteza: Boolean(t.solape),
    nombre: t.nombre,
  }) == null;
}

function sumarDias(ymd: string, dias: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + dias);
  return t.toISOString().slice(0, 10);
}

function bloqueoMensaje(v: {
  historialIncompleto: boolean;
  configurado: boolean;
  mpIncompleto: boolean;
  cuposDisponibles: boolean;
  partidoEmpezo: boolean;
  hayDuda: boolean;
}): BloqueoMensaje {
  if (v.historialIncompleto) return 'historial_incompleto';
  if (!v.configurado) return 'mp_no_configurado';
  if (v.mpIncompleto) return 'mp_incompleto';
  if (!v.cuposDisponibles) return 'cupos_no_disponibles';
  if (!v.partidoEmpezo || v.hayDuda) return 'sin_certeza';
  return null;
}

export function textoBloqueo(bloqueo: BloqueoMensaje): string | null {
  switch (bloqueo) {
    case 'historial_incompleto': return 'Historial incompleto: no uses este mensaje para sancionar';
    case 'mp_no_configurado': return 'Mercado Pago no está disponible: no uses este mensaje para sancionar';
    case 'mp_incompleto': return 'Mercado Pago incompleto: no uses este mensaje para sancionar';
    case 'cupos_no_disponibles': return 'Cupos no disponibles: no uses este mensaje para sancionar';
    case 'sin_certeza': return 'Hay titulares sin certeza: no uses este mensaje para sancionar';
    default: return null;
  }
}

function gruposAsegura(input: {
  titulares: TitularCierre[];
  cupos: CupoAsegurado[];
  banca?: BancaCierre[];
  fechaPartido: string;
}): { fecha: string; nombres: string[] }[] {
  const hoy = diaCalendario(input.fechaPartido);
  const pierdeId = new Set(input.titulares.filter((t) => t.estado !== 'pagado' && t.user_id).map((t) => t.user_id as string));
  const pierdeNombre = new Set(input.titulares.filter((t) => t.estado !== 'pagado').map((t) => t.nombre));
  const enPierde = (userId: string, nombre: string) => pierdeId.has(userId) || pierdeNombre.has(nombre);
  const previo = new Map<string, CupoAsegurado & { hasta: string; orden: number }>();
  input.cupos.forEach((c, i) => {
    const hasta = diaCalendario(c.hasta);
    const idx = input.titulares.findIndex((t) => t.user_id === c.user_id);
    const orden = idx >= 0 ? idx : input.titulares.length + i;
    const ant = previo.get(c.user_id);
    if (!ant || hasta > ant.hasta) previo.set(c.user_id, { ...c, hasta, orden: ant ? Math.min(ant.orden, orden) : orden });
    else {
      if (c.manual) ant.manual = true;
      if (orden < ant.orden) ant.orden = orden;
    }
  });
  const mejor = new Map<string, { nombre: string; hasta: string; orden: number }>();
  const guardar = (userId: string, nombre: string, hasta: string, orden: number) => {
    if (hasta <= hoy) return;
    const ant = mejor.get(userId);
    if (!ant || hasta > ant.hasta) mejor.set(userId, { nombre, hasta, orden: ant ? Math.min(ant.orden, orden) : orden });
    else if (orden < ant.orden) ant.orden = orden;
  };
  const sancionadoHoy = new Set((input.banca || []).filter((b) => b.sancionado).map((b) => b.user_id));
  for (const [userId, c] of previo) {
    if (enPierde(userId, c.nombre) || sancionadoHoy.has(userId)) continue;
    const unPartido = (c.es_mvp || c.es_organizador) && c.hasta <= hoy && !c.manual;
    if (unPartido) continue;
    guardar(userId, c.nombre, c.hasta, c.orden);
  }
  const banca = [...(input.banca || [])]
    .filter((b) => !(EXCLUIR_BANCA_CONFIRMO_TARDE && b.confirmo_tarde) && !b.sancionado)
    .sort((a, b) => a.responded_at.localeCompare(b.responded_at) || a.nombre.localeCompare(b.nombre, 'es'));
  banca.forEach((b, i) => {
    if (enPierde(b.user_id, b.nombre)) return;
    const tenia = previo.get(b.user_id);
    // Un cupo que vence hoy no está vigente. El MVP en la banca arranca +28;
    // el de organizador de un partido no.
    const mvpVenceHoy = Boolean(tenia && tenia.es_mvp && !tenia.manual && tenia.hasta <= hoy);
    if (tenia && tenia.hasta >= hoy && !mvpVenceHoy) return;
    guardar(b.user_id, b.nombre, sumarDias(hoy, DIAS_CUPO_BANCA), input.titulares.length + i);
  });
  const grupos = new Map<string, { nombre: string; orden: number }[]>();
  for (const [userId, p] of mejor) {
    void userId;
    const lista = grupos.get(p.hasta) ?? [];
    lista.push({ nombre: p.nombre, orden: p.orden });
    grupos.set(p.hasta, lista);
  }
  return [...grupos.keys()].sort().map((fecha) => ({
    fecha,
    nombres: grupos.get(fecha)!.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es')).map((x) => x.nombre),
  }));
}
