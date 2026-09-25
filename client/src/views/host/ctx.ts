import { inject, provide, type InjectionKey, type Ref, type ShallowRef } from 'vue'
import type { GameConnection } from '../../lib/connection'
import type { GameState } from '../../lib/types'

export interface HostCtx {
  conn: GameConnection
  state: ShallowRef<GameState | null>
  now: Ref<number>
  run: (name: string, args?: Record<string, unknown>) => Promise<boolean>
  toast: (text: string, kind?: 'ok' | 'err') => void
  flash: Record<string, number>
  openJoin: () => void
  openSettings: () => void
}

const KEY: InjectionKey<HostCtx> = Symbol('host')

export function provideHost(ctx: HostCtx) {
  provide(KEY, ctx)
}

export function useHost(): HostCtx {
  const ctx = inject(KEY)
  if (!ctx) throw new Error('Host context is missing')
  return ctx
}
