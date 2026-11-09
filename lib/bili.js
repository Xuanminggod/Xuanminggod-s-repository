/**
 * 取数层：只用 B 站匿名公开接口（无需 Cookie），与 surfcore 里的 bili-api.js 同一套 endpoint。
 *  - 排行榜  /x/web-interface/ranking/v2?rid=<rid>&type=all
 *  - 综合热门 /x/web-interface/popular?ps=<limit>&pn=1
 *  - 单视频  /x/web-interface/view?bvid=<bvid>
 */

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  referer: 'https://www.bilibili.com/',
  accept: 'application/json, text/plain, */*',
}

const API = 'https://api.bilibili.com'

const httpsUrl = (url) => String(url ?? '').replace(/^http:\/\//i, 'https://')

function normalizeItem(raw) {
  if (!raw?.bvid) return null
  const owner = raw.owner ?? {}
  const stat = raw.stat ?? {}
  return {
    bvid: raw.bvid,
    aid: raw.aid ?? 0,
    title: String(raw.title ?? '').trim(),
    desc: String(raw.desc ?? '').trim(),
    url: `https://www.bilibili.com/video/${raw.bvid}`,
    pubdate: Number(raw.pubdate ?? 0) * 1000,
    duration: Number(raw.duration ?? 0),
    cover: httpsUrl(raw.pic),
    tname: String(raw.tname ?? raw.tname_v2 ?? ''),
    ownerMid: String(owner.mid ?? ''),
    ownerName: String(owner.name ?? ''),
    views: Number(stat.view ?? 0),
    likes: Number(stat.like ?? 0),
  }
}

async function getJson(path, { cookie = '', timeoutMs = 10000 } = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: cookie ? { ...HEADERS, cookie } : HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const json = await response.json().catch(() => null)
  if (!response.ok) {
    throw Object.assign(new Error(`HTTP ${response.status}`), {
      code: 'BILI_HTTP',
      hint: 'B 站接口异常，稍后再试；若长期 412 说明被限流，调大间隔',
    })
  }
  if (!json || json.code !== 0) {
    const code = json?.code
    throw Object.assign(new Error(json?.message || 'B 站返回错误'), {
      code: code === -352 ? 'BILI_RISK_CONTROL' : 'BILI_API',
      hint:
        code === -352
          ? 'B 站风控：需要 wbi 签名或 Cookie，降低频率或换个网络'
          : `B 站返回 code=${code}，检查 rid 是否有效`,
    })
  }
  return json.data ?? {}
}

/** 单个来源拉取候选，失败只返回空数组把原因带给上层。 */
export async function fetchSource(source, { cookie = '', timeoutMs = 10000 } = {}) {
  try {
    if (source.type === 'popular') {
      const data = await getJson(`/x/web-interface/popular?ps=${source.limit}&pn=1`, { cookie, timeoutMs })
      const list = (data.list ?? []).map(normalizeItem).filter(Boolean)
      return { ok: true, items: list, source: 'popular' }
    }
    const data = await getJson(`/x/web-interface/ranking/v2?rid=${source.rid}&type=all`, { cookie, timeoutMs })
    const list = (data.list ?? []).slice(0, source.limit).map(normalizeItem).filter(Boolean)
    return { ok: true, items: list, source: `ranking:${source.rid}` }
  } catch (error) {
    return {
      ok: false,
      items: [],
      source: source.type === 'popular' ? 'popular' : `ranking:${source.rid}`,
      code: error?.code ?? 'BILI_NETWORK',
      error: `${source.type === 'popular' ? '综合热门' : `排行榜 rid=${source.rid}`} 拉取失败：${error.message}`,
      hint: error?.hint ?? '检查网络；DSH 需要能访问 api.bilibili.com',
    }
  }
}

/** 多来源合并去重（按 bvid）。 */
export async function fetchCandidates(sources, options) {
  const results = await Promise.all(sources.map((source) => fetchSource(source, options)))
  const seen = new Set()
  const items = []
  for (const result of results) {
    for (const item of result.items) {
      if (seen.has(item.bvid)) continue
      seen.add(item.bvid)
      items.push(item)
    }
  }
  const failures = results.filter((r) => !r.ok).map((r) => ({ code: r.code, error: r.error, hint: r.hint }))
  return { items, failures, perSource: results.map((r) => ({ source: r.source, ok: r.ok, count: r.items.length })) }
}

/** 单视频详情（手工指定 bvid 时用）。 */
export async function fetchVideoInfo(bvid, { cookie = '', timeoutMs = 10000 } = {}) {
  const id = String(bvid ?? '').trim()
  if (!/^BV[0-9A-Za-z]{8,12}$/.test(id)) {
    return { ok: false, code: 'BAD_BVID', error: `bvid 不合法：${id}`, hint: '例子：BV1Ly4i6AE5b' }
  }
  try {
    const data = await getJson(`/x/web-interface/view?bvid=${id}`, { cookie, timeoutMs })
    const item = normalizeItem(data)
    if (!item) return { ok: false, code: 'BILI_EMPTY', error: '接口没返回视频信息', hint: '确认视频仍公开可见' }
    return { ok: true, item }
  } catch (error) {
    return {
      ok: false,
      code: error?.code ?? 'BILI_NETWORK',
      error: `取 ${id} 失败：${error.message}`,
      hint: error?.hint ?? '检查网络或视频是否被删除/仅粉丝可见',
    }
  }
}
