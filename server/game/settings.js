// Описание всех настроек игры: тип, значение по умолчанию и допустимые границы.
// Всё, что приходит от ведущего, проходит через sanitizeSettings — лишние ключи и мусор отбрасываются.

export const SETTINGS_SPEC = {
  // Общие
  teamMode: { type: 'bool', def: false },
  allowPlayerTeams: { type: 'bool', def: true },
  joinAddress: { type: 'string', def: '', max: 200 },
  phoneSelect: { type: 'bool', def: true },
  // Игроки в разных местах (игра по интернету): кнопки открываются синхронно по сигналу на экранах,
  // а допуск на задержку сети больше.
  onlineMode: { type: 'bool', def: false },
  // Вход новых игроков закрыт (вернуться под своим именем по-прежнему можно).
  joinLocked: { type: 'bool', def: false },

  // «Своя игра»
  // Формат: sport — спортивная «Своя игра», личный зачёт: один бой из 10 тем по 5 вопросов подряд (10–50 очков);
  // eq — «Эрудит-квартет»: команды, 4 раунда (открытый, полуоткрытый, закрытый, личный), тему от команды играет
  // один игрок, его выбирает капитан; tv — как в телепередаче (табло, кот в мешке, аукцион, финал со ставками).
  jFormat: { type: 'enum', def: 'sport', values: ['sport', 'eq', 'tv'] },
  // Скелет игры (вопросы ведущий читает с листа). Спортивная — сколько тем в бою; «Эрудит-квартет» — сколько тем
  // в каждом из 4 раундов; телевизионная — сколько раундов и тем. Вопросов в теме — во всех форматах.
  jSportThemes: { type: 'int', def: 10, min: 1, max: 30 },
  jEqThemes: { type: 'int', def: 4, min: 1, max: 12 },
  jRounds: { type: 'int', def: 4, min: 1, max: 20 },
  jThemes: { type: 'int', def: 4, min: 1, max: 12 },
  jQuestions: { type: 'int', def: 5, min: 1, max: 10 },
  // Финал со ставками после обычных раундов (телевизионный формат).
  jFinal: { type: 'bool', def: true },
  // Стоимость вопросов темы в спортивной игре и «Эрудит-квартете»: 10–50, 1–5 или 100–500.
  // В телевизионном — 100–500 в первом раунде, 200–1000 во втором и т.д.
  jPrices: { type: 'enum', def: 'x10', values: ['x10', 'x1', 'x100'] },
  // «Эрудит-квартет»: кто от команды играет тему — один игрок (его выбирает капитан) или вся команда.
  jTableMode: { type: 'enum', def: 'one', values: ['one', 'team'] },
  // Время капитанам на выбор игроков: на весь раунд (открытый, закрытый, выбор игрока личного раунда)
  // и на одну тему (полуоткрытый).
  jAssignRoundTime: { type: 'int', def: 60, min: 0, max: 600 },
  jAssignThemeTime: { type: 'int', def: 20, min: 0, max: 600 },
  // Игрок играет не больше одной темы за раунд (если в команде хватает игроков на все темы).
  jOnePerPlayer: { type: 'bool', def: true },
  // Кот в мешке, аукцион и вопрос без риска в спортивной игре и «Эрудит-квартете» (в телевизионной — всегда).
  // Спецвопрос ведущий отмечает сам, когда дойдёт до него в своём листе.
  jSpecials: { type: 'bool', def: false },
  jBuzzTime: { type: 'int', def: 10, min: 0, max: 600 },
  jAnswerTime: { type: 'int', def: 15, min: 0, max: 600 },
  jWrongPenalty: { type: 'bool', def: true },
  jEarlyLockMs: { type: 'int', def: 1000, min: 0, max: 10000 },
  // Финал: время на ставку (0 — без ограничения) и на ответ.
  jBetTime: { type: 'int', def: 30, min: 0, max: 600 },
  jFinalTime: { type: 'int', def: 60, min: 5, max: 600 },
  jFinalOnlyPositive: { type: 'bool', def: true },
  jNewRoundChooser: { type: 'enum', def: 'lowest', values: ['lowest', 'keep'] },

  // «Хамса» (азербайджанская игра на основе «Эрудит-квартета»): 5 раундов, 5 тем по 5 вопросов.
  // Стоимость вопроса = номер вопроса × база × номер раунда (100–500, 200–1000, 300–1500, 400–2000).
  hPriceBase: { type: 'int', def: 100, min: 1, max: 1000 },
  // Фальстарта нет: нажать можно в любой момент после объявления темы и стоимости, ведущий прекращает чтение.
  // Когда вопрос дочитан — 5 секунд на обдумывание.
  hBuzzTime: { type: 'int', def: 5, min: 0, max: 600 },
  // На ответ после нажатия — 3 секунды (затягивать ответ нельзя).
  hAnswerTime: { type: 'int', def: 3, min: 0, max: 600 },
  // После неверного ответа право ответа переходит к следующему нажавшему (иначе кнопки открываются снова);
  // на обдумывание — не больше 5 секунд.
  hQueue: { type: 'bool', def: true },
  hNextTime: { type: 'int', def: 5, min: 0, max: 600 },
  hWrongPenalty: { type: 'bool', def: true },
  // Капитанам: минута на расстановку (явный и тайный раунды, выбор игрока персонального раунда), 20 секунд — в полуявном.
  hAssignRoundTime: { type: 'int', def: 60, min: 0, max: 600 },
  hAssignThemeTime: { type: 'int', def: 20, min: 0, max: 600 },
  // Раунд «Хамса»: 30 секунд капитану на ставку, затем 60 секунд на обсуждение и 10 на запись ответа.
  hBetTime: { type: 'int', def: 30, min: 0, max: 600 },
  hFinalTime: { type: 'int', def: 70, min: 5, max: 600 },

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
  // Сквозной счёт турнира: sum — взятые вопросы во всех боях (по brTakenPoints за вопрос) + очки за победы;
  // wins — только очки за победы и ничьи (взятые вопросы решают при равенстве).
  brTotal: { type: 'enum', def: 'sum', values: ['sum', 'wins'] },
  brTakenPoints: { type: 'num', def: 1, min: 0, max: 100, step: 0.1 },
  brCarryOver: { type: 'bool', def: false },
  // Стоимость вопроса в бою (с переносом очков невзятый вопрос добавляет свою стоимость к следующему).
  brQuestionValue: { type: 'int', def: 1, min: 1, max: 1000 },
  // Одна кнопка на команду: нажимает капитан или игрок, которому ведущий отдал кнопку.
  brOneButton: { type: 'bool', def: true },

  // Тест реакции: сигнал через случайное время (1,5–4 с), чтобы момент нельзя было угадать;
  // сколько секунд после сигнала ждать нажатий.
  rRandom: { type: 'bool', def: true },
  rTimeout: { type: 'int', def: 5, min: 1, max: 60 },
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
      // toFixed убирает хвосты двоичной арифметики (0,1 × 3 = 0,30000000000000004).
      const stepped = Number((Math.round(n / spec.step) * spec.step).toFixed(6))
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
