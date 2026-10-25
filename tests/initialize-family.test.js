const test = require('node:test');
const assert = require('node:assert/strict');
const { createInitializeFamilyHandler } = require('../cloudfunctions/initialize-family/handler');
const { createFamilyRepository } = require('../cloudfunctions/initialize-family/repository');

function makeHandler({ caller = { openid: 'verified-openid-a' }, repository, newId } = {}) {
  return createInitializeFamilyHandler({
    getCaller: async () => caller,
    repository: repository || {
      async initializeFamily(input) {
        return input;
      },
    },
    newId: newId || (() => 'generated-id'),
  });
}

test('family initialization takes the owner only from the authenticated caller', async () => {
  let received;
  const handler = makeHandler({
    newId: (() => {
      let id = 0;
      return () => `generated-${++id}`;
    })(),
    repository: {
      async initializeFamily(input) {
        received = input;
        return { created: true };
      },
    },
  });

  const result = await handler({
    ownerUserId: 'forged-owner',
    familyName: '  我的家庭  ',
    learners: [{ nickname: '  小明 ', grade: ' 三年级 ' }],
  });

  assert.deepEqual(received, {
    ownerUserId: 'verified-openid-a',
    familyId: 'generated-1',
    familyName: '我的家庭',
    learners: [{
      id: 'generated-2',
      nickname: '小明',
      grade: '三年级',
      academicYear: null,
    }],
  });
  assert.deepEqual(result, { created: true });
});

test('family initialization rejects unauthenticated callers before repository access', async () => {
  let called = false;
  const handler = makeHandler({
    caller: null,
    repository: {
      async initializeFamily() {
        called = true;
      },
    },
  });

  await assert.rejects(handler({ learners: [{ nickname: '孩子' }] }), {
    code: 'UNAUTHENTICATED',
  });
  assert.equal(called, false);
});

test('family initialization validates child count, names, and schema limits', async () => {
  const handler = makeHandler();

  await assert.rejects(handler({ learners: [] }), { code: 'INVALID_REQUEST' });
  await assert.rejects(handler({
    learners: Array.from({ length: 4 }, (_, index) => ({ nickname: `孩子${index}` })),
  }), { code: 'INVALID_REQUEST' });
  await assert.rejects(handler({ learners: [{ nickname: ' ' }] }), { code: 'INVALID_REQUEST' });
  await assert.rejects(handler({
    learners: [{ nickname: '孩子', grade: '年级'.repeat(17) }],
  }), { code: 'INVALID_REQUEST' });
});

test('family repository creates family and learners in one owner-scoped transaction', async () => {
  const queries = [];
  const client = {
    async query(text, values = []) {
      queries.push({ text, values });
      if (text.includes('INSERT INTO public.families')) {
        return {
          rowCount: 1,
          rows: [{ id: values[0], name: values[2], created_at: new Date('2026-10-25T00:00:00Z') }],
        };
      }
      if (text.includes('INSERT INTO public.learners')) {
        return {
          rowCount: 1,
          rows: [{
            id: values[0],
            nickname: values[2],
            grade: values[3],
            academic_year: values[4],
            created_at: new Date('2026-10-25T00:00:00Z'),
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {
      queries.push({ text: 'RELEASE', values: [] });
    },
  };
  const repository = createFamilyRepository({
    getPool: async () => ({ connect: async () => client }),
  });

  const result = await repository.initializeFamily({
    ownerUserId: 'verified-openid-a',
    familyId: 'family-1',
    familyName: '我的家庭',
    learners: [{
      id: 'learner-1',
      nickname: '小明',
      grade: '三年级',
      academicYear: null,
    }],
  });

  assert.equal(result.created, true);
  assert.equal(result.family.id, 'family-1');
  assert.equal(result.learners[0].id, 'learner-1');
  assert.deepEqual(queries.map(({ text }) => text), [
    'BEGIN',
    "SELECT set_config('daydayup.owner_user_id', $1, true)",
    queries[2].text,
    queries[3].text,
    'COMMIT',
    'RELEASE',
  ]);
  assert.match(queries[2].text, /INSERT INTO public\.families/);
  assert.match(queries[3].text, /INSERT INTO public\.learners/);
  assert.deepEqual(queries[1].values, ['verified-openid-a']);
  assert.equal(queries[2].values[1], 'verified-openid-a');
  assert.equal(queries[3].values[1], 'family-1');
});

test('family repository returns existing family without adding duplicate learners', async () => {
  const statements = [];
  const client = {
    async query(text) {
      statements.push(text);
      if (text.includes('INSERT INTO public.families')) {
        return { rowCount: 0, rows: [] };
      }
      if (text.includes('FROM public.families')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'existing-family',
            name: 'Existing family',
            created_at: new Date('2026-10-01T00:00:00Z'),
          }],
        };
      }
      if (text.includes('FROM public.learners')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'existing-learner',
            nickname: '小明',
            grade: null,
            academic_year: null,
            created_at: new Date('2026-10-02T00:00:00Z'),
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {
      statements.push('RELEASE');
    },
  };
  const repository = createFamilyRepository({
    getPool: async () => ({ connect: async () => client }),
  });

  const result = await repository.initializeFamily({
    ownerUserId: 'verified-openid-a',
    familyId: 'unused-new-id',
    familyName: 'Ignored on retry',
    learners: [{
      id: 'unused-child-id',
      nickname: 'Different child',
      grade: null,
      academicYear: null,
    }],
  });

  assert.equal(result.created, false);
  assert.equal(result.family.id, 'existing-family');
  assert.deepEqual(result.learners.map(({ id }) => id), ['existing-learner']);
  assert.equal(statements.some((text) => text.includes('INSERT INTO public.learners')), false);
  assert.equal(statements.at(-2), 'COMMIT');
  assert.equal(statements.at(-1), 'RELEASE');
});

test('family repository rolls back and releases the connection after a write failure', async () => {
  const statements = [];
  const client = {
    async query(text) {
      statements.push(text);
      if (text.includes('INSERT INTO public.learners')) {
        throw new Error('simulated insert failure');
      }
      if (text.includes('INSERT INTO public.families')) {
        return {
          rowCount: 1,
          rows: [{ id: 'family-1', name: '我的家庭', created_at: new Date() }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {
      statements.push('RELEASE');
    },
  };
  const repository = createFamilyRepository({
    getPool: async () => ({ connect: async () => client }),
  });

  await assert.rejects(repository.initializeFamily({
    ownerUserId: 'verified-openid-a',
    familyId: 'family-1',
    familyName: '我的家庭',
    learners: [{
      id: 'learner-1',
      nickname: '小明',
      grade: null,
      academicYear: null,
    }],
  }), /simulated insert failure/);
  assert.equal(statements.at(-2), 'ROLLBACK');
  assert.equal(statements.at(-1), 'RELEASE');
});
