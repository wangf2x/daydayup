BEGIN;

CREATE ROLE daydayup_family_api NOLOGIN NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO daydayup_family_api;
GRANT SELECT, INSERT ON TABLE public.families, public.learners
  TO daydayup_family_api;

CREATE POLICY families_api_owner_select
  ON public.families
  FOR SELECT
  TO daydayup_family_api
  USING (
    owner_user_id = current_setting('daydayup.owner_user_id', true)
  );

CREATE POLICY families_api_owner_insert
  ON public.families
  FOR INSERT
  TO daydayup_family_api
  WITH CHECK (
    owner_user_id = current_setting('daydayup.owner_user_id', true)
  );

CREATE POLICY learners_api_owner_select
  ON public.learners
  FOR SELECT
  TO daydayup_family_api
  USING (
    EXISTS (
      SELECT 1
      FROM public.families
      WHERE families.id = learners.family_id
        AND families.owner_user_id = current_setting('daydayup.owner_user_id', true)
    )
  );

CREATE POLICY learners_api_owner_insert
  ON public.learners
  FOR INSERT
  TO daydayup_family_api
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.families
      WHERE families.id = learners.family_id
        AND families.owner_user_id = current_setting('daydayup.owner_user_id', true)
    )
  );

COMMIT;
