// Сетевые адреса компьютера: какие показать игрокам и как понять, что запрос пришёл с этого же ПК.
import os from 'node:os'

const VIRTUAL_RE =
  /virtual|vbox|vmware|vethernet|hyper-v|docker|^br-|^veth|wsl|tailscale|zerotier|hamachi|radmin|vpn|^tun|^tap|utun|loopback|npcap|bluetooth|teredo|isatap|^awdl|^llw|^anpi|^bridge/i
const WIFI_RE = /wi-?fi|wlan|wireless|беспровод|^wl|^en0$/i
const ETH_RE = /ethernet|^eth|^enp|^eno|^ens|^en\d|подключение по локальной сети|local area connection/i

function normalizeIp(ip) {
  if (!ip) return ''
  const s = String(ip)
  return s.startsWith('::ffff:') ? s.slice(7) : s
}

function scoreAddress(name, ip) {
  let score = 0
  if (/^192\.168\./.test(ip)) score += 30
  else if (/^10\./.test(ip)) score += 20
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) score += 10
  else if (/^169\.254\./.test(ip)) score -= 50
  if (WIFI_RE.test(name)) score += 15
  else if (ETH_RE.test(name)) score += 5
  if (VIRTUAL_RE.test(name)) score -= 40
  if (/^192\.168\.(56|99)\./.test(ip)) score -= 10 // типичные адреса VirtualBox/Parallels
  if (/^192\.168\.137\.1$/.test(ip)) score += 5 // «Мобильный хот-спот» Windows
  return score
}

// Список IPv4-адресов компьютера в локальных сетях, лучшие — первыми.
export function getLanAddresses() {
  const result = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.internal) continue
      if (a.family !== 'IPv4' && a.family !== 4) continue
      result.push({ name, address: a.address, score: scoreAddress(name, a.address) })
    }
  }
  result.sort((a, b) => b.score - a.score)
  return result
}

let ownCache = { at: 0, set: new Set() }

// Все адреса этого компьютера (включая 127.0.0.1) — чтобы узнать «свой» браузер.
export function ownAddresses() {
  const now = Date.now()
  if (now - ownCache.at < 5000) return ownCache.set
  const set = new Set(['127.0.0.1', '::1'])
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) set.add(normalizeIp(a.address))
  }
  ownCache = { at: now, set }
  return set
}

export function isLocalAddress(ip) {
  const n = normalizeIp(ip)
  if (!n) return false
  if (n.startsWith('127.')) return true
  return ownAddresses().has(n)
}
