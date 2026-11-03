/**
 * Lógica del panel "Pagos": estado de pagos de una pichanga, mapeo manual
 * pagador → jugador y sanción no_pago. Recibe sus dependencias (BD y
 * MercadoPago) por parámetro, así los tests corren con fakes y nunca tocan prod.
 */
import { aPagoMp, esPagoDePichanga, type PagoMpRaw } from './pagos-mp';
import { claveNombre, cruzarPagos, identificarPago, type AliasPagador, type ResultadoCruce, type Titular } from './cruce';
import { DIAS_VENTANA, isoSantiago, santiagoAUtc, ventanaPagos } from './tiempo';
import { normalizarEmail } from './normalizar';
import { cierrePago, type CierrePago } from './cierre';

export interface Partido {
  id: string; group_id: string; date: string; time: string | null;
  price: number | null; status: string | null; phase: string | null;
  /** matches.created_at. Fallback de convocatoria si no hay mensaje. */
  created_at?: string | null;
}
export interface Sancion { user_id: string; applies_to: string; reason: string; note: string | null }

export interface PagosRepo {
  partidosRecientes(groupId: string, limite: number): Promise<Partido[]>;
  partido(matchId: string): Promise<Partido | null>;
  /** Titulares confirmados (is_starter = true), con correo de la app (solo servidor) */
  titulares(match: Partido): Promise<Titular[]>;
  /** Igual que titulares, de varios partidos en una sola lectura. */
  titularesDe(matches: Partido[]): Promise<Record<string, Titular[]>>;
  miembros(groupId: string): Promise<{ user_id: string; nombre: string }[]>;
  aliases(groupId: string): Promise<(AliasPagador & { id: string; payer_label: string | null })[]>;
  /** Fecha (YYYY-MM-DD) del siguiente partido no cancelado del grupo, o null */
  siguienteFecha(match: Partido): Promise<string | null>;
  /**
   * created_at del PRIMER mensaje system 'match_closed' del partido (group_messages),
   * o null. Es el cierre de pago: ver lib/mp/cierre.ts. Solo lectura.
   */
  eventoCierre(match: Partido): Promise<string | null>;
  /**
   * created_at del PRIMER mensaje system 'match_convocatoria' del partido, o null.
   * Es el inicio de la ventana de pagos (ver lib/mp/tiempo.ts). Solo lectura.
   */
  eventoConvocatoria(match: Partido): Promise<string | null>;
  /** Partido anterior no cancelado del mismo grupo (por hora de inicio), o null. */
  partidoAnterior(match: Partido): Promise<Partido | null>;
  /** Partido siguiente no cancelado del mismo grupo (por hora de inicio), o null. */
  partidoSiguiente(match: Partido): Promise<Partido | null>;
  /**
   * Partidos no cancelados con pitazo en [desde, hasta), como mucho `limite`.
   * desde/hasta son ISO. Orden: del más antiguo al más nuevo.
   */
  partidosActivos(groupId: string, desde: string, hasta: string, limite: number): Promise<Partido[]>;
  /** Primer match_convocatoria de esos partidos, ordenado por created_at. */
  convocatorias(groupId: string, matchIds: string[]): Promise<Record<string, string>>;
  sanciones(groupId: string, appliesTo: string): Promise<Sancion[]>;
  /** INSERT simple (sin upsert). Debe lanzar { code: '23505' } si ya existe. */
  insertarSancion(s: Sancion & { group_id: string; created_by: string | null }): Promise<void>;
  guardarAlias(a: Omit<AliasPagador, 'id'> & { group_id: string; payer_label: string; created_by: string | null }): Promise<void>;
  borrarAlias(groupId: string, aliasId: string): Promise<void>;
}

export interface MpLector {
  buscarAprobados(desdeIso: string, hastaIso: string): Promise<PagoMpRaw[]>;
  pago(id: string): Promise<PagoMpRaw>;
}

export interface Deps {
  repo: PagosRepo;
  /** null = MercadoPago no configurado (falta MP_ACCESS_TOKEN) */
  mp: MpLector | null;
  ahora: () => Date;
  /** Correos que no pagan (admin organizador). Se comparan en minúsculas. */
  noPagan: string[];
}

export class ErrorPagos extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const ymd = (d: string) => d.slice(0, 10);

/** Inicio del partido (UTC) a partir de date + time de Chile */
export const inicioPartido = (m: Partido) => santiagoAUtc(ymd(m.date), m.time);

/** Igual que admin_drop_player: siguiente partido no cancelado o fecha + 7 días */
export async function fechaSancion(repo: PagosRepo, m: Partido): Promise<string> {
  const sig = await repo.siguienteFecha(m);
  if (sig) return ymd(sig);
  const d = new Date(`${ymd(m.date)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

async function elegirPartido(deps: Deps, groupId: string, matchId?: string | null) {
  const recientes = await deps.repo.partidosRecientes(groupId, 12);
  if (matchId) {
    const m = await deps.repo.partido(matchId);
    if (!m || m.group_id !== groupId) throw new ErrorPagos('partido no encontrado', 404);
    return { m, recientes };
  }
  // Por defecto: la última pichanga que ya empezó
  const ahora = deps.ahora().getTime();
  const m = recientes.find((p) => p.status !== 'cancelled' && inicioPartido(p).getTime() <= ahora) || recientes[0];
  if (!m) throw new ErrorPagos('el grupo no tiene partidos', 404);
  return { m, recientes };
}

async function titularesQuePagan(deps: Deps, m: Partido): Promise<Titular[]> {
  const no = new Set(deps.noPagan.map(normalizarEmail));
  return (await deps.repo.titulares(m)).filter((t) => !no.has(normalizarEmail(t.email)));
}

/** Convocatoria acotada al pitazo: mensaje, si no created_at, si no el pitazo. */
function convocatoriaAcotada(evento: string | null, createdAt: string | null | undefined, inicio: Date): Date {
  const raw = evento ?? createdAt ?? null;
  if (!raw) return inicio;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime()) || d.getTime() >= inicio.getTime()) return inicio;
  return d;
}

/** Tope de la cadena: 6 partidos o 45 días (el bloque calendario), lo que llegue antes. */
const CADENA_MAX = 6;
const CADENA_DIAS = 45;
const EPOCH_CADENA = Date.UTC(2020, 0, 1);
const DIA_MS = 86400000;
const LIMITE_PARTIDOS = 20;

function bucketDe(inicioMs: number): { desde: number; hasta: number } {
  const n = Math.floor((inicioMs - EPOCH_CADENA) / (CADENA_DIAS * DIA_MS));
  const desde = EPOCH_CADENA + n * CADENA_DIAS * DIA_MS;
  return { desde, hasta: desde + CADENA_DIAS * DIA_MS };
}

interface VentanaLista {
  id: string;
  /** Pitazo (ms). Orden de la cadena: una sola vez. */
  inicio: number;
  desde: number;
  fin: number;
  /** Un partido cancelado no recibe pagos. */
  recibe: boolean;
  titulares: Titular[];
}

/** Ventanas que se tocan: [a,b) y [c,d) con a < d y c < b. */
function seSolapan(a: VentanaLista, b: VentanaLista): boolean {
  return a.desde < b.fin && b.desde < a.fin;
}

/** Misma cadena de ventanas que se solapan, de la más antigua a la más nueva. */
function cadenaSolape(orden: VentanaLista[], id: string): VentanaLista[] {
  const i = orden.findIndex((w) => w.id === id);
  if (i < 0) return [];
  let lo = i;
  let hi = i;
  while (lo > 0 && seSolapan(orden[lo - 1], orden[lo])) lo--;
  while (hi < orden.length - 1 && seSolapan(orden[hi], orden[hi + 1])) hi++;
  return orden.slice(lo, hi + 1);
}

type DestinoPago =
  | { tipo: 'match'; matchId: string; userId: string }
  | { tipo: 'ambiguo'; matchId: string; userIds: string[] }
  | { tipo: 'libre' };

function cmpPago(a: { fecha: string; id: string }, b: { fecha: string; id: string }): number {
  const dt = Date.parse(a.fecha) - Date.parse(b.fecha);
  if (dt) return dt;
  const na = Number(a.id);
  const nb = Number(b.id);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.id.localeCompare(b.id);
}

/**
 * Asignación única para toda la cadena. El resultado de un pago no depende
 * de qué pichanga se esté mirando: cada vista solo lee su parte.
 */
function asignarEnCadena(cadena: VentanaLista[], pagos: { fecha: string; id: string }[], aliases: AliasPagador[], porId: Map<string, ReturnType<typeof aPagoMp>>): Map<string, DestinoPago> {
  const ya = new Map<string, Set<string>>();
  const destinos = new Map<string, DestinoPago>();
  for (const p of [...pagos].sort(cmpPago)) {
    const pago = porId.get(p.id)!;
    const t = Date.parse(pago.fecha);
    if (Number.isNaN(t)) continue;
    let destino: DestinoPago = { tipo: 'libre' };
    for (const w of cadena) {
      if (t < w.desde || t >= w.fin) continue;
      const idn = identificarPago(w.titulares, pago, aliases);
      if (!w.recibe) continue;
      if (idn.tipo === 'ambiguo') { destino = { tipo: 'ambiguo', matchId: w.id, userIds: idn.userIds }; break; }
      if (idn.tipo !== 'unico') continue;
      const tomados = ya.get(w.id) ?? new Set<string>();
      if (tomados.has(idn.userId)) continue;
      tomados.add(idn.userId);
      ya.set(w.id, tomados);
      destino = { tipo: 'match', matchId: w.id, userId: idn.userId };
      break;
    }
    destinos.set(p.id, destino);
  }
  return destinos;
}

function paganDe(deps: Deps, filas: Titular[]): Titular[] {
  const no = new Set(deps.noPagan.map(normalizarEmail));
  return filas.filter((t) => !no.has(normalizarEmail(t.email)));
}

/** Trozo de a lo más 6 partidos. El mismo trozo para cualquiera de sus vistas. */
function acotarCadena(comp: VentanaLista[], id: string, bucketDesde: number): { cadena: VentanaLista[]; borde: boolean } {
  const idx = Math.max(0, comp.findIndex((w) => w.id === id));
  const start = Math.floor(idx / CADENA_MAX) * CADENA_MAX;
  const cadena = comp.slice(start, start + CADENA_MAX);
  const borde = start > 0 || (cadena[0] != null && cadena[0].desde < bucketDesde);
  return { cadena, borde };
}

async function cruce(deps: Deps, m: Partido, tit: Titular[]) {
  const visto = inicioPartido(m).getTime();
  const bucket = bucketDe(visto);
  const [activos, eventoCierre, aliases, miembros] = await Promise.all([
    deps.repo.partidosActivos(m.group_id, new Date(bucket.desde).toISOString(), new Date(bucket.hasta).toISOString(), LIMITE_PARTIDOS),
    deps.repo.eventoCierre(m),
    deps.repo.aliases(m.group_id),
    deps.repo.miembros(m.group_id),
  ]);
  const lista = activos.some((p) => p.id === m.id) ? activos : [...activos, m];
  const convs = await deps.repo.convocatorias(m.group_id, lista.map((p) => p.id));
  const esqueleto: VentanaLista[] = lista.map((p) => {
    const inicio = inicioPartido(p);
    const desde = convocatoriaAcotada(convs[p.id] ?? null, p.created_at, inicio);
    return {
      id: p.id, inicio: inicio.getTime(), desde: desde.getTime(),
      fin: inicio.getTime() + DIAS_VENTANA * 86400000,
      recibe: p.status !== 'cancelled', titulares: [],
    };
  }).sort((a, b) => a.inicio - b.inicio || a.id.localeCompare(b.id));
  const { cadena: trozo, borde } = acotarCadena(cadenaSolape(esqueleto, m.id), m.id, bucket.desde);
  const otros = trozo.filter((w) => w.id !== m.id).map((w) => lista.find((p) => p.id === w.id)).filter((p): p is Partido => Boolean(p));
  const leidos = await deps.repo.titularesDe(otros);
  const titularesPor = new Map<string, Titular[]>([[m.id, tit]]);
  for (const [id, filas] of Object.entries(leidos)) titularesPor.set(id, paganDe(deps, filas));
  const orden = trozo.map((w) => ({ ...w, titulares: titularesPor.get(w.id) || [] }));
  const actual = orden.find((w) => w.id === m.id) || {
    id: m.id, inicio: visto, desde: 0, fin: 0, recibe: m.status !== 'cancelled', titulares: tit,
  };
  const v0 = ventanaPagos(m.date, m.time, deps.ahora(), { convocatoria: convs[m.id] ?? m.created_at ?? null });
  actual.desde = v0.desde.getTime();
  actual.fin = v0.fin.getTime();
  const solapa = orden.some((o) => o.id !== m.id && seSolapan(actual, o));
  const v = { ...v0, solapa };
  const cierre: CierrePago = cierrePago(m, eventoCierre);
  const nombres = new Map(miembros.map((x) => [x.user_id, x.nombre]));
  const sinCerteza = new Set<string>();
  // El partido del borde del tope (había historia más atrás) no se puede sancionar.
  if (borde && orden[0]?.id === m.id) for (const t of tit) sinCerteza.add(t.user_id);
  if (!deps.mp) return { v, cierre, cruce: null as ResultadoCruce | null, sinCerteza, nombres, mpIncompleto: false };

  const buscarDesde = new Date(Math.min(...orden.map((w) => w.desde)));
  const ahora = deps.ahora();
  if (ahora.getTime() <= buscarDesde.getTime()) {
    return { v, cierre, cruce: cruzarPagos(tit, [], aliases, (id) => nombres.get(id), cierre.en), sinCerteza, nombres, mpIncompleto: false };
  }
  const raw = await deps.mp.buscarAprobados(isoSantiago(buscarDesde), isoSantiago(ahora));
  const mpIncompleto = Boolean((raw as { truncado?: boolean }).truncado);
  if (mpIncompleto) for (const t of tit) sinCerteza.add(t.user_id);
  const precio = m.price != null ? Number(m.price) : null;
  const pagos = raw.filter((r) => esPagoDePichanga(r, precio)).map(aPagoMp);
  const porId = new Map(pagos.map((p) => [p.id, p]));
  const destinos = asignarEnCadena(orden, pagos, aliases, porId);
  const asignadosAqui = new Set<string>();
  for (const d of destinos.values()) if (d.tipo === 'match' && d.matchId === m.id) asignadosAqui.add(d.userId);

  const propios: ReturnType<typeof aPagoMp>[] = [];
  const fuera: ReturnType<typeof aPagoMp>[] = [];
  for (const p of pagos) {
    const t = Date.parse(p.fecha);
    if (Number.isNaN(t)) continue;
    const enActual = t >= actual.desde && t < actual.fin;
    const d = destinos.get(p.id) ?? { tipo: 'libre' as const };
    if (!enActual) { fuera.push(p); continue; }
    if (d.tipo === 'match' && d.matchId === m.id) { propios.push(p); continue; }
    if (d.tipo === 'libre') { propios.push(p); continue; }
    if (d.tipo === 'ambiguo') {
      if (d.matchId === m.id) {
        d.userIds.forEach((u) => sinCerteza.add(u));
        propios.push(p);
      } else {
        const aqui = identificarPago(actual.titulares, p, aliases);
        if (aqui.tipo === 'ambiguo') { aqui.userIds.forEach((u) => sinCerteza.add(u)); propios.push(p); }
        else if (aqui.tipo === 'unico' && !asignadosAqui.has(aqui.userId)) sinCerteza.add(aqui.userId);
      }
      continue;
    }
    const aqui = identificarPago(actual.titulares, p, aliases);
    if (aqui.tipo === 'unico' && !asignadosAqui.has(aqui.userId)) sinCerteza.add(aqui.userId);
    else if (aqui.tipo === 'ambiguo') aqui.userIds.forEach((u) => { if (!asignadosAqui.has(u)) sinCerteza.add(u); });
  }
  return {
    v, cierre, sinCerteza, nombres, mpIncompleto,
    cruce: cruzarPagos(tit, propios, aliases, (id) => nombres.get(id), cierre.en, fuera),
  };
}

/**
 * GET del panel. Devuelve SOLO nombre, fecha y monto; nunca correos ni documentos.
 * SOLO LECTURA: no escribe ni borra sanciones. Un «pagó tarde» sigue sancionable
 * y una sanción existente se muestra tal cual (nunca se perdona sola).
 */
export async function estadoPagos(deps: Deps, groupId: string, matchId?: string | null) {
  /** Hora del servidor al consultar (el panel la muestra como «Última revisión») */
  const revisado_at = deps.ahora().toISOString();
  const { m, recientes } = await elegirPartido(deps, groupId, matchId);
  const tit = await titularesQuePagan(deps, m);
  const { v, cierre, cruce: c, sinCerteza, mpIncompleto } = await cruce(deps, m, tit);
  const fecha_sancion = await fechaSancion(deps.repo, m);
  const [sanc, aliases, miembros] = await Promise.all([
    deps.repo.sanciones(m.group_id, fecha_sancion),
    deps.repo.aliases(m.group_id),
    deps.repo.miembros(m.group_id),
  ]);
  const nombres = new Map(miembros.map((x) => [x.user_id, x.nombre]));
  const sancionPor = new Map(sanc.map((s) => [s.user_id, s.reason]));

  return {
    configurado: Boolean(deps.mp),
    /** La búsqueda de Mercado Pago se cortó en el tope de páginas: no sancionar. */
    mp_incompleto: mpIncompleto,
    revisado_at,
    partidos: recientes.map((p) => ({ id: p.id, fecha: ymd(p.date), hora: p.time, cancelado: p.status === 'cancelled' })),
    partido: {
      id: m.id, fecha: ymd(m.date), hora: m.time, precio: m.price != null ? Number(m.price) : null,
      ventana: { desde: v.desde.toISOString(), hasta: v.hasta.toISOString(), cerrada: v.cerrada, solapa: v.solapa },
      /** Cierre de pago: después de esto el pago es «pagó tarde» y no levanta la sanción */
      cierre,
    },
    fecha_sancion,
    titulares: (c?.titulares ?? tit.map((t) => ({ user_id: t.user_id, nombre: t.nombre, estado: 'no_pagado' as const, pago: null })))
      .map((f) => ({ ...f, sancion: sancionPor.get(f.user_id) ?? null, solape: sinCerteza.has(f.user_id) })),
    sin_asignar: c?.sin_asignar ?? [],
    resumen: c?.resumen ?? null,
    alias: aliases.map((a) => ({ id: a.id, jugador: nombres.get(a.user_id) || 'Jugador', pagador: a.payer_label || '—' })),
    miembros,
  };
}

/** Asigna a mano un pago (y su pagador, para las próximas fechas) a un jugador. */
export async function mapearPagador(deps: Deps, groupId: string, paymentId: string, userId: string, adminId: string | null) {
  if (!deps.mp) throw new ErrorPagos('MercadoPago no está configurado', 503);
  if (!/^\d{1,20}$/.test(paymentId || '')) throw new ErrorPagos('pago inválido');
  const miembros = await deps.repo.miembros(groupId);
  if (!miembros.some((x) => x.user_id === userId)) throw new ErrorPagos('el jugador no es del grupo');
  const raw = await deps.mp.pago(paymentId);
  if (raw?.status !== 'approved') throw new ErrorPagos('el pago no está aprobado');
  const p = aPagoMp(raw);
  const payer_name_norm = p.nombres.map(claveNombre).find(Boolean) ?? null;
  if (!p.payerId && !p.emailHash && !payer_name_norm) throw new ErrorPagos('el pago no trae datos del pagador');
  await deps.repo.guardarAlias({
    group_id: groupId, user_id: userId,
    payer_mp_id: p.payerId, payer_email_sha256: p.emailHash, payer_name_norm,
    payer_label: p.pagador, created_by: adminId,
  });
  return { ok: true };
}

/**
 * Sanción "no_pago" (pierde cupo la próxima fecha). Idempotente: si ya existe
 * la misma sanción no hace nada; si ya tiene OTRA sanción esa fecha, no la pisa.
 * Exige confirmar === true y que el jugador sea titular y figure sin pagar.
 */
export async function sancionarNoPago(
  deps: Deps, groupId: string,
  input: { match_id: string; user_id: string; confirmar: unknown },
  adminId: string | null,
) {
  if (input.confirmar !== true) throw new ErrorPagos('falta confirmación explícita');
  const m = await deps.repo.partido(input.match_id);
  if (!m || m.group_id !== groupId) throw new ErrorPagos('partido no encontrado', 404);
  if (inicioPartido(m).getTime() > deps.ahora().getTime()) throw new ErrorPagos('el partido todavía no se juega');

  const tit = await titularesQuePagan(deps, m);
  const jugador = tit.find((t) => t.user_id === input.user_id);
  if (!jugador) throw new ErrorPagos('no es titular de este partido (o no paga)');
  if (!deps.mp) throw new ErrorPagos('sin MercadoPago no se puede verificar el pago', 503);
  const { cruce: c, sinCerteza } = await cruce(deps, m, tit);
  // Solo bloquea a quien pagó A TIEMPO. «Pagó tarde» no levanta la sanción: se puede cargar.
  if (c?.titulares.find((f) => f.user_id === jugador.user_id)?.estado === 'pagado') {
    throw new ErrorPagos(`${jugador.nombre} figura con pago a tiempo`, 409);
  }
  // Pago en más de una ventana que no se pudo asignar con certeza a ESTA pichanga.
  if (sinCerteza.has(jugador.user_id)) {
    throw new ErrorPagos(`${jugador.nombre} tiene un pago en el solape de ventanas; revísalo antes de sancionar`, 409);
  }

  const applies_to = await fechaSancion(deps.repo, m);
  const previa = (await deps.repo.sanciones(groupId, applies_to)).find((s) => s.user_id === jugador.user_id);
  if (previa) {
    if (previa.reason === 'no_pago') return { ok: true, ya_existia: true, applies_to };
    throw new ErrorPagos(`ya tiene otra sanción (${previa.reason}) para el ${applies_to}`, 409);
  }
  try {
    await deps.repo.insertarSancion({
      group_id: groupId, user_id: jugador.user_id, applies_to, reason: 'no_pago',
      note: `No pagó la pichanga del ${ymd(m.date)} (match ${m.id})`, created_by: adminId,
    });
  } catch (e: any) {
    if (e?.code === '23505') return { ok: true, ya_existia: true, applies_to }; // carrera: otro clic
    throw e;
  }
  return { ok: true, ya_existia: false, applies_to };
}
