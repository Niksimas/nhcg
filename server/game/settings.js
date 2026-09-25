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

  // «Своя игра»
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
  brCarryOver: { type: 'bool', def: true },
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
