-- 030 · mp_payer_aliases: mapeo manual pagador de MercadoPago → jugador.
--
-- NO se aplica con el deploy ni con el merge del PR. Se corre aparte en
-- Supabase (project whxufmuakpmuyiatfttr), con OK de Barham.
-- Rollback: 030_mp_payer_aliases_rollback.sql
--
-- Del pagador NO se guarda el correo: solo su hash SHA-256 (correo en
-- minúsculas y sin acentos), el id de pagador de MP y el nombre normalizado.
-- payer_label es lo que se muestra en el panel (nombre o correo enmascarado).
--
-- Acceso: el panel (/admin/api/pagos) usa service_role desde el servidor y
-- además exige la allowlist de admins. Para anon no hay ningún permiso; para
-- authenticated, solo los admins del grupo (is_group_admin).

BEGIN;

CREATE TABLE IF NOT EXISTS public.mp_payer_aliases (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id           uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES public.users(id)  ON DELETE CASCADE,
  payer_mp_id        text,
  payer_email_sha256 text,
  payer_name_norm    text,
  payer_label        text,
  created_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mp_payer_aliases_alguna_clave
    CHECK (payer_mp_id IS NOT NULL OR payer_email_sha256 IS NOT NULL OR payer_name_norm IS NOT NULL),
  CONSTRAINT mp_payer_aliases_mp_id_formato
    CHECK (payer_mp_id IS NULL OR payer_mp_id ~ '^[0-9]{1,20}$'),
  CONSTRAINT mp_payer_aliases_sha256_formato
    CHECK (payer_email_sha256 IS NULL OR payer_email_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mp_payer_aliases_nombre_formato
    CHECK (payer_name_norm IS NULL OR payer_name_norm ~ '^[a-z0-9 ]{3,120}$')
);

-- Un pagador apunta a un solo jugador por grupo (por cada clave).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_payer_aliases_mp_id
  ON public.mp_payer_aliases (group_id, payer_mp_id) WHERE payer_mp_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_payer_aliases_email
  ON public.mp_payer_aliases (group_id, payer_email_sha256) WHERE payer_email_sha256 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_payer_aliases_nombre
  ON public.mp_payer_aliases (group_id, payer_name_norm) WHERE payer_name_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mp_payer_aliases_user
  ON public.mp_payer_aliases (group_id, user_id);

ALTER TABLE public.mp_payer_aliases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mp_payer_aliases FROM anon;
REVOKE ALL ON public.mp_payer_aliases FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mp_payer_aliases TO authenticated;
GRANT ALL ON public.mp_payer_aliases TO service_role;

CREATE POLICY mpa_admin_select ON public.mp_payer_aliases
  FOR SELECT TO authenticated USING (public.is_group_admin(group_id));
CREATE POLICY mpa_admin_insert ON public.mp_payer_aliases
  FOR INSERT TO authenticated WITH CHECK (public.is_group_admin(group_id));
CREATE POLICY mpa_admin_update ON public.mp_payer_aliases
  FOR UPDATE TO authenticated USING (public.is_group_admin(group_id)) WITH CHECK (public.is_group_admin(group_id));
CREATE POLICY mpa_admin_delete ON public.mp_payer_aliases
  FOR DELETE TO authenticated USING (public.is_group_admin(group_id));

COMMENT ON TABLE public.mp_payer_aliases IS
  'Mapeo manual pagador MercadoPago → jugador (panel admin /admin, pestaña Pagos). Sin correos en claro.';

COMMIT;
