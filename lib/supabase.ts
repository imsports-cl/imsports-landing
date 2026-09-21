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
  /** Nombre visible del MVP (apodo del grupo > display_name) */
  mvp_name: string | null;
  /** Jugadores confirmados del partido (para titulares / equipos / goleadores) */
  players: MatchOGPlayer[];
}

export interface MatchOGPlayer {
  user_id: string;
  name: string;
  is_starter: boolean | null;
  team: 'a' | 'b' | null;
  goals: number;
  bench_order: number | null;
  responded_at: string | null;
}

/** Nombre corto para tarjetas: apodo o primer nombre (máx. 14 chars) */
export function shortName(name: string): string {
  const n = (name || 'Jugador').trim();
  const first = n.split(' ')[0];
  const out = first.length >= 3 ? first : n;
  return out.length > 14 ? out.slice(0, 13) + '…' : out;
}

/** Fecha corta en español: "dom 14 sept".
 *  La fecha del partido se guarda como timestamp cuyo DÍA en UTC es el día
 *  real (la app guarda 00:00Z o la hora local convertida); formatear en
 *  America/Santiago la corría un día hacia atrás. */
export function formatShortDate(date: string | null): string {
  if (!date) return '';
  try {
    return new Date(date).toLocaleDateString('es-CL', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
    });
  } catch {
    return date;
  }
}

/** Goleadores de un equipo: "Thomas x3, Benja x2, Alan" */
export function scorersLine(players: MatchOGPlayer[], team: 'a' | 'b'): string {
  return players
    .filter((p) => p.team === team && p.goals > 0)
    .sort((a, b) => b.goals - a.goals)
    .map((p) => `${shortName(p.name)}${p.goals > 1 ? ` x${p.goals}` : ''}`)
    .join(', ');
}

export function startersOf(players: MatchOGPlayer[], team?: 'a' | 'b'): MatchOGPlayer[] {
  return players
    .filter((p) => p.is_starter === true && (team ? p.team === team : true))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export function benchOf(players: MatchOGPlayer[]): MatchOGPlayer[] {
  return players
    .filter((p) => p.is_starter === false)
    .sort((a, b) => (a.bench_order ?? 999) - (b.bench_order ?? 999)
      || String(a.responded_at || '').localeCompare(String(b.responded_at || '')));
}

/** Versión corta del estado, para que WhatsApp no cachee una imagen vieja */
export function ogVersion(m: MatchOG): string {
  const parts = [
    m.phase, m.team_a_score ?? '', m.team_b_score ?? '', m.mvp_user_id ?? '',
    m.players.filter((p) => p.is_starter === true).length,
    m.players.filter((p) => p.is_starter === false).length,
    m.players.filter((p) => p.team).length,
    m.players.reduce((s, p) => s + p.goals, 0),
  ];
  return parts.join('.');
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
      id, phase, date, time, location, group_id,
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
  if (!data) return null;

  // Jugadores confirmados + apodos del grupo (para titulares/equipos/goleadores)
  const groupId = (data as any).group_id as string;
  const [{ data: confs }, { data: members }] = await Promise.all([
    supabase
      .from('match_confirmations')
      .select('user_id, is_starter, team, goals, bench_order, responded_at, user:users(display_name)')
      .eq('match_id', id)
      .eq('status', 'confirmed'),
    supabase
      .from('group_members')
      .select('user_id, nickname')
      .eq('group_id', groupId),
  ]);
  const nick = new Map<string, string>();
  (members || []).forEach((m: any) => { if (m.nickname) nick.set(m.user_id, m.nickname); });

  const players: MatchOGPlayer[] = (confs || []).map((c: any) => ({
    user_id: c.user_id,
    name: nick.get(c.user_id) || c.user?.display_name || 'Jugador',
    is_starter: c.is_starter,
    team: c.team,
    goals: c.goals || 0,
    bench_order: c.bench_order ?? null,
    responded_at: c.responded_at ?? null,
  }));

  const mvpId = (data as any).mvp_user_id as string | null;
  const mvp_name = mvpId
    ? (nick.get(mvpId) || (data as any).mvp?.display_name || null)
    : null;

  return { ...(data as any), players, mvp_name } as MatchOG;
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
