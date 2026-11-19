/** An error whose message is safe to show to the end user. Anything else is reported generically. */
class ServiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
  }
}

module.exports = { ServiceError };
