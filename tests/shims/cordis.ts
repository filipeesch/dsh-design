export type Context = any

export class Service {
  protected readonly ctx: any
  constructor(ctx: any, _name: string) {
    this.ctx = ctx
  }
}

export const Context = { root: Symbol('root') } as any
