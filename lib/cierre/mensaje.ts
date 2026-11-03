/**
 * Texto de WhatsApp para cerrar una pichanga. Función pura: no lee la base
 * ni Mercado Pago.
 *
 * «Pierde cupo por no pago» son los titulares que el panel no marca «pagó»
 * a tiempo (`pagado`). «Pagó tarde» tampoco cuenta: pagar después del cierre
 * no levanta la sanción, igual que en el panel.
 *
 * «Asegura cupo hasta» usa el `hasta` de admin_lineup → cupos_asegurados
 * (banca automática de 28 días, guaranteed_spots.until_date, o el máximo).
 * Solo entran fechas estrictamente posteriores a la pichanga que se cierra.
 * Si hay una pichanga futura no cancelada en una fecha ≤ hasta, el jugador
 * queda en la última de esas. Si no hay ninguna creada, se usa el `hasta`
 * tal cual («9 de noviembre»). Quien pierde cupo por no pago no asegura.
 * Cada jugador sale una vez. El orden de los nombres es el de la tabla de
 * titulares; quien no está en esa tabla sigue el orden en que vino el cupo.
 */

export type EstadoPagoCierre = 'pagado' | 'pagado_tarde' | 'no_pagado';

export interface TitularCierre {
  user_id?: string;
  nombre: string;
  estado: EstadoPagoCierre;
}

export interface CupoAsegurado {
  user_id: string;
  nombre: string;
  /** YYYY-MM-DD. Hasta qué día (inclusive) le dura el cupo. */
  hasta: string;
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

export function mensajeCierreBloqueado(v: { historial_incompleto?: boolean; mp_incompleto?: boolean }): boolean {
  return Boolean(v.historial_incompleto || v.mp_incompleto);
}

export function mensajeCierre(input: {
  titulares: TitularCierre[];
  cupos: CupoAsegurado[];
  futuros: FechaFutura[];
  /** YYYY-MM-DD de la pichanga que se cierra. */
  fechaPartido: string;
}): string {
  const pierde = input.titulares.filter((t) => t.estado !== 'pagado').map((t) => t.nombre);
  const lineas = [
    'Pierde cupo por no pago:',
    pierde.length ? pierde.join(', ') : 'Nadie',
    '',
    'Asegura cupo hasta:',
  ];
  const grupos = gruposAsegura(input);
  if (!grupos.length) lineas.push('Nadie');
  else for (const g of grupos) lineas.push(fechaMensaje(g.fecha), g.nombres.join(', '));
  return lineas.join('\n');
}

function gruposAsegura(input: {
  titulares: TitularCierre[];
  cupos: CupoAsegurado[];
  futuros: FechaFutura[];
  fechaPartido: string;
}): { fecha: string; nombres: string[] }[] {
  const hoy = diaCalendario(input.fechaPartido);
  const futuros = [...new Set(input.futuros.map((f) => diaCalendario(f.fecha)).filter((f) => f > hoy))].sort();
  const pierdeId = new Set(input.titulares.filter((t) => t.estado !== 'pagado' && t.user_id).map((t) => t.user_id as string));
  const pierdeNombre = new Set(input.titulares.filter((t) => t.estado !== 'pagado').map((t) => t.nombre));
  const mejor = new Map<string, { nombre: string; hasta: string; orden: number }>();
  input.cupos.forEach((c, i) => {
    if (pierdeId.has(c.user_id) || pierdeNombre.has(c.nombre)) return;
    const hasta = diaCalendario(c.hasta);
    const idx = input.titulares.findIndex((t) => t.user_id && t.user_id === c.user_id);
    const orden = idx >= 0 ? idx : input.titulares.length + i;
    const prev = mejor.get(c.user_id);
    if (!prev || hasta > prev.hasta) mejor.set(c.user_id, { nombre: c.nombre, hasta, orden: prev ? Math.min(prev.orden, orden) : orden });
    else if (orden < prev.orden) prev.orden = orden;
  });
  const grupos = new Map<string, { nombre: string; orden: number }[]>();
  for (const p of mejor.values()) {
    if (p.hasta <= hoy) continue;
    let fecha = '';
    for (const f of futuros) if (f <= p.hasta) fecha = f;
    if (!fecha) fecha = p.hasta;
    const lista = grupos.get(fecha) ?? [];
    lista.push({ nombre: p.nombre, orden: p.orden });
    grupos.set(fecha, lista);
  }
  return [...grupos.keys()].sort().map((fecha) => ({
    fecha,
    nombres: grupos.get(fecha)!.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es')).map((x) => x.nombre),
  }));
}
