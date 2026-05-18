/**
 * Supabase clients para Next.js (Server Components / Route Handlers).
 *
 * IMPORTANTE: usamos service role key porque el código solo corre en el server
 * (Next.js Server Components y Route Handlers). NUNCA se expone al cliente.
 *
 * Esto evita tener que abrir RLS policies para anon (más seguro).
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Server-only client. NUNCA importar desde Client Components.
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export interface MatchOG {
  id: string;
  phase: string;
  date: string | null;
  time: string | null;
  location: string | null;
  team_a_name: string | null;
  team_b_name: string | null;
  team_a_score: number | null;
  team_b_score: number | null;
  mvp_user_id: string | null;
  group: {
    name: string;
    sport: { name: string; emoji: string | null } | null;
  } | null;
  mvp: { display_name: string } | null;
}

/**
 * Fetch a match with everything we need to render OG meta + image.
 *
 * Schema:
 *   matches.group_id → groups.id
 *   groups.sport_id  → sports.id (has emoji + name)
 *   matches.mvp_user_id → users.id
 */
export async function fetchMatchForOG(id: string): Promise<MatchOG | null> {
  const { data, error } = await supabase
    .from('matches')
    .select(`
      id, phase, date, time, location,
      team_a_name, team_b_name, team_a_score, team_b_score, mvp_user_id,
      group:groups(name, sport:sports(name, emoji)),
      mvp:users!mvp_user_id(display_name)
    `)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[fetchMatchForOG] error:', error);
    return null;
  }
  return data as any;
}

export const PHASE_LABELS: Record<string, string> = {
  created: 'Próximo partido',
  convocatoria: 'Convocatoria abierta',
  titulares: 'Titulares definidos',
  equipos: 'Equipos armados',
  playing: 'Partido en juego',
  voting: 'Votación MVP',
  closed: 'Partido cerrado',
};

export const PHASE_EMOJI: Record<string, string> = {
  created: '📅',
  convocatoria: '📢',
  titulares: '⭐',
  equipos: '👕',
  playing: '⚽',
  voting: '🗳️',
  closed: '🏆',
};
