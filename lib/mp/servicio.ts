/**
 * Lógica del panel "Pagos": estado de pagos de una pichanga, mapeo manual
 * pagador → jugador y sanción no_pago. Recibe sus dependencias (BD y
 * MercadoPago) por parámetro, así los tests corren con fakes y nunca tocan prod.
 */
import { aPagoMp, esPagoDePichanga, type PagoMpRaw } from './pagos-mp';
import { claveNombre, cruzarPagos, type AliasPagador, type ResultadoCruce, type Titular } from './cruce';
import { isoSantiago, santiagoAUtc, ventanaPagos } from './tiempo';
import { normalizarEmail } from './normalizar';
import { cierrePago, type CierrePago } from './cierre';

export interface Partido {
  id: string; group_id: string; date: string; time: string | null;
  price: number | null; status: string | null; phase: string | null;
}
export interface Sancion { user_id: string; applies_to: string; reason: string; note: string | null }

export interface PagosRepo {
  partidosRecientes(groupId: string, limite: number): Promise<Partido[]>;
  partido(matchId: string): Promise<Partido | null>;
  /** Titulares confirmados (is_starter = true), con correo de la app (solo servidor) */
  titulares(match: Partido): Promise<Titular[]>;
  miembros(groupId: string): Promise<{ user_id: string; nombre: string }[]>;
  aliases(groupId: string): Promise<(AliasPagador & { id: string; payer_label: string | null })[]>;
  /** Fecha (YYYY-MM-DD) del siguiente partido no cancelado del grupo, o null */
  siguienteFecha(match: Partido): Promise<string | null>;
  /**
   * created_at del PRIMER mensaje system 'match_closed' del partido (group_messages),
   * o null. Es el cierre de pago: ver lib/mp/cierre.ts. Solo lectura.
   */
  eventoCierre(match: Partido): Promise<string | null>;
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

async function cruce(deps: Deps, m: Partido, tit: Titular[]) {
  const v = ventanaPagos(m.date, m.time, deps.ahora());
  const cierre: CierrePago = cierrePago(m, await deps.repo.eventoCierre(m));
  if (!deps.mp) return { v, cierre, cruce: null as ResultadoCruce | null };
  if (v.hasta.getTime() <= v.desde.getTime()) {
    return { v, cierre, cruce: cruzarPagos(tit, [], [], undefined, cierre.en) };
  }
  const raw = await deps.mp.buscarAprobados(isoSantiago(v.desde), isoSantiago(v.hasta));
  const pagos = raw.filter((r) => esPagoDePichanga(r, m.price != null ? Number(m.price) : null)).map(aPagoMp);
  const [aliases, miembros] = await Promise.all([deps.repo.aliases(m.group_id), deps.repo.miembros(m.group_id)]);
  const nombres = new Map(miembros.map((x) => [x.user_id, x.nombre]));
  return { v, cierre, cruce: cruzarPagos(tit, pagos, aliases, (id) => nombres.get(id), cierre.en) };
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
  const { v, cierre, cruce: c } = await cruce(deps, m, tit);
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
    revisado_at,
    partidos: recientes.map((p) => ({ id: p.id, fecha: ymd(p.date), hora: p.time, cancelado: p.status === 'cancelled' })),
    partido: {
      id: m.id, fecha: ymd(m.date), hora: m.time, precio: m.price != null ? Number(m.price) : null,
      ventana: { desde: v.desde.toISOString(), hasta: v.hasta.toISOString(), cerrada: v.cerrada },
      /** Cierre de pago: después de esto el pago es «pagó tarde» y no levanta la sanción */
      cierre,
    },
    fecha_sancion,
    titulares: (c?.titulares ?? tit.map((t) => ({ user_id: t.user_id, nombre: t.nombre, estado: 'no_pagado' as const, pago: null })))
      .map((f) => ({ ...f, sancion: sancionPor.get(f.user_id) ?? null })),
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
  const { cruce: c } = await cruce(deps, m, tit);
  // Solo bloquea a quien pagó A TIEMPO. «Pagó tarde» no levanta la sanción: se puede cargar.
  if (c?.titulares.find((f) => f.user_id === jugador.user_id)?.estado === 'pagado') {
    throw new ErrorPagos(`${jugador.nombre} figura con pago a tiempo`, 409);
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
