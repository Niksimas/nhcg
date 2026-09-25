// Ведущий вписывает название темы из своего листа (пустое — вернуть «Тема N»).
import type { JeopardyView } from '../../lib/types'

export function askThemeName(j: JeopardyView, themeIndex: number, currentName: string | null = null): string | null {
  const theme = j.board?.[themeIndex]
  const current = currentName ?? (theme?.named ? theme.name ?? '' : '')
  return prompt(`Название темы ${themeIndex + 1} (пусто — «Тема ${themeIndex + 1}»)`, current)
}
