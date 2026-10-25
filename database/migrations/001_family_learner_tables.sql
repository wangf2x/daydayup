BEGIN;

CREATE TABLE public.families (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  name text NOT NULL DEFAULT '我的家庭',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT families_owner_user_id_key UNIQUE (owner_user_id),
  CONSTRAINT families_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 80)
);

CREATE TABLE public.learners (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL
    REFERENCES public.families (id) ON DELETE CASCADE,
  nickname text NOT NULL,
  grade text,
  academic_year text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learners_nickname_length CHECK (
    char_length(btrim(nickname)) BETWEEN 1 AND 40
  ),
  CONSTRAINT learners_grade_length CHECK (
    grade IS NULL OR char_length(grade) <= 32
  ),
  CONSTRAINT learners_academic_year_length CHECK (
    academic_year IS NULL OR char_length(academic_year) <= 32
  )
);

CREATE INDEX learners_family_id_idx ON public.learners (family_id);

GRANT SELECT ON public.families, public.learners TO authenticated;

ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learners ENABLE ROW LEVEL SECURITY;

CREATE POLICY families_owner_select
  ON public.families
  FOR SELECT
  TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY learners_owner_select
  ON public.learners
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.families
      WHERE families.id = learners.family_id
        AND families.owner_user_id = auth.uid()
    )
  );

COMMIT;
