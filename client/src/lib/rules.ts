// Подписи и пояснения к правилам (форматы «Своей игры», виды раундов и т.п.).
import type { JFormat, Mode, RoundKind } from './types'

export const MODE_TITLE: Record<Mode, string> = {
  jeopardy: 'Своя игра',
  brainring: 'Брейн-ринг',
  khamsa: 'Хамса',
  reaction: 'Тест реакции',
}

export const FORMAT_TITLE: Record<JFormat, string> = {
  sport: 'Спортивная',
  eq: 'Эрудит-квартет',
  tv: 'Как на ТВ',
  khamsa: 'Хамса',
}

export const KIND_TITLE: Record<RoundKind, string> = {
  open: 'Открытый',
  semi: 'Полуоткрытый',
  closed: 'Закрытый',
  personal: 'Личный',
  khamsa: 'Хамса',
}

// В «Хамсе» раунды называются по-своему: явный, полуявный, тайный, персональный.
const KHAMSA_TITLE: Partial<Record<RoundKind, string>> = {
  open: 'Явный',
  semi: 'Полуявный',
  closed: 'Тайный',
  personal: 'Персональный',
  khamsa: 'Хамса',
}

export function kindTitle(kind: RoundKind, format?: JFormat): string {
  return (format === 'khamsa' ? KHAMSA_TITLE[kind] : undefined) ?? KIND_TITLE[kind]
}

// Подпись вида раунда, если его название этого ещё не говорит («Открытый раунд» + «открытый» — лишнее).
export function kindSuffix(roundName: string | undefined, kind: RoundKind | null | undefined, format?: JFormat): string {
  if (!kind) return ''
  const word = kindTitle(kind, format).toLowerCase()
  return (roundName ?? '').toLowerCase().includes(word) ? '' : word
}

const KIND_HINT: Record<RoundKind, string> = {
  open: 'Темы раунда объявлены заранее. Капитаны сразу решают, кто из игроков какую тему играет.',
  semi: 'Тема объявляется перед игрой, и капитан за несколько секунд выбирает, кто её играет.',
  closed: 'Капитаны заранее ставят игроков на темы, не зная их названий. Тема открывается, когда игроки уже за столом.',
  personal: 'Капитан выбирает одного игрока — он играет все темы раунда за команду.',
  khamsa: 'Один сложный вопрос для всей команды. Играют команды с положительным счётом, ставка — до всех набранных очков.',
}

export function kindHint(kind: RoundKind, format?: JFormat): string {
  if (kind === 'personal' && format === 'khamsa') {
    return 'Капитан выбирает одного игрока. Команды по очереди, от меньшего счёта к большему, убирают темы — оставшуюся тему играют выбранные игроки.'
  }
  return KIND_HINT[kind]
}
