/**
 * Serializes async operations so concurrent socket/HTTP handlers never
 * interleave reads/writes against the local JSON file (which has no
 * database-level locking of its own).
 */
class Mutex {
  constructor() {
    this._queue = Promise.resolve();
  }

  runExclusive(fn) {
    const result = this._queue.then(() => fn());
    // Keep the chain alive even if a task rejects, so later tasks still run.
    this._queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

module.exports = Mutex;
