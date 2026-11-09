/**
 * 挑选层：按用户配置的顺序过滤，最后均匀随机抽一条。
 * 每个过滤器都能关：数值填 0 / 列表留空即视为关闭（见 README 的「关掉某个条件」）。
 */

const lower = (v) => String(v ?? '').toLowerCase()

function matchAny(text, keywords) {
  return keywords.some((kw) => text.includes(lower(kw)))
}

/**
 * @param {object[]} items 候选
 * @param {object} ctx { filters, now, sentTo:Set<string>, recentUps:string[], targetKeys:string[] }
 * @returns {{ kept: object[], dropped: Record<string, number> }}
 */
export function applyFilters(items, { filters, now, sentTo, recentUps }) {
  const dropped = { age: 0, duration: 0, views: 0, include: 0, exclude: 0, seen: 0, sameUp: 0 }
  const kept = []

  const oldest = filters.maxAgeDays > 0 ? now - filters.maxAgeDays * 86400000 : 0
  const includeKw = filters.includeKeywords.map(lower)
  const excludeKw = filters.excludeKeywords.map(lower)
  const cooldownUps = filters.sameUpCooldown > 0 ? new Set(recentUps.slice(-filters.sameUpCooldown)) : null

  for (const item of items) {
    if (oldest && item.pubdate && item.pubdate < oldest) {
      dropped.age += 1
      continue
    }
    if (item.duration > 0) {
      if (filters.minSeconds > 0 && item.duration < filters.minSeconds) {
        dropped.duration += 1
        continue
      }
      if (filters.maxSeconds > 0 && item.duration > filters.maxSeconds) {
        dropped.duration += 1
        continue
      }
    }
    if (filters.minViews > 0 && item.views < filters.minViews) {
      dropped.views += 1
      continue
    }
    const haystack = `${lower(item.title)} ${lower(item.desc)}`
    if (includeKw.length > 0 && !matchAny(haystack, includeKw)) {
      dropped.include += 1
      continue
    }
    if (excludeKw.length > 0 && matchAny(haystack, excludeKw)) {
      dropped.exclude += 1
      continue
    }
    if (sentTo.has(item.bvid)) {
      dropped.seen += 1
      continue
    }
    if (cooldownUps && cooldownUps.has(item.ownerMid)) {
      dropped.sameUp += 1
      continue
    }
    kept.push(item)
  }

  return { kept, dropped }
}

/** 均匀随机抽一条；RNG 可注入以便测试。 */
export function pickRandom(items, random = Math.random) {
  if (items.length === 0) return null
  const index = Math.min(items.length - 1, Math.floor(random() * items.length))
  return items[index]
}
