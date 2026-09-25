// Описание всех настроек игры: тип, значение по умолчанию и допустимые границы.
// Всё, что приходит от ведущего, проходит через sanitizeSettings — лишние ключи и мусор отбрасываются.

export const SETTINGS_SPEC = {
  // Общие
  teamMode: { type: 'bool', def: false },
  allowPlayerTeams: { type: 'bool', def: true },
  joinAddress: { type: 'string', def: '', max: 200 },
  showQuestionOnPhones: { type: 'bool', def: true },
  phoneSelect: { type: 'bool', def: true },
  hideAnswerOnHost: { type: 'bool', def: false },
  // Игроки в разных местах (игра по интернету): кнопки открываются синхронно по сигналу на экранах,
  // а допуск на задержку сети больше.
  onlineMode: { type: 'bool', def: false },
  // Вход новых игроков закрыт (вернуться под своим именем по-прежнему можно).
  joinLocked: { type: 'bool', def: false },

  // «Своя игра»
  // Формат: sport — спортивный (как «Эрудит-квартет»: темы по 5 вопросов подряд, 10–50 очков, раунды открытый,
  // полуоткрытый, закрытый и командирский, от команды за столом один игрок); tv — как в телепередаче
  // (табло, кот в мешке, аукцион, финал со ставками).
  jFormat: { type: 'enum', def: 'sport', values: ['sport', 'tv'] },
  // Стоимость вопросов темы в спортивном формате: 10–50, 1–5, 100–500 или как в пакете.
  jPrices: { type: 'enum', def: 'x10', values: ['x10', 'x1', 'x100', 'pack'] },
  // Кто от команды играет тему: один игрок (его выбирает капитан) или вся команда.
  jTableMode: { type: 'enum', def: 'one', values: ['one', 'team'] },
  // Время капитанам на выбор игроков: на весь раунд (открытый, закрытый) и на одну тему (полуоткрытый).
  jAssignRoundTime: { type: 'int', def: 60, min: 0, max: 600 },
  jAssignThemeTime: { type: 'int', def: 20, min: 0, max: 600 },
  // Игрок играет не больше одной темы за раунд (если в команде хватает игроков на все темы).
  jOnePerPlayer: { type: 'bool', def: true },
  // Кот в мешке, аукцион и вопрос без риска в спортивном формате (в телевизионном — всегда как в пакете).
  jSpecials: { type: 'bool', def: false },
  jBuzzTime: { type: 'int', def: 10, min: 0, max: 600 },
  jAnswerTime: { type: 'int', def: 15, min: 0, max: 600 },
  jWrongPenalty: { type: 'bool', def: true },
  jEarlyLockMs: { type: 'int', def: 1000, min: 0, max: 10000 },
  jFinalTime: { type: 'int', def: 60, min: 5, max: 600 },
  jFinalOnlyPositive: { type: 'bool', def: true },
  jNewRoundChooser: { type: 'enum', def: 'lowest', values: ['lowest', 'keep'] },

  // «Брейн-ринг»
  brMainTime: { type: 'int', def: 60, min: 5, max: 600 },
  brAfterWrongTime: { type: 'int', def: 20, min: 0, max: 600 },
  brAfterWrongMode: { type: 'enum', def: 'atLeast', values: ['atLeast', 'fixed', 'remaining'] },
  brAnswerTime: { type: 'int', def: 0, min: 0, max: 600 },
  brTargetScore: { type: 'int', def: 0, min: 0, max: 1000 },
  // Бой: сколько вопросов (0 — без ограничения), сколько турнирных очков за победу и за ничью.
  brBattleQuestions: { type: 'int', def: 5, min: 0, max: 100 },
  brWinPoints: { type: 'num', def: 1, min: 0, max: 100, step: 0.5 },
  brDrawPoints: { type: 'num', def: 0, min: 0, max: 100, step: 0.5 },
  // Ничья после всех вопросов боя: extra — дополнительный вопрос до первого верного ответа,
  // draw — ничья, ask — решает ведущий.
  brTieMode: { type: 'enum', def: 'extra', values: ['extra', 'draw', 'ask'] },
  // Сквозной счёт турнира: sum — взятые вопросы во всех боях + очки за победы; wins — только очки за победы.
  brTotal: { type: 'enum', def: 'sum', values: ['sum', 'wins'] },
  brCarryOver: { type: 'bool', def: false },
  brQuestionValue: { type: 'int', def: 1, min: 1, max: 1000 },
  brAutoShowQuestion: { type: 'bool', def: false },
  brShowAnswer: { type: 'bool', def: true },
}

export function defaultSettings() {
  const out = {}
  for (const [key, spec] of Object.entries(SETTINGS_SPEC)) out[key] = spec.def
  return out
}

function sanitizeValue(spec, value) {
  switch (spec.type) {
    case 'bool':
      return typeof value === 'boolean' ? value : undefined
    case 'int': {
      const n = typeof value === 'string' ? Number(value) : value
      if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
      return Math.min(spec.max, Math.max(spec.min, Math.round(n)))
    }
    case 'num': {
      const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value
      if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
      const stepped = Math.round(n / spec.step) * spec.step
      return Math.min(spec.max, Math.max(spec.min, stepped))
    }
    case 'enum':
      return spec.values.includes(value) ? value : undefined
    case 'string':
      return typeof value === 'string' ? value.slice(0, spec.max) : undefined
    default:
      return undefined
  }
}

// Возвращает только корректные значения из patch (неизвестные ключи и неверные типы отбрасываются).
export function sanitizeSettings(patch) {
  const out = {}
  if (!patch || typeof patch !== 'object') return out
  for (const [key, value] of Object.entries(patch)) {
    const spec = SETTINGS_SPEC[key]
    if (!spec) continue
    const v = sanitizeValue(spec, value)
    if (v !== undefined) out[key] = v
  }
  return out
}

// Полный набор настроек: значения по умолчанию, поверх которых наложено сохранённое.
export function mergeSettings(saved) {
  return { ...defaultSettings(), ...sanitizeSettings(saved) }
}
