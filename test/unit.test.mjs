/**
 * 单元测试：不联网、不碰真实 QQ。
 * 跑法：node --test test/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'

import { normalizeConfig, parseQuietHours, inQuietHours, DEFAULTS } from '../lib/config.js'
import { applyFilters, pickRandom } from '../lib/pick.js'
import {
  buildSegments,
  formatDuration,
  formatViews,
  firstSentence,
  previewText,
  renderTemplate,
} from '../lib/message.js'

// 状态文件不能污染真实 ~/.dsh
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'bili-share-test-'))

const { createStateStore } = await import('../lib/state.js')
const { sendMessage, checkOneBot } = await import('../lib/onebot.js')

const item = (over = {}) => ({
  bvid: 'BV1xx411c7mD',
  aid: 1,
  title: '崩坏：星穹铁道 公益第三卷',
  desc: '一个关于抵达彩色的彼方的故事。后面还有第二句。',
  url: 'https://www.bilibili.com/video/BV1xx411c7mD',
  pubdate: Date.now() - 3600_000,
  duration: 330,
  cover: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
  tname: '手机游戏',
  ownerMid: '401742377',
  ownerName: '米哈游',
  views: 1234567,
  likes: 1000,
  ...over,
})

const baseFilters = { ...DEFAULTS.filters }

/* ── 配置 ───────────────────────────────────────────────────────────── */

test('默认配置可用，且没有任何问题', () => {
  const { config, problems } = normalizeConfig({})
  assert.equal(config.enabled, true)
  assert.equal(config.schedule.intervalMinMinutes, 240)
  assert.equal(config.schedule.intervalMaxMinutes, 600)
  assert.equal(config.message.summaryMode, 'ai')
  assert.deepEqual(config.problems ?? [], [])
  assert.ok(problems.some((p) => p.includes('targets')), '空 targets 应被提示')
})

test('非法配置回退默认值并报出来，不抛异常', () => {
  const { config, problems } = normalizeConfig({
    sources: [{ type: '不存在的来源' }],
    qq: { baseUrl: 'ftp://nope', gapMinMs: 5000, gapMaxMs: 1000 },
    schedule: { intervalMinMinutes: 600, intervalMaxMinutes: 240, quietHours: '25:00-08:00' },
    filters: { minSeconds: 3600, maxSeconds: 60 },
    targets: [{ kind: 'group', id: '不是群号' }, { kind: 'private', id: '10001' }],
  })
  assert.equal(config.sources[0].type, 'ranking', '非法来源被丢弃后回退到全站排行榜')
  assert.equal(config.qq.baseUrl, DEFAULTS.qq.baseUrl)
  assert.equal(config.schedule.intervalMinMinutes, 240, '交换后的间隔')
  assert.equal(config.schedule.intervalMaxMinutes, 600)
  assert.equal(config.filters.minSeconds, 60, '时长上下限被交换')
  assert.equal(config.schedule.quiet, null, '无法解析的安静时段被忽略')
  assert.equal(config.targets.length, 1, '非法群号被丢掉，好友保留')
  assert.equal(config.targets[0].kind, 'private')
  assert.ok(problems.length >= 3)
})

test('安静时段解析与跨午夜判断', () => {
  assert.deepEqual(parseQuietHours('23:00-08:00'), { start: 1380, end: 480 })
  assert.deepEqual(parseQuietHours('08:00~12:30'), { start: 480, end: 750 })
  assert.equal(parseQuietHours('abc'), null)
  const quiet = parseQuietHours('23:00-08:00')
  assert.equal(inQuietHours(new Date(2026, 0, 1, 23, 30), quiet), true)
  assert.equal(inQuietHours(new Date(2026, 0, 1, 7, 59), quiet), true)
  assert.equal(inQuietHours(new Date(2026, 0, 1, 8, 0), quiet), false)
  assert.equal(inQuietHours(new Date(2026, 0, 1, 12, 0), quiet), false)
})

/* ── 过滤 ───────────────────────────────────────────────────────────── */

test('七道过滤各自生效，且能逐条关掉', () => {
  const now = Date.now()
  const sentTo = new Set(['BV1seen00001'])
  const recentUps = ['401742377']
  const cases = [
    ['太旧', item({ pubdate: now - 30 * 86400_000 }), 'age'],
    ['太短', item({ duration: 10 }), 'duration'],
    ['太长', item({ duration: 7200 }), 'duration'],
    ['播放少', item({ views: 10 }), 'views'],
    ['不含关键词', item({ title: '无关内容', desc: '' }), 'include'],
    ['命中排除词', item({ title: '星穹铁道 内鬼爆料' }), 'exclude'],
    ['发过了', item({ bvid: 'BV1seen00001' }), 'seen'],
    ['同一 UP', item({ ownerMid: '401742377' }), 'sameUp'],
  ]
  for (const [label, candidate, key] of cases) {
    const filters = { ...baseFilters, includeKeywords: ['星穹铁道'], excludeKeywords: ['内鬼'] }
    const { kept, dropped } = applyFilters([candidate], { filters, now, sentTo, recentUps })
    assert.equal(kept.length, 0, label)
    assert.equal(dropped[key], 1, label)
  }

  // 全部关掉：同一条脏数据也能过
  const off = {
    ...DEFAULTS.filters,
    maxAgeDays: 0,
    minSeconds: 0,
    maxSeconds: 0,
    minViews: 0,
    includeKeywords: [],
    excludeKeywords: [],
    sameUpCooldown: 0,
  }
  const dirty = item({ pubdate: now - 365 * 86400_000, duration: 3, views: 1 })
  assert.equal(applyFilters([dirty], { filters: off, now, sentTo: new Set(), recentUps: [] }).kept.length, 1)

  const clean = applyFilters([item()], { filters: baseFilters, now, sentTo: new Set(), recentUps: [] })
  assert.equal(clean.kept.length, 1)
})

test('随机抽取覆盖整个候选池，且空池返回 null', () => {
  const pool = ['a', 'b', 'c', 'd']
  const seen = new Set()
  for (let i = 0; i < 200; i += 1) seen.add(pickRandom(pool))
  assert.equal(seen.size, 4)
  assert.equal(pickRandom([], () => 0.5), null)
  assert.equal(pickRandom(pool, () => 0.99), 'd', 'rng 取上界也不能越界')
})

/* ── 文案 ───────────────────────────────────────────────────────────── */

test('格式化数字/时长/简介首句', () => {
  assert.equal(formatViews(999), '999')
  assert.equal(formatViews(12345), '1.2万')
  assert.equal(formatViews(123456789), '1.2亿')
  assert.equal(formatDuration(59), '0:59')
  assert.equal(formatDuration(330), '5:30')
  assert.equal(formatDuration(3725), '1:02:05')
  assert.equal(firstSentence('第一句。第二句。'), '第一句。')
  assert.equal(firstSentence(''), '')
  assert.ok(firstSentence('x'.repeat(200), 20).endsWith('…'))
})

test('模板渲染：未知占位符留空，{cover} 交给拼装器', () => {
  const vars = { title: 'T', url: 'U', tname: '游戏' }
  assert.equal(renderTemplate('【B站·{tname}】{title}\n{url}', vars), '【B站·游戏】T\nU')
  assert.equal(renderTemplate('{nope}', vars), '')
  assert.equal(renderTemplate('a{cover}b', vars), 'a{cover}b')
})

test('消息段：默认纯文本，开关控制封面/@/播放量/推荐语', () => {
  const config = normalizeConfig({}).config
  const target = { kind: 'group', id: '1', at: [], persona: '' }

  const plain = buildSegments({ item: item(), config, target })
  assert.deepEqual(plain, [
    { type: 'text', data: { text: '【B站·手机游戏】崩坏：星穹铁道 公益第三卷\nhttps://www.bilibili.com/video/BV1xx411c7mD' } },
  ])

  const rich = buildSegments({
    item: item(),
    config: {
      ...config,
      message: { ...config.message, withCover: true, withViews: true, template: '{title}\n{url}\n{cover}' },
    },
    target: { ...target, at: ['10001', 'all'] },
    summary: '五分钟看完，画面很顶。',
  })
  const kinds = rich.map((s) => s.type)
  assert.deepEqual(kinds, ['at', 'at', 'text', 'text', 'image', 'text', 'text'])
  assert.equal(rich[4].data.file, item().cover)
  assert.match(previewText(rich), /\[图片 https:\/\//)
  assert.ok(previewText(rich).includes('@all'))
  assert.ok(previewText(rich).includes('五分钟看完，画面很顶。'))
})

/* ── 状态 ───────────────────────────────────────────────────────────── */

test('状态：去重、每日计数、裁剪、原子写后能读回', () => {
  const store = createStateStore({ keepCount: 3, keepDays: 90 })
  const now = new Date()
  store.load()
  assert.equal(store.hasSent('BV1', 'group:1'), false)

  store.recordSent({ bvid: 'BV1', target: 'group:1', at: Date.now() })
  store.recordSent({ bvid: 'BV2', target: 'group:1', at: Date.now() })
  store.recordSent({ bvid: 'BV1', target: 'group:2', at: Date.now() })
  assert.equal(store.hasSent('BV1', 'group:1'), true)
  assert.equal(store.hasSent('BV1', 'group:2'), true, '不同目标独立')
  assert.equal(store.hasSent('BV1', 'group:3'), false)

  assert.equal(store.dailyCount(now), 0)
  store.bumpDaily(now)
  store.bumpDaily(now)
  assert.equal(store.dailyCount(now), 2)

  store.recordSent({ bvid: 'BV3', target: 'group:1', at: Date.now() })
  store.recordSent({ bvid: 'BV4', target: 'group:1', at: Date.now() })
  assert.equal(store.state.sent.length, 3, '超出 keepCount 丢最旧')

  store.noteFailure('QQ_UNREACHABLE', '启动 OneBot')
  assert.equal(store.state.failures.consecutive, 1)
  store.resetFailure()
  assert.equal(store.state.failures.consecutive, 0)

  store.state.nextAt = Date.now() + 1000
  assert.equal(store.save(), true)

  const reopened = createStateStore({ keepCount: 3, keepDays: 90 })
  reopened.load()
  assert.equal(reopened.state.nextAt, store.state.nextAt)
  assert.equal(reopened.state.sent.length, 3)
})

test('状态文件损坏时备份并重建，不阻塞启动', async () => {
  const { writeFileSync } = await import('node:fs')
  const store = createStateStore({})
  const file = store.file
  writeFileSync(file, '{ 这不是 json', 'utf8')
  const fresh = createStateStore({})
  const state = fresh.load()
  assert.equal(state.sent.length, 0)
  assert.equal(state.paused, false)
})

/* ── OneBot ─────────────────────────────────────────────────────────── */

function stubServer(handler) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => handler(req, res, body))
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, close: () => server.close() })
    })
  })
}

const qqBase = { accessToken: '', timeoutMs: 3000, retries: 0, gapMinMs: 0, gapMaxMs: 0 }

test('OneBot：正常发送会带上群号与消息段', async () => {
  let seen = null
  const stub = await stubServer((req, res, body) => {
    seen = { url: req.url, body: JSON.parse(body) }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 42 } }))
  })
  try {
    const out = await sendMessage({
      qq: { ...qqBase, baseUrl: stub.baseUrl },
      kind: 'group',
      id: '123456',
      segments: [{ type: 'text', data: { text: 'hi' } }],
    })
    assert.equal(out.ok, true)
    assert.equal(seen.url, '/send_group_msg')
    assert.equal(seen.body.group_id, 123456)
    assert.deepEqual(seen.body.message, [{ type: 'text', data: { text: 'hi' } }])
  } finally {
    stub.close()
  }
})

test('OneBot：只认老端点名时会自动回退', async () => {
  const paths = []
  const stub = await stubServer((req, res) => {
    paths.push(req.url)
    if (req.url === '/send_group_msg') {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', retcode: 0 }))
  })
  try {
    const out = await sendMessage({
      qq: { ...qqBase, baseUrl: stub.baseUrl },
      kind: 'group',
      id: '1',
      segments: [{ type: 'text', data: { text: 'hi' } }],
    })
    assert.equal(out.ok, true)
    assert.deepEqual(paths, ['/send_group_msg', '/sendgroupmsg'])
  } finally {
    stub.close()
  }
})

test('OneBot：retcode 非 0 与连不上都要给出可执行的 hint', async () => {
  const stub = await stubServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'failed', retcode: 100, message: '群不存在' }))
  })
  try {
    const rejected = await sendMessage({
      qq: { ...qqBase, baseUrl: stub.baseUrl },
      kind: 'group',
      id: '1',
      segments: [{ type: 'text', data: { text: 'hi' } }],
    })
    assert.equal(rejected.ok, false)
    assert.equal(rejected.code, 'QQ_API_REJECTED')
    assert.ok(rejected.hint)
  } finally {
    stub.close()
  }

  const dead = await checkOneBot({ qq: { ...qqBase, baseUrl: 'http://127.0.0.1:1' } })
  assert.equal(dead.ok, false)
  assert.equal(dead.code, 'QQ_UNREACHABLE')
  assert.match(dead.hint, /127\.0\.0\.1:1/)
})
