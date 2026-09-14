/**
 * API del panel admin — /admin/api
 * Autoriza SOLO a los emails de ADMINS (verificando el JWT de Supabase del
 * usuario logueado) y devuelve los datos vía RPCs que solo son ejecutables
 * con service role (revocadas para anon/authenticated).
 *
 * GET           → { ...admin_panel_data(), lineup: admin_lineup() }
 * POST {accion} → gestiona cupos asegurados (guaranteed_spots)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase as service } from '../../../lib/supabase';

// Barham + Pablo Ibáñez (Spid). Para agregar admins: sumar email y redeploy.
const ADMINS = ['bmadain@gmail.com', 'pablo.ibanezd@gmail.com'];

const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoeHVmbXVha3BtdXlpYXRmdHRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NDgxOTEsImV4cCI6MjA5MDEyNDE5MX0.TB5FXT570-RyM8rW56Gsxj92LoXOhs_DtypZiZP1xiY';

export const dynamic = 'force-dynamic';

/** Verifica el JWT y que el email esté en la allowlist. */
async function requireAdmin(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { error: NextResponse.json({ error: 'sin token' }, { status: 401 }) };

  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ANON_KEY);
  const { data: { user }, error } = await anon.auth.getUser(token);
  if (error || !user?.email || !ADMINS.includes(user.email.toLowerCase())) {
    return { error: NextResponse.json({ error: 'sin acceso' }, { status: 403 }) };
  }
  return { user };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const cupos = Number(req.nextUrl.searchParams.get('cupos') || 12);

  const [panel, lineup, miembros] = await Promise.all([
    service.rpc('admin_panel_data'),
    service.rpc('admin_lineup', { p_cupos: cupos }),
    service.rpc('admin_lineup_members'),
  ]);

  if (panel.error) return NextResponse.json({ error: panel.error.message }, { status: 500 });
  if (lineup.error) return NextResponse.json({ error: lineup.error.message }, { status: 500 });

  return NextResponse.json({ ...panel.data, lineup: lineup.data, miembros: miembros.data || [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const { accion, user_id, hasta, reason } = body as {
    accion?: string; user_id?: string; hasta?: string; reason?: string;
  };

  // Grupo del partido vigente (mismo criterio que admin_lineup)
  const { data: grupo } = await service
    .from('groups').select('id').order('member_count', { ascending: false }).limit(1).single();
  if (!grupo) return NextResponse.json({ error: 'sin grupo' }, { status: 500 });

  if (accion === 'agregar') {
    if (!user_id || !hasta) return NextResponse.json({ error: 'faltan datos' }, { status: 400 });
    // Agregar siempre levanta una exclusión previa (si el admin lo quitó por error)
    await service.from('guaranteed_spots')
      .delete().eq('group_id', grupo.id).eq('user_id', user_id).eq('reason', 'excluido');
    const { error } = await service.from('guaranteed_spots').upsert(
      { group_id: grupo.id, user_id, until_date: hasta, reason: reason || 'banca' },
      { onConflict: 'group_id,user_id,reason' }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (accion === 'quitar') {
    // Quitar un cupo: si es automático (banca detectada), se registra una exclusión.
    if (!user_id) return NextResponse.json({ error: 'faltan datos' }, { status: 400 });
    await service.from('guaranteed_spots')
      .delete().eq('group_id', grupo.id).eq('user_id', user_id).neq('reason', 'excluido');
    const { error } = await service.from('guaranteed_spots').upsert(
      { group_id: grupo.id, user_id, until_date: '2099-12-31', reason: 'excluido' },
      { onConflict: 'group_id,user_id,reason' }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (accion === 'restaurar') {
    if (!user_id) return NextResponse.json({ error: 'faltan datos' }, { status: 400 });
    const { error } = await service.from('guaranteed_spots')
      .delete().eq('group_id', grupo.id).eq('user_id', user_id).eq('reason', 'excluido');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── "Pierde cupo": sanción de UNA fecha (no pagó a tiempo / llegó tarde) ──
  if (accion === 'sancionar') {
    if (!user_id || !hasta) return NextResponse.json({ error: 'faltan datos' }, { status: 400 });
    const { error } = await service.from('player_sanctions').upsert(
      { group_id: grupo.id, user_id, applies_to: hasta, reason: reason || 'atraso' },
      { onConflict: 'group_id,user_id,applies_to' }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (accion === 'quitar_sancion') {
    if (!user_id || !hasta) return NextResponse.json({ error: 'faltan datos' }, { status: 400 });
    const { error } = await service.from('player_sanctions')
      .delete().eq('group_id', grupo.id).eq('user_id', user_id).eq('applies_to', hasta);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'acción desconocida' }, { status: 400 });
}
