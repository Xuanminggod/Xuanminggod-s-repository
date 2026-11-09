/**
 * 工具层：三个给 agent 用的工具。
 * 参数先用宿主支持的 author 写法（属性表 + required:true），注册前编译成 JSON Schema；
 * 万一宿主只认编译后的形态或只认 author 形态，注册失败会退到另一种再试一次。
 */

const CONTENT = (text) => [{ type: 'text', text }]

import { describeConfig } from './config.js'

/** 属性表 → JSON Schema（与 @deepseek-ai/dsh-tools 的编译规则一致）。 */
function compileParameters(spec = {}) {
  const properties = {}
  const required = []
  for (const [key, raw] of Object.entries(spec)) {
    const { required: isRequired, ...rest } = raw ?? {}
    if (isRequired) required.push(key)
    if (rest.type === 'json') {
      properties[key] = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'type'))
      continue
    }
    if (rest.type === 'object' && rest.properties) {
      const inner = compileParameters(rest.properties)
      properties[key] = { ...rest, ...inner }
      continue
    }
    if (rest.type === 'array' && rest.items?.properties) {
      properties[key] = { ...rest, items: { ...rest.items, ...compileParameters(rest.items.properties) } }
      continue
    }
    properties[key] = rest
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

function buildDefinition(spec, form) {
  const parameters = form === 'author' ? spec.parameters : compileParameters(spec.parameters)
  // 宿主要求返回值是「无损 JSON」：undefined / Date / 循环引用会让整次调用报错，
  // 所以统一过一遍 JSON 往返，宁可变空也不要让工具挂掉。
  const execute = async (args) => {
    const value = await spec.execute(args)
    try {
      return JSON.parse(JSON.stringify(value))
    } catch {
      return { ok: false, code: 'BAD_OUTPUT', error: '返回值无法序列化', hint: '这是插件 bug，请附上刚才的操作步骤' }
    }
  }
  return {
    name: spec.name,
    description: spec.description,
    parameters,
    output: spec.output,
    execute,
    timeoutMs: spec.timeoutMs,
    isConcurrencySafe: spec.isConcurrencySafe,
  }
}

/** 注册一个工具，两种 schema 形态都试一遍，失败要出声。 */
function register(ctx, spec, logger, report) {
  const attempts = ['compiled', 'author']
  let lastError = null
  for (const form of attempts) {
    try {
      const definition = buildDefinition(spec, form)
      const dispose = ctx.tools.register(definition)
      report.registered.push({ name: spec.name, schema: form })
      logger.debug(`${spec.name} 已注册（${form} schema）`)
      return dispose
    } catch (error) {
      lastError = error
    }
  }
  report.failed.push({ name: spec.name, error: String(lastError?.message ?? lastError) })
  logger.error(`${spec.name} 注册失败：${lastError?.message ?? lastError}`)
  return null
}

const describeTargets = (status) => status.targets.join('、') || '（未配置）'

export function registerTools(ctx, { engine, cfg, logger, saveConfig }) {
  const disposers = []
  const report = { registered: [], failed: [] }

  disposers.push(
    register(
      ctx,
      {
        name: 'bili_share_now',
        description: [
          '立刻从 B 站挑一条视频分享到配置的 QQ 群/好友。',
          'dryRun=true 时只挑不发，返回将要发出的消息预览。',
          'bvid 可直接指定一条视频（跳过挑选与去重）；target 可只发某一个接收方（形如 group:123456）。',
          '没有合适候选时返回 ok:false + NO_CANDIDATE，这是正常结果，不要重试。',
        ].join('\n'),
        parameters: {
          dryRun: { type: 'boolean', description: '只挑不发，返回预览。默认 false。' },
          bvid: { type: 'string', description: '指定视频号（BV 开头）。留空则按配置的过滤规则随机挑。' },
          target: { type: 'string', description: '只发给这个接收方，形如 group:123456 或 private:10001。' },
          force: {
            type: 'boolean',
            description: '即使是已经发过的视频也再发一次（默认 false，正常情况不要传）。',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            required: ['ok'],
            properties: {
              ok: { type: 'boolean', description: '这次是否真的发出（dryRun 时为 true）。' },
              bvid: { type: 'string' },
              title: { type: 'string' },
              url: { type: 'string' },
              targets: {
                type: 'array',
                description: '每个接收方的结果。',
                items: { type: 'object', additionalProperties: true },
              },
              code: { type: 'string', description: '失败码，如 NO_CANDIDATE / QQ_UNREACHABLE。' },
              error: { type: 'string' },
              hint: { type: 'string', description: '下一步该做什么。' },
            },
          },
          render(args, value) {
            if (!value?.ok) {
              return CONTENT(
                [`发不出去：${value?.code ?? 'ERROR'}`, value?.error, value?.hint ? `下一步：${value.hint}` : '']
                  .filter(Boolean)
                  .join('\n'),
              )
            }
            const head = value.allSkipped
              ? `[跳过] ${value.title}（这些接收方已经收过这条）`
              : value.dryRun
                ? `[预览，没有真的发] ${value.title}`
                : `已发出：${value.title}`
            const lines = [head, value.url]
            for (const t of value.targets ?? []) {
              if (t.skipped) lines.push(`· ${t.target}：已发过，跳过`)
              else if (t.ok) lines.push(`· ${t.target}：${t.dryRun ? `预览（推荐语：${t.summaryMode ?? '?'}）` : '成功'}`)
              else lines.push(`· ${t.target}：失败 ${t.code ?? ''} ${t.error ?? ''}`)
            }
            if (value.dryRun) {
              const preview = value.targets?.find((t) => t.preview)?.preview
              if (preview) lines.push('', '将发送的内容：', preview)
            }
            return CONTENT(lines.join('\n'))
          },
        },
        timeoutMs: 120000,
        isConcurrencySafe() {
          return false
        },
        async execute(args) {
          return engine.runOnce({
            dryRun: args?.dryRun === true,
            bvid: String(args?.bvid ?? '').trim(),
            onlyTarget: String(args?.target ?? '').trim(),
            force: args?.force === true,
          })
        },
      },
      logger,
      report,
    ),
  )

  disposers.push(
    register(
      ctx,
      {
        name: 'bili_share_status',
        description: [
          '看 B 站分享插件现在什么状态：下次什么时候发、今天发了几条、最近发过什么、上次的错误。',
          '也用来确认配置是否生效（problems 里会写被忽略的配置项）。',
        ].join('\n'),
        parameters: {},
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            required: ['text'],
            properties: { text: { type: 'string' } },
          },
          render(args, value) {
            return CONTENT(value.text)
          },
        },
        timeoutMs: 10000,
        isConcurrencySafe() {
          return true
        },
        async execute() {
          const status = engine.status()
          const next = status.nextAt
            ? new Date(status.nextAt).toLocaleString('zh-CN', { hour12: false })
            : '未排期'
          const recent = (status.recent ?? []).slice(0, 10).map((item) => {
            const at = new Date(item.at).toLocaleString('zh-CN', { hour12: false })
            return `· ${at}  ${item.bvid}  ${item.target}`
          })
          const text = [
            `开关：${status.enabled ? '启用' : '停用'}；${status.paused ? '已暂停' : '运行中'}`,
            `下次分享：${next}${status.nextInSeconds != null ? `（约 ${Math.max(1, Math.round(status.nextInSeconds / 60))} 分钟后）` : ''}`,
            `今天已发：${status.todayCount} / ${status.dailyMax}`,
            `安静时段：${status.quietHours || '无'}`,
            `接收方：${describeTargets(status)}`,
            `AI 推荐语：${status.llmReady ? '可用' : '不可用（会退回简介首句）'}`,
            `状态文件：${status.stateFile}`,
            status.failures?.consecutive
              ? `最近失败：连续 ${status.failures.consecutive} 次，${status.failures.lastCode} ${status.failures.lastHint}`
              : '最近失败：无',
            status.problems?.length ? `配置提醒：${status.problems.join('；')}` : '配置提醒：无',
            recent.length ? `最近发送：\n${recent.join('\n')}` : '最近发送：还没有',
          ].join('\n')
          return { text }
        },
      },
      logger,
      report,
    ),
  )

  disposers.push(
    register(
      ctx,
      {
        name: 'bili_share_set_paused',
        description: '暂停或恢复 B 站定时分享。暂停只会停掉「到点自动发」，bili_share_now 仍可手动发。',
        parameters: {
          paused: { type: 'boolean', required: true, description: 'true = 暂停，false = 恢复' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            required: ['text'],
            properties: { text: { type: 'string' } },
          },
          render(args, value) {
            return CONTENT(value.text)
          },
        },
        timeoutMs: 10000,
        isConcurrencySafe() {
          return false
        },
        async execute(args) {
          if (typeof args?.paused !== 'boolean') {
            return { text: 'paused 必须是 true 或 false' }
          }
          const result = engine.setPaused(args.paused)
          const next = result.nextAt
            ? new Date(result.nextAt).toLocaleString('zh-CN', { hour12: false })
            : '未排期'
          return {
            text: result.paused ? `已暂停。${next === '未排期' ? '' : `恢复后仍按当前排期：${next}`}` : `已恢复，下次分享：${next}`,
          }
        },
      },
      logger,
      report,
    ),
  )

  disposers.push(
    register(
      ctx,
      {
        name: 'bili_share_pick',
        description: [
          '只挑不发：按当前过滤规则随机给出 1~10 条候选视频，用来「先看看有什么」。',
          '不写任何状态，也不影响去重——看完可以用 bili_share_send 指定某一条发出。',
          '典型用法：bili_share_pick → 对感兴趣的用 video_storyboard 看一眼 → 写一句真的看过才写得出的推荐语 → bili_share_send({bvid, note})。',
        ].join('\n'),
        parameters: {
          count: { type: 'number', description: '要几条候选，1~10，默认 5。' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            required: ['ok'],
            properties: {
              ok: { type: 'boolean' },
              candidates: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
              },
              code: { type: 'string' },
              error: { type: 'string' },
              hint: { type: 'string' },
            },
          },
          render(args, value) {
            if (!value?.ok) {
              return CONTENT(
                [`没挑到：${value?.code ?? 'ERROR'}`, value?.error, value?.hint ? `下一步：${value.hint}` : '']
                  .filter(Boolean)
                  .join('\n'),
              )
            }
            const lines = [`候选 ${value.candidates.length} 条（过滤后共 ${value.kept} 条）：`]
            value.candidates.forEach((c, i) => {
              lines.push(`${i + 1}. ${c.title}`)
              lines.push(`   ${c.url}  · ${c.tname} · ${c.up} · ${Math.round(c.duration / 60)} 分钟`)
            })
            return CONTENT(lines.join('\n'))
          },
        },
        timeoutMs: 60000,
        isConcurrencySafe() {
          return false
        },
        async execute(args) {
          return engine.pick({ count: Number(args?.count) || 5 })
        },
      },
      logger,
      report,
    ),
  )

  disposers.push(
    register(
      ctx,
      {
        name: 'bili_share_send',
        description: [
          '把指定的一条视频（bvid）发出去，note 会作为推荐语一起发（不传则按配置让模型写或退回简介）。',
          '和 bili_share_now 的区别：bili_share_send 不发随机挑的，只发你点名的那条，适合「先看过再发」。',
          '已经发给这个接收方过的视频会跳过（返回 skipped），要重发请传 force=true。',
        ].join('\n'),
        parameters: {
          bvid: { type: 'string', required: true, description: '要发的视频号，BV 开头。' },
          note: { type: 'string', description: '推荐语，一句话。传了就不再让模型写。' },
          target: { type: 'string', description: '只发给这个接收方，形如 group:123456。留空发给所有配置的接收方。' },
          force: { type: 'boolean', description: '已经发过也再发一次（默认 false）。' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            required: ['ok'],
            properties: {
              ok: { type: 'boolean' },
              bvid: { type: 'string' },
              title: { type: 'string' },
              url: { type: 'string' },
              allSkipped: { type: 'boolean' },
              targets: { type: 'array', items: { type: 'object', additionalProperties: true } },
              code: { type: 'string' },
              error: { type: 'string' },
              hint: { type: 'string' },
            },
          },
          render(args, value) {
            if (!value?.ok) {
              return CONTENT(
                [`发不出去：${value?.code ?? 'ERROR'}`, value?.error, value?.hint ? `下一步：${value.hint}` : '']
                  .filter(Boolean)
                  .join('\n'),
              )
            }
            const head = value.allSkipped ? `[跳过] ${value.title}（已经发过）` : `已发出：${value.title}`
            const lines = [head, value.url]
            for (const t of value.targets ?? []) {
              if (t.skipped) lines.push(`· ${t.target}：已发过，跳过`)
              else if (t.ok) lines.push(`· ${t.target}：成功（推荐语：${t.summaryMode ?? '?'}）`)
              else lines.push(`· ${t.target}：失败 ${t.code ?? ''} ${t.error ?? ''}`)
            }
            return CONTENT(lines.join('\n'))
          },
        },
        timeoutMs: 120000,
        isConcurrencySafe() {
          return false
        },
        async execute(args) {
          const bvid = String(args?.bvid ?? '').trim()
          if (!bvid) {
            return { ok: false, code: 'NO_BVID', error: '没给 bvid', hint: '先用 bili_share_pick 挑一条，再把它发出去' }
          }
          return engine.runOnce({
            bvid,
            note: String(args?.note ?? '').trim(),
            onlyTarget: String(args?.target ?? '').trim(),
            force: args?.force === true,
          })
        },
      },
      logger,
      report,
    ),
  )

  disposers.push(
    register(
      ctx,
      {
        name: 'bili_share_config',
        description: [
          '修改并保存 B 站分享的配置（立刻生效，不用重启）。只传要改的字段，其余保持不变。',
          '例：{"targets":[{"kind":"group","id":"1234567"}]} 或 {"schedule":{"intervalMinMinutes":180,"intervalMaxMinutes":420}}。',
          'targets 在顶层（不在 qq 里），每项 {kind:"group"|"private", id:"群号或QQ号", at?:["QQ号"|"all"], persona?:"这个人的口味"}。',
          '数组是整体替换：改 targets / sources / 关键词列表时要传完整的新数组。',
          'reset=true 会先清空用户保存的配置再应用 patch，回到默认值。',
        ].join('\n'),
        parameters: {
          patch: {
            type: 'object',
            additionalProperties: true,
            description:
              '要合并进去的配置片段，键名与插件配置一致：enabled / sources / filters / qq / targets / schedule / message / state / ai。',
          },
          reset: { type: 'boolean', description: '先清空已保存的配置再应用 patch。默认 false。' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            required: ['text'],
            properties: { text: { type: 'string' } },
          },
          render(args, value) {
            return CONTENT(value.text)
          },
        },
        timeoutMs: 15000,
        isConcurrencySafe() {
          return false
        },
        async execute(args) {
          const patch = args?.patch && typeof args.patch === 'object' ? args.patch : {}
          const result = saveConfig(patch, args?.reset === true)
          const lines = ['配置已保存并生效。', '', describeConfig(result.config)]
          if (result.problems?.length) lines.push('', `需要注意：${result.problems.join('；')}`)
          lines.push('', `配置文件：${result.file}`)
          return { text: lines.join('\n') }
        },
      },
      logger,
      report,
    ),
  )

  void cfg
  const dispose = () => {
    for (const item of disposers) {
      try {
        item?.()
      } catch {
        /* ignore */
      }
    }
  }
  return { dispose, report }
}
