/**
 * 推荐语层：可选地用 DSH 自己的模型写一句「为什么值得点开」，失败就退回 B 站简介首句。
 * 走 ctx.get('llm') + agentDefaultModel.currentSelection()，不额外配置 API key；
 * config.ai.provider / model 留空时跟随「设置 → 模型」里的默认模型。
 */

import { firstSentence } from './message.js'
import { dataRoot } from './state.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 把最近的 AI 失败落盘：没有日志可看时，这是唯一能问的证人。 */
function noteAiFailure(info) {
  try {
    mkdirSync(dataRoot(), { recursive: true })
    writeFileSync(join(dataRoot(), 'last-ai.json'), JSON.stringify({ at: new Date().toISOString(), ...info }, null, 2), 'utf8')
  } catch {
    /* 落盘失败不影响主流程 */
  }
}

function resolveModel(ctx, ai) {
  if (ai.provider && ai.model) return { provider: ai.provider, model: ai.model }
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.() ?? null
    const provider = String(selection?.provider ?? '').trim()
    const model = String(selection?.model ?? '').trim()
    if (provider && model) return { provider, model }
  } catch {
    /* 服务没装就当没有 */
  }
  return ai.provider && ai.model ? { provider: ai.provider, model: ai.model } : null
}

export function llmReady(ctx, ai) {
  try {
    return Boolean(ctx.get('llm')?.stream) && Boolean(resolveModel(ctx, ai))
  } catch {
    return false
  }
}

async function complete(ctx, ai, { system, user, temperature = 0.9, maxTokens = ai.maxTokens }) {
  const llm = ctx.get('llm')
  if (!llm?.stream) throw Object.assign(new Error('DSH 的 llm 服务不可用'), { code: 'LLM_UNAVAILABLE' })
  const target = resolveModel(ctx, ai)
  if (!target) throw Object.assign(new Error('读不到 DSH 的默认模型（设置 → 模型）'), { code: 'LLM_NO_MODEL' })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ai.timeoutMs)
  let text = ''
  const seen = []
  let finishReason = null
  try {
    const stream = llm.stream({
      provider: target.provider,
      model: target.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
      maxTokens,
      temperature,
      signal: controller.signal,
    })
    for await (const chunk of stream) {
      if (!chunk) continue
      if (seen.length < 12) seen.push(chunk.type ?? typeof chunk)
      if (chunk.type === 'text-delta' && chunk.text) text += chunk.text
      else if (chunk.type === 'finish') {
        finishReason = chunk.reason ?? null
        const kind = chunk.reason?.kind
        if (kind === 'error' || kind === 'aborted') {
          const message = chunk.reason?.failure?.message || (kind === 'aborted' ? '模型调用被取消' : '模型调用失败')
          throw Object.assign(new Error(message), { code: chunk.reason?.failure?.code || kind })
        }
      }
    }
  } finally {
    clearTimeout(timer)
  }
  return { text, model: target.model, seen, finishReason }
}

const clean = (text) =>
  String(text ?? '')
    .replace(/^["'“”「」『』\s]+|["'“”「」『』\s]+$/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim()

/**
 * 生成推荐语。
 * @returns {Promise<{text:string, mode:'off'|'desc'|'ai'|'ai-fallback', code?:string, error?:string, hint?:string}>}
 */
export async function makeSummary({ ctx, item, config, target, logger }) {
  const { summaryMode, summaryMaxChars, tone } = config.message
  const maxChars = summaryMaxChars > 0 ? summaryMaxChars : 60
  const fallback = () => {
    const desc = firstSentence(item.desc, maxChars)
    return desc ? { text: desc, mode: 'desc' } : { text: '', mode: 'desc' }
  }

  if (summaryMode === 'off') return { text: '', mode: 'off' }
  if (summaryMode === 'desc') return fallback()
  if (!llmReady(ctx, config.ai)) {
    const out = fallback()
    return {
      ...out,
      mode: 'ai-fallback',
      code: 'LLM_UNAVAILABLE',
      error: '没有可用的模型服务，已改用简介首句',
      hint: '在 设置 → 模型 里选一个默认模型，或把 message.summaryMode 改成 desc / off',
    }
  }

  const persona = String(target?.persona ?? '').trim()
  const system = [
    '你在给朋友分享一条 B 站视频。只写一句中文推荐语，不要引号、不要表情、不要话题标签。',
    `不超过 ${maxChars} 个字。不要复述完整标题，不要说「为您推荐」「快来」这类客套话。`,
    tone ? `语气：${tone}` : '语气：像熟人随口安利，具体、有信息量。',
  ].join('\n')
  const user = [
    `标题：${item.title}`,
    `UP主：${item.ownerName}`,
    `分区：${item.tname}`,
    `时长：${Math.round(item.duration / 60)} 分钟`,
    `播放：${item.views}`,
    item.desc ? `简介：${firstSentence(item.desc, 300)}` : '',
    persona ? `收件人的偏好：${persona}（贴合这个偏好挑一个点说，但不要谄媚）` : '',
  ]
    .filter(Boolean)
    .join('\n')

  // 推理模型容易把预算全烧在思考上（finish: max-tokens 却没有正文），
  // 所以先按配置预算试，发现是预算耗尽就放大四倍重试，仍空才放弃。
  let budget = Math.max(240, Number(config.ai?.maxTokens) || 240)
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { text, seen, finishReason } = await complete(ctx, config.ai, { system, user, maxTokens: budget })
      if (finishReason?.kind === 'max-tokens') budget = Math.min(4096, Math.max(budget * 4, 1600))
      const cleaned = clean(text).slice(0, maxChars * 2)
      if (!cleaned) {
        if (attempt === 1) continue
        noteAiFailure({ code: 'LLM_EMPTY', error: '模型没有返回文本', bvid: item.bvid, seen, finishReason })
        throw Object.assign(new Error('模型返回空内容'), { code: 'LLM_EMPTY' })
      }
      return { text: cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}…` : cleaned, mode: 'ai' }
    } catch (error) {
      if (error?.code === 'LLM_EMPTY' && attempt === 1) continue
      logger?.warn?.(`AI 推荐语失败，退回简介：${error?.message ?? error}`)
      if (error?.code !== 'LLM_EMPTY') {
        noteAiFailure({
          code: error?.code || 'LLM_ERROR',
          error: String(error?.message ?? error),
          bvid: item.bvid,
          model: config.ai?.model || '(默认)',
        })
      }
      return {
        ...fallback(),
        mode: 'ai-fallback',
        code: error?.code || 'LLM_ERROR',
        error: String(error?.message ?? error),
        hint: 'AI 只是锦上添花；想让分享更稳可把 message.summaryMode 设为 desc',
      }
    }
  }
  return { ...fallback(), mode: 'ai-fallback', code: 'LLM_ERROR' }
}
