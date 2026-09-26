// Звуки синтезируются Web Audio — никаких файлов, всё работает без интернета.
import { ref } from 'vue'
import { storage } from './util'

export type SoundName =
  | 'buzz'
  | 'start'
  | 'falseStart'
  | 'correct'
  | 'wrong'
  | 'timeUp'
  | 'tick'
  | 'warn'
  | 'select'
  | 'special'
  | 'reveal'
  | 'test'
  | 'join'
  | 'win'
  | 'click'

type Wave = OscillatorType

export class SoundEngine {
  readonly enabled = ref(true)
  readonly unlocked = ref(false)
  private ctx: AudioContext | null = null
  private master: GainNode | null = null

  constructor(private readonly key: string) {
    this.enabled.value = storage.get(key) !== 'off'
  }

  // Браузеры разрешают звук только после действия пользователя — вызываем при первом клике/касании.
  unlock() {
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (!Ctx) return
        this.ctx = new Ctx()
        this.master = this.ctx.createGain()
        this.master.gain.value = 0.6
        this.master.connect(this.ctx.destination)
      }
      if (this.ctx.state !== 'running') void this.ctx.resume().then(() => this.updateUnlocked())
      this.updateUnlocked()
    } catch {
      // звук недоступен
    }
  }

  private updateUnlocked() {
    this.unlocked.value = this.ctx?.state === 'running'
  }

  setEnabled(v: boolean) {
    this.enabled.value = v
    storage.set(this.key, v ? 'on' : 'off')
    if (v) this.unlock()
  }

  private tone(freq: number, start: number, dur: number, wave: Wave = 'sine', vol = 0.3, slideTo?: number) {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = wave
    osc.frequency.setValueAtTime(freq, start)
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur)
    g.gain.setValueAtTime(0.0001, start)
    g.gain.exponentialRampToValueAtTime(vol, start + 0.012)
    g.gain.setValueAtTime(vol, start + Math.max(0.012, dur * 0.6))
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    osc.connect(g)
    g.connect(master)
    osc.start(start)
    osc.stop(start + dur + 0.05)
  }

  // delayMs — сыграть позже (например, в момент синхронного открытия кнопок).
  play(name: SoundName, delayMs = 0) {
    if (!this.enabled.value || !this.ctx || this.ctx.state !== 'running') return
    const t = this.ctx.currentTime + 0.01 + Math.max(0, Math.min(3000, delayMs)) / 1000
    const seq = (notes: number[], step: number, dur: number, wave: Wave = 'triangle', vol = 0.28) =>
      notes.forEach((f, i) => this.tone(f, t + i * step, dur, wave, vol))
    switch (name) {
      case 'buzz':
        this.tone(740, t, 0.12, 'square', 0.22)
        this.tone(1109, t + 0.1, 0.3, 'square', 0.22)
        break
      case 'start':
        this.tone(1046, t, 0.55, 'sine', 0.45)
        this.tone(2093, t, 0.4, 'sine', 0.12)
        break
      case 'falseStart':
        this.tone(150, t, 0.22, 'sawtooth', 0.35)
        this.tone(150, t + 0.28, 0.35, 'sawtooth', 0.35)
        break
      case 'correct':
        seq([523, 659, 784, 1046], 0.09, 0.28)
        break
      case 'wrong':
        this.tone(330, t, 0.28, 'sawtooth', 0.22, 247)
        this.tone(247, t + 0.28, 0.45, 'sawtooth', 0.22, 165)
        break
      case 'timeUp':
        seq([440, 349, 262], 0.28, 0.35, 'square', 0.2)
        break
      case 'tick':
        this.tone(1568, t, 0.05, 'sine', 0.18)
        break
      case 'warn':
        this.tone(988, t, 0.14, 'sine', 0.3)
        this.tone(988, t + 0.2, 0.14, 'sine', 0.3)
        break
      case 'select':
        this.tone(660, t, 0.08, 'triangle', 0.2)
        this.tone(990, t + 0.07, 0.14, 'triangle', 0.2)
        break
      case 'special':
        seq([392, 523, 659, 784, 1046], 0.1, 0.3, 'square', 0.16)
        break
      case 'reveal':
        this.tone(523, t, 0.16, 'sine', 0.22)
        this.tone(784, t + 0.13, 0.35, 'sine', 0.22)
        break
      case 'test':
        this.tone(1200, t, 0.07, 'sine', 0.16)
        break
      case 'join':
        this.tone(784, t, 0.09, 'sine', 0.16)
        this.tone(1046, t + 0.09, 0.14, 'sine', 0.16)
        break
      case 'win':
        seq([523, 659, 784, 1046, 784, 1046, 1318], 0.12, 0.35, 'triangle', 0.28)
        break
      case 'click':
        this.tone(900, t, 0.04, 'square', 0.12)
        break
    }
  }
}

// Какой звук играть на событие сервера (для ведущего и экрана).
export function soundForEvent(name: string, data: { type?: string; resumed?: boolean } = {}): SoundName | null {
  switch (name) {
    case 'buzzWinner':
      return 'buzz'
    case 'falseStart':
      return 'falseStart'
    case 'brStart':
      return 'start'
    case 'armed':
    case 'strike':
      return 'click'
    case 'correct':
      return 'correct'
    case 'wrong':
      return 'wrong'
    case 'timeUp':
      return 'timeUp'
    case 'answerTimeUp':
      return 'warn'
    case 'questionSelected':
      return data.type && data.type !== 'normal' ? 'special' : 'select'
    case 'reveal':
      return 'reveal'
    case 'test':
      return 'test'
    case 'join':
      return 'join'
    case 'brWinner':
    case 'results':
    case 'soundTest':
      return 'win'
    case 'finalQuestion':
    case 'brQuestion':
    case 'assignStart':
    case 'battleStart':
    case 'strikeStart':
    case 'reactionStart':
      return 'select'
    case 'reactionDone':
      return 'reveal'
    case 'betsClosed':
      return 'timeUp'
    case 'theme':
      return 'special'
    case 'battleEnd':
      return 'win'
    case 'battleTie':
      return 'warn'
    default:
      return null
  }
}
