/**
 * One search attempt on the Seek screen: join the queue, count seconds, give up after the window.
 *
 * `join` may report an error synchronously (matching unavailable), before it even returns, so
 * nothing here may depend on a variable assigned after `join` is called.
 */
export interface SearchAttemptOptions {
  /** Joins the queue and returns a function that leaves it. */
  join: (onError: (message: string) => void) => () => void;
  windowSeconds: number;
  onTick: (secondsElapsed: number) => void;
  onTimeout: () => void;
  onError: (message: string) => void;
}

/** Starts an attempt; returns a cleanup that stops the timer and leaves the queue. */
export function startSearchAttempt({ join, windowSeconds, onTick, onTimeout, onError }: SearchAttemptOptions): () => void {
  let ticker: ReturnType<typeof setInterval> | undefined;
  // Set once the attempt has ended (error, timeout or cleanup): later callbacks are ignored.
  let done = false;

  const stopTicker = () => {
    if (ticker !== undefined) clearInterval(ticker);
    ticker = undefined;
  };

  const leave = join((message) => {
    if (done) return;
    done = true;
    stopTicker();
    onError(message);
  });

  // An error during join already ended the attempt: don't start counting toward a timeout.
  if (!done) {
    let seconds = 0;
    ticker = setInterval(() => {
      if (done) return;
      seconds += 1;
      onTick(seconds);
      if (seconds >= windowSeconds) {
        done = true;
        stopTicker();
        leave();
        onTimeout();
      }
    }, 1000);
  }

  return () => {
    done = true;
    stopTicker();
    leave();
  };
}
