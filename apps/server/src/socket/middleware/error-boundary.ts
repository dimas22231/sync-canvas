/**
 * Error boundary untuk setiap listener Socket.io.
 *
 * EventEmitter tidak menangkap exception dari listener. Tanpa wrapper, satu
 * bug di handler bisa mematikan proses Node. Wrapper ini mencatat error,
 * membalas ack (jika ada) dengan `INTERNAL_ERROR`, dan menjaga server tetap
 * hidup. Detail internal tidak pernah dikirim ke client.
 */
import { fail, type Result } from '@synccanvas/shared';
import type { Logger } from '../../lib/logger.js';

type Handler<Args extends unknown[]> = (...args: Args) => void | Promise<void>;

export function withErrorBoundary<Args extends unknown[]>(
  logger: Logger,
  event: string,
  handler: Handler<Args>,
): (...args: Args) => void {
  return (...args: Args): void => {
    const onError = (error: unknown): void => {
      logger.error('Unhandled error in socket handler', { event, error });

      // Ack selalu menjadi argumen terakhir pada event yang memintanya.
      const lastArg = args[args.length - 1];
      if (typeof lastArg === 'function') {
        const ack = lastArg as (response: Result<never>) => void;
        ack(fail('INTERNAL_ERROR', 'Terjadi kesalahan internal pada server'));
      }
    };

    try {
      const result = handler(...args);
      if (result instanceof Promise) void result.catch(onError);
    } catch (error) {
      onError(error);
    }
  };
}
