let cloud;
let Pool;
try {
  cloud = require('wx-server-sdk');
  ({ Pool } = require('pg'));
} catch (error) {
  throw new Error(
    'CloudBase runtime dependencies are missing; install this function package before deployment.',
    { cause: error },
  );
}

const { createInitializeFamilyHandler } = require('./handler');
const { createFamilyRepository } = require('./repository');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

let pool;
function getPool() {
  if (!process.env.DATABASE_URL) {
    const error = new Error('The DATABASE_URL cloud-function environment variable is required.');
    error.code = 'DATABASE_NOT_CONFIGURED';
    throw error;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    });
  }
  return pool;
}

const handler = createInitializeFamilyHandler({
  getCaller: async () => {
    // The CloudBase JS SDK path exposes identity through TCB_CONTEXT_KEYS, while
    // wx-server-sdk's getWXContext() only understands WX_CONTEXT_KEYS.
    const contextKeys = String(process.env.TCB_CONTEXT_KEYS || process.env.WX_CONTEXT_KEYS || '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean);
    const pick = (key) => {
      if (contextKeys.length > 0 && !contextKeys.includes(key)) {
        return undefined;
      }
      return process.env[key];
    };

    return {
      openid: pick('WX_OPENID'),
      uid: pick('TCB_UUID'),
    };
  },
  repository: createFamilyRepository({ getPool }),
});

exports.main = handler;
