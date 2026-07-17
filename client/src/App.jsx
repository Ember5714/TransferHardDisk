import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Routes, Route, Navigate, useParams, useNavigate, useLocation } from 'react-router-dom'

const API = '/api'

// ============ 工具 ============
function formatSize(bytes) {
  if (bytes === 0) return '-'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${u[i]}`
}
function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function getFileIcon(_category, isDir) {
  if (isDir) return '[DIR]'
  return '[FILE]'
}

// ============ API 请求封装（自动带 token） ============
function api(method, path, body, isFormData) {
  const headers = {}
  if (!isFormData) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('token')
  if (token) headers['Authorization'] = `Bearer ${token}`

  return fetch(`${API}${path}`, {
    method,
    headers,
    body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
  })
}

// ============ App 入口 ============
export default function App() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)
  const [verifyEmail, setVerifyEmail] = useState('')

  // 主题：'auto' | 'light' | 'dark'
  const [theme, setTheme] = useState(() => localStorage.getItem('lt_theme') || 'auto')

  useEffect(() => {
    const applyTheme = () => {
      if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark')
      } else if (theme === 'light') {
        document.documentElement.removeAttribute('data-theme')
      } else {
        // auto: follow system
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          document.documentElement.setAttribute('data-theme', 'dark')
        } else {
          document.documentElement.removeAttribute('data-theme')
        }
      }
    }
    applyTheme()
    localStorage.setItem('lt_theme', theme)

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => { if (theme === 'auto') applyTheme() }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  const cycleTheme = () => {
    setTheme(prev => prev === 'auto' ? 'dark' : prev === 'dark' ? 'light' : 'auto')
  }

  const themeLabel = theme === 'auto' ? '☼' : theme === 'dark' ? '☾' : '☀'

  // 启动时检查登录状态
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) { setChecking(false); return }
    api('GET', '/auth/me').then(async (r) => {
      if (r.ok) {
        const d = await r.json()
        setUser(d.user)
      } else {
        localStorage.removeItem('token')
      }
    }).finally(() => setChecking(false))
  }, [])

  const handleLogin = (token, userData) => {
    localStorage.setItem('token', token)
    setUser(userData)
  }

  const handleLogout = async () => {
    await api('POST', '/auth/logout')
    localStorage.removeItem('token')
    setUser(null)
  }

  const handleRegisterSuccess = (email) => {
    setVerifyEmail(email)
    navigate('/verify')
  }

  const handleVerified = () => {
    navigate('/login')
  }

  if (checking) {
    return <div className="app"><div className="auth-page"><p>加载中...</p></div></div>
  }

  if (!user) {
    return (
      <div className="app">
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
          <Route path="/register" element={<RegisterPage onSuccess={handleRegisterSuccess} />} />
          <Route path="/verify" element={<VerifyPage email={verifyEmail} onVerified={handleVerified} />} />
          <Route path="/forgot" element={<ForgotPasswordPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/privateWarehouse" replace />} />
      <Route path="/privateWarehouse" element={<MainApp user={user} onLogout={handleLogout} pageMode="private" themeLabel={themeLabel} cycleTheme={cycleTheme} theme={theme} />} />
      <Route path="/publicWarehouse" element={<MainApp user={user} onLogout={handleLogout} pageMode="public" themeLabel={themeLabel} cycleTheme={cycleTheme} theme={theme} />} />
      <Route path="/profile" element={<MainApp user={user} onLogout={handleLogout} pageMode="profile" themeLabel={themeLabel} cycleTheme={cycleTheme} theme={theme} />} />
      <Route path="/user/:userId" element={<MainApp user={user} onLogout={handleLogout} pageMode="user" themeLabel={themeLabel} cycleTheme={cycleTheme} theme={theme} />} />
      <Route path="*" element={<Navigate to="/privateWarehouse" replace />} />
    </Routes>
  )
}

// ============ 登录页 ============
function LoginPage({ onLogin }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setError('')
    setLoading(true)
    try {
      const r = await api('POST', '/auth/login', { email: email.trim(), password })
      const d = await r.json()
      if (r.ok) {
        onLogin(d.token, d.user)
      } else {
        setError(d.error || '登录失败')
      }
    } catch {
      setError('网络错误')
    }
    setLoading(false)
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Logo />
        <h2>登录</h2>
        <form onSubmit={handleSubmit}>
          <input
            className="auth-input" type="email" placeholder="邮箱"
            value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
          />
          <input
            className="auth-input" type="password" placeholder="密码"
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-btn" type="submit" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
        <div className="auth-switch">
          还没有账号？<button className="btn-link" onClick={() => navigate('/register')}>立即注册</button>
        </div>
        <div className="auth-switch" style={{ marginTop: '8px' }}>
          <button className="btn-link" onClick={() => navigate('/forgot')}>忘记密码？</button>
        </div>
      </div>
    </div>
  )
}

// ============ 注册页 ============
function RegisterPage({ onSuccess }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !username.trim() || !password) return
    if (password.length < 6) { setError('密码至少 6 位'); return }
    if (password !== password2) { setError('两次密码不一致'); return }
    setError('')
    setLoading(true)
    try {
      const r = await api('POST', '/auth/register', { email: email.trim(), username: username.trim(), password })
      const d = await r.json()
      if (r.ok) {
        onSuccess(d.email)
      } else {
        setError(d.error || '注册失败')
      }
    } catch {
      setError('网络错误')
    }
    setLoading(false)
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Logo />
        <h2>注册</h2>
        <form onSubmit={handleSubmit}>
          <input
            className="auth-input" type="email" placeholder="邮箱"
            value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
          />
          <input
            className="auth-input" type="text" placeholder="用户名"
            value={username} onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="auth-input" type="password" placeholder="密码（至少 6 位）"
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
          <input
            className="auth-input" type="password" placeholder="确认密码"
            value={password2} onChange={(e) => setPassword2(e.target.value)}
          />
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-btn" type="submit" disabled={loading}>
            {loading ? '注册中...' : '注册'}
          </button>
        </form>
        <div className="auth-switch">
          已有账号？<button className="btn-link" onClick={() => navigate('/login')}>返回登录</button>
        </div>
      </div>
    </div>
  )
}

// ============ 邮箱验证页 ============
function VerifyPage({ email, onVerified }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(60)

  // 倒计时
  useEffect(() => {
    if (countdown <= 0) return
    const t = setInterval(() => setCountdown((c) => c - 1), 1000)
    return () => clearInterval(t)
  }, [countdown])

  const handleVerify = async (e) => {
    e.preventDefault()
    if (code.length !== 6) { setError('验证码为 6 位数字'); return }
    setError('')
    setLoading(true)
    try {
      const r = await api('POST', '/auth/verify', { email, code })
      const d = await r.json()
      if (r.ok) {
        setSuccess(true)
      } else {
        setError(d.error || '验证失败')
      }
    } catch {
      setError('网络错误')
    }
    setLoading(false)
  }

  const handleResend = async () => {
    setCountdown(60)
    setError('')
    await api('POST', '/auth/resend', { email })
  }

  if (success) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <Logo />
          <h2>验证成功</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
            邮箱验证成功，现在可以登录了
          </p>
          <button className="auth-btn" onClick={onVerified}>去登录</button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Logo />
        <h2>验证邮箱</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
          验证码已发送至 <strong>{email}</strong>，请查收邮件
        </p>
        <form onSubmit={handleVerify}>
          <input
            className="auth-input auth-code-input"
            type="text" placeholder="输入 6 位验证码" maxLength={6}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            autoFocus
          />
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-btn" type="submit" disabled={loading}>
            {loading ? '验证中...' : '验证'}
          </button>
        </form>
        <div className="auth-switch">
          {countdown > 0 ? (
            <span style={{ color: 'var(--text-muted)' }}>{countdown}s 后可重发</span>
          ) : (
            <button className="btn-link" onClick={handleResend}>重新发送验证码</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ============ 主应用（已登录） ============
function MainApp({ user, onLogout, pageMode, themeLabel, cycleTheme, theme }) {
  const params = useParams()
  const navigate = useNavigate()
  const [dir, setDir] = useState(null)
  const [items, setItems] = useState([])
  const [parent, setParent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('grid')
  const [selected, setSelected] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(null)
  const [previewFile, setPreviewFile] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [renameTarget, setRenameTarget] = useState(null)
  const [notify, setNotify] = useState(null)
  const [showUserMenu, setShowUserMenu] = useState(false)

  // 公开/私密
  const [visibility, setVisibility] = useState(pageMode === 'public' ? 'public' : 'private')

  // 同步 visibility 与 URL 路由
  useEffect(() => {
    if (pageMode === 'public') setVisibility('public')
    else if (pageMode === 'private') setVisibility('private')
  }, [pageMode])
  const [publicProfile, setPublicProfile] = useState(!!user.publicProfile)

  // 搜索用户
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)

  // 点击外部关闭下拉
  const userMenuRef = useRef(null)
  const searchBarRef = useRef(null)
  useEffect(() => {
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setShowUserMenu(false)
      }
      if (searchBarRef.current && !searchBarRef.current.contains(e.target)) {
        setSearchFocused(false)
      }
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  // 正在浏览的公开用户（从 URL 参数获取）
  const publicUser = pageMode === 'user' ? { id: params.userId } : null
  const viewingOwnProfile = pageMode === 'profile'
  const isProfileView = pageMode === 'user' || pageMode === 'profile'
  const isOwnSpace = pageMode === 'private' || pageMode === 'public'

  // 搜索历史（localStorage 持久化，最多 10 条）
  const [searchHistory, setSearchHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lt_search_history') || '[]') }
    catch { return [] }
  })

  // 设置
  const [showSettings, setShowSettings] = useState(false)
  const [currentUser, setCurrentUser] = useState(user) // 动态更新用户信息

  const toast = useCallback((msg, type = 'info') => {
    setNotify({ msg, type, id: Date.now() })
    setTimeout(() => setNotify(null), 3000)
  }, [])

  const loadDir = useCallback(async (dirPath, targetPublicUser, visOverride) => {
    const pu = targetPublicUser !== undefined ? targetPublicUser : publicUser
    const vis = visOverride !== undefined ? visOverride : visibility
    setLoading(true)
    try {
      let url
      if (pu) {
        const params = dirPath ? `?dir=${encodeURIComponent(dirPath)}` : ''
        url = `/users/${pu.id}/public/browse${params}`
      } else {
        const params = new URLSearchParams()
        params.set('visibility', vis)
        if (dirPath) params.set('dir', dirPath)
        url = `/files/browse?${params.toString()}`
      }
      const r = await api('GET', url)
      const data = await r.json()
      if (r.ok) {
        setDir(data.dir || '')
        setItems(data.items)
        setParent(data.parent)
      } else {
        toast(data.error || '加载失败', 'error')
      }
    } catch { toast('网络错误', 'error') }
    setLoading(false)
    setSelected([])
  }, [toast, visibility, pageMode, params.userId])

  useEffect(() => { loadDir() }, [loadDir])

  // 路由变化时加载资料
  useEffect(() => {
    if (pageMode === 'user' && params.userId) {
      setEditingProfile(false)
      setEditBio('')
      fetchProfile({ id: params.userId })
    } else if (pageMode === 'profile') {
      setEditingProfile(false)
      setEditBio('')
      // 加载自己的个人资料
      ;(async () => {
        try {
          const r = await api('GET', '/auth/profile-bio')
          const d = await r.json()
          setProfileInfo({
            id: user.id,
            username: user.username,
            avatar: user.avatar || null,
            background: user.background || null,
            signature: user.signature || '',
            bio: d.bio || '',
          })
        } catch { /* ignore */ }
      })()
    } else {
      setProfileInfo(null)
    }
  }, [pageMode, params.userId])

  const enterDir = (item) => { if (item.isDir) loadDir(item.path) }
  const goUp = () => { if (parent !== null) loadDir(parent) }

  const breadcrumbs = () => {
    if (!dir || dir === '') return []
    const parts = []
    const segs = dir.replace(/\\/g, '/').split('/').filter(Boolean)
    let cur = ''
    for (const seg of segs) {
      cur = cur ? `${cur}/${seg}` : seg
      parts.push({ name: seg, path: cur })
    }
    parts.unshift({ name: '根目录', path: '' })
    return parts
  }

  const toggleSelect = (item) => {
    setSelected((prev) => {
      const idx = prev.findIndex((s) => s.path === item.path)
      if (idx >= 0) return prev.filter((s) => s.path !== item.path)
      return [...prev, item]
    })
  }
  const selectAll = () => {
    if (selected.length === items.length) setSelected([])
    else setSelected([...items])
  }

  const downloadFile = (item) => {
    if (item.isDir) return
    const token = localStorage.getItem('token')
    let url
    if (publicUser) {
      url = `${API}/users/${publicUser.id}/public/download?path=${encodeURIComponent(item.path)}`
    } else {
      url = `${API}/files/download?path=${encodeURIComponent(item.path)}&visibility=${visibility}`
    }
    const a = document.createElement('a')
    a.href = url + (token ? `&token=${token}` : '')
    a.download = item.name
    document.body.appendChild(a); a.click()
    document.body.removeChild(a)
  }

  const copyToMyWarehouse = async (item) => {
    if (!publicUser) return
    try {
      const r = await api('POST', `/users/${publicUser.id}/copytome`, { filePath: item.path })
      if (r.ok) {
        toast(`已复制「${item.name}」到私密仓库`)
      } else {
        const d = await r.json()
        toast(d.error || '复制失败', 'error')
      }
    } catch { toast('网络错误', 'error') }
  }

  const preview = (item) => {
    if (item.isDir) return enterDir(item)
    if (item.category === 'image') setPreviewFile(item)
    else downloadFile(item)
  }

  const getPreviewUrl = (item) => {
    const token = localStorage.getItem('token')
    if (publicUser) {
      return `${API}/users/${publicUser.id}/public/download?path=${encodeURIComponent(item.path)}&token=${token}`
    }
    return `${API}/files/download?path=${encodeURIComponent(item.path)}&visibility=${visibility}&token=${token}`
  }

  const deleteItems = async (targets) => {
    const names = targets.map((t) => t.name).join(', ')
    if (!confirm(`确定删除 ${names}？`)) return
    try {
      for (const t of targets) {
        await api('DELETE', '/files', { path: t.path, visibility })
      }
      toast(`已删除 ${names}`)
      loadDir(dir)
    } catch { toast('删除失败', 'error') }
  }

  const createFolder = async (name) => {
    try {
      const r = await api('POST', '/files/mkdir', { dir, name, visibility })
      const d = await r.json()
      if (r.ok) { toast(`已创建文件夹「${name}」`); loadDir(dir) }
      else toast(d.error || '创建失败', 'error')
    } catch { toast('网络错误', 'error') }
  }

  const rename = async (oldPath, newName) => {
    try {
      const r = await api('POST', '/files/rename', { path: oldPath, name: newName, visibility })
      const d = await r.json()
      if (r.ok) { toast(`已重命名为「${newName}」`); loadDir(dir) }
      else toast(d.error || '重命名失败', 'error')
    } catch { toast('网络错误', 'error') }
  }

  const handleUpload = async (files) => {
    if (!files || files.length === 0) return
    setShowUpload(false)
    setUploading(true)
    const formData = new FormData()
    formData.append('userId', user.id)
    formData.append('visibility', visibility)
    if (dir) formData.append('dir', dir)
    for (const f of files) formData.append('files', f)
    const startTime = Date.now()
    try {
      const xhr = new XMLHttpRequest()
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const elapsed = (Date.now() - startTime) / 1000
          setUploadProgress({
            percent: Math.round((e.loaded / e.total) * 100),
            speed: elapsed > 0 ? e.loaded / elapsed : 0,
            loaded: e.loaded, total: e.total,
          })
        }
      })
      await new Promise((resolve, reject) => {
        xhr.open('POST', `${API}/files/upload`)
        xhr.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('token')}`)
        xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText)); else reject(new Error(`HTTP ${xhr.status}`)) }
        xhr.onerror = () => reject(new Error('连接失败'))
        xhr.ontimeout = () => reject(new Error('超时'))
        xhr.timeout = 0
        xhr.send(formData)
      })
      toast(`上传完成 (${files.length} 个文件)`)
      loadDir(dir)
    } catch (e) { toast(`上传失败: ${e.message}`, 'error') }
    setUploading(false)
    setUploadProgress(null)
  }

  // 保存搜索历史
  const saveSearchHistory = (query) => {
    const trimmed = query.trim()
    if (!trimmed) return
    setSearchHistory((prev) => {
      const next = [trimmed, ...prev.filter((q) => q !== trimmed)].slice(0, 10)
      localStorage.setItem('lt_search_history', JSON.stringify(next))
      return next
    })
  }

  const handleSearch = async (e, queryOverride) => {
    const query = (queryOverride !== undefined ? queryOverride : searchQuery).trim()
    if (e?.preventDefault) e.preventDefault()
    setSearchError('')
    if (!query) { setSearchResults([]); return }
    setSearching(true)
    setSearchQuery(query)
    saveSearchHistory(query)
    try {
      const r = await api('GET', `/users/search?q=${encodeURIComponent(query)}`)
      if (!r.ok) {
        setSearchError('搜索失败，请确认已登录')
        setSearchResults([])
        setSearching(false)
        return
      }
      const data = await r.json()
      setSearchResults(data)
      if (data.length === 0) setSearchError('未找到公开用户，请确认对方已公开仓库')
    } catch { setSearchError('网络错误'); setSearchResults([]) }
    setSearching(false)
  }

  // 进入公开用户空间
  const [profileInfo, setProfileInfo] = useState(null) // { username, avatar, background, signature, bio }
  const [editingProfile, setEditingProfile] = useState(false)
  const [editBio, setEditBio] = useState('')
  const bgInputRef = useRef(null)

  const fetchProfile = async (targetUser) => {
    try {
      const r = await api('GET', `/users/${targetUser.id}/profile`)
      if (r.ok) {
        const data = await r.json()
        setProfileInfo(data)
      }
    } catch { setProfileInfo(null) }
  }

  // 搜索后跳转到用户页面
  const openPublicUser = (targetUser, query) => {
    if (query) saveSearchHistory(query)
    navigate(`/user/${targetUser.id}`)
  }

  // 查看自己的个人主页
  const openOwnProfile = () => {
    navigate('/profile')
  }

  // 关闭个人主页（返回我的仓库）
  const closeOwnProfile = () => navigate('/privateWarehouse')
  const backToMySpace = () => navigate('/privateWarehouse')

  // 保存个人简介
  const handleSaveBio = async () => {
    try {
      const r = await api('PUT', '/auth/profile-bio', { content: editBio })
      const d = await r.json()
      if (r.ok) {
        setProfileInfo((prev) => ({ ...prev, bio: editBio }))
        setEditingProfile(false)
        toast('简介已保存')
      } else toast(d.error || '保存失败', 'error')
    } catch { toast('网络错误', 'error') }
  }

  // 上传背景图
  const handleBgUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const formData = new FormData()
    formData.append('background', file)
    try {
      const r = await fetch(`${API}/auth/profile-background`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      })
      const d = await r.json()
      if (r.ok) {
        setProfileInfo((prev) => ({ ...prev, background: d.background }))
        toast('背景已更新')
      } else toast(d.error || '上传失败', 'error')
    } catch { toast('网络错误', 'error') }
    e.target.value = ''
  }

  // 切换公开资料
  const togglePublicProfile = async () => {
    const newVal = !publicProfile
    try {
      const r = await api('PATCH', '/auth/profile', { publicProfile: newVal })
      const d = await r.json()
      if (r.ok) {
        setPublicProfile(d.publicProfile)
        toast(d.publicProfile ? '已公开仓库，他人可搜索到你' : '已关闭公开仓库')
      } else {
        toast(d.error || '操作失败', 'error')
      }
    } catch { toast('网络错误', 'error') }
  }

  // 修改密码
  const handleChangePassword = async (code, newPw) => {
    try {
      const r = await api('PATCH', '/auth/password', { code, newPassword: newPw })
      const d = await r.json()
      if (r.ok) toast('密码修改成功')
      else toast(d.error || '修改失败', 'error')
      return r.ok
    } catch { toast('网络错误', 'error'); return false }
  }

  // 修改用户名
  const handleChangeUsername = async (newName) => {
    try {
      const r = await api('PATCH', '/auth/username', { username: newName })
      const d = await r.json()
      if (r.ok) {
        setCurrentUser((prev) => ({ ...prev, username: d.username }))
        toast('用户名修改成功')
      } else toast(d.error || '修改失败', 'error')
      return r.ok
    } catch { toast('网络错误', 'error'); return false }
  }

  // 修改个性签名
  const handleSetSignature = async (signature) => {
    try {
      const r = await api('PATCH', '/auth/signature', { signature })
      const d = await r.json()
      if (r.ok) {
        setCurrentUser((prev) => ({ ...prev, signature: d.signature }))
        toast('签名已更新')
      } else toast(d.error || '更新失败', 'error')
      return r.ok
    } catch { toast('网络错误', 'error'); return false }
  }

  // 上传头像
  const handleUploadAvatar = async (file) => {
    const formData = new FormData()
    formData.append('avatar', file)
    try {
      const r = await fetch(`${API}/auth/avatar`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      })
      const d = await r.json()
      if (r.ok) {
        setCurrentUser((prev) => ({ ...prev, avatar: d.avatar }))
        toast('头像更新成功')
      } else toast(d.error || '上传失败', 'error')
      return r.ok
    } catch { toast('网络错误', 'error'); return false }
  }

  // 注销账号
  const handleDeleteAccount = async (code) => {
    try {
      const r = await api('DELETE', '/auth/account', { code })
      const d = await r.json()
      if (r.ok) {
        toast('账号已注销')
        localStorage.removeItem('token')
        setTimeout(() => onLogout(), 1000)
      } else toast(d.error || '注销失败', 'error')
      return r.ok
    } catch { toast('网络错误', 'error'); return false }
  }

  const avatarUrl = currentUser.avatar ? `/avatars/${currentUser.avatar}` : null

  const selectedStats = selected.length > 0
    ? `已选 ${selected.length} 项 (${formatSize(selected.reduce((s, i) => s + (i.size || 0), 0))})`
    : ''

  return (
    <div className="app">
      {notify && <div className={`toast toast-${notify.type}`}>{notify.msg}</div>}

      {isProfileView ? (
        /* ========== 个人主页 / 他人仓库 独立页面 ========== */
        <div className="profile-page">
          <header className="profile-page-header">
            <button className="btn-back" onClick={viewingOwnProfile ? closeOwnProfile : backToMySpace}>
              返回我的仓库
            </button>
            <div className="profile-page-logo"><Logo /></div>
            <span className="profile-page-title">
              {viewingOwnProfile ? '我的个人主页' : `${profileInfo?.username || '用户'} 的公开仓库`}
            </span>
          </header>

          {profileInfo && (
            <ProfileCard
              profile={profileInfo}
              isOwner={profileInfo.id === user.id}
              editing={editingProfile}
              editBio={editBio}
              onEditBio={setEditBio}
              onStartEdit={() => { setEditingProfile(true); setEditBio(profileInfo.bio || '') }}
              onCancelEdit={() => setEditingProfile(false)}
              onSaveBio={handleSaveBio}
              onBgUpload={handleBgUpload}
              bgInputRef={bgInputRef}
            />
          )}

          {publicUser && (
            <>
              <div className="toolbar">
                <div className="toolbar-left">
                  <div className="breadcrumb">
                    <button className="btn-back" onClick={goUp} disabled={!parent} title="返回上级">返回</button>
                    {breadcrumbs().map((b, i) => (
                      <span key={i}>
                        {i > 0 && <span className="bc-sep">/</span>}
                        <button className={`bc-item ${i === breadcrumbs().length - 1 ? 'bc-current' : ''}`} onClick={() => loadDir(b.path)}>
                          {b.name}
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="toolbar-right">
                  <button className="btn-tool" onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}>
                    {viewMode === 'grid' ? '列表' : '网格'}
                  </button>
                  <button className="btn-tool" onClick={() => loadDir(dir)}>刷新</button>
                </div>
              </div>

              <div className="main-content">
                {loading ? (
                  <div className="empty-state"><p>加载中...</p></div>
                ) : items.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">--</div>
                    <p>此文件夹为空</p>
                  </div>
                ) : viewMode === 'grid' ? (
                  <div className="content-card">
                    <div className="file-grid">
                      {items.map((item) => {
                        const isSel = selected.some((s) => s.path === item.path)
                        return (
                          <div key={item.path} className={`file-grid-item ${isSel ? 'selected' : ''}`}
                            onDoubleClick={() => preview(item)}
                            onClick={(e) => { if (e.ctrlKey || e.metaKey) toggleSelect(item) }}>
                            <div className="file-icon">{getFileIcon(item.category, item.isDir)}</div>
                            <div className="file-name" title={item.name}>{item.name}</div>
                            <div className="file-meta">{item.isDir ? '文件夹' : formatSize(item.size)}</div>
                            <div className="file-actions-overlay">
                              <button className="act-btn" onClick={(e) => { e.stopPropagation(); preview(item) }} title={item.isDir ? '打开' : '预览'}>
                                {item.isDir ? '打开' : '预览'}
                              </button>
                              <button className="act-btn" onClick={(e) => { e.stopPropagation(); downloadFile(item) }} title="下载" disabled={item.isDir}>下载</button>
                              <button className="act-btn" onClick={(e) => { e.stopPropagation(); copyToMyWarehouse(item) }} title="复制到我的私密仓库">复制</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="content-card" style={{ padding: 0 }}>
                    <div className="file-list-table">
                      <div className="file-list-header-row">
                        <div className="col-name">名称</div>
                        <div className="col-size">大小</div>
                        <div className="col-date">修改时间</div>
                        <div className="col-actions">操作</div>
                      </div>
                      {items.map((item) => {
                        const isSel = selected.some((s) => s.path === item.path)
                        return (
                          <div key={item.path} className={`file-list-row ${isSel ? 'selected' : ''}`}
                            onDoubleClick={() => preview(item)}
                            onClick={(e) => { if (e.ctrlKey || e.metaKey) toggleSelect(item) }}>
                            <div className="col-name"><span className="list-icon">{getFileIcon(item.category, item.isDir)}</span>{item.name}</div>
                            <div className="col-size">{item.isDir ? '-' : formatSize(item.size)}</div>
                            <div className="col-date">{formatDate(item.mtime)}</div>
                            <div className="col-actions">
                              <button className="act-btn" onClick={(e) => { e.stopPropagation(); preview(item) }} title={item.isDir ? '打开' : '预览'}>{item.isDir ? '打开' : '预览'}</button>
                              <button className="act-btn" onClick={(e) => { e.stopPropagation(); downloadFile(item) }} title="下载" disabled={item.isDir}>下载</button>
                              <button className="act-btn" onClick={(e) => { e.stopPropagation(); copyToMyWarehouse(item) }} title="复制到我的私密仓库">复制</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {previewFile && (
                <Modal onClose={() => setPreviewFile(null)} title={previewFile.name} wide>
                  <div className="preview-container">
                    <img src={getPreviewUrl(previewFile)} alt={previewFile.name} className="preview-img" />
                    <div className="preview-info">
                      <span>{previewFile.name}</span>
                      <span>{formatSize(previewFile.size)}</span>
                      <button className="btn-primary" onClick={() => downloadFile(previewFile)}>下载原图</button>
                    </div>
                  </div>
                </Modal>
              )}
            </>
          )}
        </div>
      ) : (
        /* ========== 正常文件浏览器 ========== */
        <>
          <header className="header">
            <div className="header-left">
              <Logo />
            </div>
            <div className="header-right">
              <div className="visibility-switch">
                <button
                  className={`vis-btn ${pageMode === 'private' ? 'vis-active' : ''}`}
                  onClick={() => navigate('/privateWarehouse')}
                >私密仓库</button>
                <button
                  className={`vis-btn ${pageMode === 'public' ? 'vis-active' : ''}`}
                  onClick={() => navigate('/publicWarehouse')}
                >公开仓库</button>
              </div>
              <div className="user-menu" ref={userMenuRef} onClick={(e) => { e.stopPropagation(); setShowUserMenu(prev => !prev) }}>
                {avatarUrl ? (
                  <img className="user-avatar-img" src={avatarUrl} alt={currentUser.username} />
                ) : (
                  <span className="user-avatar">{currentUser.username.charAt(0).toUpperCase()}</span>
                )}
                <span className="user-name">{currentUser.username}</span>
                {currentUser.signature && <span className="user-signature">{currentUser.signature}</span>}
                {showUserMenu && (
                  <div className="user-dropdown">
                    <div className="user-dropdown-item user-dropdown-email">{currentUser.email}</div>
                    <div className="user-dropdown-item user-dropdown-theme" onClick={(e) => { e.stopPropagation(); cycleTheme(); }}>
                      主题: {theme === 'auto' ? '跟随系统' : theme === 'dark' ? '暗色' : '亮色'}
                    </div>
                    <div className="user-dropdown-item user-dropdown-toggle" onClick={togglePublicProfile}>
                      {publicProfile ? '公开仓库（开）' : '公开仓库（关）'}
                    </div>
                    <div className="user-dropdown-item user-dropdown-profile" onClick={(e) => { e.stopPropagation(); openOwnProfile(); setShowUserMenu(false) }}>
                      个人主页
                    </div>
                    <div className="user-dropdown-item user-dropdown-settings" onClick={(e) => { e.stopPropagation(); setShowSettings(true); setShowUserMenu(false) }}>
                      账户设置
                    </div>
                    <div className="user-dropdown-item user-dropdown-logout" onClick={onLogout}>
                      退出登录
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* 搜索栏 */}
          <div className="search-bar" ref={searchBarRef}>
            <form onSubmit={handleSearch} className="search-form">
              <input
                className="search-input"
                type="text"
                placeholder="搜索公开用户..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
              />
              <button className="search-btn" type="submit" disabled={searching}>搜索</button>
            </form>
            {/* 搜索历史 */}
            {searchFocused && !searchQuery && searchHistory.length > 0 && searchResults.length === 0 && !searchError && (
              <div className="search-results">
                <div className="search-history-header">
                  <span>搜索历史</span>
                  <button className="btn-link btn-link-sm" onClick={() => { setSearchHistory([]); localStorage.removeItem('lt_search_history') }}>清空</button>
                </div>
                {searchHistory.map((q, i) => (
                  <div key={i} className="search-result-item search-history-item" onMouseDown={(e) => { e.preventDefault(); handleSearch(null, q) }}>
                    <span className="search-history-icon">~</span>
                    <span className="search-result-name">{q}</span>
                    <button className="btn-link btn-link-sm search-history-del" onClick={(e) => {
                      e.stopPropagation()
                      setSearchHistory((prev) => {
                        const next = prev.filter((_, j) => j !== i)
                        localStorage.setItem('lt_search_history', JSON.stringify(next))
                        return next
                      })
                    }}>删除</button>
                  </div>
                ))}
              </div>
            )}
            {/* 搜索结果 */}
            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((u) => (
                  <div key={u.id} className="search-result-item" onClick={() => openPublicUser(u, searchQuery)}>
                    {u.avatar ? (
                      <img className="search-result-avatar-img" src={`/avatars/${u.avatar}`} alt={u.username} />
                    ) : (
                      <span className="search-result-avatar">{u.username.charAt(0).toUpperCase()}</span>
                    )}
                    <span className="search-result-name">{u.username}</span>
                    <span className="search-result-hint">点击查看公开仓库</span>
                  </div>
                ))}
              </div>
            )}
            {searchError && !searching && (
              <div className="search-results">
                <div className="search-result-item" style={{ color: 'var(--text-muted)', cursor: 'default' }}>
                  {searchError}
                </div>
              </div>
            )}
          </div>

          <div className="toolbar">
            <div className="toolbar-left">
              <div className="breadcrumb">
                <button className="btn-back" onClick={goUp} disabled={!parent} title="返回上级">返回</button>
                {breadcrumbs().map((b, i) => (
                  <span key={i}>
                    {i > 0 && <span className="bc-sep">/</span>}
                    <button className={`bc-item ${i === breadcrumbs().length - 1 ? 'bc-current' : ''}`} onClick={() => loadDir(b.path)}>
                      {b.name}
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <div className="toolbar-right">
              {selected.length > 0 && (
                <>
                  <span className="selected-info">{selectedStats}</span>
                  <button className="btn-tool btn-danger" onClick={() => deleteItems(selected)}>删除选中</button>
                </>
              )}
              <button className="btn-tool" onClick={() => setShowNewFolder(true)}>新建文件夹</button>
              <button className="btn-tool" onClick={() => setShowUpload(true)}>上传</button>
              <button className="btn-tool" onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}>
                {viewMode === 'grid' ? '列表' : '网格'}
              </button>
              <button className="btn-tool" onClick={() => loadDir(dir)}>刷新</button>
            </div>
          </div>

          {uploading && uploadProgress && (
            <div className="upload-bar">
              <div className="upload-bar-header">
                <span>上传中...</span>
                <span>{uploadProgress.percent}% ({formatSize(uploadProgress.loaded)} / {formatSize(uploadProgress.total)})</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${uploadProgress.percent}%` }} />
              </div>
              {uploadProgress.speed > 0 && <span className="upload-speed">{formatSize(uploadProgress.speed)}/s</span>}
            </div>
          )}

          <div className="main-content">
            {loading ? (
              <div className="empty-state"><p>加载中...</p></div>
            ) : items.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">--</div>
                <p>此文件夹为空</p>
                <p className="empty-hint">点击上方"上传"按钮添加文件</p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="content-card">
                <div className="file-grid">
                  <div className="file-grid-item select-all" onClick={selectAll}>
                    <div className="file-icon">{selected.length === items.length ? '[v]' : '[ ]'}</div>
                    <div className="file-name">全选</div>
                  </div>
                  {items.map((item) => {
                    const isSel = selected.some((s) => s.path === item.path)
                    return (
                      <div key={item.path} className={`file-grid-item ${isSel ? 'selected' : ''}`}
                        onDoubleClick={() => preview(item)}
                        onClick={(e) => { if (e.ctrlKey || e.metaKey) toggleSelect(item) }}>
                        <div className="file-icon">{getFileIcon(item.category, item.isDir)}</div>
                        <div className="file-name" title={item.name}>{item.name}</div>
                        <div className="file-meta">{item.isDir ? '文件夹' : formatSize(item.size)}</div>
                        <div className="file-actions-overlay">
                          <button className="act-btn" onClick={(e) => { e.stopPropagation(); preview(item) }} title={item.isDir ? '打开' : '预览'}>
                            {item.isDir ? '打开' : '预览'}
                          </button>
                          <button className="act-btn" onClick={(e) => { e.stopPropagation(); downloadFile(item) }} title="下载" disabled={item.isDir}>下载</button>
                          <button className="act-btn" onClick={(e) => { e.stopPropagation(); setRenameTarget(item) }} title="重命名">重命名</button>
                          <button className="act-btn act-del" onClick={(e) => { e.stopPropagation(); deleteItems([item]) }} title="删除">删除</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="content-card" style={{ padding: 0 }}>
                <div className="file-list-table">
                  <div className="file-list-header-row">
                    <div className="col-check" onClick={selectAll}>{selected.length === items.length ? '[v]' : '[ ]'}</div>
                    <div className="col-name">名称</div>
                    <div className="col-size">大小</div>
                    <div className="col-date">修改时间</div>
                    <div className="col-actions">操作</div>
                  </div>
                  {items.map((item) => {
                    const isSel = selected.some((s) => s.path === item.path)
                    return (
                      <div key={item.path} className={`file-list-row ${isSel ? 'selected' : ''}`}
                        onDoubleClick={() => preview(item)}
                        onClick={(e) => { if (e.ctrlKey || e.metaKey) toggleSelect(item) }}>
                        <div className="col-check" onClick={(e) => { e.stopPropagation(); toggleSelect(item) }}>{isSel ? '[v]' : '[ ]'}</div>
                        <div className="col-name"><span className="list-icon">{getFileIcon(item.category, item.isDir)}</span>{item.name}</div>
                        <div className="col-size">{item.isDir ? '-' : formatSize(item.size)}</div>
                        <div className="col-date">{formatDate(item.mtime)}</div>
                        <div className="col-actions">
                          <button className="act-btn" onClick={(e) => { e.stopPropagation(); preview(item) }} title={item.isDir ? '打开' : '预览'}>{item.isDir ? '打开' : '预览'}</button>
                          <button className="act-btn" onClick={(e) => { e.stopPropagation(); downloadFile(item) }} title="下载" disabled={item.isDir}>下载</button>
                          <button className="act-btn" onClick={(e) => { e.stopPropagation(); setRenameTarget(item) }} title="重命名">重命名</button>
                          <button className="act-btn act-del" onClick={(e) => { e.stopPropagation(); deleteItems([item]) }} title="删除">删除</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {showUpload && (
            <Modal onClose={() => setShowUpload(false)} title={`上传到${visibility === 'public' ? '公开' : '私密'}仓库`}>
              <UploadPanel onUpload={handleUpload} onClose={() => setShowUpload(false)} />
            </Modal>
          )}
          {showNewFolder && (
            <Modal onClose={() => setShowNewFolder(false)} title="新建文件夹">
              <InputModal placeholder="请输入文件夹名称" onSubmit={(name) => { createFolder(name); setShowNewFolder(false) }} onClose={() => setShowNewFolder(false)} />
            </Modal>
          )}
          {renameTarget && (
            <Modal onClose={() => setRenameTarget(null)} title="重命名">
              <InputModal placeholder="请输入新名称" defaultValue={renameTarget.name} onSubmit={(name) => { rename(renameTarget.path, name); setRenameTarget(null) }} onClose={() => setRenameTarget(null)} />
            </Modal>
          )}
          {previewFile && (
            <Modal onClose={() => setPreviewFile(null)} title={previewFile.name} wide>
              <div className="preview-container">
                <img src={getPreviewUrl(previewFile)} alt={previewFile.name} className="preview-img" />
                <div className="preview-info">
                  <span>{previewFile.name}</span>
                  <span>{formatSize(previewFile.size)}</span>
                  <button className="btn-primary" onClick={() => downloadFile(previewFile)}>下载原图</button>
                </div>
              </div>
            </Modal>
          )}
        </>
      )}
      {showSettings && (
        <SettingsPage
          user={currentUser}
          avatarUrl={avatarUrl}
          onChangePassword={handleChangePassword}
          onChangeUsername={handleChangeUsername}
          onSetSignature={handleSetSignature}
          onUploadAvatar={handleUploadAvatar}
          onDeleteAccount={handleDeleteAccount}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}

// ============ 找回密码页 ============
function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState('email') // 'email' | 'reset' | 'done'
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(60)

  useEffect(() => {
    if (countdown <= 0) return
    const t = setInterval(() => setCountdown((c) => c - 1), 1000)
    return () => clearInterval(t)
  }, [countdown])

  const handleSendCode = async (e) => {
    e.preventDefault()
    if (!email.trim()) { setError('请输入邮箱'); return }
    setError('')
    setLoading(true)
    try {
      const r = await api('POST', '/auth/send-reset-code', { email: email.trim() })
      const d = await r.json()
      if (r.ok) {
        setStep('reset')
        setCountdown(60)
      } else {
        setError(d.error || '发送失败')
      }
    } catch { setError('网络错误') }
    setLoading(false)
  }

  const handleReset = async (e) => {
    e.preventDefault()
    if (code.length !== 6) { setError('验证码为 6 位数字'); return }
    if (newPassword.length < 6) { setError('新密码至少 6 位'); return }
    if (newPassword !== newPassword2) { setError('两次密码不一致'); return }
    setError('')
    setLoading(true)
    try {
      const r = await api('POST', '/auth/reset-password', { email: email.trim(), code, newPassword })
      const d = await r.json()
      if (r.ok) {
        setStep('done')
      } else {
        setError(d.error || '重置失败')
      }
    } catch { setError('网络错误') }
    setLoading(false)
  }

  const handleResend = async () => {
    setCountdown(60)
    setError('')
    await api('POST', '/auth/send-reset-code', { email: email.trim() })
  }

  if (step === 'done') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <Logo />
          <h2>密码重置成功</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
            新密码已设置，请使用新密码登录
          </p>
          <button className="auth-btn" onClick={() => navigate('/login')}>去登录</button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Logo />
        <h2>找回密码</h2>
        {step === 'email' ? (
          <form onSubmit={handleSendCode}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '14px' }}>
              输入注册邮箱，我们将发送验证码
            </p>
            <input
              className="auth-input" type="email" placeholder="注册邮箱"
              value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
            />
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? '发送中...' : '发送验证码'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleReset}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '14px' }}>
              验证码已发送至 <strong>{email}</strong>
            </p>
            <input
              className="auth-input auth-code-input"
              type="text" placeholder="输入 6 位验证码" maxLength={6}
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
            <input
              className="auth-input" type="password" placeholder="新密码（至少 6 位）"
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            />
            <input
              className="auth-input" type="password" placeholder="确认新密码"
              value={newPassword2} onChange={(e) => setNewPassword2(e.target.value)}
            />
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? '重置中...' : '重置密码'}
            </button>
            <div className="auth-switch">
              {countdown > 0 ? (
                <span style={{ color: 'var(--text-muted)' }}>{countdown}s 后可重发</span>
              ) : (
                <button className="btn-link" type="button" onClick={handleResend}>重新发送验证码</button>
              )}
            </div>
          </form>
        )}
        <div className="auth-switch">
          <button className="btn-link" onClick={() => navigate('/login')}>返回登录</button>
        </div>
      </div>
    </div>
  )
}

// ============ 简单 Markdown 渲染 ============
function renderMarkdown(text) {
  if (!text) return ''
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^\- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
  return '<p>' + html + '</p>'
}

// HTML 转 Markdown（递归遍历 DOM）
function htmlToMarkdown(node) {
  if (!node) return ''
  if (node.nodeType === 3) return node.textContent // Text node
  if (node.nodeType !== 1) return ''

  const tag = node.tagName ? node.tagName.toLowerCase() : ''
  let inner = ''
  for (const child of node.childNodes) {
    inner += htmlToMarkdown(child)
  }

  switch (tag) {
    case 'h1': return '# ' + inner + '\n\n'
    case 'h2': return '## ' + inner + '\n\n'
    case 'h3': return '### ' + inner + '\n\n'
    case 'strong': case 'b': return '**' + inner + '**'
    case 'em': case 'i': return '*' + inner + '*'
    case 'code': return '`' + inner + '`'
    case 'a': {
      const href = node.getAttribute('href') || ''
      return '[' + inner + '](' + href + ')'
    }
    case 'li': return '- ' + inner + '\n'
    case 'ul': case 'ol': return inner + '\n'
    case 'p': return inner + '\n\n'
    case 'br': return '\n'
    case 'div': return inner + '\n'
    default: return inner
  }
}

// ============ 个人信息卡片 ============
function ProfileCard({ profile, isOwner, editing, editBio, onEditBio, onStartEdit, onCancelEdit, onSaveBio, onBgUpload, bgInputRef }) {
  const textareaRef = useRef(null)
  const previewRef = useRef(null)
  const isInternalUpdate = useRef(false)
  const [showHeadingPicker, setShowHeadingPicker] = useState(false)
  const headingTimerRef = useRef(null)
  const bgStyle = profile.background
    ? { backgroundImage: `url(/backgrounds/${profile.background})` }
    : { background: 'linear-gradient(135deg, var(--brand) 0%, #6366f1 100%)' }

  // 同步 markdown → 预览 HTML
  useEffect(() => {
    if (!previewRef.current || isInternalUpdate.current) return
    const html = renderMarkdown(editBio)
    previewRef.current.innerHTML = html || '<p style="color:var(--text-muted);font-style:italic">暂无内容</p>'
  }, [editBio])

  // 预览面板编辑 → 转回 markdown
  const handlePreviewInput = () => {
    if (!previewRef.current) return
    isInternalUpdate.current = true
    const md = htmlToMarkdown(previewRef.current).replace(/\n{3,}/g, '\n\n').trim()
    onEditBio(md)
    setTimeout(() => { isInternalUpdate.current = false }, 0)
  }

  const insertMarkdown = (before, after = '') => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = editBio.substring(start, end)
    const newText = editBio.substring(0, start) + before + selected + after + editBio.substring(end)
    onEditBio(newText)
    // 恢复光标位置
    setTimeout(() => {
      ta.focus()
      ta.selectionStart = start + before.length
      ta.selectionEnd = start + before.length + selected.length
    }, 0)
  }

  const mdButtons = [
    { label: 'B', title: '加粗', before: '**', after: '**' },
    { label: 'I', title: '斜体', before: '*', after: '*' },
    { label: '·', title: '列表', before: '- ' },
    { label: '[]', title: '链接', before: '[', after: '](url)' },
    { label: '<>', title: '行内代码', before: '`', after: '`' },
    { label: '"', title: '引用', before: '> ' },
  ]

  const headingLevels = [
    { label: 'H1', prefix: '# ' },
    { label: 'H2', prefix: '## ' },
    { label: 'H3', prefix: '### ' },
    { label: 'H4', prefix: '#### ' },
    { label: 'H5', prefix: '##### ' },
    { label: 'H6', prefix: '###### ' },
  ]

  const handleHeadingHover = () => {
    clearTimeout(headingTimerRef.current)
    setShowHeadingPicker(true)
  }

  const handleHeadingLeave = () => {
    headingTimerRef.current = setTimeout(() => setShowHeadingPicker(false), 200)
  }

  const handleHeadingPick = (prefix) => {
    insertMarkdown(prefix)
    setShowHeadingPicker(false)
  }

  const avatarUrl = profile.avatar ? `/avatars/${profile.avatar}` : null

  return (
    <div className="profile-card">
      <div className="profile-bg" style={bgStyle}>
        {isOwner && (
          <button className="profile-bg-edit" onClick={() => bgInputRef.current?.click()}>
            更换背景
          </button>
        )}
        <input ref={bgInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onBgUpload} />
      </div>
      <div className="profile-body">
        <div className="profile-avatar-row">
          <div className="profile-avatar-lg">
            {avatarUrl ? (
              <img className="profile-avatar-img" src={avatarUrl} alt={profile.username} />
            ) : (
              <span className="profile-avatar-text">{profile.username.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="profile-name-row">
            <h2 className="profile-username">{profile.username}</h2>
            {profile.signature && <span className="profile-signature">{profile.signature}</span>}
          </div>
        </div>

        <div className="profile-bio-section">
          <div className="profile-bio-header">
            <span className="profile-bio-label">个人简介</span>
            {isOwner && !editing && (
              <button className="btn-link btn-link-sm" onClick={onStartEdit}>编辑</button>
            )}
          </div>
          {editing ? (
            <div className="profile-bio-edit">
              <div className="md-toolbar">
                {mdButtons.map((btn) => (
                  <button
                    key={btn.title}
                    className="md-toolbar-btn"
                    title={btn.title}
                    onClick={() => insertMarkdown(btn.before, btn.after)}
                  >
                    {btn.label}
                  </button>
                ))}
                <div
                  className="md-toolbar-heading"
                  onMouseEnter={handleHeadingHover}
                  onMouseLeave={handleHeadingLeave}
                >
                  <button className="md-toolbar-btn" title="标题">H</button>
                  {showHeadingPicker && (
                    <div
                      className="md-heading-dropdown"
                      onMouseEnter={handleHeadingHover}
                      onMouseLeave={handleHeadingLeave}
                    >
                      {headingLevels.map((hl) => (
                        <button
                          key={hl.label}
                          className="md-heading-item"
                          onClick={() => handleHeadingPick(hl.prefix)}
                        >
                          {hl.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="md-split">
                <div className="md-split-pane md-split-preview">
                  <div className="md-split-label">预览</div>
                  <div
                    ref={previewRef}
                    className="profile-bio-md profile-bio-editable"
                    contentEditable
                    suppressContentEditableWarning
                    onInput={handlePreviewInput}
                  />
                </div>
                <div className="md-split-pane md-split-source">
                  <div className="md-split-label">代码</div>
                  <textarea
                    ref={textareaRef}
                    className="profile-bio-textarea"
                    value={editBio}
                    onChange={(e) => onEditBio(e.target.value)}
                    placeholder="介绍你自己吧...…"
                  />
                </div>
              </div>
              <div className="profile-bio-actions">
                <button className="btn-primary btn-sm" onClick={onSaveBio}>保存</button>
                <button className="btn-secondary btn-sm" onClick={onCancelEdit}>取消</button>
                <span className="profile-bio-hint">支持 Markdown 语法</span>
              </div>
            </div>
          ) : (
            <div className="profile-bio-content">
              {profile.bio ? (
                <div className="profile-bio-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(profile.bio) }} />
              ) : (
                <p className="profile-bio-empty">{isOwner ? '点击"编辑"添加个人简介' : '暂无简介'}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============ 设置页 ============
function SettingsPage({ user, avatarUrl, onChangePassword, onChangeUsername, onSetSignature, onUploadAvatar, onDeleteAccount, onClose }) {
  const [tab, setTab] = useState('profile')
  const [newPw, setNewPw] = useState('')
  const [pwCode, setPwCode] = useState('')
  const [pwCodeSent, setPwCodeSent] = useState(false)
  const [pwCountdown, setPwCountdown] = useState(60)
  const [newName, setNewName] = useState(user.username)
  const [newSignature, setNewSignature] = useState(user.signature || '')
  const [delCode, setDelCode] = useState('')
  const [delCodeSent, setDelCodeSent] = useState(false)
  const [delCountdown, setDelCountdown] = useState(60)
  const [submitting, setSubmitting] = useState(false)
  const avatarInputRef = useRef(null)

  const tabs = [
    { key: 'profile', label: '个人信息' },
    { key: 'password', label: '修改密码' },
    { key: 'danger', label: '注销账号' },
  ]

  // 倒计时
  useEffect(() => {
    if (pwCountdown <= 0) return
    const t = setInterval(() => setPwCountdown((c) => c - 1), 1000)
    return () => clearInterval(t)
  }, [pwCountdown])
  useEffect(() => {
    if (delCountdown <= 0) return
    const t = setInterval(() => setDelCountdown((c) => c - 1), 1000)
    return () => clearInterval(t)
  }, [delCountdown])

  const handleAvatar = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setSubmitting(true)
    await onUploadAvatar(file)
    setSubmitting(false)
    e.target.value = ''
  }

  const sendPwCode = async () => {
    setSubmitting(true)
    try {
      const r = await api('POST', '/auth/send-op-code', { operation: 'changePassword' })
      const d = await r.json()
      if (r.ok) {
        setPwCodeSent(true)
        setPwCountdown(60)
      } else {
        alert(d.error || '发送失败')
      }
    } catch { alert('网络错误') }
    setSubmitting(false)
  }

  const handleSubmitPassword = async () => {
    if (pwCode.length !== 6) { alert('验证码为 6 位数字'); return }
    setSubmitting(true)
    const ok = await onChangePassword(pwCode, newPw)
    if (ok) { setPwCode(''); setNewPw(''); setPwCodeSent(false) }
    setSubmitting(false)
  }

  const handleSubmitName = async () => {
    if (newName.trim() === user.username) return
    setSubmitting(true)
    const ok = await onChangeUsername(newName.trim())
    if (!ok) setNewName(user.username)
    setSubmitting(false)
  }

  const handleSubmitSignature = async () => {
    if (newSignature.trim() === (user.signature || '')) return
    setSubmitting(true)
    const ok = await onSetSignature(newSignature.trim())
    if (!ok) setNewSignature(user.signature || '')
    setSubmitting(false)
  }

  const sendDelCode = async () => {
    setSubmitting(true)
    try {
      const r = await api('POST', '/auth/send-op-code', { operation: 'deleteAccount' })
      const d = await r.json()
      if (r.ok) {
        setDelCodeSent(true)
        setDelCountdown(60)
      } else {
        alert(d.error || '发送失败')
      }
    } catch { alert('网络错误') }
    setSubmitting(false)
  }

  const handleDelete = async () => {
    if (!confirm('确定要注销账号吗？此操作不可撤销，所有数据将被删除。')) return
    if (delCode.length !== 6) { alert('验证码为 6 位数字'); return }
    setSubmitting(true)
    await onDeleteAccount(delCode)
    setSubmitting(false)
  }

  return (
    <Modal onClose={onClose} title="账户设置" wide>
      <div className="settings-container">
        <div className="settings-sidebar">
          {tabs.map((t) => (
            <button key={t.key} className={`settings-tab ${tab === t.key ? 'settings-tab-active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="settings-content">
          {tab === 'profile' && (
            <div className="settings-section">
              <h4>个人信息</h4>
              <div className="settings-avatar-row">
                <div className="settings-avatar-preview">
                  {avatarUrl ? (
                    <img className="settings-avatar-img" src={avatarUrl} alt={user.username} />
                  ) : (
                    <span className="settings-avatar-placeholder">{user.username.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="settings-avatar-actions">
                  <button className="btn-primary btn-sm" onClick={() => avatarInputRef.current?.click()} disabled={submitting}>
                    {submitting ? '上传中...' : '更换头像'}
                  </button>
                  <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatar} />
                  <p className="settings-hint">支持 JPG、PNG、GIF、WebP，最大 2MB</p>
                </div>
              </div>
              <div className="settings-field">
                <label>邮箱</label>
                <input className="auth-input" value={user.email} disabled />
              </div>
              <div className="settings-field">
                <label>用户名</label>
                <div className="settings-inline">
                  <input className="auth-input" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={20} />
                  <button className="btn-primary btn-sm" onClick={handleSubmitName} disabled={submitting || newName.trim() === user.username || !newName.trim()}>
                    保存
                  </button>
                </div>
              </div>
              <div className="settings-field">
                <label>个性签名</label>
                <div className="settings-inline">
                  <input className="auth-input" value={newSignature} onChange={(e) => setNewSignature(e.target.value)} maxLength={50} placeholder="写一句话介绍自己..." />
                  <button className="btn-primary btn-sm" onClick={handleSubmitSignature} disabled={submitting || newSignature.trim() === (user.signature || '')}>
                    保存
                  </button>
                </div>
                <p className="settings-hint">最多 50 个字，将显示在头像旁边</p>
              </div>
            </div>
          )}

          {tab === 'password' && (
            <div className="settings-section">
              <h4>修改密码</h4>
              <p className="settings-hint" style={{ marginBottom: '12px' }}>为保障安全，修改密码需邮箱验证码确认</p>
              <div className="settings-field">
                <label>新密码</label>
                <input className="auth-input" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="至少 6 位" />
              </div>
              <div className="settings-field">
                <label>邮箱验证码</label>
                <div className="settings-inline">
                  <input className="auth-input auth-code-input" style={{ flex: 1, marginBottom: 0 }} type="text" placeholder="6 位验证码" maxLength={6}
                    value={pwCode} onChange={(e) => setPwCode(e.target.value.replace(/\D/g, ''))} />
                  {pwCodeSent && pwCountdown > 0 ? (
                    <button className="btn-secondary btn-sm" disabled>{pwCountdown}s</button>
                  ) : (
                    <button className="btn-secondary btn-sm" onClick={sendPwCode} disabled={submitting}>
                      {pwCodeSent ? '重新发送' : '发送验证码'}
                    </button>
                  )}
                </div>
              </div>
              <button className="btn-primary" onClick={handleSubmitPassword} disabled={submitting || !pwCode || !newPw || newPw.length < 6}>
                {submitting ? '修改中...' : '修改密码'}
              </button>
            </div>
          )}

          {tab === 'danger' && (
            <div className="settings-section">
              <h4 className="text-danger">注销账号</h4>
              <p className="settings-warning">注销后所有数据将被永久删除，包括文件、用户信息等。此操作不可撤销。</p>
              <p className="settings-hint" style={{ marginBottom: '12px' }}>为保障安全，注销账号需邮箱验证码确认</p>
              <div className="settings-field">
                <label>邮箱验证码</label>
                <div className="settings-inline">
                  <input className="auth-input auth-code-input" style={{ flex: 1, marginBottom: 0 }} type="text" placeholder="6 位验证码" maxLength={6}
                    value={delCode} onChange={(e) => setDelCode(e.target.value.replace(/\D/g, ''))} />
                  {delCodeSent && delCountdown > 0 ? (
                    <button className="btn-secondary btn-sm" disabled>{delCountdown}s</button>
                  ) : (
                    <button className="btn-secondary btn-sm" onClick={sendDelCode} disabled={submitting}>
                      {delCodeSent ? '重新发送' : '发送验证码'}
                    </button>
                  )}
                </div>
              </div>
              <button className="btn-danger-full" onClick={handleDelete} disabled={submitting || !delCode}>
                {submitting ? '注销中...' : '确认注销账号'}
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ============ Logo ============
function Logo() {
  const [step, setStep] = useState(0)
  const sources = ['/logo/logo.svg', '/logo/logo.png', '/logo/logo.ico', '/logo.svg']
  const handleError = () => setStep((s) => s + 1)
  if (step >= sources.length) return <h1 className="logo">Transfer Hard Disk</h1>
  return <img className="logo-img" src={sources[step]} alt="Transfer Hard Disk" onError={handleError} />
}

// ============ Modal ============
function Modal({ children, onClose, title, wide }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h3>{title}</h3><button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

// ============ UploadPanel ============
function UploadPanel({ onUpload, onClose }) {
  const [files, setFiles] = useState([])
  const handleDrop = (e) => { e.preventDefault(); setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)]) }
  const handleSelect = (e) => { setFiles((prev) => [...prev, ...Array.from(e.target.files)]); e.target.value = '' }
  const total = files.reduce((s, f) => s + f.size, 0)
  return (
    <div>
      <div className="upload-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop} onClick={() => document.getElementById('upload-input').click()}>
        <input id="upload-input" type="file" multiple style={{ display: 'none' }} onChange={handleSelect} />
        <div className="dropzone-icon">📤</div>
        <p>拖拽文件到此处，或点击选择</p>
      </div>
      {files.length > 0 && (
        <div className="upload-file-list">
          <div className="upload-file-header"><span>{files.length} 个文件 ({formatSize(total)})</span><button className="btn-text" onClick={() => setFiles([])}>清空</button></div>
          {files.map((f, i) => (
            <div key={i} className="upload-file-item">
              <span className="uf-name">{f.name}</span><span className="uf-size">{formatSize(f.size)}</span>
              <button className="btn-remove" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>取消</button>
        <button className="btn-primary" onClick={() => onUpload(files)} disabled={files.length === 0}>开始上传 ({files.length})</button>
      </div>
    </div>
  )
}

// ============ InputModal ============
function InputModal({ placeholder, defaultValue, onSubmit, onClose }) {
  const [value, setValue] = useState(defaultValue || '')
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  const handleSubmit = () => { if (value.trim()) onSubmit(value.trim()) }
  return (
    <div>
      <input ref={inputRef} className="input-full" type="text" placeholder={placeholder}
        value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }} />
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>取消</button>
        <button className="btn-primary" onClick={handleSubmit} disabled={!value.trim()}>确定</button>
      </div>
    </div>
  )
}