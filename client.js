window.__ModuleLoader__.load({
  id: 'dsh-bili-share',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const ZH = {
      tab: 'B站视频分享',
      title: 'B站视频分享',
      subtitle: '按分区或关键词挑公开视频，在不固定的时间点发到白名单 QQ 群 / 好友。',
      status: '状态',
      enabled: '启用',
      paused: '已暂停',
      next: '下次分享',
      today: '今日已发',
      targets: '接收方',
      none: '（未配置）',
      llm: 'AI 推荐语',
      llmReady: '可用',
      llmOff: '不可用（会退回简介首句）',
      recent: '最近发送',
      noRecent: '还没有发过',
      tabTargets: '接收方',
      tabSources: '来源与过滤',
      tabSchedule: '节奏与文案',
      tabConn: '连接',
      targetsHint: '一行一个，`group:群号` 或 `private:QQ号`。@ 与口味写在 config.json 里（面板暂不支持）。',
      sourcesHint: '分区 ID，逗号分隔（4=游戏 36=知识 188=科技 0=全站）；留空用全站排行榜。',
      popular: '用「综合热门」而不是排行榜',
      minViews: '最少播放量',
      maxAge: '只要几天内的',
      maxMinutes: '最长几分钟',
      include: '必须包含关键词（逗号分隔）',
      exclude: '排除关键词（逗号分隔）',
      sameUp: '同一 UP 主冷却条数',
      intervalMin: '最短间隔（小时）',
      intervalMax: '最长间隔（小时）',
      dailyMax: '每天最多几条',
      quiet: '安静时段（如 23:00-08:00，留空=不静音）',
      template: '消息模板',
      summaryMode: '推荐语',
      summaryOff: '不写',
      summaryDesc: '用简介首句',
      summaryAi: '让模型写一句',
      tag: '结尾标注（如「（试验）」）',
      withCover: '附带封面图',
      withViews: '附带播放量',
      baseUrl: 'OneBot 地址',
      token: 'Access Token',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      pause: '暂停自动分享',
      resume: '恢复自动分享',
      test: '试发一条（只看不发）',
      testing: '在挑…',
      testHint: '预览会用当前配置挑一条，不真的发出去。',
      loadFailed: '读取配置失败',
      reload: '重新读取',
      problems: '配置提醒',
      changed: '有未保存的修改',
    }

    const EN = {
      tab: 'Bilibili Share',
      title: 'Bilibili Share',
      subtitle: 'Picks public Bilibili videos by category and shares them to whitelisted QQ groups or friends at random times.',
      status: 'Status',
      enabled: 'Enabled',
      paused: 'Paused',
      next: 'Next share',
      today: 'Sent today',
      targets: 'Recipients',
      none: '(none)',
      llm: 'AI blurb',
      llmReady: 'available',
      llmOff: 'unavailable (falls back to the description)',
      recent: 'Recent',
      noRecent: 'nothing sent yet',
      tabTargets: 'Recipients',
      tabSources: 'Sources & filters',
      tabSchedule: 'Cadence & message',
      tabConn: 'Connection',
      targetsHint: 'One per line: `group:<id>` or `private:<id>`. @mentions and per-recipient taste live in config.json.',
      sourcesHint: 'Category ids, comma separated (4=gaming 36=knowledge 188=tech 0=all). Empty = site-wide ranking.',
      popular: 'Use Popular instead of the ranking',
      minViews: 'Minimum views',
      maxAge: 'Newer than (days)',
      maxMinutes: 'Max length (minutes)',
      include: 'Must contain (comma separated)',
      exclude: 'Exclude (comma separated)',
      sameUp: 'Same uploader cooldown',
      intervalMin: 'Min interval (hours)',
      intervalMax: 'Max interval (hours)',
      dailyMax: 'Max per day',
      quiet: 'Quiet hours (e.g. 23:00-08:00, empty = off)',
      template: 'Message template',
      summaryMode: 'Blurb',
      summaryOff: 'none',
      summaryDesc: 'first line of the description',
      summaryAi: 'model-written',
      tag: 'Trailing tag (e.g. "(test)")',
      withCover: 'Attach cover image',
      withViews: 'Attach view count',
      baseUrl: 'OneBot base URL',
      token: 'Access token',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      pause: 'Pause auto share',
      resume: 'Resume auto share',
      test: 'Dry-run one pick',
      testing: 'Picking…',
      testHint: 'Picks one video with the current config and does not send it.',
      loadFailed: 'Could not read the config',
      reload: 'Reload',
      problems: 'Config warnings',
      changed: 'Unsaved changes',
    }

    const C = {
      bg: 'var(--dsw-alias-bg-layer-1)',
      bg2: 'var(--dsw-alias-bg-layer-2)',
      border: 'var(--dsw-alias-border-l1)',
      border2: 'var(--dsw-alias-border-l2)',
      text: 'var(--dsw-alias-label-primary)',
      dim: 'var(--dsw-alias-label-secondary)',
      brand: 'var(--dsw-alias-brand-primary)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      err: 'var(--dsw-alias-state-error-primary)',
    }

    const apiPath = () => {
      const relative = 'bili-share/api'
      if (typeof document === 'undefined') return `/${relative}`
      return new URL(relative, document.baseURI).pathname
    }

    const parseRids = (text) =>
      String(text ?? '')
        .split(/[,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n >= 0)

    const parseList = (text) =>
      String(text ?? '')
        .split(/[,，]+/)
        .map((s) => s.trim())
        .filter(Boolean)

    const parseTargets = (text) =>
      String(text ?? '')
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const m = line.match(/^(group|private)\s*[:：]\s*(\d+)$/i)
          if (!m) return null
          return { kind: m[1].toLowerCase(), id: m[2] }
        })
        .filter(Boolean)

    const formatTime = (iso) => {
      if (!iso) return '—'
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return '—'
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    /* ---------- 小部件 ---------- */

    function Row(props) {
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' } },
        h('label', { style: { flex: '0 0 168px', fontSize: 13, color: C.dim } }, props.label),
        h('div', { style: { flex: '1 1 auto', minWidth: 0 } }, props.children),
      )
    }

    function TextField(props) {
      return h('input', {
        type: props.type ?? 'text',
        value: props.value ?? '',
        placeholder: props.placeholder,
        disabled: props.disabled,
        onChange: (e) => props.onChange(e.target.value),
        style: {
          width: '100%',
          boxSizing: 'border-box',
          padding: '7px 10px',
          fontSize: 13,
          color: C.text,
          background: C.bg2,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          outline: 'none',
        },
      })
    }

    function AreaField(props) {
      return h('textarea', {
        value: props.value ?? '',
        rows: props.rows ?? 3,
        placeholder: props.placeholder,
        onChange: (e) => props.onChange(e.target.value),
        style: {
          width: '100%',
          boxSizing: 'border-box',
          padding: '7px 10px',
          fontSize: 13,
          fontFamily: 'inherit',
          lineHeight: 1.5,
          resize: 'vertical',
          color: C.text,
          background: C.bg2,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          outline: 'none',
        },
      })
    }

    function SelectField(props) {
      return h(
        'select',
        {
          value: props.value,
          onChange: (e) => props.onChange(e.target.value),
          style: {
            padding: '7px 10px',
            fontSize: 13,
            color: C.text,
            background: C.bg2,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
          },
        },
        props.options.map((o) => h('option', { key: o.value, value: o.value }, o.label)),
      )
    }

    function CheckField(props) {
      return h(
        'label',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.text, cursor: 'pointer' } },
        h('input', { type: 'checkbox', checked: Boolean(props.value), onChange: (e) => props.onChange(e.target.checked) }),
        props.children,
      )
    }

    function Button(props) {
      const primary = props.primary
      return h(
        'button',
        {
          type: 'button',
          disabled: props.disabled,
          onClick: props.onClick,
          style: {
            padding: '7px 14px',
            fontSize: 13,
            fontWeight: primary ? 600 : 400,
            color: primary ? '#fff' : C.text,
            background: primary ? C.brand : C.bg2,
            border: `1px solid ${primary ? C.brand : C.border}`,
            borderRadius: 8,
            cursor: props.disabled ? 'default' : 'pointer',
            opacity: props.disabled ? 0.55 : 1,
          },
        },
        props.children,
      )
    }

    function Card(props) {
      return h(
        'section',
        {
          style: {
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: '14px 16px',
            marginBottom: 14,
          },
        },
        props.title
          ? h('h3', { style: { margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: C.text } }, props.title)
          : null,
        props.children,
      )
    }

    function Field(props) {
      return h(Row, { label: props.label }, props.children)
    }

    /* ---------- 面板 ---------- */

    function Panel() {
      const [data, setData] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [dirty, setDirty] = React.useState(false)
      const [busy, setBusy] = React.useState('')
      const [error, setError] = React.useState('')
      const [note, setNote] = React.useState('')

      const apply = (payload) => {
        setData(payload)
        setDraft(toDraft(payload.config))
        setDirty(false)
      }

      const load = React.useCallback(async () => {
        setError('')
        try {
          const res = await fetch(apiPath(), { cache: 'no-store' })
          const body = await res.json()
          if (!body.ok) throw new Error(body.error || 'unknown')
          apply(body)
        } catch (e) {
          setError(String(e?.message ?? e))
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      const post = async (payload) => {
        const res = await fetch(apiPath(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const body = await res.json()
        if (!body.ok) throw new Error(body.error || 'unknown')
        return body
      }

      const patch = (group, key, value) => {
        setDraft((prev) => ({ ...prev, [group]: { ...prev[group], [key]: value } }))
        setDirty(true)
        setNote('')
      }

      const save = async () => {
        setBusy('save')
        setError('')
        try {
          const payload = fromDraft(draft)
          // targets 是整体替换：把面板不管的 at / persona 从旧配置里带回来，
          // 否则用户在面板点一次保存会把这些字段冲掉。
          const prev = new Map((data?.config?.targets ?? []).map((t) => [`${t.kind}:${t.id}`, t]))
          payload.targets = payload.targets.map((t) => ({ ...(prev.get(`${t.kind}:${t.id}`) ?? {}), ...t }))
          const body = await post({ action: 'save', patch: payload })
          apply(body)
          setNote(body.problems && body.problems.length ? body.problems.join('；') : '已保存')
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setBusy('')
        }
      }

      const togglePause = async () => {
        setBusy('pause')
        setError('')
        try {
          const body = await post({ action: 'pause', paused: !data?.status?.paused })
          setData((prev) => ({ ...prev, status: body.status }))
          setNote(body.paused ? '已暂停自动分享' : '已恢复自动分享')
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setBusy('')
        }
      }

      const test = async () => {
        setBusy('test')
        setError('')
        setNote('')
        try {
          const body = await post({ action: 'now', dryRun: true })
          setData((prev) => ({ ...prev, status: body.status }))
          if (body.ok) {
            setNote(`会发：${body.title ?? body.bvid} → ${(body.targets ?? []).map((t) => t.name ?? t.key).join('、') || '（无接收方）'}`)
          } else {
            setNote(`${body.code ?? 'NO_CANDIDATE'}：${body.error ?? ''}`)
          }
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setBusy('')
        }
      }

      if (error && !data) {
        return h(
          'div',
          { style: { padding: 24, color: C.err, fontSize: 13 } },
          h('div', { style: { marginBottom: 12 } }, `${'读取配置失败'}：${error}`),
          h(Button, { onClick: load }, '重新读取'),
        )
      }
      if (!data || !draft) {
        return h('div', { style: { padding: 24, color: C.dim, fontSize: 13 } }, '加载中…')
      }

      const s = data.status ?? {}
      const statusColor = s.paused || !s.enabled ? C.warn : C.ok

      return h(
        'div',
        { style: { padding: '4px 2px 32px', color: C.text, fontSize: 13 } },
        h(
          'div',
          { style: { marginBottom: 14 } },
          h('h2', { style: { margin: '0 0 4px', fontSize: 17, fontWeight: 600 } }, 'B站视频分享'),
          h('p', { style: { margin: 0, color: C.dim, fontSize: 12.5 } }, data.summary ?? ''),
        ),

        h(
          Card,
          { title: '状态' },
          h(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 } },
            stat('开关', s.enabled ? (s.paused ? '已暂停' : '启用') : '停用', statusColor),
            stat('下次分享', formatTime(s.nextAt)),
            stat('今日已发', `${s.todayCount ?? 0} / ${s.dailyMax ?? 0}`),
            stat('接收方', (s.targets ?? []).join('、') || '（未配置）'),
            stat('AI 推荐语', s.llmReady ? '可用' : '不可用'),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' } },
            h(Button, { onClick: togglePause, disabled: busy === 'pause' }, s.paused ? '恢复自动分享' : '暂停自动分享'),
            h(Button, { onClick: test, disabled: busy === 'test' }, busy === 'test' ? '在挑…' : '试发一条（只看不发）'),
            h(Button, { onClick: load }, '刷新'),
          ),
          Array.isArray(s.recent) && s.recent.length
            ? h(
                'div',
                { style: { marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}` } },
                h('div', { style: { fontSize: 11.5, color: C.dim, marginBottom: 6 } }, '最近发送'),
                s.recent.slice(0, 5).map((row) =>
                  h(
                    'div',
                    { key: `${row.bvid}:${row.target}:${row.at}`, style: { fontSize: 12, color: C.dim, padding: '2px 0' } },
                    `${formatTime(new Date(row.at).toISOString())}　${row.bvid}　${row.target}`,
                  ),
                ),
              )
            : null,
          note || error
            ? h(
                'div',
                { style: { marginTop: 10, fontSize: 12.5, color: error ? C.err : C.dim, whiteSpace: 'pre-wrap' } },
                error || note,
              )
            : null,
          (data.problems ?? []).length
            ? h(
                'div',
                { style: { marginTop: 8, fontSize: 12.5, color: C.warn } },
                `配置提醒：${data.problems.join('；')}`,
              )
            : null,
        ),

        h(
          Card,
          { title: '接收方' },
          h(AreaField, {
            value: draft.targets,
            rows: 3,
            placeholder: 'group:950370313',
            onChange: (v) => patch('raw', 'targets', v),
          }),
          h('p', { style: { margin: '6px 0 0', color: C.dim, fontSize: 12 } }, '一行一个，group:群号 或 private:QQ号。@ 与口味在 config.json 里。'),
        ),

        h(
          Card,
          { title: '来源与过滤' },
          h(Field, { label: '分区 ID' }, h(TextField, { value: draft.raw.rids, onChange: (v) => patch('raw', 'rids', v) })),
          h(Field, { label: '来源' }, h(CheckField, { value: draft.raw.popular, onChange: (v) => patch('raw', 'popular', v) }, '用综合热门')),
          h(Field, { label: '最少播放量' }, h(TextField, { value: draft.filters.minViews, onChange: (v) => patch('filters', 'minViews', num(v)) })),
          h(Field, { label: '只要几天内' }, h(TextField, { value: draft.filters.maxAgeDays, onChange: (v) => patch('filters', 'maxAgeDays', num(v)) })),
          h(Field, { label: '最长几分钟' }, h(TextField, { value: draft.raw.maxMinutes, onChange: (v) => patch('raw', 'maxMinutes', v) })),
          h(Field, { label: '必须包含' }, h(TextField, { value: draft.raw.include, onChange: (v) => patch('raw', 'include', v) })),
          h(Field, { label: '排除' }, h(TextField, { value: draft.raw.exclude, onChange: (v) => patch('raw', 'exclude', v) })),
          h(Field, { label: '同 UP 冷却' }, h(TextField, { value: draft.filters.sameUpCooldown, onChange: (v) => patch('filters', 'sameUpCooldown', num(v)) })),
        ),

        h(
          Card,
          { title: '节奏' },
          h(Field, { label: '最短间隔（小时）' }, h(TextField, { value: draft.raw.intervalMinHours, onChange: (v) => patch('raw', 'intervalMinHours', v) })),
          h(Field, { label: '最长间隔（小时）' }, h(TextField, { value: draft.raw.intervalMaxHours, onChange: (v) => patch('raw', 'intervalMaxHours', v) })),
          h(Field, { label: '每天最多' }, h(TextField, { value: draft.schedule.dailyMax, onChange: (v) => patch('schedule', 'dailyMax', num(v)) })),
          h(Field, { label: '安静时段' }, h(TextField, { value: draft.schedule.quietHours, onChange: (v) => patch('schedule', 'quietHours', v) })),
        ),

        h(
          Card,
          { title: '文案' },
          h(AreaField, { value: draft.message.template, rows: 3, onChange: (v) => patch('message', 'template', v) }),
          h(
            'div',
            { style: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 } },
            h(CheckField, { value: draft.message.withCover, onChange: (v) => patch('message', 'withCover', v) }, '附带封面'),
            h(CheckField, { value: draft.message.withViews, onChange: (v) => patch('message', 'withViews', v) }, '附带播放量'),
          ),
          h(
            Field,
            { label: '推荐语' },
            h(SelectField, {
              value: draft.message.summaryMode,
              onChange: (v) => patch('message', 'summaryMode', v),
              options: [
                { value: 'off', label: '不写' },
                { value: 'desc', label: '简介首句' },
                { value: 'ai', label: '模型写一句' },
              ],
            }),
          ),
          h(Field, { label: '结尾标注' }, h(TextField, { value: draft.message.tag, placeholder: '（试验）', onChange: (v) => patch('message', 'tag', v) })),
        ),

        h(
          Card,
          { title: '连接' },
          h(Field, { label: 'OneBot 地址' }, h(TextField, { value: draft.qq.baseUrl, onChange: (v) => patch('qq', 'baseUrl', v) })),
          h(Field, { label: 'Access Token' }, h(TextField, { type: 'password', value: draft.qq.accessToken, onChange: (v) => patch('qq', 'accessToken', v) })),
          h('p', { style: { margin: '6px 0 0', color: C.dim, fontSize: 12 } }, '任何 OneBot v11 HTTP 后端都可以；新老端点名自动回退。'),
        ),

        h(
          'div',
          { style: { position: 'sticky', bottom: 0, display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', background: C.bg } },
          h(Button, { primary: true, onClick: save, disabled: busy === 'save' || !dirty }, busy === 'save' ? '保存中…' : '保存'),
          dirty ? h('span', { style: { color: C.warn, fontSize: 12 } }, '有未保存的修改') : null,
        ),
      )
    }

    function stat(label, value, color) {
      return h(
        'div',
        { key: label, style: { minWidth: 0 } },
        h('div', { style: { fontSize: 11.5, color: C.dim, marginBottom: 3 } }, label),
        h('div', { style: { fontSize: 13.5, fontWeight: 500, color: color ?? C.text, wordBreak: 'break-all' } }, String(value ?? '—')),
      )
    }

    const num = (v) => {
      const n = Number(String(v).trim())
      return Number.isFinite(n) ? n : 0
    }

    /* config → 表单 */
    function toDraft(config) {
      const sources = Array.isArray(config.sources) && config.sources.length ? config.sources : [{ type: 'ranking', rid: 0 }]
      const rids = sources.filter((s) => s.type === 'ranking').map((s) => s.rid)
      const popular = sources.some((s) => s.type === 'popular')
      const schedule = config.schedule ?? {}
      const filters = config.filters ?? {}
      const message = config.message ?? {}
      const qq = config.qq ?? {}
      return {
        raw: {
          targets: (config.targets ?? []).map((t) => `${t.kind}:${t.id}`).join('\n'),
          rids: rids.join(','),
          popular,
          maxMinutes: String(Math.round((filters.maxSeconds ?? 3600) / 60)),
          include: (filters.includeKeywords ?? []).join(','),
          exclude: (filters.excludeKeywords ?? []).join(','),
          intervalMinHours: String(Math.round(((schedule.intervalMinMinutes ?? 240) / 60) * 10) / 10),
          intervalMaxHours: String(Math.round(((schedule.intervalMaxMinutes ?? 600) / 60) * 10) / 10),
        },
        filters: {
          minViews: String(filters.minViews ?? 0),
          maxAgeDays: String(filters.maxAgeDays ?? 7),
          sameUpCooldown: String(filters.sameUpCooldown ?? 2),
        },
        schedule: {
          dailyMax: String(schedule.dailyMax ?? 3),
          quietHours: schedule.quietHours ?? '',
        },
        message: {
          template: message.template ?? '',
          withCover: message.withCover === true,
          withViews: message.withViews === true,
          summaryMode: message.summaryMode ?? 'ai',
          tag: message.tag ?? '',
        },
        qq: { baseUrl: qq.baseUrl ?? '', accessToken: qq.accessToken ?? '' },
      }
    }

    /* 表单 → patch（只传有变化的组，避免把 at / persona 这些面板不管的字段冲掉） */
    function fromDraft(draft) {
      const patch = {}
      const targets = parseTargets(draft.raw.targets)
      patch.targets = targets

      const sources = []
      for (const rid of parseRids(draft.raw.rids)) sources.push({ type: 'ranking', rid, limit: 50 })
      if (!sources.length || draft.raw.popular) sources.unshift({ type: 'popular', limit: 50 })
      patch.sources = sources

      patch.filters = {
        minViews: num(draft.filters.minViews),
        maxAgeDays: num(draft.filters.maxAgeDays),
        maxSeconds: Math.max(60, Math.round(num(draft.raw.maxMinutes) * 60)),
        sameUpCooldown: num(draft.filters.sameUpCooldown),
        includeKeywords: parseList(draft.raw.include),
        excludeKeywords: parseList(draft.raw.exclude),
      }

      patch.schedule = {
        intervalMinMinutes: Math.round(num(draft.raw.intervalMinHours) * 60),
        intervalMaxMinutes: Math.round(num(draft.raw.intervalMaxHours) * 60),
        dailyMax: num(draft.schedule.dailyMax),
        quietHours: String(draft.schedule.quietHours ?? '').trim(),
      }

      patch.message = {
        template: draft.message.template,
        withCover: Boolean(draft.message.withCover),
        withViews: Boolean(draft.message.withViews),
        summaryMode: draft.message.summaryMode,
        tag: draft.message.tag,
      }

      patch.qq = {
        baseUrl: String(draft.qq.baseUrl ?? '').trim(),
        accessToken: String(draft.qq.accessToken ?? '').trim(),
      }

      return patch
    }

    function apply(ctx) {
      const locale = (() => {
        try {
          return ctx.get ? ctx.get('locale') : undefined
        } catch {
          return undefined
        }
      })()

      let t = (key) => (ZH[key] !== undefined ? ZH[key] : key)
      if (locale && typeof locale.register === 'function' && typeof locale.bind === 'function') {
        try {
          ctx.effect(() => locale.register('bili-share', 'zh', ZH))
          ctx.effect(() => locale.register('bili-share', 'en', EN))
          const bound = locale.bind('bili-share')
          t = (key) => {
            try {
              return bound(key)
            } catch {
              return ZH[key] ?? key
            }
          }
        } catch {
          /* 本地化不可用就用中文 */
        }
      }

      function BundleConfig(props) {
        if (!props || props.view !== 'page') return null
        return h(Panel, { t })
      }

      ctx.slots.inject('plugins.bundle.config', () =>
        ctx.slots.register(
          {
            name: 'plugins.bundle.config',
            key: 'dsh-bili-share',
          },
          BundleConfig,
        ),
      )
    }

    return { inject: ['slots'], apply }
  },
})
