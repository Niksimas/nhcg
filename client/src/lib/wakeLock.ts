// Не даём экрану телефона гаснуть во время игры (иначе соединение рвётся и можно пропустить вопрос).
import NoSleep from 'nosleep.js'

let noSleep: NoSleep | null = null

export async function keepAwake(): Promise<boolean> {
  try {
    if (!noSleep) noSleep = new NoSleep()
    if (!noSleep.isEnabled) await noSleep.enable()
    return true
  } catch {
    return false
  }
}

export function releaseAwake() {
  try {
    noSleep?.disable()
  } catch {
    // ничего страшного
  }
}
