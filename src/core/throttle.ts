type LimiterOptions = {
  maxConcurrent: number;
  maxRequestsPerMinute: number;
  maxTokensPerMinute: number;
};

type Scheduled<T> = () => Promise<T>;

export type Limiter = {
  schedule<T>(fn: Scheduled<T>, estimatedTokens?: number): Promise<T>;
};

export function createLimiter(opts: LimiterOptions): Limiter {
  const queue: {
    fn: Scheduled<unknown>;
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
    tokens: number;
  }[] = [];
  let active = 0;
  const windowMs = 60_000;
  const requestsTimestamps: number[] = [];
  const tokensTimestamps: { t: number; tokens: number }[] = [];

  function prune(now: number): void {
    while (requestsTimestamps.length && now - requestsTimestamps[0] > windowMs)
      requestsTimestamps.shift();
    while (tokensTimestamps.length && now - tokensTimestamps[0].t > windowMs)
      tokensTimestamps.shift();
  }

  async function runNext(): Promise<void> {
    if (active >= opts.maxConcurrent) return;
    const item = queue.shift();
    if (!item) return;
    const now = Date.now();
    prune(now);

    const pendingRequests = requestsTimestamps.length;
    const tokensUsed = tokensTimestamps.reduce((acc, e) => acc + e.tokens, 0);

    // throttle if needed
    if (
      pendingRequests >= opts.maxRequestsPerMinute ||
      tokensUsed + item.tokens > opts.maxTokensPerMinute
    ) {
      // put back and try later
      queue.unshift(item);
      setTimeout(runNext, 250);
      return;
    }

    active += 1;
    requestsTimestamps.push(now);
    tokensTimestamps.push({ t: now, tokens: item.tokens });
    try {
      const val = await item.fn();
      item.resolve(val);
    } catch (err) {
      item.reject(err);
    } finally {
      active -= 1;
      setImmediate(runNext);
    }
  }

  function schedule<T>(fn: Scheduled<T>, estimatedTokens = 500): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push({ fn, resolve, reject, tokens: estimatedTokens });
      setImmediate(runNext);
    });
  }

  return { schedule };
}
