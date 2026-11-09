/**
 * 状态层：跨重启记住「发过什么、下次什么时候、今天发了几条」。
 * 位置：$DSH_HOME/bili-share/state.json，原子写（tmp → rename），损坏时先备份再重建。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const EMPTY = () => ({
  v: 1,
  nextAt: 0,
  runningAt: 0,
  dailyKey: '',
  dailyCount: 0,
  paused: false,
  sent: [],
  recentUps: [],
  failures: { consecutive: 0, lastCode: '', lastHint: '', at: 0 },
  lastSentAt: 0,
})

export function dataRoot() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'bili-share')
}

export function statePath() {
  return join(dataRoot(), 'state.json')
}

/** 用户自己改的配置：优先级高于 cordis.patch.yml 里那份，改完即时生效。 */
export function configPath() {
  return join(dataRoot(), 'config.json')
}

export function readUserConfig() {
  try {
    const file = configPath()
    if (!existsSync(file)) return {}
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function writeUserConfig(value) {
  const file = configPath()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(value ?? {}, null, 2), 'utf8')
  renameSync(tmp, file)
  return file
}

const dayKey = (date) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

export function targetKey(target) {
  return `${target.kind}:${target.id}`
}

export function createStateStore({ logger, keepCount = 2000, keepDays = 90 } = {}) {
  const file = statePath()
  let state = EMPTY()
  let loaded = false

  function load() {
    if (loaded) return state
    loaded = true
    try {
      if (!existsSync(file)) return state
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (!parsed || typeof parsed !== 'object') throw new Error('state 不是对象')
      state = { ...EMPTY(), ...parsed }
      state.failures = { ...EMPTY().failures, ...(parsed.failures ?? {}) }
      if (!Array.isArray(state.sent)) state.sent = []
      if (!Array.isArray(state.recentUps)) state.recentUps = []
    } catch (error) {
      try {
        const backup = `${file}.corrupt-${Date.now()}`
        copyFileSync(file, backup)
        logger?.warn?.(`state 损坏，已备份到 ${backup}：${error.message}`)
      } catch {
        /* 备份失败也不能挡住启动 */
      }
      state = EMPTY()
    }
    return state
  }

  function save() {
    const json = JSON.stringify(state, null, 2)
    try {
      mkdirSync(dirname(file), { recursive: true })
      const tmp = `${file}.tmp-${process.pid}`
      writeFileSync(tmp, json, 'utf8')
      renameSync(tmp, file)
      return true
    } catch (error) {
      logger?.error?.(`写状态失败 ${file}：${error.message}`)
      return false
    }
  }

  function prune(now = Date.now()) {
    const cutoff = now - keepDays * 86400000
    const kept = state.sent.filter((item) => (item?.at ?? 0) >= cutoff)
    state.sent = kept.length > keepCount ? kept.slice(kept.length - keepCount) : kept
    state.recentUps = state.recentUps.slice(-20)
  }

  /** 这个 bvid 是否已经发给过这个目标。 */
  function hasSent(bvid, key) {
    return state.sent.some((item) => item.bvid === bvid && item.target === key)
  }

  function recordSent(entry) {
    state.sent.push(entry)
    state.lastSentAt = entry.at
    prune(entry.at)
  }

  function noteUp(mid) {
    if (!mid) return
    state.recentUps.push(String(mid))
    if (state.recentUps.length > 20) state.recentUps = state.recentUps.slice(-20)
  }

  function bumpDaily(now) {
    const key = dayKey(now)
    if (state.dailyKey !== key) {
      state.dailyKey = key
      state.dailyCount = 0
    }
    state.dailyCount += 1
    return state.dailyCount
  }

  function dailyCount(now) {
    return state.dailyKey === dayKey(now) ? state.dailyCount : 0
  }

  function noteFailure(code, hint) {
    state.failures = {
      consecutive: (state.failures?.consecutive ?? 0) + 1,
      lastCode: String(code ?? ''),
      lastHint: String(hint ?? ''),
      at: Date.now(),
    }
    return state.failures.consecutive
  }

  function resetFailure() {
    state.failures = { consecutive: 0, lastCode: '', lastHint: '', at: 0 }
  }

  return {
    get file() {
      return file
    },
    get state() {
      load()
      return state
    },
    load,
    save,
    prune,
    hasSent,
    recordSent,
    noteUp,
    bumpDaily,
    dailyCount,
    noteFailure,
    resetFailure,
    dayKey,
    targetKey,
  }
}
