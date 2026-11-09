/**
 * 配置层：默认值、合并、归一化、校验。
 * 用户只在 profile 的 cordis.patch.yml（或设置页表单）里改少数键，其余走默认值。
 */

/** 常用分区对照。接口返回的 tname 才是权威值，这里只用于表单提示与日志。 */
export const CATEGORIES = [
  { rid: 0, name: '全站' },
  { rid: 1, name: '动画' },
  { rid: 3, name: '音乐' },
  { rid: 4, name: '游戏' },
  { rid: 5, name: '娱乐' },
  { rid: 36, name: '知识' },
  { rid: 119, name: '鬼畜' },
  { rid: 129, name: '舞蹈' },
  { rid: 155, name: '时尚' },
  { rid: 160, name: '生活' },
  { rid: 181, name: '影视' },
  { rid: 188, name: '科技' },
  { rid: 202, name: '资讯' },
  { rid: 211, name: '美食' },
  { rid: 217, name: '动物' },
  { rid: 223, name: '汽车' },
  { rid: 234, name: '运动' },
]

export const DEFAULTS = {
  enabled: true,
  sources: [{ type: 'ranking', rid: 0, limit: 50 }],
  filters: {
    maxAgeDays: 7,
    minSeconds: 60,
    maxSeconds: 3600,
    minViews: 10000,
    includeKeywords: [],
    excludeKeywords: [],
    sameUpCooldown: 2,
  },
  qq: {
    baseUrl: 'http://127.0.0.1:3000',
    accessToken: '',
    timeoutMs: 10000,
    retries: 2,
    gapMinMs: 1000,
    gapMaxMs: 5000,
  },
  targets: [],
  schedule: {
    intervalMinMinutes: 240,
    intervalMaxMinutes: 600,
    dailyMax: 3,
    quietHours: '23:00-08:00',
    startupDelayMinutes: 2,
    catchUpMinutes: 180,
    tickSeconds: 60,
  },
  message: {
    template: '【B站·{tname}】{title}\n{url}',
    withCover: false,
    summaryMode: 'ai', // off | desc | ai
    summaryMaxChars: 60,
    tone: '',
    withViews: false,
    tag: '',
  },
  state: { keepCount: 2000, keepDays: 90 },
  ai: { provider: '', model: '', maxTokens: 800, timeoutMs: 30000 },
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** 深合并：数组整体替换（用户改一个来源，不想被默认值补回去）。 */
export function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return patch === undefined ? base : patch
  const out = Array.isArray(base) ? [] : { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    out[key] = isPlainObject(value) && isPlainObject(base?.[key]) ? deepMerge(base[key], value) : value
  }
  return out
}

const number = (value, fallback, min, max) => {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

const strings = (value) =>
  Array.isArray(value)
    ? value.map((v) => String(v ?? '').trim()).filter(Boolean)
    : typeof value === 'string' && value.trim()
      ? value.split(/[,，\n]/).map((v) => v.trim()).filter(Boolean)
      : []

function normalizeSource(raw, problems, index) {
  const type = String(raw?.type ?? 'ranking').toLowerCase()
  if (type !== 'ranking' && type !== 'popular') {
    problems.push(`sources[${index}].type 只能是 ranking 或 popular，实际是 ${type}`)
    return null
  }
  if (type === 'popular') return { type, limit: number(raw?.limit, 50, 1, 100) }
  const rid = number(raw?.rid, 0, 0, 9999)
  if (raw?.rid === undefined) problems.push(`sources[${index}] 缺 rid，按全站（0）处理`)
  return { type, rid, limit: number(raw?.limit, 50, 1, 100) }
}

function normalizeTarget(raw, problems, index) {
  const kindRaw = String(raw?.kind ?? 'group').toLowerCase()
  const kind = kindRaw === 'private' || kindRaw === 'friend' ? 'private' : 'group'
  const id = String(raw?.id ?? raw?.groupId ?? raw?.userId ?? '').trim()
  if (!/^\d+$/.test(id)) {
    problems.push(`targets[${index}].id 必须是纯数字的群号或 QQ 号，实际是 ${JSON.stringify(raw?.id)}`)
    return null
  }
  return {
    kind,
    id,
    at: strings(raw?.at).filter((v) => /^\d+$/.test(v) || v === 'all'),
    persona: String(raw?.persona ?? '').trim(),
  }
}

/** 解析 "23:00-08:00" / "23:00~08:00" / "08:00"；无法解析返回 null。 */
export function parseQuietHours(text) {
  const s = String(text ?? '').trim()
  if (!s) return null
  const parts = s.split(/[-~—至]/).map((v) => v.trim()).filter(Boolean)
  const hm = (v) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v)
    if (!m) return null
    const h = Number(m[1])
    const min = Number(m[2])
    if (h > 23 || min > 59) return null
    return h * 60 + min
  }
  const start = hm(parts[0])
  const end = parts.length > 1 ? hm(parts[1]) : 0
  if (start === null || end === null) return null
  return { start, end }
}

/** 当前时刻是否落在安静时段内（支持跨午夜）。 */
export function inQuietHours(date, quiet) {
  if (!quiet) return false
  const mins = date.getHours() * 60 + date.getMinutes()
  return quiet.start <= quiet.end
    ? mins >= quiet.start && mins < quiet.end
    : mins >= quiet.start || mins < quiet.end
}

/** 安静时段结束后、再随机几分钟的下一个可发时刻。 */
export function quietReleaseTime(date, quiet, jitterMinutes) {
  const at = new Date(date.getTime())
  at.setSeconds(0, 0)
  const end = quiet.end
  at.setHours(Math.floor(end / 60), end % 60, Math.floor(Math.random() * Math.max(1, jitterMinutes)) * 60, 0)
  if (at.getTime() <= date.getTime()) at.setDate(at.getDate() + 1)
  return at
}

/**
 * 把用户给的裸配置归一化成插件内部结构。
 * 永远返回一个可用配置：非法项退回默认值，问题写进 problems 供 status/日志展示。
 */
export function normalizeConfig(raw) {
  const problems = []
  const merged = deepMerge(DEFAULTS, isPlainObject(raw) ? raw : {})

  const sources = (Array.isArray(merged.sources) ? merged.sources : [])
    .map((s, i) => normalizeSource(s, problems, i))
    .filter(Boolean)
  if (sources.length === 0) {
    problems.push('没有任何可用来源，已回退到全站排行榜')
    sources.push({ type: 'ranking', rid: 0, limit: 50 })
  }

  // 未知键直接点名，免得写错一层就默默不生效（曾经把 targets 写进 qq 里踩过）
  const KNOWN_KEYS = new Set(['enabled', 'sources', 'filters', 'qq', 'targets', 'schedule', 'message', 'state', 'ai'])
  for (const key of Object.keys(isPlainObject(raw) ? raw : {})) {
    if (!KNOWN_KEYS.has(key)) problems.push(`未知配置项 ${key}（已忽略）`)
  }

  // 兼容写在 qq 下面的 targets：照用，但提醒一次
  let rawTargets = merged.targets
  if ((!Array.isArray(rawTargets) || rawTargets.length === 0) && Array.isArray(merged.qq?.targets)) {
    rawTargets = merged.qq.targets
    problems.push('qq.targets 已生效，但推荐写在顶层 targets')
  }

  const targets = (Array.isArray(rawTargets) ? rawTargets : [])
    .map((t, i) => normalizeTarget(t, problems, i))
    .filter(Boolean)
  if (targets.length === 0) problems.push('targets 为空：不会发任何消息，先在配置里填一个群或好友')

  const f = merged.filters
  const filters = {
    maxAgeDays: number(f.maxAgeDays, 7, 0, 3650), // 0 = 不限
    minSeconds: number(f.minSeconds, 60, 0, 86400),
    maxSeconds: number(f.maxSeconds, 3600, 0, 86400 * 24),
    minViews: number(f.minViews, 10000, 0, 1e12), // 0 = 不限
    includeKeywords: strings(f.includeKeywords),
    excludeKeywords: strings(f.excludeKeywords),
    sameUpCooldown: number(f.sameUpCooldown, 2, 0, 50), // 0 = 不限
  }
  if (filters.maxSeconds > 0 && filters.maxSeconds < filters.minSeconds) {
    problems.push('filters.maxSeconds 小于 minSeconds，已交换')
    ;[filters.minSeconds, filters.maxSeconds] = [filters.maxSeconds, filters.minSeconds]
  }

  const s = merged.schedule
  let intervalMin = number(s.intervalMinMinutes, 240, 1, 60 * 24 * 30)
  let intervalMax = number(s.intervalMaxMinutes, 600, 1, 60 * 24 * 30)
  if (intervalMax < intervalMin) {
    problems.push('schedule.intervalMaxMinutes 小于 intervalMinMinutes，已交换')
    ;[intervalMin, intervalMax] = [intervalMax, intervalMin]
  }
  const quiet = parseQuietHours(s.quietHours)
  if (String(s.quietHours ?? '').trim() && !quiet) problems.push(`schedule.quietHours 无法解析：${s.quietHours}，已忽略`)

  const qq = merged.qq
  let baseUrl = String(qq.baseUrl ?? '').trim() || DEFAULTS.qq.baseUrl
  baseUrl = baseUrl.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(baseUrl)) {
    problems.push(`qq.baseUrl 必须以 http:// 或 https:// 开头：${baseUrl}`)
    baseUrl = DEFAULTS.qq.baseUrl
  }

  const m = merged.message
  const summaryMode = ['off', 'desc', 'ai'].includes(String(m.summaryMode)) ? String(m.summaryMode) : 'ai'

  return {
    problems,
    config: {
      enabled: merged.enabled !== false,
      sources,
      filters,
      qq: {
        baseUrl,
        accessToken: String(qq.accessToken ?? ''),
        timeoutMs: number(qq.timeoutMs, 10000, 1000, 120000),
        retries: number(qq.retries, 2, 0, 5),
        gapMinMs: number(qq.gapMinMs, 1000, 0, 60000),
        gapMaxMs: number(qq.gapMaxMs, 5000, 0, 120000),
      },
      targets,
      schedule: {
        intervalMinMinutes: intervalMin,
        intervalMaxMinutes: intervalMax,
        dailyMax: number(s.dailyMax, 3, 1, 500),
        quietHours: quiet ? String(s.quietHours).trim() : '',
        quiet,
        startupDelayMinutes: number(s.startupDelayMinutes, 2, 0, 1440),
        catchUpMinutes: number(s.catchUpMinutes, 180, 0, 60 * 24 * 30),
        tickSeconds: number(s.tickSeconds, 60, 5, 3600),
      },
      message: {
        template: String(m.template ?? DEFAULTS.message.template),
        withCover: m.withCover === true,
        summaryMode,
        summaryMaxChars: number(m.summaryMaxChars, 60, 0, 500),
        tone: String(m.tone ?? '').trim(),
        withViews: m.withViews === true,
        tag: String(m.tag ?? '').trim(),
      },
      state: {
        keepCount: number(merged.state?.keepCount, 2000, 10, 100000),
        keepDays: number(merged.state?.keepDays, 90, 1, 3650),
      },
      ai: {
        provider: String(merged.ai?.provider ?? '').trim(),
        model: String(merged.ai?.model ?? '').trim(),
        maxTokens: number(merged.ai?.maxTokens, 800, 32, 4096),
        timeoutMs: number(merged.ai?.timeoutMs, 20000, 3000, 120000),
      },
    },
  }
}

/** 给 status 工具/日志用的一句话摘要（不含 token）。 */
export function describeConfig(config) {
  const src = config.sources
    .map((s) => (s.type === 'ranking' ? `排行榜(rid=${s.rid})` : '综合热门'))
    .join(' + ')
  const targets = config.targets.map((t) => `${t.kind === 'group' ? '群' : '好友'}${t.id}`).join('、')
  const s = config.schedule
  return [
    `来源 ${src}`,
    `目标 ${targets || '（未配置）'}`,
    `间隔 ${s.intervalMinMinutes}~${s.intervalMaxMinutes} 分钟`,
    `每日上限 ${s.dailyMax}`,
    `安静时段 ${s.quietHours || '无'}`,
    `文案模式 ${config.message.summaryMode}`,
  ].join('；')
}
