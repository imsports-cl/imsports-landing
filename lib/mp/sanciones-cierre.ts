/**
 * Sanciones de no_pago al cerrar una pichanga.
 *
 * El cron y el botón «Aplicar sanciones del cierre» usan la misma función.
 * Idempotente por public.cierre_sanciones (match_id PK, migración 043).
 * Mercado Pago solo se lee. No se escribe en matches.
 *
 * Apagado por defecto: SANCIONES_AL_CIERRE ausente o distinto de 1/true.
 */
import { debeRegistrarDeuda, sancionHastaPagarActiva } from './deudas';
import { DIAS_VENTANA, santiagoAUtc } from './tiempo';
import {
  ErrorPagos,
  estadoPagos,
  fechaSancion,
  inicioPartido,
  type CierreSancionFila,
  type CierreSancionSnapshot,
  type CierreSnapshotItem,
  type Deps,
  type EstadoCierreSancion,
} from './servicio';

/** Galletas + Ibáñez. Único grupo con sanción y deuda al cierre. */
export const GRUPO_GALLETAS = 'a812c96c-2193-41fe-b35a-a2b6159ed57f';

export const SANCION_DEUDA_GRUPOS = [GRUPO_GALLETAS] as const;

/** Quien organiza no paga la cancha. La misma lista que el panel. */
export const NO_PAGAN_CANCHA = ['bmadain@gmail.com'];

/**
 * Sin SANCIONES_AL_CIERRE_DESDE no hay backfill: solo cierres desde el
 * inicio de este día en Chile (el día del deploy de esta regla).
 */
export const SANCIONES_AL_CIERRE_DESDE_DEFECTO = '2026-11-09';

/** Tope por pasada, para no encadenar búsquedas de Mercado Pago en un solo tick. */
export const TOPE_POR_CRON = 3;

/** Un processing más viejo que esto lo retoma el cron (la corrida anterior murió). */
export const MINUTOS_REINTENTO_PROCESSING = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MS_DIA = 86400000;

export function sancionesAlCierreActivas(env?: { SANCIONES_AL_CIERRE?: string }): boolean {
  const v = env ? env.SANCIONES_AL_CIERRE : process.env.SANCIONES_AL_CIERRE;
  return v === '1' || v === 'true';
}

export function grupoConSancionDeuda(groupId: string): boolean {
  const id = (groupId || '').toLowerCase();
  return SANCION_DEUDA_GRUPOS.some((g) => g === id);
}

/** Inicio del día en Chile, o un ISO con hora. Vacío → 2026-11-09 00:00 CLT. */
export function instanteDesdeCierre(valor: string | undefined): Date {
  const raw = (valor || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return santiagoAUtc(raw, '00:00');
  if (raw && !Number.isNaN(Date.parse(raw))) return new Date(raw);
  return santiagoAUtc(SANCIONES_AL_CIERRE_DESDE_DEFECTO, '00:00');
}

function desdeDe(deps: Deps): Date {
  if (deps.sancionesAlCierreDesde !== undefined) return instanteDesdeCierre(deps.sancionesAlCierreDesde);
  return instanteDesdeCierre(process.env.SANCIONES_AL_CIERRE_DESDE);
}

/** CHECK de la 043: 'cron' o 'admin:<uuid>'. */
export function procesadoPor(actor: ActorCierre): string {
  if (actor.via === 'cron') return 'cron';
  const id = (actor.by || '').replace(/^admin:/, '').trim().toLowerCase();
  if (!UUID.test(id)) throw new ErrorPagos('falta el admin', 403);
  return `admin:${id}`;
}

function createdByDe(actor: ActorCierre): string | null {
  if (actor.via === 'cron') return null;
  const id = (actor.by || '').replace(/^admin:/, '').trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

/**
 * Authorization: Bearer <CRON_SECRET>. Sin secreto, o si no calza, no corre.
 * No loguea el header.
 */
export function cronAutorizado(authorization: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const esperado = `Bearer ${secret}`;
  const recibido = authorization || '';
  if (recibido.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < esperado.length; i++) diff |= recibido.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diff === 0;
}

export interface TitularAlCierre {
  user_id: string;
  nombre: string;
  estado: 'pagado' | 'pagado_tarde' | 'no_pagado';
  solape?: boolean;
}

export interface PlanCierre {
  status: EstadoCierreSancion | 'sin_cierre';
  note: string | null;
  fechaSancion: string;
  fechaPartido: string;
  cierreEn: string | null;
  sancionables: { user_id: string; nombre: string; estado: 'no_pagado' | 'pagado_tarde'; deuda: boolean }[];
  /** Arreglo que persiste la 043. Un objeto no pasa el CHECK. */
  snapshot: CierreSancionSnapshot;
}

/** Un apodo que venga como correo no sale en la nota, el snapshot ni el panel. */
export function nombreVisible(nombre: string): string {
  const limpio = (nombre || '').trim();
  if (!limpio || limpio.includes('@')) return 'Jugador';
  return limpio;
}

function textoSeguro(s: string): string {
  return s.replace(/[^\s@]+@[^\s@]+/g, '***');
}

function sinCorreos<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (
    typeof v === 'string' ? textoSeguro(v) : v
  ))) as T;
}

/**
 * Qué haría el cierre con el estado de pago ya calculado (cruce + cierrePago).
 * No toca la base. no_pagado y pagado_tarde sancionan la fecha siguiente;
 * la deuda solo entra si no pagó.
 */
function filaSnapshot(
  t: TitularAlCierre,
  sancion: { deuda: boolean } | undefined,
): CierreSnapshotItem {
  return {
    user_id: t.user_id,
    nombre: t.nombre,
    estado: t.estado,
    pagado: t.estado === 'pagado',
    sancion: Boolean(sancion),
    deuda: Boolean(sancion?.deuda),
  };
}

export function planSancionesCierre(input: {
  cerrado: boolean;
  configurado: boolean;
  mpIncompleto: boolean;
  historialIncompleto: boolean;
  cierreEn: string | null;
  fechaSancion: string;
  fechaPartido: string;
  /** Sin SANCION_HASTA_PAGAR la deuda no entra: solo la fecha. */
  sancionHastaPagar?: boolean;
  titulares: TitularAlCierre[];
}): PlanCierre {
  const fechaSancion = input.fechaSancion;
  const fechaPartido = input.fechaPartido;
  const hastaPagar = input.sancionHastaPagar === true;
  const titulares = input.titulares.map((t) => ({ ...t, nombre: nombreVisible(t.nombre), user_id: t.user_id }));
  const vacio = (status: PlanCierre['status'], note: string | null): PlanCierre => ({
    status,
    note,
    fechaSancion,
    fechaPartido,
    cierreEn: input.cierreEn,
    sancionables: [],
    snapshot: sinCorreos(titulares.map((t) => filaSnapshot(t, undefined))),
  });

  if (!input.cerrado) return vacio('sin_cierre', null);
  if (!input.configurado || input.mpIncompleto || input.historialIncompleto) {
    const partes: string[] = [];
    if (!input.configurado) partes.push('Mercado Pago no está conectado');
    if (input.mpIncompleto) partes.push('Mercado Pago devolvió la búsqueda incompleta');
    if (input.historialIncompleto) partes.push('el historial de pichangas que se solapan está incompleto');
    return vacio('skipped_incomplete', textoSeguro(`No se aplicaron sanciones: ${partes.join('. ')}.`));
  }
  if (titulares.some((t) => t.solape)) {
    const quienes = titulares.filter((t) => t.solape).map((t) => t.nombre).join(', ');
    return vacio('alert', textoSeguro(
      `No se aplicaron sanciones: hay un pago en el solape de ventanas (${quienes}). Revísalo antes de sancionar.`,
    ));
  }

  const sancionables = titulares
    .filter((t) => t.estado === 'no_pagado' || t.estado === 'pagado_tarde')
    .map((t) => ({
      user_id: t.user_id,
      nombre: t.nombre,
      estado: t.estado as 'no_pagado' | 'pagado_tarde',
      deuda: debeRegistrarDeuda({ activa: hastaPagar, estado: t.estado, partidoEmpezo: true }),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.user_id.localeCompare(b.user_id));
  const porId = new Map(sancionables.map((s) => [s.user_id, s]));

  const note = sancionables.length
    ? `Sanciones no_pago para el ${fechaSancion}: ${sancionables.map((s) => s.nombre).join(', ')}.`
    : 'Cierre sin sanciones: todos pagaron a tiempo.';
  return {
    status: 'applied',
    note: textoSeguro(note),
    fechaSancion,
    fechaPartido,
    cierreEn: input.cierreEn,
    sancionables,
    snapshot: sinCorreos(titulares.map((t) => filaSnapshot(t, porId.get(t.user_id)))),
  };
}

export interface ActorCierre {
  by: string | null;
  via: 'cron' | 'panel';
}

export interface ResultadoCierreSancion {
  ok: true;
  omitido?: boolean;
  ya_aplicado?: boolean;
  status?: EstadoCierreSancion;
  applies_to?: string;
  note?: string | null;
  sancionados?: { user_id: string; nombre: string; estado: 'no_pagado' | 'pagado_tarde'; deuda: boolean; ya_existia: boolean }[];
}

function flagActivo(deps: Deps): boolean {
  return deps.sancionesAlCierre ?? sancionesAlCierreActivas();
}

function codesMigracion(e: { code?: string } | null | undefined): boolean {
  return e?.code === 'PGRST202' || e?.code === '42883' || e?.code === '42P01' || e?.code === 'PGRST205';
}

function sancionadosDe(items: CierreSancionSnapshot | undefined): NonNullable<ResultadoCierreSancion['sancionados']> {
  return (Array.isArray(items) ? items : []).filter((s) => s.sancion).map((s) => ({
    user_id: s.user_id,
    nombre: nombreVisible(s.nombre),
    estado: s.estado === 'pagado_tarde' ? 'pagado_tarde' as const : 'no_pagado' as const,
    deuda: Boolean(s.deuda),
    ya_existia: false,
  }));
}

function processingViejo(processedAt: string, ahora: Date): boolean {
  const t = Date.parse(processedAt);
  if (Number.isNaN(t)) return true;
  return ahora.getTime() - t >= MINUTOS_REINTENTO_PROCESSING * 60 * 1000;
}

function notaIncompleta(sanciones: number, deudas: number): string {
  return `Escritura incompleta: quedaron ${sanciones} sanciones y ${deudas} deudas. Se puede reintentar.`;
}

/**
 * Aplica (o deja alerta) las sanciones de un partido ya cerrado.
 * El reclamo es `processing` (no final). `applied` se escribe solo cuando
 * todas las sanciones y deudas terminaron. Si creada es false y otro
 * proceso sigue en curso, el cron no escribe; el botón sí puede completar.
 */
export async function aplicarSancionesCierre(
  deps: Deps,
  groupId: string,
  matchId: string,
  actor: ActorCierre,
): Promise<ResultadoCierreSancion> {
  if (!flagActivo(deps)) return { ok: true, omitido: true };
  if (!grupoConSancionDeuda(groupId)) return { ok: true, omitido: true };

  const previa = await deps.repo.cierreSancion(matchId);
  if (previa && previa.group_id && previa.group_id !== groupId) throw new ErrorPagos('partido no encontrado', 404);
  if (previa?.status === 'applied') {
    return {
      ok: true,
      ya_aplicado: true,
      status: 'applied',
      applies_to: await fechaSancion(deps.repo, await partidoO404(deps, groupId, matchId)),
      note: previa.note,
      sancionados: sancionadosDe(previa.snapshot),
    };
  }

  const m = await partidoO404(deps, groupId, matchId);
  if (m.status === 'cancelled') throw new ErrorPagos('el partido está cancelado', 409);
  if (inicioPartido(m).getTime() > deps.ahora().getTime()) throw new ErrorPagos('el partido todavía no se juega', 409);
  const cerradoEn = await deps.repo.eventoCierre(m);
  if (!cerradoEn) throw new ErrorPagos('el partido todavía no se cierra', 409);
  if (Date.parse(cerradoEn) < desdeDe(deps).getTime()) {
    return { ok: true, omitido: true, note: 'Este cierre es anterior al inicio de las sanciones automáticas.' };
  }

  const estado = await estadoPagos(deps, groupId, matchId);
  const plan = planSancionesCierre({
    cerrado: estado.partido.cierre.fuente === 'match_closed' && Boolean(estado.partido.cierre.en),
    configurado: estado.configurado,
    mpIncompleto: Boolean(estado.mp_incompleto),
    historialIncompleto: Boolean(estado.historial_incompleto),
    cierreEn: estado.partido.cierre.en,
    fechaSancion: estado.fecha_sancion,
    fechaPartido: estado.partido.fecha,
    sancionHastaPagar: deps.sancionHastaPagar ?? sancionHastaPagarActiva(),
    titulares: estado.titulares.map((t) => ({
      user_id: t.user_id, nombre: t.nombre, estado: t.estado, solape: t.solape,
    })),
  });
  if (plan.status === 'sin_cierre') throw new ErrorPagos('el partido todavía no se cierra', 409);

  const processed_by = procesadoPor(actor);
  const processed_at = deps.ahora().toISOString();
  const snapshot = plan.snapshot;

  if (!previa) {
    const reclamo = await deps.repo.reclamarCierre({
      match_id: matchId, group_id: groupId, processed_by, snapshot,
      status: 'processing', note: 'Cierre en curso.',
    });
    const ahoraFila = await deps.repo.cierreSancion(matchId);
    if (!reclamo.creada) {
      if (ahoraFila?.status === 'applied') {
        return {
          ok: true, ya_aplicado: true, status: 'applied', applies_to: plan.fechaSancion,
          note: ahoraFila.note, sancionados: sancionadosDe(ahoraFila.snapshot),
        };
      }
      if (!ahoraFila) return { ok: true, ya_aplicado: true, applies_to: plan.fechaSancion, sancionados: [] };
      if (actor.via === 'cron' && ahoraFila.status === 'processing' && !processingViejo(ahoraFila.processed_at, deps.ahora())) {
        return { ok: true, status: 'processing', note: ahoraFila.note, applies_to: plan.fechaSancion, sancionados: [] };
      }
    }
  }

  if (plan.status !== 'applied') {
    const guardada = await deps.repo.guardarCierreSancion({
      match_id: matchId, group_id: groupId, processed_at, processed_by,
      status: plan.status, note: plan.note, snapshot,
    });
    return { ok: true, status: guardada.status, note: guardada.note, applies_to: plan.fechaSancion, sancionados: [] };
  }

  const progreso = { sanciones: 0, deudas: 0 };
  try {
    const sancionados = await escribirSanciones(deps, groupId, matchId, plan, actor, progreso);
    const cerrado = await cerrarNota(deps, groupId, matchId, plan, processed_by, processed_at, sancionados, snapshot);
    return { ok: true, ya_aplicado: false, status: 'applied', applies_to: plan.fechaSancion, note: cerrado.note, sancionados };
  } catch (e) {
    const note = notaIncompleta(progreso.sanciones, progreso.deudas);
    try {
      await deps.repo.guardarCierreSancion({
        match_id: matchId, group_id: groupId, processed_at, processed_by,
        status: 'alert', snapshot, note,
      }, { forzar: true });
    } catch (alerta) {
      console.error('[sanciones-cierre]', matchId, 'alert', alerta instanceof ErrorPagos ? alerta.status : (alerta as { code?: string })?.code || 'error');
    }
    console.error('[sanciones-cierre]', matchId, e instanceof ErrorPagos ? e.status : (e as { code?: string })?.code || 'error');
    throw e;
  }
}

async function partidoO404(deps: Deps, groupId: string, matchId: string) {
  const m = await deps.repo.partido(matchId);
  if (!m || m.group_id !== groupId) throw new ErrorPagos('partido no encontrado', 404);
  return m;
}

async function escribirSanciones(
  deps: Deps,
  groupId: string,
  matchId: string,
  plan: PlanCierre,
  actor: ActorCierre,
  progreso: { sanciones: number; deudas: number },
): Promise<NonNullable<ResultadoCierreSancion['sancionados']>> {
  const created_by = createdByDe(actor);
  let existentes: Awaited<ReturnType<Deps['repo']['deudas']>> = [];
  try {
    existentes = await deps.repo.deudas(groupId);
  } catch (e) {
    console.error('[sanciones-cierre]', matchId, 'deudas', (e as { code?: string })?.code || 'error');
  }
  const yaDeuda = new Set(existentes.filter((d) => d.match_id === matchId).map((d) => d.user_id));
  const sancionados: NonNullable<ResultadoCierreSancion['sancionados']> = [];
  for (const s of plan.sancionables) {
    const prev = (await deps.repo.sanciones(groupId, plan.fechaSancion)).find((x) => x.user_id === s.user_id);
    if (prev && prev.reason !== 'no_pago') continue;
    let ya = Boolean(prev);
    if (!prev) {
      try {
        await deps.repo.insertarSancion({
          group_id: groupId, user_id: s.user_id, applies_to: plan.fechaSancion, reason: 'no_pago',
          note: `No pagó la pichanga del ${plan.fechaPartido} (match ${matchId})`,
          created_by,
        });
      } catch (e: any) {
        if (e?.code !== '23505') throw e;
        ya = true;
      }
    }
    progreso.sanciones += 1;
    let deuda = false;
    if (s.deuda) {
      if (yaDeuda.has(s.user_id)) deuda = true;
      else {
        try {
          const r = await deps.repo.registrarDeuda({ match_id: matchId, user_id: s.user_id, created_by });
          deuda = Boolean(r?.ok && !r.omitida);
          if (deuda) yaDeuda.add(s.user_id);
        } catch (e: any) {
          if (e?.code === '23505') deuda = true;
          else if (codesMigracion(e)) deuda = false;
          else throw e;
        }
      }
      if (deuda) progreso.deudas += 1;
    }
    sancionados.push({ user_id: s.user_id, nombre: s.nombre, estado: s.estado, deuda, ya_existia: ya });
  }
  return sancionados;
}

async function cerrarNota(
  deps: Deps,
  groupId: string,
  matchId: string,
  plan: PlanCierre,
  processed_by: string,
  processed_at: string,
  sancionados: NonNullable<ResultadoCierreSancion['sancionados']>,
  base: CierreSancionSnapshot,
) {
  let note = plan.note || '';
  const pisadas = plan.sancionables.filter((s) => !sancionados.some((x) => x.user_id === s.user_id));
  if (pisadas.length) {
    note = `${note} No se pisó otra sanción de ${pisadas.map((s) => s.nombre).join(', ')}.`.trim();
  }
  const sinDeuda = sancionados.filter((s) => s.estado === 'no_pagado' && !s.deuda && plan.sancionables.find((p) => p.user_id === s.user_id)?.deuda);
  if (sinDeuda.length) {
    note = `${note} No quedó registrada la deuda de ${sinDeuda.map((s) => s.nombre).join(', ')}.`.trim();
  }
  note = textoSeguro(note);
  const porUser = new Map(sancionados.map((s) => [s.user_id, s]));
  const snapshot = sinCorreos(base.map((item) => {
    const hecho = porUser.get(item.user_id);
    if (!hecho) return item.sancion ? { ...item, sancion: false, deuda: false } : item;
    return { ...item, sancion: true, deuda: hecho.deuda };
  }));
  return deps.repo.guardarCierreSancion({
    match_id: matchId, group_id: groupId, processed_at, processed_by,
    status: 'applied', note, snapshot,
  });
}

export interface ResultadoCron {
  ok: true;
  omitido: boolean;
  resultados: { match_id: string; status: EstadoCierreSancion | null; sancionados: number; error?: boolean }[];
}

/** Una pasada del cron. Con el flag apagado no lee ni escribe. */
export async function correrSancionesCierre(deps: Deps, ahora = new Date()): Promise<ResultadoCron> {
  if (!flagActivo(deps)) return { ok: true, omitido: true, resultados: [] };
  const desde = desdeDe(deps).toISOString();
  const resultados: ResultadoCron['resultados'] = [];
  for (const groupId of SANCION_DEUDA_GRUPOS) {
    let pendientes: { id: string; cerrado_en: string }[] = [];
    try {
      const reintento = new Date(ahora.getTime() - MINUTOS_REINTENTO_PROCESSING * 60 * 1000).toISOString();
      pendientes = await deps.repo.partidosPendientesCierre(groupId, desde, TOPE_POR_CRON, reintento);
    } catch (e) {
      console.error('[cron/sanciones-cierre]', groupId, e instanceof ErrorPagos ? e.status : (e as { code?: string })?.code || 'error');
      continue;
    }
    for (const p of pendientes) {
      try {
        // Hasta que cierra la ventana (pitazo + 5 días) un pago que llegue
        // después cuenta como «pagó tarde»: no hay deuda. El cron espera;
        // el botón del panel aplica el estado que el admin está viendo.
        const m = await deps.repo.partido(p.id);
        if (!m) continue;
        const finVentana = inicioPartido(m).getTime() + DIAS_VENTANA * MS_DIA;
        if (finVentana > ahora.getTime()) continue;
        const r = await aplicarSancionesCierre(deps, groupId, p.id, { by: null, via: 'cron' });
        resultados.push({
          match_id: p.id,
          status: r.status ?? null,
          sancionados: r.sancionados?.length ?? 0,
        });
      } catch (e) {
        console.error('[cron/sanciones-cierre]', p.id, e instanceof ErrorPagos ? e.status : (e as { code?: string })?.code || 'error');
        resultados.push({ match_id: p.id, status: null, sancionados: 0, error: true });
      }
    }
  }
  return { ok: true, omitido: false, resultados };
}

/** Lo que el panel puede mostrar. Sin correos ni snapshot crudo. */
export function vistaCierreSancion(fila: CierreSancionFila | null): {
  status: EstadoCierreSancion;
  note: string | null;
  processed_at: string;
  sancionados: { nombre: string; estado: 'no_pagado' | 'pagado_tarde'; deuda: boolean }[];
} | null {
  if (!fila) return null;
  const lista = (Array.isArray(fila.snapshot) ? fila.snapshot : []).filter((s) => s?.sancion);
  return {
    status: fila.status,
    note: fila.note ? textoSeguro(fila.note) : null,
    processed_at: fila.processed_at,
    sancionados: lista.map((s) => ({
      nombre: nombreVisible(String(s?.nombre || '')),
      estado: s?.estado === 'pagado_tarde' ? 'pagado_tarde' as const : 'no_pagado' as const,
      deuda: Boolean(s?.deuda),
    })),
  };
}
