/** Browser half: proves the client module loaded without a dead UI action. */
export const inject: string[] = []

/** Mark the document so host/browser tests can observe client activation. */
export function apply(ctx: any): void {
  void ctx
  if (typeof document !== 'undefined') document.documentElement.dataset.dshDesignClient = 'loaded'
}
