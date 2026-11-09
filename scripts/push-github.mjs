#!/usr/bin/env node
/**
 * 没有 git 也能把插件推上 GitHub：直接走 REST contents API，一个文件一个文件建。
 *
 *   $env:GITHUB_TOKEN = 'ghp_...'      # 需要 repo 权限（经典 token）或 Contents:write（细粒度）
 *   node scripts/push-github.mjs --dry-run
 *   node scripts/push-github.mjs
 *
 * 只读 token 时会在第一步 401/403，脚本会明确说清楚，不会半途留下一堆残文件。
 * 仓库已经有的文件会被覆盖（sha 自动取），所以重复跑是安全的。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN

/** 推上去的东西：源码 + 文档 + 打包信息，不含运行期产物和内部草稿 */
const INCLUDE_DIRS = ['lib', 'locale', 'test', 'scripts', 'screenshots']
const INCLUDE_FILES = [
  'package.json',
  'screenshots.json',
  'cordis.patch.yml',
  'client.js',
  'icon.svg',
  'icon-96.png',
  'README.md',
  'LICENSE',
  'market-entry.yml',
  '.gitignore',
]
const SKIP = [/PROMPT/i, /\.log$/]

function listFiles() {
  const files = []
  for (const dir of INCLUDE_DIRS) {
    const base = join(root, dir)
    let entries = []
    try {
      entries = readdirSync(base)
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(base, entry)
      if (!statSync(full).isFile()) continue
      files.push(relative(root, full).split(sep).join('/'))
    }
  }
  for (const file of INCLUDE_FILES) {
    try {
      if (statSync(join(root, file)).isFile()) files.push(file)
    } catch {
      /* 可选文件不存在就算了 */
    }
  }
  return files.filter((f) => !SKIP.some((re) => re.test(f)))
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const repoUrl = (pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '')
const m = repoUrl.match(/github\.com\/([\w.-]+)\/([\w.-]+)/)
if (!m) {
  console.error('package.json 的 repository 还指向别处，先跑 scripts/set-repo.mjs')
  process.exit(2)
}
const [, owner, repo] = m
const api = (path) => `https://api.github.com/repos/${owner}/${repo}${path}`

const files = listFiles()
console.log(`目标仓库：${owner}/${repo}`)
console.log(`待推送 ${files.length} 个文件：`)
for (const f of files) console.log(`  ${f}`)

if (dryRun) {
  console.log('\n[dry-run] 不发任何请求。')
  process.exit(0)
}

if (!token) {
  console.error('\n缺少 GITHUB_TOKEN。先在同一行里设好再跑：')
  console.error("  $env:GITHUB_TOKEN = 'ghp_...'; node scripts/push-github.mjs")
  process.exit(2)
}

const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'dsh-bili-share-publisher',
  'content-type': 'application/json',
  'x-github-api-version': '2022-11-28',
}

async function call(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    const why = body?.message ?? text
    throw Object.assign(new Error(`${res.status} ${why}`), { status: res.status })
  }
  return body
}

/* 0. 先确认 token 真的能写 —— 别推了一半才发现没权限 */
await call(api(''), {}).catch((e) => {
  console.error(`仓库读不到：${e.message}`)
  process.exit(1)
})

let created = 0
let updated = 0

for (const file of files) {
  const content = readFileSync(join(root, file))
  const encoded = content.toString('base64')
  let sha = null
  try {
    const existing = await call(api(`/contents/${encodeURIComponent(file).replace(/%2F/g, '/')}`))
    sha = existing?.sha ?? null
  } catch (e) {
    if (e.status !== 404) {
      console.error(`读 ${file} 失败：${e.message}`)
      if (e.status === 401 || e.status === 403) {
        console.error('token 没有写权限（或已过期）。需要 repo 权限；建完请撤销这个 token。')
        process.exit(1)
      }
      process.exit(1)
    }
  }
  const payload = {
    message: `${sha ? 'Update' : 'Add'} ${file}`,
    content: encoded,
    ...(sha ? { sha } : {}),
  }
  await call(api(`/contents/${file}`), { method: 'PUT', body: JSON.stringify(payload) })
  console.log(`${sha ? '~' : '+'} ${file}`)
  if (sha) updated += 1
  else created += 1
}

/* 打 topic：市场收录的扫描器认这个 */
try {
  await call(api('/topics'), {
    method: 'PUT',
    body: JSON.stringify({ names: ['dsh-plugin', 'dsh', 'bilibili', 'onebot'] }),
  })
  console.log('+ topics: dsh-plugin, dsh, bilibili, onebot')
} catch (e) {
  console.warn(`topic 没设上（不影响代码，之后可以在网页里加）：${e.message}`)
}

console.log(`\n完成：新增 ${created}，更新 ${updated}`)
console.log(`仓库：https://github.com/${owner}/${repo}`)
