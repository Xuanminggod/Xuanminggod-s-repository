/**
 * 发送层：直连 OneBot v11 HTTP，不依赖任何私有桥接。
 * 群 /send_group_msg  { group_id, message }
 * 私聊 /send_private_msg { user_id, message }
 * 部分实现只认 /sendgroupmsg、/sendprivatemsg，这里按顺序回退。
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const ENDPOINTS = {
  group: ['/send_group_msg', '/sendgroupmsg'],
  private: ['/send_private_msg', '/sendprivatemsg'],
}

function toId(raw) {
  const n = Number(raw)
  return Number.isSafeInteger(n) && String(n) === String(raw).trim() ? n : String(raw).trim()
}

function buildPayload(kind, id, segments) {
  return kind === 'group'
    ? { group_id: toId(id), message: segments, auto_escape: false }
    : { user_id: toId(id), message: segments, auto_escape: false }
}

/** 把一次 HTTP 失败翻译成「下一步该做什么」。 */
function classify(error, { baseUrl, status, kind }) {
  const where = `${baseUrl}`
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return {
      code: 'QQ_TIMEOUT',
      error: `请求 ${where} 超时`,
      hint: 'OneBot 在运行吗？是否卡住？可调大 qq.timeoutMs 试试',
    }
  }
  if (status === 401 || status === 403) {
    return {
      code: 'QQ_AUTH',
      error: `OneBot 拒绝请求（HTTP ${status}）`,
      hint: 'token 不对：把 OneBot 的 access token 填进 qq.accessToken',
    }
  }
  if (status === 404) {
    return {
      code: 'QQ_NO_ENDPOINT',
      error: `${where} 没有 ${kind === 'group' ? 'send_group_msg' : 'send_private_msg'} 接口（HTTP 404）`,
      hint: '确认这是 OneBot v11 的 HTTP 端口（不是 webui / 不是正向 WS 端口）',
    }
  }
  if (status) {
    return {
      code: 'QQ_HTTP_ERROR',
      error: `OneBot 返回 HTTP ${status}`,
      hint: '看 OneBot 端日志；401/403 是 token，404 是端口或路径不对',
    }
  }
  const detail = String(error?.cause?.code || error?.message || error)
  return {
    code: 'QQ_UNREACHABLE',
    error: `连不上 ${where}：${detail}`,
    hint: `确认 OneBot 已在 ${where} 监听（先在浏览器打开 /get_login_info 试试）`,
  }
}

async function postJson(url, body, { token, timeoutMs }) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = /^bearer /i.test(token) ? token : `Bearer ${token}`
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* 非 JSON：留着原文报错 */
  }
  return { response, json, text }
}

/**
 * 发一条消息（内部已做重试与端点回退）。
 * @returns {Promise<{ok:true,data:any,attempts:number}|{ok:false,code:string,error:string,hint:string,attempts:number}>}
 */
export async function sendMessage({ qq, kind, id, segments, logger }) {
  const attempts = Math.max(1, qq.retries + 1)
  const delay = [1000, 3000, 6000, 10000]
  let last = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (const path of ENDPOINTS[kind] ?? ENDPOINTS.group) {
      const url = `${qq.baseUrl}${path}`
      try {
        const { response, json, text } = await postJson(url, buildPayload(kind, id, segments), {
          token: qq.accessToken,
          timeoutMs: qq.timeoutMs,
        })
        if (response.status === 404) {
          last = { ...classify(null, { baseUrl: qq.baseUrl, status: 404, kind }), attempts: attempt, url }
          continue // 换下一个端点名再试
        }
        if (!response.ok) {
          last = { ...classify(null, { baseUrl: qq.baseUrl, status: response.status, kind }), attempts: attempt, url }
          break
        }
        // OneBot v11: { status:'ok'|'failed', retcode, data, message }
        const retcode = json?.retcode
        if (retcode !== undefined && retcode !== 0 && retcode !== 1) {
          last = {
            ok: false,
            code: 'QQ_API_REJECTED',
            error: `OneBot 返回 retcode=${retcode}：${json?.message || json?.wording || text?.slice(0, 200) || ''}`,
            hint:
              retcode === 100
                ? '群号/QQ 号不对，或机器人不在群里'
                : '看 OneBot 端日志；retcode=100 一般是群号/QQ 号不存在',
            attempts: attempt,
            url,
          }
          break
        }
        logger?.debug?.(`已发送 ${kind}:${id} via ${path}`)
        return { ok: true, data: json?.data ?? json, attempts: attempt, url }
      } catch (error) {
        last = { ...classify(error, { baseUrl: qq.baseUrl, kind }), attempts: attempt, url }
      }
    }
    if (last?.ok === true) return last
    if (last?.code === 'QQ_AUTH' || last?.code === 'QQ_API_REJECTED') break // 重试没意义
    if (attempt < attempts) await sleep(delay[Math.min(attempt - 1, delay.length - 1)])
  }

  const { url, attempts: used, ...rest } = last ?? {}
  return { ...rest, attempts: used ?? attempts }
}

/** 轻量连通性检查：OneBot 在线就返回账号信息。 */
export async function checkOneBot({ qq }) {
  const url = `${qq.baseUrl}/get_login_info`
  try {
    const headers = qq.accessToken
      ? { authorization: /^bearer /i.test(qq.accessToken) ? qq.accessToken : `Bearer ${qq.accessToken}` }
      : {}
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(Math.min(qq.timeoutMs, 8000)) })
    const json = await response.json().catch(() => null)
    if (!response.ok) return { ...classify(null, { baseUrl: qq.baseUrl, status: response.status, kind: 'group' }), ok: false }
    return { ok: true, data: json?.data ?? json }
  } catch (error) {
    return { ...classify(error, { baseUrl: qq.baseUrl, kind: 'group' }), ok: false }
  }
}

export { sleep }
