/**
 * API de moderación — /admin/api/moderacion
 *
 * Cumple App Store Guideline 1.2: alguien tiene que poder revisar las
 * denuncias y actuar. Misma allowlist de admins que /admin/api.
 *
 * GET  → denuncias pendientes + usuarios suspendidos
 * POST → { action: 'suspend' | 'unsuspend' | 'hide' | 'resolve' | 'dismiss' }
 *
 * Todo lo que escribe usa el cliente service-role (solo corre en el server).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase as service } from '../../../../lib/supabase';

const ADMINS = ['bmadain@gmail.com', 'pablo.ibanezd@gmail.com'];

export const dynamic = 'force-dynamic';

// Qué tabla toca ocultar según el tipo de contenido denunciado.
const TABLA_POR_KIND: Record<string, string> = {
  group_message: 'group_messages',
  group_photo: 'group_photos',
  photo_comment: 'photo_comments',
};

async function requireAdmin(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { deny: NextResponse.json({ error: 'sin token' }, { status: 401 }) };

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user }, error } = await anon.auth.getUser(token);
  if (error || !user?.email || !ADMINS.includes(user.email.toLowerCase())) {
    return { deny: NextResponse.json({ error: 'sin acceso' }, { status: 403 }) };
  }
  return { user };
}

export async function GET(req: NextRequest) {
  const { deny, user } = await requireAdmin(req);
  if (deny) return deny;

  const { data: denuncias, error: e1 } = await service
    .from('content_reports')
    .select(`
      id, kind, target_id, reason, content_snapshot, status, created_at,
      reporter:users!content_reports_reporter_id_fkey(id, display_name, email),
      denunciado:users!content_reports_target_user_id_fkey(id, display_name, email, suspended_at),
      grupo:groups(id, name)
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(200);
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  const { data: suspendidos, error: e2 } = await service
    .from('users')
    .select('id, display_name, email, suspended_at, suspended_reason')
    .not('suspended_at', 'is', null)
    .order('suspended_at', { ascending: false });
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  return NextResponse.json({
    denuncias: denuncias ?? [],
    suspendidos: suspendidos ?? [],
    admin: user!.email,
  });
}

export async function POST(req: NextRequest) {
  const { deny, user } = await requireAdmin(req);
  if (deny) return deny;

  const body = await req.json().catch(() => ({}));
  const { action, reportId, userId, motivo, kind, targetId } = body as Record<string, string>;

  // Quién ejecuta la acción, para dejar rastro en suspended_by / reviewed_by.
  const { data: adminRow } = await service
    .from('users').select('id').eq('email', user!.email!).maybeSingle();
  const adminId = (adminRow as any)?.id ?? null;

  const marcarRevisada = async (estado: 'actioned' | 'dismissed') => {
    if (!reportId) return;
    await service.from('content_reports').update({
      status: estado,
      reviewed_at: new Date().toISOString(),
      reviewed_by: adminId,
      admin_notes: motivo ?? null,
    }).eq('id', reportId);
  };

  try {
    switch (action) {
      case 'suspend': {
        if (!userId) throw new Error('falta userId');
        const { error } = await service.from('users').update({
          suspended_at: new Date().toISOString(),
          suspended_reason: motivo ?? 'Incumple las normas de la comunidad',
          suspended_by: adminId,
        }).eq('id', userId);
        if (error) throw error;
        await marcarRevisada('actioned');
        break;
      }
      case 'unsuspend': {
        if (!userId) throw new Error('falta userId');
        const { error } = await service.from('users').update({
          suspended_at: null, suspended_reason: null, suspended_by: null,
        }).eq('id', userId);
        if (error) throw error;
        break;
      }
      case 'hide': {
        const tabla = TABLA_POR_KIND[kind ?? ''];
        if (!tabla || !targetId) throw new Error('contenido no identificable');
        const { error } = await service.from(tabla).update({ is_deleted: true }).eq('id', targetId);
        if (error) throw error;
        await marcarRevisada('actioned');
        break;
      }
      case 'resolve':  await marcarRevisada('actioned');  break;
      case 'dismiss':  await marcarRevisada('dismissed'); break;
      default: throw new Error('acción desconocida');
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'error' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
