function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function createFamilyRepository({ getPool }) {
  if (typeof getPool !== 'function') {
    throw new TypeError('A PostgreSQL connection pool provider is required.');
  }

  return {
    async initializeFamily({ ownerUserId, familyId, familyName, learners }) {
      const pool = await getPool();
      const client = await pool.connect();
      let transactionOpen = false;

      try {
        await client.query('BEGIN');
        transactionOpen = true;
        await client.query(
          "SELECT set_config('daydayup.owner_user_id', $1, true)",
          [ownerUserId],
        );

        const insertFamily = await client.query(
          `INSERT INTO public.families (id, owner_user_id, name)
           VALUES ($1, $2, $3)
           ON CONFLICT (owner_user_id) DO NOTHING
           RETURNING id, name, created_at`,
          [familyId, ownerUserId, familyName],
        );

        let family;
        let savedLearners;
        const created = insertFamily.rowCount === 1;

        if (created) {
          family = insertFamily.rows[0];
          savedLearners = [];
          for (const learner of learners) {
            const result = await client.query(
              `INSERT INTO public.learners
                 (id, family_id, nickname, grade, academic_year)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id, nickname, grade, academic_year, created_at`,
              [
                learner.id,
                family.id,
                learner.nickname,
                learner.grade,
                learner.academicYear,
              ],
            );
            savedLearners.push(result.rows[0]);
          }
        } else {
          const existingFamily = await client.query(
            `SELECT id, name, created_at
             FROM public.families
             WHERE owner_user_id = $1`,
            [ownerUserId],
          );
          if (existingFamily.rowCount !== 1) {
            throw new Error('Family insert conflicted but the existing owner family was not visible.');
          }
          family = existingFamily.rows[0];

          const existingLearners = await client.query(
            `SELECT id, nickname, grade, academic_year, created_at
             FROM public.learners
             WHERE family_id = $1
             ORDER BY created_at, id`,
            [family.id],
          );
          savedLearners = existingLearners.rows;
        }

        await client.query('COMMIT');
        transactionOpen = false;

        return {
          created,
          family: {
            id: family.id,
            name: family.name,
            createdAt: toIsoString(family.created_at),
          },
          learners: savedLearners.map((learner) => ({
            id: learner.id,
            nickname: learner.nickname,
            grade: learner.grade,
            academicYear: learner.academic_year,
            createdAt: toIsoString(learner.created_at),
          })),
        };
      } catch (error) {
        if (transactionOpen) {
          try {
            await client.query('ROLLBACK');
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              'Family initialization failed and its transaction could not be rolled back.',
              { cause: error },
            );
          }
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

module.exports = { createFamilyRepository };
