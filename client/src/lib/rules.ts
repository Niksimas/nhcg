// Подписи и пояснения к правилам (виды раундов «Своей игры» и т.п.).
import type { JeopardyView, Mode, RoundKind } from './types'

export const MODE_TITLE: Record<Mode, string> = {
  jeopardy: 'Своя игра',
  brainring: 'Брейн-ринг',
  khamsa: 'Хамса',
}

export const KIND_TITLE: Record<RoundKind, string> = {
  open: 'Открытый',
  semi: 'Полуоткрытый',
  closed: 'Закрытый',
  captain: 'Командирский',
  leaders: 'Четвёртый',
  khamsa: 'Хамса',
}

// В «Хамсе» раунды называются по-своему: явный, полуявный, тайный.
const KHAMSA_TITLE: Partial<Record<RoundKind, string>> = {
  open: 'Явный',
  semi: 'Полуявный',
  closed: 'Тайный',
  leaders: 'Четвёртый',
  khamsa: 'Хамса',
}

export function kindTitle(kind: RoundKind, format?: JeopardyView['format']): string {
  return (format === 'khamsa' ? KHAMSA_TITLE[kind] : undefined) ?? KIND_TITLE[kind]
}

// Подпись вида раунда, если его название этого ещё не говорит («Открытый раунд» + «открытый» — лишнее).
export function kindSuffix(roundName: string | undefined, kind: RoundKind | null | undefined, format?: JeopardyView['format']): string {
  if (!kind) return ''
  const word = kindTitle(kind, format).toLowerCase()
  return (roundName ?? '').toLowerCase().includes(word) ? '' : word
}

export const KIND_HINT: Record<RoundKind, string> = {
  open: 'Темы раунда объявлены заранее. Капитаны сразу решают, кто из игроков какую тему играет.',
  semi: 'Тема объявляется перед игрой, и капитан за несколько секунд выбирает, кто её играет.',
  closed: 'Капитаны заранее ставят игроков на темы, не зная их названий. Тема открывается, когда игроки уже за столом.',
  captain: 'Все темы раунда играют капитаны команд.',
  leaders:
    'Капитан выбирает одного игрока. Команды по очереди, от меньшего счёта к большему, убирают темы — оставшуюся тему играют выбранные игроки.',
  khamsa: 'Один сложный вопрос для всей команды. Играют команды с положительным счётом, ставка — до всех набранных очков.',
}

// Виды раундов, между которыми может выбирать ведущий.
export function kindsFor(format: JeopardyView['format']): RoundKind[] {
  return format === 'khamsa' ? ['open', 'semi', 'closed', 'leaders'] : ['open', 'semi', 'closed', 'captain']
}
