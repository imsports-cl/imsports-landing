/**
 * Cron de Vercel: una vez al día, 13:00 UTC (10:00 hora de Chile). Hobby no admite cada 10 min.
 * Authorization: Bearer CRON_SECRET. Con SANCIONES_AL_CIERRE apagado no escribe.
 * Mercado Pago solo lectura. No toca matches. No loguea el secreto ni correos.
 */
import { NextRequest, NextResponse } from 'next/server';
import { buscarPagosAprobados, mpConfigurado, obtenerPago } from '../../../../lib/mp/client';
import { repoSupabase } from '../../../../lib/mp/repo-supabase';
import { NO_PAGAN_CANCHA, correrSancionesCierre, cronAutorizado, sancionesAlCierreActivas } from '../../../../lib/mp/sanciones-cierre';
import { ErrorPagos, type Deps } from '../../../../lib/mp/servicio';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

function deps(): Deps {
  return {
    repo: repoSupabase,
    mp: mpConfigurado()
      ? { buscarAprobados: (d, h) => buscarPagosAprobados(d, h), pago: (id) => obtenerPago(id) }
      : null,
    ahora: () => new Date(),
    noPagan: [...NO_PAGAN_CANCHA],
    sancionesAlCierre: sancionesAlCierreActivas(),
  };
}

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  try {
    const r = await correrSancionesCierre(deps());
    return NextResponse.json(r, { headers: NO_STORE });
  } catch (e) {
    console.error('[cron/sanciones-cierre]', e instanceof ErrorPagos ? e.status : 'error');
    return NextResponse.json({ error: 'error interno' }, { status: 500, headers: NO_STORE });
  }
}
