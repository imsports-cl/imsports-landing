/**
 * API del panel admin — /admin/api
 * Autoriza SOLO a los emails de ADMINS (verificando el JWT de Supabase del
 * usuario logueado) y devuelve los datos vía RPC admin_panel_data(), que solo
 * es ejecutable con service role (revocada para anon/authenticated).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase as service } from '../../../lib/supabase';

// Barham + Pablo Ibáñez (Spid). Para agregar admins: sumar email y redeploy.
const ADMINS = ['bmadain@gmail.com', 'pablo.ibanezd@gmail.com'];

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'sin token' }, { status: 401 });

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoeHVmbXVha3BtdXlpYXRmdHRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NDgxOTEsImV4cCI6MjA5MDEyNDE5MX0.TB5FXT570-RyM8rW56Gsxj92LoXOhs_DtypZiZP1xiY'
  );
  const { data: { user }, error } = await anon.auth.getUser(token);
  if (error || !user?.email || !ADMINS.includes(user.email.toLowerCase())) {
    return NextResponse.json({ error: 'sin acceso' }, { status: 403 });
  }

  const { data, error: rpcErr } = await service.rpc('admin_panel_data');
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  return NextResponse.json(data);
}
