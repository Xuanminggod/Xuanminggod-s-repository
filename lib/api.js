/**
 * 给设置面板用的本地 HTTP 接口。
 *
 * 为什么不走 RPC：客户端插件能拿到的是浏览器的 fetch，宿主给插件的正规出口就是
 * webServer.register。所以这里挂两条同源路由，只监听本机回环（webServer 本来就是
 * 绑在本机上的），面板直接 fetch 相对路径。
 *
 *   GET  /bili-share/api   → { ok, status, config, summary, problems }
 *   POST /bili-share/api   → { action: 'save' | 'pause' | 'now', ... }
 *
 * 路由随插件 fiber 回收（ctx.effect），插件停用后这两条路径会消失。
 */

const BODY_LIMIT = 1 << 20 // 1MB：配置片段不可能这么大

function sendJson(res, statusCode, body) {
  const text = JSON.stringify(body)
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/** cordis 里访问未 inject 的服务会在取属性时抛错，必须用 get 探测。 */
function optional(ctx, key) {
  try {
    if (typeof ctx.get === 'function') {
      const found = ctx.get(key)
      if (found) return found
    }
  } catch {
    /* 没注入就继续往下试 */
  }
  try {
    return ctx?.[key]
  } catch {
    return undefined
  }
}

/**
 * @returns {{registered: string[], failed: Array<{path:string,error:string}>, dispose: () => void}}
 */
export function registerApi({ ctx, logger, engine, saveConfig, getConfig }) {
  const server = optional(ctx, 'webServer')
  const report = { registered: [], failed: [], dispose: () => {} }
  if (!server || typeof server.register !== 'function') {
    logger.info('没有 webServer 服务：设置面板的接口未挂载（插件其余部分照常工作）')
    return report
  }

  const disposers = []
  const mount = (kind, path, handler) => {
    try {
      disposers.push(server.register({ kind, path, handler }))
      report.registered.push(path)
    } catch (error) {
      report.failed.push({ path, error: String(error?.message ?? error) })
      logger.warn(`注册路由 ${path} 失败：${error?.message ?? error}`)
    }
  }

  mount('exact', '/bili-share/api', async (req, res) => {
    try {
      if (req.method === 'GET' || req.method === 'HEAD') {
        const config = getConfig()
        sendJson(res, 200, {
          ok: true,
          status: engine.status(),
          config,
          summary: config.summary,
          problems: config.problems ?? [],
        })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: '只支持 GET / POST' })
        return
      }

      const body = await readJson(req)
      const action = String(body.action ?? '')

      if (action === 'save') {
        const result = saveConfig(body.patch, body.reset === true)
        sendJson(res, 200, {
          ok: true,
          config: result.config,
          problems: result.problems,
          file: result.file,
          status: engine.status(),
        })
        return
      }
      if (action === 'pause') {
        const result = engine.setPaused(body.paused !== false)
        sendJson(res, 200, { ok: true, ...result, status: engine.status() })
        return
      }
      if (action === 'now') {
        const result = await engine.runOnce({
          dryRun: body.dryRun === true,
          bvid: body.bvid ? String(body.bvid) : undefined,
          target: body.target ? String(body.target) : undefined,
        })
        sendJson(res, 200, { ...result, status: engine.status() })
        return
      }

      sendJson(res, 400, {
        ok: false,
        code: 'BAD_ACTION',
        error: `未知动作：${action || '(空)'}`,
        hint: 'action 只能是 save / pause / now',
      })
    } catch (error) {
      logger.warn(`设置面板接口出错：${error?.message ?? error}`)
      sendJson(res, 500, {
        ok: false,
        code: 'PANEL_API',
        error: String(error?.message ?? error),
        hint: '看 Harness 日志里的 [bili-share] 行',
      })
    }
  })

  report.dispose = () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        /* 已经释放过了 */
      }
    }
  }
  return report
}
