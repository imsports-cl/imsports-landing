-- Revisión de Barham. Este archivo NO se aplica a producción con el deploy
-- ni con el merge del PR. Se corre aparte en Supabase, con OK de Barham.
--
-- Regla (solo confirmaciones):
--   match_confirmations.status = 'confirmed' en las últimas 12 partidas
--   completadas del grupo a812c96c-2193-41fe-b35a-a2b6159ed57f.
--   Una vez por usuario y partido (UNIQUE). Sin respaldo por
--   match_players.attended y sin corte de fecha 2026-10-12.
--   Un partido antiguo sin convocatoria no suma a nadie.
--
-- 1) admin_panel_data: conserva las claves fechas, ranking y registrados.
--    Agrega ultimas12_confirmacion (nombre, is_ghost, confirmadas, jugo, banca).
-- 2) admin_lineup: solo cambia la CTE asistencias. El resto queda igual
--    que la definición viva al 2026-10-11.

-- ---------------------------------------------------------------------------
-- 1. Panel: mismas claves + ultimas12_confirmacion
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_panel_data()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH grp AS (SELECT 'a812c96c-2193-41fe-b35a-a2b6159ed57f'::uuid AS id),
last12 AS (
  SELECT m.id, m.date, m.team_a_score, m.team_b_score
  FROM matches m, grp
  WHERE m.group_id = grp.id AND m.status = 'completed'
  ORDER BY m.date DESC
  LIMIT 12
),
rk AS (
  SELECT
    COALESCE(gm.nickname, u.display_name) AS nombre,
    u.is_ghost,
    count(*)::int AS pj,
    count(*) FILTER (WHERE (mp.team='a' AND l.team_a_score > l.team_b_score)
                        OR (mp.team='b' AND l.team_b_score > l.team_a_score))::int AS v,
    count(*) FILTER (WHERE l.team_a_score = l.team_b_score)::int AS e,
    count(*) FILTER (WHERE (mp.team='a' AND l.team_a_score < l.team_b_score)
                        OR (mp.team='b' AND l.team_b_score < l.team_a_score))::int AS d,
    COALESCE(sum(mp.goals),0)::int AS goles,
    count(*) FILTER (WHERE mp.is_mvp)::int AS mvp
  FROM match_players mp
  JOIN last12 l ON l.id = mp.match_id
  JOIN users u ON u.id = mp.user_id
  LEFT JOIN group_members gm ON gm.user_id = mp.user_id AND gm.group_id = (SELECT id FROM grp)
  GROUP BY 1, 2
),
-- Una fila por usuario y partido. is_starter distingue jugó (true) y banca (false).
conf_partida AS (
  SELECT DISTINCT ON (mc.user_id, l.id)
         mc.user_id,
         l.id AS match_id,
         mc.is_starter
    FROM last12 l
    JOIN match_confirmations mc ON mc.match_id = l.id
   WHERE mc.status = 'confirmed'
   ORDER BY mc.user_id, l.id, mc.is_starter DESC NULLS LAST
),
conf AS (
  SELECT
    COALESCE(gm.nickname, u.display_name) AS nombre,
    u.is_ghost,
    count(*)::int AS confirmadas,
    count(*) FILTER (WHERE c.is_starter IS TRUE)::int AS jugo,
    count(*) FILTER (WHERE c.is_starter IS FALSE)::int AS banca
  FROM conf_partida c
  JOIN users u ON u.id = c.user_id
  LEFT JOIN group_members gm ON gm.user_id = c.user_id AND gm.group_id = (SELECT id FROM grp)
  GROUP BY u.id, 1, u.is_ghost
)
SELECT jsonb_build_object(
  'fechas', (SELECT COALESCE(jsonb_agg(to_char(date,'DD Mon YYYY') ORDER BY date DESC), '[]'::jsonb) FROM last12),
  'ranking', (SELECT COALESCE(jsonb_agg(to_jsonb(rk) ORDER BY rk.pj DESC, rk.v DESC, rk.goles DESC), '[]'::jsonb) FROM rk),
  'registrados', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'nombre', COALESCE(gm.nickname, u.display_name, au.email),
      'email', au.email,
      'registrado', to_char(au.created_at, 'YYYY-MM-DD'),
      'ultimo_acceso', to_char(au.last_sign_in_at, 'YYYY-MM-DD HH24:MI'),
      'partidos', (SELECT count(*)::int FROM match_players mp WHERE mp.user_id = au.id)
    ) ORDER BY au.created_at DESC), '[]'::jsonb)
    FROM auth.users au
    LEFT JOIN users u ON u.id = au.id
    LEFT JOIN group_members gm ON gm.user_id = au.id AND gm.group_id = (SELECT id FROM grp)
  ),
  'ultimas12_confirmacion', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'nombre', conf.nombre,
      'is_ghost', conf.is_ghost,
      'confirmadas', conf.confirmadas,
      'jugo', conf.jugo,
      'banca', conf.banca
    ) ORDER BY conf.confirmadas DESC, conf.jugo DESC, conf.nombre), '[]'::jsonb)
    FROM conf
  )
);
$function$;

-- Privilegios vivos de admin_panel_data: solo postgres y service_role.
REVOKE ALL ON FUNCTION public.admin_panel_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_panel_data() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_panel_data() TO service_role;

-- ---------------------------------------------------------------------------
-- 2. admin_lineup: idéntica a la viva, salvo la CTE asistencias
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_lineup(p_group_id uuid DEFAULT NULL::uuid, p_match_id uuid DEFAULT NULL::uuid, p_cupos integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_group uuid;
  v_match record;
  v_prev  record;
  v_result jsonb;
BEGIN
  v_group := COALESCE(p_group_id, (SELECT id FROM groups ORDER BY member_count DESC LIMIT 1));

  SELECT m.* INTO v_match FROM matches m
   WHERE (p_match_id IS NOT NULL AND m.id = p_match_id)
      OR (p_match_id IS NULL AND m.group_id = v_group
          AND m.phase <> 'closed' AND m.status <> 'cancelled')
   ORDER BY m.date ASC LIMIT 1;

  IF v_match IS NULL THEN
    SELECT m.* INTO v_match FROM matches m
     WHERE m.group_id = v_group AND m.status <> 'cancelled'
     ORDER BY m.date DESC LIMIT 1;
  END IF;
  IF v_match IS NULL THEN RETURN jsonb_build_object('error', 'sin partidos'); END IF;

  SELECT m.id, m.date, m.mvp_user_id INTO v_prev FROM matches m
   WHERE m.group_id = v_match.group_id AND m.status = 'completed'
     AND m.date < v_match.date
   ORDER BY m.date DESC LIMIT 1;

  WITH RECURSIVE ult12 AS (
    SELECT m.id FROM matches m
     WHERE m.group_id = v_match.group_id AND m.status = 'completed'
       AND m.date < v_match.date
     ORDER BY m.date DESC LIMIT 12
  ),
  asistencias AS (
    -- Solo confirmaciones. Una por usuario y partido. Sin match_players
    -- y sin corte 2026-10-12: la fecha sin convocatoria no suma.
    SELECT d.user_id, count(*) AS pj
      FROM (
        SELECT DISTINCT mc.user_id, u.id AS match_id
          FROM ult12 u
          JOIN match_confirmations mc ON mc.match_id = u.id
         WHERE mc.status = 'confirmed'
      ) d
     GROUP BY d.user_id
  ),
  sancionados AS (
    SELECT ps.user_id, ps.reason FROM player_sanctions ps
     WHERE ps.group_id = v_match.group_id AND ps.applies_to = v_match.date::date
  ),
  -- Todas las veces que quedó en banca, en orden cronológico
  bancas_hist AS (
    SELECT mc.user_id, m.date::date AS f
      FROM matches m JOIN match_confirmations mc ON mc.match_id = m.id
     WHERE m.group_id = v_match.group_id AND m.status = 'completed'
       AND m.date < v_match.date
       AND mc.status = 'confirmed' AND mc.is_starter = false
       AND (m.starters_announced_at IS NULL OR mc.responded_at <= m.starters_announced_at)
       AND NOT EXISTS (SELECT 1 FROM player_sanctions ps2
                        WHERE ps2.group_id = m.group_id AND ps2.user_id = mc.user_id
                          AND ps2.applies_to = m.date::date)
  ),
  bancas_ord AS (
    SELECT user_id, f, row_number() OVER (PARTITION BY user_id ORDER BY f) AS rn
      FROM bancas_hist
  ),
  -- Banca con beneficio vigente => mantiene la fecha; vencido => arranca de nuevo
  bancas_fold AS (
    SELECT user_id, rn, (f + 28) AS hasta FROM bancas_ord WHERE rn = 1
    UNION ALL
    SELECT o.user_id, o.rn,
           CASE WHEN o.f > fd.hasta THEN o.f + 28 ELSE fd.hasta END
      FROM bancas_fold fd
      JOIN bancas_ord o ON o.user_id = fd.user_id AND o.rn = fd.rn + 1
  ),
  banca_auto AS (
    SELECT z.user_id, z.hasta FROM (
      SELECT DISTINCT ON (user_id) user_id, hasta
        FROM bancas_fold ORDER BY user_id, rn DESC
    ) z WHERE z.hasta >= v_match.date::date
  ),
  manual AS (
    SELECT gs.user_id, gs.until_date AS hasta, gs.reason FROM guaranteed_spots gs
     WHERE gs.group_id = v_match.group_id AND gs.until_date >= v_match.date::date
  ),
  excluidos AS (SELECT user_id FROM manual WHERE reason = 'excluido'),
  -- tipo: 3=MVP, 2=organizador, 1=banca/manual
  asegurados AS (
    SELECT user_id, max(hasta) AS hasta, max(tipo) AS tipo FROM (
      SELECT user_id, hasta, 1 AS tipo FROM banca_auto
      UNION ALL
      SELECT user_id, hasta, 1 FROM manual WHERE reason <> 'excluido'
      UNION ALL
      SELECT v_match.created_by, v_match.date::date, 2
       WHERE v_match.created_by IS NOT NULL
      UNION ALL
      SELECT v_prev.mvp_user_id, v_match.date::date, 3
       WHERE v_prev.mvp_user_id IS NOT NULL
    ) x
    WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT user_id FROM excluidos)
    GROUP BY user_id
  ),
  confirmados AS (
    SELECT mc.user_id, mc.responded_at,
           COALESCE(gm.nickname, u.display_name) AS nombre,
           COALESCE(gm.avatar_url, u.avatar_url)  AS avatar,
           COALESCE(a.pj, 0) AS pj,
           row_number() OVER (ORDER BY mc.responded_at ASC NULLS LAST) AS orden
      FROM match_confirmations mc
      JOIN users u ON u.id = mc.user_id
      LEFT JOIN group_members gm ON gm.user_id = mc.user_id AND gm.group_id = v_match.group_id
      LEFT JOIN asistencias a ON a.user_id = mc.user_id
     WHERE mc.match_id = v_match.id AND mc.status = 'confirmed'
  ),
  base AS (
    SELECT c.*,
           -- El cupo asegurado solo rige si confirmó dentro de los primeros p_cupos
           CASE WHEN c.orden <= p_cupos THEN s.tipo END AS tipo_cupo,
           s.hasta AS asegura_hasta,
           (s.user_id IS NOT NULL AND c.orden > p_cupos) AS cupo_caducado,
           (sn.user_id IS NOT NULL) AS sancionado,
           sn.reason AS sancion_motivo,
           -- NETEO: cupo asegurado VIGENTE Y pierde cupo → se anulan
           (s.user_id IS NOT NULL AND c.orden <= p_cupos
            AND sn.user_id IS NOT NULL) AS neteado,
           (v_match.starters_announced_at IS NOT NULL
            AND c.responded_at > v_match.starters_announced_at) AS confirmo_tarde
      FROM confirmados c
      LEFT JOIN asegurados s   ON s.user_id  = c.user_id
      LEFT JOIN sancionados sn ON sn.user_id = c.user_id
  ),
  ranked AS (
    SELECT b.*,
           -- 0 = asegurado, 1 = normal (incluye neteados), 2 = sancionado puro
           CASE WHEN b.neteado THEN 1
                WHEN b.sancionado THEN 2
                WHEN b.tipo_cupo IS NOT NULL THEN 0
                ELSE 1 END AS grupo,
           row_number() OVER (
             ORDER BY
               CASE WHEN b.confirmo_tarde THEN 3 WHEN b.neteado THEN 1 WHEN b.sancionado THEN 2
                    WHEN b.tipo_cupo IS NOT NULL THEN 0 ELSE 1 END ASC,
               CASE WHEN b.neteado OR b.sancionado OR b.confirmo_tarde THEN 0
                    ELSE COALESCE(b.tipo_cupo, 0) END DESC,      -- MVP > organizador > banca
               CASE WHEN b.sancionado AND NOT b.neteado THEN 0
                    ELSE b.pj END DESC,                           -- sancionado puro = sin puntos
               b.responded_at ASC NULLS LAST
           ) AS pos
      FROM base b
  )
  SELECT jsonb_build_object(
    'match', jsonb_build_object(
        'id', v_match.id, 'fecha', v_match.date::date, 'hora', v_match.time,
        'lugar', v_match.location, 'fase', v_match.phase, 'cupos', p_cupos,
        'organizador', (SELECT COALESCE(gm.nickname, u.display_name) FROM users u
                          LEFT JOIN group_members gm ON gm.user_id = u.id AND gm.group_id = v_match.group_id
                         WHERE u.id = v_match.created_by)),
    'mvp_previo', (SELECT COALESCE(gm.nickname, u.display_name) FROM users u
                     LEFT JOIN group_members gm ON gm.user_id = u.id AND gm.group_id = v_match.group_id
                    WHERE u.id = v_prev.mvp_user_id),
    'fecha_previa', v_prev.date::date,
    'jugadores', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'user_id', r.user_id, 'nombre', r.nombre, 'avatar', r.avatar,
        'pj', r.pj, 'orden', r.orden, 'pos', r.pos,
        'titular', r.pos <= p_cupos,
        'asegurado', (r.grupo = 0),
        'es_mvp', (r.tipo_cupo = 3), 'es_organizador', (r.tipo_cupo = 2),
        'sancionado', r.sancionado, 'sancion_motivo', r.sancion_motivo,
        'neteado', r.neteado, 'confirmo_tarde', r.confirmo_tarde,
        'cupo_caducado', r.cupo_caducado,
        'asegura_hasta', r.asegura_hasta,
        'confirmo_at', r.responded_at
      ) ORDER BY r.pos) FROM ranked r), '[]'::jsonb),
    'asegurados_sin_confirmar', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'user_id', s.user_id, 'nombre', COALESCE(gm.nickname, u.display_name),
          'asegura_hasta', s.hasta, 'estado', COALESCE(mc.status, 'sin_responder'))
        ORDER BY COALESCE(gm.nickname, u.display_name))
        FROM asegurados s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN group_members gm ON gm.user_id = s.user_id AND gm.group_id = v_match.group_id
        LEFT JOIN match_confirmations mc ON mc.match_id = v_match.id AND mc.user_id = s.user_id
       WHERE COALESCE(mc.status, 'pending') <> 'confirmed'
         AND s.user_id NOT IN (SELECT user_id FROM sancionados)), '[]'::jsonb),
    'cupos_asegurados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'user_id', s.user_id, 'nombre', COALESCE(gm.nickname, u.display_name),
          'hasta', s.hasta, 'es_mvp', (s.tipo = 3), 'es_organizador', (s.tipo = 2),
          'manual', EXISTS(SELECT 1 FROM manual mm WHERE mm.user_id = s.user_id AND mm.reason <> 'excluido'))
        ORDER BY s.tipo DESC, s.hasta DESC, COALESCE(gm.nickname, u.display_name))
        FROM asegurados s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN group_members gm ON gm.user_id = s.user_id AND gm.group_id = v_match.group_id), '[]'::jsonb),
    'sanciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'user_id', sn.user_id, 'nombre', COALESCE(gm.nickname, u.display_name),
          'motivo', sn.reason,
          'neteado', EXISTS(SELECT 1 FROM asegurados a2 WHERE a2.user_id = sn.user_id),
          'confirmo', EXISTS(SELECT 1 FROM match_confirmations mc
                              WHERE mc.match_id = v_match.id AND mc.user_id = sn.user_id
                                AND mc.status = 'confirmed'))
        ORDER BY COALESCE(gm.nickname, u.display_name))
        FROM sancionados sn
        JOIN users u ON u.id = sn.user_id
        LEFT JOIN group_members gm ON gm.user_id = sn.user_id AND gm.group_id = v_match.group_id), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- Privilegios vivos de admin_lineup: PUBLIC y service_role. No se restringen acá.
GRANT EXECUTE ON FUNCTION public.admin_lineup(uuid, uuid, integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_lineup(uuid, uuid, integer) TO service_role;
