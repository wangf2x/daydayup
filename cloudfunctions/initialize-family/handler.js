const { randomUUID } = require('node:crypto');

const MAX_LEARNERS = 3;

function invalidRequest(message) {
  const error = new Error(message);
  error.code = 'INVALID_REQUEST';
  return error;
}

function normalizeOptionalText(value, field, maxLength) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw invalidRequest(`${field} must be a string.`);
  }

  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw invalidRequest(`${field} must be at most ${maxLength} characters.`);
  }
  return normalized || null;
}

function validateRequest(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw invalidRequest('A family setup request is required.');
  }

  const familyName = event.familyName === undefined
    ? '我的家庭'
    : typeof event.familyName === 'string' && event.familyName.trim()
      ? event.familyName.trim()
      : '';
  if (!familyName || familyName.length > 80) {
    throw invalidRequest('familyName must contain 1 to 80 characters.');
  }
  if (!Array.isArray(event.learners) || event.learners.length < 1 || event.learners.length > MAX_LEARNERS) {
    throw invalidRequest(`learners must contain between 1 and ${MAX_LEARNERS} children.`);
  }

  const learners = event.learners.map((learner, index) => {
    if (!learner || typeof learner !== 'object' || Array.isArray(learner)) {
      throw invalidRequest(`learners[${index}] must be an object.`);
    }
    const nickname = typeof learner.nickname === 'string' ? learner.nickname.trim() : '';
    if (!nickname || nickname.length > 40) {
      throw invalidRequest(`learners[${index}].nickname must contain 1 to 40 characters.`);
    }
    return {
      nickname,
      grade: normalizeOptionalText(learner.grade, `learners[${index}].grade`, 32),
      academicYear: normalizeOptionalText(
        learner.academicYear,
        `learners[${index}].academicYear`,
        32,
      ),
    };
  });

  return { familyName, learners };
}

function createInitializeFamilyHandler({ getCaller, repository, newId = randomUUID }) {
  if (typeof getCaller !== 'function' || !repository
    || typeof repository.initializeFamily !== 'function') {
    throw new TypeError('Authenticated caller and family repository adapters are required.');
  }

  return async function initializeFamily(event) {
    const caller = await getCaller();
    const callerId = caller && typeof caller.openid === 'string' && caller.openid.length > 0
      ? caller.openid
      : caller && typeof caller.uid === 'string' && caller.uid.length > 0
        ? caller.uid
        : null;
    if (!callerId) {
      const error = new Error('Authentication is required.');
      error.code = 'UNAUTHENTICATED';
      throw error;
    }

    const request = validateRequest(event);
    return repository.initializeFamily({
      ownerUserId: callerId,
      familyId: newId(),
      familyName: request.familyName,
      learners: request.learners.map((learner) => ({
        id: newId(),
        ...learner,
      })),
    });
  };
}

module.exports = { createInitializeFamilyHandler, validateRequest };
