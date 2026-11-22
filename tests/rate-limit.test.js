const TokenBucket = require('../src/sockets/rateLimit');

describe('TokenBucket', () => {
  test('allows a burst, then blocks, then refills over time', () => {
    let t = 0;
    const bucket = new TokenBucket({ burst: 3, perSecond: 1, now: () => t });

    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true]);
    expect(bucket.take()).toBe(false);

    t += 500; // half a token: still blocked
    expect(bucket.take()).toBe(false);
    t += 500; // a full token has accrued
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });

  test('never accumulates more than the burst size', () => {
    let t = 0;
    const bucket = new TokenBucket({ burst: 2, perSecond: 10, now: () => t });
    t += 60_000;
    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, false]);
  });
});
