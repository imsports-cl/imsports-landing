/**
 * API de novedades — /admin/api/novedades
 *
 * Noticias que se muestran en el feed del inicio de la app (y mandan push
 * al publicarse, vía trigger en la base) + auspiciadores que aparecen como
 * burbujas entre las noticias. Misma allowlist que /admin/api.
 *
 * GET  → { noticias, auspiciadores }
 * POST → { action: 'news_create' | 'news_update' | 'news_delete'
 *                | 'sponsor_create' | 'sponsor_update' | 'sponsor_delete', ... }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase as service } from '../../../../lib/supabase';

const ADMINS = ['bmadain@gmail.com', 'pablo.ibanezd@gmail.com'];

export const dynamic = 'force-dynamic';

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

const clean = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length ? s : null;
};

export async function GET(req: NextRequest) {
  const { deny } = await requireAdmin(req);
  if (deny) return deny;

  const [{ data: noticias, error: e1 }, { data: auspiciadores, error: e2 }] = await Promise.all([
    service.from('news_posts').select('*').order('pinned', { ascending: false }).order('published_at', { ascending: false }).limit(200),
    service.from('sponsors').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false }),
  ]);
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  return NextResponse.json({ noticias: noticias ?? [], auspiciadores: auspiciadores ?? [] });
}

export async function POST(req: NextRequest) {
  const { deny, user } = await requireAdmin(req);
  if (deny) return deny;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');

  try {
    if (action === 'news_create') {
      const title = clean(body.title);
      if (!title) return NextResponse.json({ error: 'Falta el título' }, { status: 400 });
      const { data, error } = await service.from('news_posts').insert({
        title,
        body: clean(body.body),
        image_url: clean(body.image_url),
        link_url: clean(body.link_url),
        link_label: clean(body.link_label),
        pinned: !!body.pinned,
        notify: body.notify !== false,
        is_active: true,
        created_by: user!.email,
      }).select('*').single();
      if (error) throw error;
      return NextResponse.json({ ok: true, noticia: data });
    }

    if (action === 'news_update') {
      const id = String(body.id || '');
      if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });
      const patch: Record<string, unknown> = {};
      if ('title' in body) patch.title = clean(body.title) ?? undefined;
      if ('body' in body) patch.body = clean(body.body);
      if ('image_url' in body) patch.image_url = clean(body.image_url);
      if ('link_url' in body) patch.link_url = clean(body.link_url);
      if ('link_label' in body) patch.link_label = clean(body.link_label);
      if ('pinned' in body) patch.pinned = !!body.pinned;
      if ('is_active' in body) patch.is_active = !!body.is_active;
      const { error } = await service.from('news_posts').update(patch).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === 'news_delete') {
      const { error } = await service.from('news_posts').delete().eq('id', String(body.id || ''));
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === 'sponsor_create') {
      const name = clean(body.name);
      if (!name) return NextResponse.json({ error: 'Falta el nombre' }, { status: 400 });
      const { data, error } = await service.from('sponsors').insert({
        name,
        tagline: clean(body.tagline),
        logo_url: clean(body.logo_url),
        link_url: clean(body.link_url),
        sort_order: Number(body.sort_order) || 0,
        starts_at: clean(body.starts_at),
        ends_at: clean(body.ends_at),
        is_active: true,
      }).select('*').single();
      if (error) throw error;
      return NextResponse.json({ ok: true, auspiciador: data });
    }

    if (action === 'sponsor_update') {
      const id = String(body.id || '');
      if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });
      const patch: Record<string, unknown> = {};
      for (const k of ['name', 'tagline', 'logo_url', 'link_url', 'starts_at', 'ends_at'] as const) {
        if (k in body) patch[k] = clean(body[k]);
      }
      if ('sort_order' in body) patch.sort_order = Number(body.sort_order) || 0;
      if ('is_active' in body) patch.is_active = !!body.is_active;
      const { error } = await service.from('sponsors').update(patch).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === 'sponsor_delete') {
      const { error } = await service.from('sponsors').delete().eq('id', String(body.id || ''));
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'acción desconocida' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'error' }, { status: 500 });
  }
}
