-- Lock the tables away from Supabase's auto-generated Data API (PostgREST).
-- Supabase exposes the `public` schema to the `anon` / `authenticated` roles, and the anon key is public.
-- RLS without any policy denies those roles every row; the app's own connection (table owner, or a
-- BYPASSRLS role such as Supabase's `postgres`) is unaffected. On plain PostgreSQL this is harmless.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Place" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Video" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Inquiry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Setting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailyStat" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  api_role text;
  -- Prisma's history table is absent when migrations are replayed into a shadow database.
  has_history boolean := to_regclass('"_prisma_migrations"') IS NOT NULL;
BEGIN
  IF has_history THEN
    EXECUTE 'ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY';
  END IF;

  -- Defense in depth: drop the Data API grants entirely where those roles exist (Supabase only).
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE "User", "Session", "Place", "Video", "Plan", "Inquiry", "Setting", "DailyStat" FROM %I',
        api_role
      );
      IF has_history THEN
        EXECUTE format('REVOKE ALL ON TABLE "_prisma_migrations" FROM %I', api_role);
      END IF;
    END IF;
  END LOOP;
END $$;
