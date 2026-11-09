/**
 * 调度层：不定期的「滴答」。
 * 每 tickSeconds 检查一次，到点才真正发；发完按 [intervalMin, intervalMax] 重新随机下一次。
 * 安静时段、每日上限、启动延迟、错过补发、连续失败自动暂停都在这儿。
 */

import { fetchCandidates, fetchVideoInfo } from './bili.js'
import { makeSummary } from './ai.js'
import { buildSegments, previewText, firstSentence } from './message.js'
import { applyFilters, pickRandom } from './pick.js'
import { sendMessage, sleep } from './onebot.js'
import { inQuietHours, quietReleaseTime } from './config.js'
import { targetKey } from './state.js'

const MINUTE = 60000
const randInt = (min, max) => min + Math.floor(Math.random() * Math.max(1, max - min + 1))

export function createEngine({ ctx, cfg, logger, store, llm }) {
  let schedule = cfg.schedule
  let running = false
  let timerDispose = null

  const jitterMinutes = 10

  function nextDelayMs() {
    return randInt(cfg.schedule.intervalMinMinutes, cfg.schedule.intervalMaxMinutes) * MINUTE + randInt(0, 59) * 1000
  }

  /** 把 nextAt 推到「下一个合法时刻」：安静时段顺延、每日上限等到明天。 */
  function computeNextAt(from = new Date()) {
    let at = new Date(from.getTime() + nextDelayMs())
    if (schedule.quiet && inQuietHours(at, schedule.quiet)) {
      at = quietReleaseTime(at, schedule.quiet, jitterMinutes)
    }
    return at
  }

  function scheduleNext(from = new Date()) {
    const at = computeNextAt(from)
    store.state.nextAt = at.getTime()
    store.save()
    logger.debug(`下一次分享：${at.toLocaleString()}`)
    return at
  }

  function secondsUntilNext() {
    const next = store.state.nextAt
    if (!next) return null
    return Math.round((next - Date.now()) / 1000)
  }

  /** 今天还能发几条。 */
  function remainingToday(now = new Date()) {
    return Math.max(0, schedule.dailyMax - store.dailyCount(now))
  }

  async function collectCandidates(now) {
    const uniqTargets = cfg.targets.length
    // 只有「所有目标都看过」才该被过滤掉；某个群没看过就还能发。
    const seenBy = new Map()
    for (const target of cfg.targets) {
      for (const entry of store.state.sent) {
        if (entry.target !== targetKey(target)) continue
        seenBy.set(entry.bvid, (seenBy.get(entry.bvid) ?? 0) + 1)
      }
    }
    const sentToAll = new Set(
      [...seenBy.entries()].filter(([, count]) => count >= uniqTargets).map(([bvid]) => bvid),
    )

    const { items, failures, perSource } = await fetchCandidates(cfg.sources, {
      cookie: '',
      timeoutMs: cfg.qq.timeoutMs,
    })
    const { kept, dropped } = applyFilters(items, {
      filters: cfg.filters,
      now: now.getTime(),
      sentTo: sentToAll,
      recentUps: store.state.recentUps,
    })
    return { items, kept, dropped, failures, perSource }
  }

  function summarizeDropReason(dropped) {
    const map = {
      age: '太旧',
      duration: '时长不合',
      views: '播放太少',
      include: '不含关键词',
      exclude: '命中排除词',
      seen: '全发过了',
      sameUp: '同一 UP 刚发过',
    }
    const parts = Object.entries(dropped)
      .filter(([, n]) => n > 0)
      .map(([key, n]) => `${map[key] ?? key} ${n}`)
    return parts.join('，')
  }

  /**
   * 只挑不发：给 agent 自己看（比如配故事板）并写推荐语，然后再调 bili_share_send。
   * 不写状态、不去重标记，随便挑几次都不影响正式分享。
   */
  async function pick({ count = 5 } = {}) {
    if (cfg.targets.length === 0) {
      return {
        ok: false,
        code: 'NO_TARGETS',
        error: '还没有配置任何接收方',
        hint: "在插件配置的 targets 里加一项 {kind:'group', id:'群号'}",
      }
    }
    const { kept, dropped, perSource } = await collectCandidates(new Date())
    if (kept.length === 0) {
      return {
        ok: false,
        code: 'NO_CANDIDATE',
        error: '这一轮没有合适的视频',
        hint: `被过滤掉的原因：${summarizeDropReason(dropped) || '候选池为空'}`,
        dropped,
        perSource,
      }
    }
    const pool = [...kept]
    const want = Math.max(1, Math.min(Number(count) || 5, 10, pool.length))
    const candidates = []
    for (let i = 0; i < want; i += 1) {
      const [item] = pool.splice(Math.floor(Math.random() * pool.length), 1)
      candidates.push({
        bvid: item.bvid,
        title: item.title,
        url: item.url,
        tname: item.tname,
        up: item.ownerName,
        duration: item.duration,
        views: item.views,
        desc: firstSentence(item.desc, 120),
      })
    }
    return { ok: true, candidates, kept: kept.length, perSource }
  }

  /**
   * 执行一次分享。
   * @param {{dryRun?:boolean, bvid?:string, onlyTarget?:string, force?:boolean}} options
   */
  async function runOnce({ dryRun = false, bvid = '', onlyTarget = '', force = false, note = '' } = {}) {
    if (running) {
      return { ok: false, code: 'BUSY', error: '上一次分享还没结束', hint: '等它跑完再试' }
    }
    if (cfg.targets.length === 0) {
      return {
        ok: false,
        code: 'NO_TARGETS',
        error: '还没有配置任何接收方',
        hint: "在插件配置的 targets 里加一项 {kind:'group', id:'群号'}",
      }
    }

    const now = new Date()
    const targets = onlyTarget ? cfg.targets.filter((t) => targetKey(t) === onlyTarget) : cfg.targets
    if (targets.length === 0) {
      return {
        ok: false,
        code: 'NO_TARGET',
        error: `没有这个接收方：${onlyTarget}`,
        hint: '用 bili_share_status 看当前配置的 kind:id',
      }
    }

    running = true
    store.state.runningAt = Date.now()
    try {
      let item = null
      let diagnosis = null

      if (bvid) {
        const info = await fetchVideoInfo(bvid, { timeoutMs: cfg.qq.timeoutMs })
        if (!info.ok) return info
        item = info.item
      } else {
        const { kept, dropped, failures, perSource } = await collectCandidates(now)
        if (kept.length === 0) {
          return {
            ok: false,
            code: 'NO_CANDIDATE',
            error: '这一轮没有合适的视频，这次就不发了',
            hint: `被过滤掉的原因：${summarizeDropReason(dropped) || '候选池为空'}；来源状态：${perSource
              .map((p) => `${p.source}${p.ok ? `=${p.count}` : '(失败)'}`)
              .join(' ')}`,
            dropped,
            failures,
            perSource,
          }
        }
        item = pickRandom(kept)
        diagnosis = { kept: kept.length, dropped, failures, perSource }
      }

      const results = []
      const summaryCache = new Map()
      for (const target of targets) {
        const key = targetKey(target)
        // 去重对「指定 bvid」同样生效：验收要的就是「同一条不会发两次」，除非明确 force
        if (!force && store.hasSent(item.bvid, key)) {
          results.push({ target: key, ok: true, skipped: 'already-sent' })
          continue
        }
        const personaKey = String(target.persona ?? '')
        if (!summaryCache.has(personaKey)) {
          const trimmed = String(note ?? '').trim()
          // agent 自己写过一句（note）就直接用，不再让模型二次加工
          summaryCache.set(
            personaKey,
            trimmed
              ? { text: trimmed, mode: 'note' }
              : await makeSummary({ ctx, item, config: cfg, target, logger }),
          )
        }
        const summary = summaryCache.get(personaKey)
        const segments = buildSegments({ item, config: cfg, target, summary: summary.text })

        if (dryRun) {
          results.push({
            target: key,
            ok: true,
            dryRun: true,
            preview: previewText(segments),
            summaryMode: summary.mode,
          })
          continue
        }

        const sent = await sendMessage({ qq: cfg.qq, kind: target.kind, id: target.id, segments, logger })
        if (sent.ok) {
          store.recordSent({ bvid: item.bvid, target: key, at: Date.now() })
          results.push({ target: key, ok: true, preview: previewText(segments), summaryMode: summary.mode })
        } else {
          results.push({ target: key, ok: false, code: sent.code, error: sent.error, hint: sent.hint })
        }
        const gap = randInt(cfg.qq.gapMinMs, cfg.qq.gapMaxMs)
        if (gap > 0 && target !== targets[targets.length - 1]) await sleep(gap)
      }

      const delivered = results.filter((r) => r.ok && !r.skipped)
      const failed = results.filter((r) => !r.ok)
      const allSkipped = results.length > 0 && results.every((r) => r.skipped)

      if (!dryRun) {
        if (delivered.length > 0) {
          store.bumpDaily(new Date())
          store.noteUp(item.ownerMid)
          store.resetFailure()
          store.state.runningAt = 0
          if (store.state.nextAt && schedule.intervalMinMinutes > 0) scheduleNext()
          else scheduleNext()
          store.save()
        } else if (failed.length > 0) {
          const consecutive = store.noteFailure(failed[0].code, failed[0].hint)
          store.state.runningAt = 0
          if (consecutive >= 3 && !store.state.paused) {
            store.state.paused = true
            logger.error(`连续 ${consecutive} 次发送失败，已自动暂停：${failed[0].error}`)
          }
          store.save()
        } else {
          store.state.runningAt = 0
          store.save()
        }
      }

      return {
        ok: delivered.length > 0 || dryRun || allSkipped,
        allSkipped,
        dryRun,
        bvid: item.bvid,
        title: item.title,
        url: item.url,
        tname: item.tname,
        up: item.ownerName,
        targets: results,
        // 宿主工具返回值必须是「无损 JSON」：undefined 字段会被判非法，所以只在有诊断时才带上
        ...(diagnosis ? { dropped: diagnosis.dropped, perSource: diagnosis.perSource } : {}),
        paused: store.state.paused,
        nextAt: store.state.nextAt ? new Date(store.state.nextAt).toISOString() : null,
        ...(delivered.length === 0 && failed.length > 0
          ? { code: failed[0].code, error: failed[0].error, hint: failed[0].hint }
          : {}),
      }
    } finally {
      running = false
      store.state.runningAt = 0
    }
  }

  /** 定时器触发的检查：到点了吗？能发吗？ */
  async function tick() {
    if (running) return
    const now = new Date()

    if (store.state.paused) return
    if (!cfg.enabled) return
    if (store.state.nextAt === 0) {
      scheduleNext(now)
      return
    }
    if (now.getTime() < store.state.nextAt) return

    // 错过太久（关机 / 休眠）就不补了，重新排一个
    const lateBy = now.getTime() - store.state.nextAt
    if (lateBy > schedule.catchUpMinutes * MINUTE) {
      logger.info(`${Math.round(lateBy / MINUTE)} 分钟前的那次分享已错过补发窗口，重新排期`)
      scheduleNext(now)
      return
    }
    if (schedule.quiet && inQuietHours(now, schedule.quiet)) {
      const at = quietReleaseTime(now, schedule.quiet, jitterMinutes)
      store.state.nextAt = at.getTime()
      store.save()
      return
    }
    if (remainingToday(now) <= 0) {
      const tomorrow = new Date(now.getTime() + 24 * 3600000)
      const at = computeNextAt(tomorrow)
      store.state.nextAt = at.getTime()
      store.save()
      return
    }

    const result = await runOnce({})
    if (!result.ok && (result.code === 'NO_CANDIDATE' || result.code === 'NO_TARGETS')) {
      // 没候选 / 没接收方：半小时后再看，不刷日志，也不记为失败
      store.state.nextAt = Date.now() + 30 * MINUTE
      store.save()
      logger.debug(`本轮跳过（${result.code}：${result.hint ?? ''}），30 分钟后再试`)
    }
  }

  function start() {
    store.load()
    const now = new Date()
    if (store.state.nextAt === 0) {
      const at = new Date(now.getTime() + schedule.startupDelayMinutes * MINUTE)
      store.state.nextAt = at.getTime()
      store.save()
      logger.info(`首次启动，${schedule.startupDelayMinutes} 分钟后开始第一次分享`)
    } else if (store.state.nextAt > now.getTime() + schedule.intervalMaxMinutes * MINUTE) {
      // 状态里的时间明显在未来很远（改过配置/时钟跳变），重排
      scheduleNext(now)
    }
    // 上次是「正在发送」就死了：10 分钟后自行解除
    if (store.state.runningAt && Date.now() - store.state.runningAt > 10 * MINUTE) {
      store.state.runningAt = 0
      store.save()
    }

    const tickMs = Math.max(5000, schedule.tickSeconds * 1000)
    const run = () => {
      void tick()
    }
    // 注意：cordis 里访问未 inject 的服务会在「取属性」时就抛错，
    // 所以不能写 ctx.timer?.interval，必须把取属性本身包起来。
    let timer = null
    try {
      timer = ctx.timer
    } catch {
      timer = null
    }
    timerDispose =
      timer && typeof timer.interval === 'function'
        ? timer.interval(run, tickMs)
        : (() => {
            const handle = setInterval(run, tickMs)
            if (typeof handle.unref === 'function') handle.unref()
            return () => clearInterval(handle)
          })()
    return () => {
      try {
        timerDispose?.()
      } catch {
        /* ignore */
      }
    }
  }

  function status() {
    const state = store.state
    return {
      enabled: cfg.enabled,
      paused: state.paused,
      nextAt: state.nextAt ? new Date(state.nextAt).toISOString() : null,
      nextInSeconds: secondsUntilNext(),
      todayCount: store.dailyCount(new Date()),
      dailyMax: schedule.dailyMax,
      quietHours: schedule.quietHours || '',
      lastSentAt: state.lastSentAt ? new Date(state.lastSentAt).toISOString() : null,
      recent: state.sent.slice(-20).reverse(),
      failures: state.failures,
      problems: cfg.problems,
      targets: cfg.targets.map((t) => targetKey(t)),
      llmReady: llm?.ready ?? false,
      stateFile: store.file,
    }
  }

  function setPaused(paused) {
    store.state.paused = Boolean(paused)
    if (!paused) {
      store.resetFailure()
      if (!store.state.nextAt || store.state.nextAt < Date.now()) scheduleNext()
    }
    store.save()
    return { paused: store.state.paused, nextAt: store.state.nextAt }
  }

  /**
   * 配置热更新：新值拷进同一个 cfg 对象（工具和调度器都持有它的引用），
   * 然后按新的间隔重排一次下一次，避免还停在旧配置算出来的时间上。
   */
  function updateConfig(next) {
    for (const key of Object.keys(cfg)) {
      if (!(key in next)) delete cfg[key]
    }
    Object.assign(cfg, next)
    schedule = cfg.schedule
    if (!store.state.nextAt || store.state.nextAt > Date.now() + schedule.intervalMaxMinutes * MINUTE) {
      scheduleNext()
    } else {
      store.save()
    }
    return { nextAt: store.state.nextAt }
  }

  return { start, tick, runOnce, pick, status, setPaused, scheduleNext, remainingToday, updateConfig }
}
