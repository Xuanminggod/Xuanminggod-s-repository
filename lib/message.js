/**
 * 文案层：模板渲染 + 消息段拼装（纯文本 / @ / 图片三段可用）。
 * 模板占位符：{title} {url} {up} {tname} {duration} {views} {desc} {summary} {cover}
 * 把 {cover} 写在模板里就能控制封面插在哪；不写则封面附在最后。
 */

export function formatViews(views) {
  const n = Number(views) || 0
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`
  return String(n)
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (v) => String(v).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** 简介压成一句：跳过「大家好/首先感谢」这类开场白，取第一句有信息量的，超长截断。 */
const FILLER = /^(首先|大家好|各位|感谢大家|谢谢大家|本期视频|这期视频|视频开始前|话不多说|废话不多说|hello|hi |hi，|开头)/i

export function firstSentence(text, max = 80) {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!flat) return ''
  const sentences = flat
    .split(/(?<=[。！？!?])/)
    .map((s) => s.trim())
    .filter(Boolean)
  const cut = sentences.find((s) => s.length >= 6 && !FILLER.test(s)) ?? sentences[0] ?? flat
  const out = cut.length > max ? `${cut.slice(0, max).trimEnd()}…` : cut
  return out
}

export function templateVars(item, summary = '') {
  return {
    title: item.title,
    url: item.url,
    up: item.ownerName,
    tname: item.tname || 'B站',
    duration: formatDuration(item.duration),
    views: formatViews(item.views),
    desc: firstSentence(item.desc),
    summary,
  }
}

export function renderTemplate(template, vars) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (whole, key) => {
    if (key === 'cover') return whole // 由 assembler 处理
    const value = vars[key]
    return value === undefined || value === null ? '' : String(value)
  })
}

/**
 * 组装 OneBot 消息段。
 * @returns {Array<{type:string,data:object}>}
 */
export function buildSegments({ item, config, target, summary = '' }) {
  const { template, withCover, withViews } = config.message
  const vars = templateVars(item, summary)
  const segments = []

  // @ 只对群有效，且要么 @all 要么 @具体人
  if (target?.kind === 'group' && Array.isArray(target.at) && target.at.length > 0) {
    for (const qq of target.at) {
      segments.push({ type: 'at', data: { qq: qq === 'all' ? 'all' : String(qq) } })
    }
    segments.push({ type: 'text', data: { text: ' ' } })
  }

  const body = renderTemplate(template, vars)
  const [before, after] = body.includes('{cover}') ? body.split('{cover}') : [body, '']
  const coverSegment = withCover && item.cover ? { type: 'image', data: { file: item.cover } } : null

  const pushText = (text) => {
    const value = String(text ?? '').replace(/^\n+|\n+$/g, '')
    if (value) segments.push({ type: 'text', data: { text: value } })
  }

  pushText(before)
  if (coverSegment) segments.push(coverSegment)
  pushText(after)

  if (withViews) {
    segments.push({ type: 'text', data: { text: `\n时长 ${vars.duration} · ${vars.views} 播放` } })
  }
  if (summary) {
    segments.push({ type: 'text', data: { text: `\n${summary}` } })
  }
  if (config.message.tag) {
    segments.push({ type: 'text', data: { text: `\n${config.message.tag}` } })
  }

  return segments
}

/** 日志/工具输出用的纯文本预览（不发给 QQ）。 */
export function previewText(segments) {
  return segments
    .map((seg) => {
      if (seg.type === 'text') return seg.data.text
      if (seg.type === 'image') return `[图片 ${seg.data.file}]`
      if (seg.type === 'at') return `@${seg.data.qq}`
      return `[${seg.type}]`
    })
    .join('')
}
