/**
 * Sanciones de no_pago al cerrar una pichanga.
 *
 * El cron y el botón «Aplicar sanciones del cierre» usan la misma función.
 * Idempotente por public.cierre_sanciones (match_id PK, migración 043).
 * Mercado Pago solo se lee. No se escribe en matches.
 *
 * Apagado por defecto: SANCIONES_AL_CIERRE ausente o distinto de 1/true.
 */
import { debeRegistrarDeuda } from './deudas';
import { DIAS_VENTANA } from './tiempo';
import {
  ErrorPagos,
  estadoPagos,
  inicioPartido,
  type CierreSancionFila,
  type CierreSancionSnapshot,
  type Deps,
  type EstadoCierreSancion,
} from './servicio';

/** Galletas + Ibáñez. Único grupo con sanción y deuda al cierre. */
export const GRUPO_GALLETAS = 'a812c96c-2193-41fe-b35a-a2b6159ed57f';

export const SANCION_DEUDA_GRUPOS = [GRUPO_GALLETAS] as const;

/** Quien organiza no paga la cancha. La misma lista que el panel. */
export const NO_PAGAN_CANCHA = ['bmadain@gmail.com'];

/** El cron no recorre años de cierres: solo mensajes match_closed de esta ventana. */
export const DIAS_BUSQUEDA_CIERRE = 60;

/** Tope por pasada, para no encadenar búsquedas de Mercado Pago en un solo tick. */
export const TOPE_POR_CRON = 3;

const MS_DIA = 86400000;

export function sancionesAlCierreActivas(env?: { SANCIONES_AL_CIERRE?: string }): boolean {
  const v = env ? env.SANCIONES_AL_CIERRE : process.env.SANCIONES_AL_CIERRE;
  return v === '1' || v === 'true';
}

export function grupoConSancionDeuda(groupId: string): boolean {
  const id = (groupId || '').toLowerCase();
  return SANCION_DEUDA_GRUPOS.some((g) => g === id);
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
export function planSancionesCierre(input: {
  cerrado: boolean;
  configurado: boolean;
  mpIncompleto: boolean;
  historialIncompleto: boolean;
  cierreEn: string | null;
  fechaSancion: string;
  fechaPartido: string;
  titulares: TitularAlCierre[];
}): PlanCierre {
  const fechaSancion = input.fechaSancion;
  const fechaPartido = input.fechaPartido;
  const titulares = input.titulares.map((t) => ({ ...t, nombre: nombreVisible(t.nombre), user_id: t.user_id }));
  const base: CierreSancionSnapshot = {
    cierre_en: input.cierreEn,
    fecha_sancion: fechaSancion,
    fecha_partido: fechaPartido,
    mp_incompleto: input.mpIncompleto,
    historial_incompleto: input.historialIncompleto,
    configurado: input.configurado,
    solapes: titulares.filter((t) => t.solape).map((t) => ({ user_id: t.user_id, nombre: t.nombre })),
    al_dia: titulares.filter((t) => t.estado === 'pagado' && !t.solape).map((t) => ({ user_id: t.user_id, nombre: t.nombre })),
  };
  const vacio = (status: PlanCierre['status'], note: string | null): PlanCierre => ({
    status, note, fechaSancion, fechaPartido, cierreEn: input.cierreEn, sancionables: [], snapshot: sinCorreos(base),
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
    const quienes = base.solapes!.map((t) => t.nombre).join(', ');
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
      deuda: debeRegistrarDeuda({ activa: true, estado: t.estado, partidoEmpezo: true }),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.user_id.localeCompare(b.user_id));

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
    snapshot: sinCorreos({ ...base, sancionados: sancionables.map((s) => ({ ...s, ya_existia: false })) }),
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

/**
 * Aplica (o deja alerta) las sanciones de un partido ya cerrado.
 * Si la fila está `applied`, no vuelve a escribir. `skipped_incomplete` y
 * `alert` se pueden reintentar: el botón recalcula y, si ahora hay certeza, aplica.
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
  if (previa && previa.group_id !== groupId) throw new ErrorPagos('partido no encontrado', 404);
  if (previa?.status === 'applied') {
    return {
      ok: true,
      ya_aplicado: true,
      status: 'applied',
      applies_to: previa.snapshot?.fecha_sancion,
      note: previa.note,
      sancionados: (previa.snapshot?.sancionados || []).map((s) => ({
        user_id: s.user_id,
        nombre: nombreVisible(s.nombre),
        estado: s.estado === 'pagado_tarde' ? 'pagado_tarde' : 'no_pagado',
        deuda: Boolean(s.deuda),
        ya_existia: Boolean(s.ya_existia),
      })),
    };
  }

  const m = await deps.repo.partido(matchId);
  if (!m || m.group_id !== groupId) throw new ErrorPagos('partido no encontrado', 404);
  if (m.status === 'cancelled') throw new ErrorPagos('el partido está cancelado', 409);
  if (inicioPartido(m).getTime() > deps.ahora().getTime()) throw new ErrorPagos('el partido todavía no se juega', 409);
  const cerradoEn = await deps.repo.eventoCierre(m);
  if (!cerradoEn) throw new ErrorPagos('el partido todavía no se cierra', 409);

  const estado = await estadoPagos(deps, groupId, matchId);
  const plan = planSancionesCierre({
    cerrado: estado.partido.cierre.fuente === 'match_closed' && Boolean(estado.partido.cierre.en),
    configurado: estado.configurado,
    mpIncompleto: Boolean(estado.mp_incompleto),
    historialIncompleto: Boolean(estado.historial_incompleto),
    cierreEn: estado.partido.cierre.en,
    fechaSancion: estado.fecha_sancion,
    fechaPartido: estado.partido.fecha,
    titulares: estado.titulares.map((t) => ({
      user_id: t.user_id, nombre: t.nombre, estado: t.estado, solape: t.solape,
    })),
  });
  if (plan.status === 'sin_cierre') throw new ErrorPagos('el partido todavía no se cierra', 409);

  const processed_at = deps.ahora().toISOString();
  if (plan.status !== 'applied') {
    const fila = await deps.repo.guardarCierreSancion({
      match_id: matchId,
      group_id: groupId,
      processed_at,
      processed_by: actor.by,
      status: plan.status,
      note: plan.note,
      snapshot: sinCorreos({ ...plan.snapshot, via: actor.via }),
    });
    return { ok: true, status: fila.status, note: fila.note, applies_to: plan.fechaSancion, sancionados: [] };
  }

  const sancionados: NonNullable<ResultadoCierreSancion['sancionados']> = [];
  const conflictos: { user_id: string; nombre: string; reason: string }[] = [];
  for (const s of plan.sancionables) {
    const prev = (await deps.repo.sanciones(groupId, plan.fechaSancion)).find((x) => x.user_id === s.user_id);
    if (prev && prev.reason !== 'no_pago') {
      conflictos.push({ user_id: s.user_id, nombre: s.nombre, reason: prev.reason });
      continue;
    }
    let ya = Boolean(prev);
    if (!prev) {
      try {
        await deps.repo.insertarSancion({
          group_id: groupId,
          user_id: s.user_id,
          applies_to: plan.fechaSancion,
          reason: 'no_pago',
          note: `No pagó la pichanga del ${plan.fechaPartido} (match ${matchId})`,
          created_by: actor.by,
        });
      } catch (e: any) {
        if (e?.code !== '23505') throw e;
        ya = true;
      }
    }
    let deuda = false;
    if (s.deuda) {
      try {
        const r = await deps.repo.registrarDeuda({ match_id: matchId, user_id: s.user_id, created_by: actor.by });
        deuda = Boolean(r?.ok && !r.omitida);
      } catch (e: any) {
        if (e?.code === '23505') deuda = true;
        else if (codesMigracion(e)) deuda = false;
        else throw e;
      }
    }
    sancionados.push({ user_id: s.user_id, nombre: s.nombre, estado: s.estado, deuda, ya_existia: ya });
  }

  let note = plan.note || '';
  if (conflictos.length) {
    note = `${note} No se pisó otra sanción de ${conflictos.map((c) => `${c.nombre} (${c.reason})`).join(', ')}.`.trim();
  }
  const sinDeuda = sancionados.filter((s) => s.estado === 'no_pagado' && !s.deuda);
  if (sinDeuda.length) {
    note = `${note} No quedó registrada la deuda de ${sinDeuda.map((s) => s.nombre).join(', ')}.`.trim();
  }
  note = textoSeguro(note);
  const snapshot = sinCorreos({
    ...plan.snapshot,
    via: actor.via,
    sancionados,
    conflictos,
  });
  const fila = await deps.repo.guardarCierreSancion({
    match_id: matchId,
    group_id: groupId,
    processed_at,
    processed_by: actor.by,
    status: 'applied',
    note,
    snapshot,
  });
  return {
    ok: true,
    ya_aplicado: false,
    status: fila.status,
    applies_to: plan.fechaSancion,
    note: fila.note,
    sancionados,
  };
}

export interface ResultadoCron {
  ok: true;
  omitido: boolean;
  resultados: { match_id: string; status: EstadoCierreSancion | null; sancionados: number; error?: boolean }[];
}

/** Una pasada del cron. Con el flag apagado no lee ni escribe. */
export async function correrSancionesCierre(deps: Deps, ahora = new Date()): Promise<ResultadoCron> {
  if (!flagActivo(deps)) return { ok: true, omitido: true, resultados: [] };
  const desde = new Date(ahora.getTime() - DIAS_BUSQUEDA_CIERRE * MS_DIA).toISOString();
  const resultados: ResultadoCron['resultados'] = [];
  for (const groupId of SANCION_DEUDA_GRUPOS) {
    let pendientes: { id: string; cerrado_en: string }[] = [];
    try {
      pendientes = await deps.repo.partidosPendientesCierre(groupId, desde, TOPE_POR_CRON);
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
  const lista = Array.isArray(fila.snapshot?.sancionados) ? fila.snapshot.sancionados : [];
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
