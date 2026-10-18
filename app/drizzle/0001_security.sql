-- AgeOS security baseline. Re-runnable: scripts/migrate.ts calls
-- ageos_apply_security() after every migration batch so new tables inherit it.
--
-- * The application connects as role ageos_app (NOSUPERUSER, NOBYPASSRLS).
-- * Migrations and the demo seed run as the schema owner role.
-- * Every table with a tenant_id column (except the membership registry and
--   the platform audit stream) gets ROW LEVEL SECURITY with a policy bound to
--   the transaction-local setting app.tenant_id. Unset context => no rows.
-- * Audit streams are append-only for the application role.
CREATE OR REPLACE FUNCTION ageos_apply_security() RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ageos_app') THEN
    RAISE NOTICE 'role ageos_app not found; grants skipped';
  ELSE
    EXECUTE 'GRANT USAGE ON SCHEMA public TO ageos_app';
    FOR r IN
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO ageos_app', r.relname);
    END LOOP;
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.business_event FROM ageos_app';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.platform_audit_event FROM ageos_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ageos_app';
  END IF;

  FOR r IN
    SELECT DISTINCT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'tenant_id'
      AND table_name NOT IN ('membership', 'platform_audit_event')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', r.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      r.table_name
    );
  END LOOP;
END
$fn$;
--> statement-breakpoint
SELECT ageos_apply_security();
