#!/usr/bin/env node
/**
 * 把仓库地址一次性写进所有需要它的地方。
 *
 *   node scripts/set-repo.mjs https://github.com/owner/repo
 *   node scripts/set-repo.mjs owner/repo
 *   node scripts/set-repo.mjs owner/repo --dry-run
 *
 * 会改三处：package.json（repository / homepage / bugs）、README.md（仓库链接）、
 * market-entry.yml（url / name）。重复运行是幂等的。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const raw = args.find((a) => !a.startsWith('--'))

if (!raw) {
  console.error('用法：node scripts/set-repo.mjs https://github.com/owner/repo [--dry-run]')
  process.exit(2)
}

const match = raw
  .trim()
  .replace(/\.git$/, '')
  .match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)\/?$/i)

if (!match) {
  console.error(`看不懂这个地址：${raw}\n要 https://github.com/owner/repo 或 owner/repo`)
  process.exit(2)
}

const owner = match[1]
const repo = match[2]
const url = `https://github.com/${owner}/${repo}`

const changes = []

function edit(relative, transform) {
  const file = join(root, relative)
  const before = readFileSync(file, 'utf8')
  const after = transform(before)
  if (after === before) {
    console.log(`= ${relative}（无需改动）`)
    return
  }
  changes.push(relative)
  if (!dryRun) writeFileSync(file, after, 'utf8')
  console.log(`${dryRun ? '~' : '+'} ${relative}`)
}

/* package.json：补 repository / homepage / bugs，并去掉占位 */
edit('package.json', (text) => {
  const json = JSON.parse(text)
  json.repository = { type: 'git', url: `git+${url}.git` }
  json.homepage = url
  json.bugs = { url: `${url}/issues` }
  return `${JSON.stringify(json, null, 2)}\n`
})

/* README：第一段之后放一行仓库链接；已有就替换 */
edit('README.md', (text) => {
  const line = `仓库：[${owner}/${repo}](${url})`
  if (/^仓库：.*$/m.test(text)) return text.replace(/^仓库：.*$/m, line)
  return text.replace(/^(# .+\n)/, `$1\n${line}\n`)
})

/* market-entry.yml：url 与 name 两行 */
edit('market-entry.yml', (text) =>
  text
    .replace(/^url: .*$/m, `url: ${url}`)
    .replace(/^name: .*$/m, `name: ${owner}/${repo}`),
)

console.log(
  dryRun
    ? `\n[dry-run] 会写入 ${changes.length} 个文件：${changes.join('、') || '无'}`
    : `\n完成：${url}`,
)

if (!dryRun) {
  console.log('下一步：把目录推到该仓库 → 加 topic `dsh-plugin` → 满 1 天后按 market-entry.yml 提 PR。')
}
