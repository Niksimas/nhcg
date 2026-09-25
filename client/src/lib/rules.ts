// Подписи и пояснения к правилам (виды раундов «Своей игры» и т.п.).
import type { RoundKind } from './types'

export const KIND_TITLE: Record<RoundKind, string> = {
  open: 'Открытый',
  semi: 'Полуоткрытый',
  closed: 'Закрытый',
  captain: 'Командирский',
}

// Подпись вида раунда, если его название этого ещё не говорит («Открытый раунд» + «открытый» — лишнее).
export function kindSuffix(roundName: string | undefined, kind: RoundKind | null | undefined): string {
  if (!kind) return ''
  const word = KIND_TITLE[kind].toLowerCase()
  return (roundName ?? '').toLowerCase().includes(word) ? '' : word
}

export const KIND_HINT: Record<RoundKind, string> = {
  open: 'Темы раунда объявлены заранее. Капитаны сразу решают, кто из игроков какую тему играет.',
  semi: 'Тема объявляется перед игрой, и капитан за несколько секунд выбирает, кто её играет.',
  closed: 'Капитаны заранее ставят игроков на темы, не зная их названий. Тема открывается, когда игроки уже за столом.',
  captain: 'Все темы раунда играют капитаны команд.',
}
