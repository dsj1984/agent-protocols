/**
 * lib/errors/ — canonical home for custom Error subclasses used by the
 * orchestration SDK.
 *
 * Consumers import by class so tests can match on `instanceof` rather than
 * message substrings.
 */

export class ConflictingTypeLabelsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictingTypeLabelsError';
  }
}

export class ValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ValidationError';
    Object.assign(this, details);
  }
}
