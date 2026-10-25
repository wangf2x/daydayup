BEGIN;

REVOKE ALL ON TABLE public.families, public.learners
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.families, public.learners TO authenticated;

COMMIT;
