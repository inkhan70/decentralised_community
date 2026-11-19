/**
 * Token bucket: allows short bursts but caps the sustained event rate.
 * One instance per socket, so one noisy client cannot starve the others.
 */
class TokenBucket {
  constructor({ burst, perSecond, now = Date.now }) {
    this.burst = burst;
    this.perSecond = perSecond;
    this.now = now;
    this.tokens = burst;
    this.last = now();
  }

  /** Returns true (and spends a token) if the event is allowed. */
  take() {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.perSecond);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

module.exports = TokenBucket;
