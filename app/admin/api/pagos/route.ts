/**
 * API de pagos (MercadoPago, SOLO LECTURA) — /admin/api/pagos
 * Misma allowlist de admins que /admin/api.
 *
 * GET  ?match_id=  → titulares con pagado / no pagado, pagos sin asignar y alias.
 *                    Sin match_id: la última pichanga que ya empezó.
 * POST { accion: 'mapear', payment_id, user_id }      → alias pagador → jugador
 *      { accion: 'quitar_alias', alias_id }
 *      { accion: 'sancion_no_pago', match_id, user_id, confirmar: true }
 *
 * MercadoPago: solo GET /v1/payments/search y GET /v1/payments/{id}, con
 * MP_ACCESS_TOKEN (server-only, nunca NEXT_PUBLIC_). Al navegador va solo
 * nombre, fecha y monto: nunca correos completos ni documentos.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase as service } from '../../../../lib/supabase';
import { buscarPagosAprobados, mpConfigurado, obtenerPago, MpError, MpNoConfigurado } from '../../../../lib/mp/client';
import { repoSupabase } from '../../../../lib/mp/repo-supabase';
import { ErrorPagos, estadoPagos, mapearPagador, sancionarNoPago, type Deps } from '../../../../lib/mp/servicio';
import { mensajeDePagos } from '../../../../lib/cierre/datos';
import { exigirMatchId } from '../../../../lib/mp/ids';
import { asignarPagosADeudas, sancionHastaPagarActiva, ventanaConciliacion } from '../../../../lib/mp/deudas';
import { aPagoMp, esPagoDePichanga } from '../../../../lib/mp/pagos-mp';

const ADMINS = ['bmadain@gmail.com', 'pablo.ibanezd@gmail.com'];
// Titulares que no pagan la cancha (Barham organiza y es admin).
const NO_PAGAN = ['bmadain@gmail.com'];
// Galletas + Ibáñez
const GRUPO_ID = 'a812c96c-2193-41fe-b35a-a2b6159ed57f';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

async function requireAdmin(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { deny: NextResponse.json({ error: 'sin token' }, { status: 401 }) };
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user }, error } = await anon.auth.getUser(token);
  if (error || !user?.email || !ADMINS.includes(user.email.toLowerCase())) {
    return { deny: NextResponse.json({ error: 'sin acceso' }, { status: 403 }) };
  }
  return { user };
}

function deps(): Deps {
  return {
    repo: repoSupabase,
    mp: mpConfigurado()
      ? { buscarAprobados: (d, h) => buscarPagosAprobados(d, h), pago: (id) => obtenerPago(id) }
      : null,
    ahora: () => new Date(),
    noPagan: NO_PAGAN,
  };
}

async function extraDeudas(d: ReturnType<typeof deps>) {
  const sancion_hasta_pagar = sancionHastaPagarActiva();
  if (!sancion_hasta_pagar) return { sancion_hasta_pagar, sancionHastaPagar: false, deudas: [] as Awaited<ReturnType<typeof d.repo.deudas>> };
  try {
    const deudas = await d.repo.deudas(GRUPO_ID);
    return { sancion_hasta_pagar, sancionHastaPagar: true, deudas };
  } catch {
    return { sancion_hasta_pagar, sancionHastaPagar: true, deudas: [] as Awaited<ReturnType<typeof d.repo.deudas>> };
  }
}

function fallo(e: unknown) {
  if (e instanceof ErrorPagos) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof MpNoConfigurado) return NextResponse.json({ error: e.message }, { status: 503 });
  if (e instanceof MpError) {
    console.error('[admin/pagos] MercadoPago', e.status); // solo el status, nunca headers ni token
    return NextResponse.json({ error: `MercadoPago no respondió bien (${e.status})` }, { status: 502 });
  }
  console.error('[admin/pagos]', (e as any)?.message ?? 'error');
  return NextResponse.json({ error: 'error interno' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const { deny } = await requireAdmin(req);
  if (deny) return deny;
  try {
    // Cada GET consulta MercadoPago en el momento: nunca cachear (botón «Revisar pagos»)
    const matchId = req.nextUrl.searchParams.get('match_id');
    if (matchId) exigirMatchId(matchId);
    const d = deps();
    const estado = await estadoPagos(d, GRUPO_ID, matchId);
    const extra = await extraDeudas(d);
    const mensaje = await mensajeDePagos(estado, GRUPO_ID, extra);
    return NextResponse.json({ ...estado, ...mensaje, ...extra }, { headers: NO_STORE });
  } catch (e) { return fallo(e); }
}

export async function POST(req: NextRequest) {
  const { deny, user } = await requireAdmin(req);
  if (deny) return deny;
  const body = await req.json().catch(() => ({}));
  try {
    const { data: adminRow } = await service.from('users').select('id').eq('email', user!.email!).maybeSingle();
    const adminId = (adminRow as any)?.id ?? null;
    const d = deps();
    switch (body?.accion) {
      case 'mapear':
        return NextResponse.json(await mapearPagador(d, GRUPO_ID, String(body.payment_id || ''), String(body.user_id || ''), adminId));
      case 'quitar_alias':
        if (!body.alias_id) throw new ErrorPagos('faltan datos');
        await d.repo.borrarAlias(GRUPO_ID, String(body.alias_id));
        return NextResponse.json({ ok: true });
      case 'sancion_no_pago': {
        const matchId = String(body.match_id || '');
        exigirMatchId(matchId);
        return NextResponse.json(await sancionarNoPago(d, GRUPO_ID, {
          match_id: matchId, user_id: String(body.user_id || ''), confirmar: body.confirmar,
        }, adminId));
      }
      case 'saldar_deuda': {
        // Salda player_debts. No toca player_sanctions ni fechas_pendientes: esas fechas ya ganadas se cumplen igual.
        if (!sancionHastaPagarActiva()) return NextResponse.json({ ok: true, omitido: true });
        const userId = String(body.user_id || '');
        if (!userId) throw new ErrorPagos('faltan datos');
        const activas = (await d.repo.deudas(GRUPO_ID)).filter((x) => x.user_id === userId && x.status === 'activa');
        activas.sort((a, b) => a.fecha.localeCompare(b.fecha));
        if (!activas[0]) return NextResponse.json({ ok: true, ya_saldada: true });
        const saldo = await d.repo.saldarDeuda({ debt_id: activas[0].id, via: 'manual', by: adminId });
        if (!saldo.ok) throw new ErrorPagos('no se pudo marcar la deuda (falta aplicar la migración)', 503);
        return NextResponse.json(saldo);
      }
      case 'conciliar_deudas': {
        if (!sancionHastaPagarActiva()) return NextResponse.json({ ok: true, omitido: true, saldadas: [] });
        if (!d.mp) throw new ErrorPagos('sin MercadoPago no se puede conciliar', 503);
        const deudas = (await d.repo.deudas(GRUPO_ID)).filter((x) => x.status === 'activa' && x.fecha);
        if (!deudas.length) return NextResponse.json({ ok: true, saldadas: [], sin_mapear: [] });
        const ventana = ventanaConciliacion(deudas.map((x) => x.fecha), new Date());
        const raw = await d.mp.buscarAprobados(ventana.desde, ventana.hasta);
        const pagos = raw.filter((r) => esPagoDePichanga(r, null)).map((r) => {
          const pago = aPagoMp(r);
          return { id: String(pago.id), fecha: pago.fecha, pago };
        });
        const partidos = await Promise.all(deudas.map((x) => d.repo.partido(x.match_id)));
        const tits = await d.repo.titularesDe(partidos.filter((p): p is NonNullable<typeof p> => Boolean(p)));
        const perfiles = Object.values(tits).flat();
        const aliases = await d.repo.aliases(GRUPO_ID);
        const plan = asignarPagosADeudas({ deudas, pagos, perfiles, aliases });
        const saldadas: string[] = [];
        for (const s of plan) {
          try {
            const r = await d.repo.saldarDeuda({ debt_id: s.debtId, via: 'mp', settled_at: s.settledAt, mp_payment_id: s.paymentId, by: adminId });
            if (r.ok && !r.ya_saldada) saldadas.push(s.debtId);
          } catch (e: any) {
            if (e?.code !== '23505') throw e;
          }
        }
        const cubiertas = new Set(plan.map((s) => s.debtId));
        return NextResponse.json({
          ok: true,
          saldadas,
          sin_mapear: deudas.filter((x) => !cubiertas.has(x.id)).map((x) => ({ user_id: x.user_id, fecha: x.fecha })),
        });
      }
      default:
        throw new ErrorPagos('acción desconocida');
    }
  } catch (e) { return fallo(e); }
}
