/**
 * Throttle leading + trailing.
 *
 * Mengapa bukan debounce? Kursor harus terasa responsif: event pertama
 * langsung dikirim (leading), lalu paling banyak satu event per `waitMs`.
 * Argumen terakhir selalu dijadwalkan (trailing) agar posisi akhir kursor
 * tidak tertinggal saat pointer berhenti bergerak.
 */
export interface ThrottledFunction<Args extends unknown[]> {
  (...args: Args): void;
  /** Membatalkan trailing call, dipakai saat cleanup effect. */
  cancel(): void;
}

export function createThrottle<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): ThrottledFunction<Args> {
  let lastInvokedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let trailingArgs: Args | null = null;

  const invoke = (args: Args): void => {
    lastInvokedAt = Date.now();
    fn(...args);
  };

  return Object.assign(
    (...args: Args): void => {
      trailingArgs = args;
      const remaining = waitMs - (Date.now() - lastInvokedAt);

      if (remaining <= 0) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        invoke(args);
        return;
      }

      if (timer) return;

      timer = setTimeout(() => {
        timer = null;
        if (!trailingArgs) return;
        const pending = trailingArgs;
        trailingArgs = null;
        invoke(pending);
      }, remaining);
    },
    {
      cancel: (): void => {
        if (timer) clearTimeout(timer);
        timer = null;
        trailingArgs = null;
      },
    },
  );
}
