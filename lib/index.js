/**
 * dsh-bili-share —— 把 B 站指定类型的公开视频，不定期分享到白名单 QQ 群 / 好友。
 *
 * 设计取舍（README 里有完整版）：
 *  · Host-only bundle，零第三方运行时依赖，直接用内置 fetch；
 *  · 只读 B 站匿名公开接口，写操作只有「发 QQ 消息」这一个；
 *  · 定时器与工具都挂在自己的 fiber 上，插件停用即回收；
 *  · 不静态 import 宿主的 dsh-tools / schemastery（它们在 app.asar 里，插件解析不到），
 *    拿不到就降级：没有 Config schema 也照常工作，config 走 cordis.patch.yml。
 */
import { normalizeConfig, describeConfig, deepMerge } from './config.js'
import { createStateStore, dataRoot, readUserConfig, writeUserConfig, configPath } from './state.js'
import { createEngine } from './scheduler.js'
import { registerTools } from './tools.js'
import { registerApi } from './api.js'
import { llmReady } from './ai.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const inject = ['tools']

function makeLogger(ctx) {
  const raw = ctx.logger
  let base = raw
  if (typeof raw === 'function') {
    try {
      base = raw('bili-share')
    } catch {
      base = null
    }
  }
  const prefix = '[bili-share]'
  const wrap = (level) => (...args) => {
    const fn = (base && base[level]) || console[level] || console.log
    try {
      fn.call(base ?? console, prefix, ...args)
    } catch {
      /* 日志失败不影响业务 */
    }
  }
  return { debug: wrap('debug'), info: wrap('info'), warn: wrap('warn'), error: wrap('error') }
}

/**
 * 设置页的表单 schema。宿主没把 schemastery 暴露给插件时就是 undefined，
 * 此时 config 只能从 profile 的 cordis.patch.yml 改 —— 插件本身照常工作。
 */
let Config
try {
  const { default: S } = await import('@deepseek-ai/schemastery')
  const target = S.object({
    kind: S.union(['group', 'private']).default('group'),
    id: S.string().default(''),
    at: S.array(S.string()).default([]),
    persona: S.string().default(''),
  })
  const source = S.object({
    type: S.union(['ranking', 'popular']).default('ranking'),
    rid: S.number().default(0),
    limit: S.number().default(50),
  })
  Config = S.object({
    enabled: S.boolean().default(true),
    sources: S.array(source).default([{ type: 'ranking', rid: 0, limit: 50 }]),
    filters: S.object({
      maxAgeDays: S.number().default(7),
      minSeconds: S.number().default(60),
      maxSeconds: S.number().default(3600),
      minViews: S.number().default(10000),
      includeKeywords: S.array(S.string()).default([]),
      excludeKeywords: S.array(S.string()).default([]),
      sameUpCooldown: S.number().default(2),
    }),
    qq: S.object({
      baseUrl: S.string().default('http://127.0.0.1:3000'),
      accessToken: S.string().default(''),
      timeoutMs: S.number().default(10000),
      retries: S.number().default(2),
      gapMinMs: S.number().default(1000),
      gapMaxMs: S.number().default(5000),
    }),
    targets: S.array(target).default([]),
    schedule: S.object({
      intervalMinMinutes: S.number().default(240),
      intervalMaxMinutes: S.number().default(600),
      dailyMax: S.number().default(3),
      quietHours: S.string().default('23:00-08:00'),
      startupDelayMinutes: S.number().default(2),
      catchUpMinutes: S.number().default(180),
      tickSeconds: S.number().default(60),
    }),
    message: S.object({
      template: S.string().default('【B站·{tname}】{title}\n{url}'),
      withCover: S.boolean().default(false),
      summaryMode: S.union(['off', 'desc', 'ai']).default('ai'),
      summaryMaxChars: S.number().default(60),
      tone: S.string().default(''),
      withViews: S.boolean().default(false),
    }),
    state: S.object({
      keepCount: S.number().default(2000),
      keepDays: S.number().default(90),
    }),
    ai: S.object({
      provider: S.string().default(''),
      model: S.string().default(''),
      maxTokens: S.number().default(800),
      timeoutMs: S.number().default(30000),
    }),
  })
} catch {
  Config = undefined
}
export { Config }

export function apply(ctx, config) {
  const logger = makeLogger(ctx)
  // 配置来源两层：cordis.patch.yml 里的打底，用户自己保存的 config.json 覆盖它。
  // 宿主没给 schemastery，设置页就没有表单，这一层是用户改配置的正经入口。
  const base = config && typeof config === 'object' ? config : {}
  const saved = readUserConfig()
  const { config: cfg, problems } = normalizeConfig(deepMerge(base, saved))

  if (problems.length > 0) {
    logger.warn(`配置有问题（已按默认值兜底）：${problems.join('；')}`)
  }
  logger.info(describeConfig(cfg))

  const store = createStateStore({
    logger,
    keepCount: cfg.state.keepCount,
    keepDays: cfg.state.keepDays,
  })

  const llm = {
    get ready() {
      return llmReady(ctx, cfg.ai)
    },
  }

  const engine = createEngine({ ctx, cfg, logger, store, llm })

  /**
   * 保存配置：用户层覆盖 patch 层，写盘 + 热更新调度器。
   * 数组整体替换（deepMerge 对数组的处理），所以改 targets 要传完整数组。
   */
  function saveConfig(patch, reset = false) {
    const current = reset ? {} : readUserConfig()
    const mergedUser = deepMerge(current, patch && typeof patch === 'object' ? patch : {})
    const file = writeUserConfig(mergedUser)
    const normalized = normalizeConfig(deepMerge(base, mergedUser))
    engine.updateConfig(normalized.config)
    logger.info(`配置已更新：${describeConfig(normalized.config)}`)
    if (normalized.problems.length > 0) logger.warn(`配置提醒：${normalized.problems.join('；')}`)
    return { config: normalized.config, problems: normalized.problems, file }
  }

  // 定时器：插件停用 / 配置重载时自动回收
  ctx.effect(() => engine.start())

  // 工具：跟随 fiber 回收
  let toolsReport = { registered: [], failed: [] }
  if (ctx.tools) {
    const result = registerTools(ctx, { engine, cfg, logger, saveConfig })
    toolsReport = result.report
    ctx.effect(() => result.dispose)
  } else {
    logger.warn('没有 tools 服务：定时分享仍会运行，但 agent 用不了 bili_share_* 工具')
  }

  // 设置面板的本地接口。**webServer 常常比插件晚就绪**：在 apply 里直接
  // `ctx.get('webServer')` 会拿到 undefined，路由就永远挂不上（面板表现为
  // 「读取配置失败 / Unexpected end of JSON input」）。所以用动态 inject 等它。
  let apiReport = { registered: [], failed: [], dispose: () => {} }

  // 自检报告：装完不用猜「到底成没成」，直接看这个文件
  function writeReport() {
    try {
      const report = {
        at: new Date().toISOString(),
        package: 'dsh-bili-share',
        hasConfigSchema: Boolean(Config),
        tools: toolsReport,
        api: { registered: apiReport.registered, failed: apiReport.failed },
        configProblems: problems,
        nextAt: store.state.nextAt ? new Date(store.state.nextAt).toISOString() : null,
        configSummary: describeConfig(cfg),
      }
      mkdirSync(dataRoot(), { recursive: true })
      writeFileSync(join(dataRoot(), 'apply-report.json'), JSON.stringify(report, null, 2), 'utf8')
    } catch (error) {
      logger.warn(`写自检报告失败：${error?.message ?? error}`)
    }
  }

  const attachApi = (apiCtx) => {
    try {
      apiReport = registerApi({
        ctx: apiCtx,
        logger,
        engine,
        saveConfig,
        getConfig: () => ({ ...cfg, summary: describeConfig(cfg), problems: cfg.problems ?? problems }),
      })
      if (apiReport.registered.length > 0) {
        logger.info(`设置面板接口已挂载：${apiReport.registered.join(', ')}`)
      }
    } catch (error) {
      apiReport.failed.push({ path: '*', error: String(error?.message ?? error) })
      logger.warn(`挂载设置面板接口失败：${error?.message ?? error}`)
    }
    writeReport()
    return () => apiReport.dispose?.()
  }

  if (typeof ctx.inject === 'function') {
    try {
      const off = ctx.inject(['webServer'], (webCtx) => {
        const dispose = attachApi(webCtx)
        return () => dispose?.()
      })
      if (typeof off === 'function') ctx.effect(() => off)
    } catch (error) {
      logger.warn(`等待 webServer 失败，改为立即探测：${error?.message ?? error}`)
      ctx.effect(() => attachApi(ctx))
    }
  } else {
    ctx.effect(() => attachApi(ctx))
  }

  writeReport()

  return {
    engine,
    status: () => engine.status(),
  }
}
