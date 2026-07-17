# Transfer Hard Disk

<p align="center">
  <strong>File Transfer &amp; Sharing Platform</strong><br>
  文件传输与共享平台
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <img src="https://img.shields.io/badge/react-18-61dafb" alt="React">
</p>

A self-hosted file server built with Node.js + React. Multi-user with email verification, private/public repositories, user search, personal profiles, dark mode, and CLI management.

基于 Node.js + React 的网盘应用。支持多用户注册登录、邮箱验证、私密/公开仓库、用户搜索、个人主页、暗色主题、CLI 管理。

## Features / 功能

- **Multi-user system** — register, login, email verification, token auth, password reset
- **多用户系统** — 注册、登录、邮箱验证、Token 认证、找回密码
- **Private + Public repos** — dual-space per user, toggle visibility with one click
- **私密仓库 + 公开仓库** — 双空间独立管理，一键切换
- **User search** — find public users by username, browse and download their public files
- **用户搜索** — 按用户名搜索公开用户，浏览对方的公开文件
- **Personal profiles** — avatar, background image, status signature, Markdown bio
- **个人主页** — 头像、背景图、个性签名、Markdown 个人简介
- **File management** — grid/list view, folder navigation, breadcrumbs
- **文件管理** — 网格/列表双视图，文件夹导航，面包屑
- **Upload** — drag-and-drop or click, batch upload (up to 500 files per batch), real-time progress
- **文件上传** — 拖拽/点击上传，批量支持（单次最多 500 个文件），实时进度
- **Download** — HTTP Range support for resumable downloads
- **文件下载** — HTTP Range 断点续传
- **Image preview** — click to view in lightbox
- **图片预览** — 点击弹窗查看
- **Dark theme** — auto (follows system) or manual toggle
- **暗色主题** — 跟随系统/手动切换
- **Server CLI** — manage users, browse files, check disk usage from the console
- **服务端 CLI** — 控制台管理用户、查看文件、统计磁盘占用
- **Public access** — built-in frp config for exposing to the internet via VPS
- **公网穿透** — 内置 frp 配置，配合 VPS 开放到公网
- **Auto-setup** — `start.bat` detects and installs missing dependencies automatically
- **自动安装** — `start.bat` 自动检测并安装缺失的依赖

## Quick Start / 快速开始

### Prerequisites / 环境

- Node.js 18+

### Run / 启动

```bash
# Clone / 克隆项目
git clone https://github.com/yourname/transfer-hard-disk.git
cd transfer-hard-disk

# Install & build / 安装依赖并构建
cd server && npm install
cd ../client && npm install && npm run build

# Start / 启动
cd ../server && npm start
```

Or simply double-click `start.bat` on Windows — it auto-detects Node.js, installs missing dependencies, and builds the frontend.

或直接双击 `start.bat`（Windows）— 自动检测 Node.js、安装缺失依赖、构建前端。

Open `http://localhost:3000`. Other devices on the LAN can access via `http://<your-ip>:3000`.

浏览器访问 `http://localhost:3000`，局域网内其他设备通过 `http://<本机IP>:3000` 访问。

### First use / 首次使用

1. Register an account (email + username + password) / 注册账号（邮箱 + 用户名 + 密码）
2. Enter the verification code (printed in the console if SMTP is not configured) / 输入邮箱验证码验证（未配置 SMTP 时验证码打印在控制台）
3. Log in and start using / 登录后即可使用

## SMTP Email Setup / SMTP 邮件配置

Set environment variables before starting the server:

启动前设置环境变量：

```bat
set SMTP_HOST=smtp.qq.com
set SMTP_PORT=587
set SMTP_USER=your@qq.com
set SMTP_PASS=your_smtp_password
```

Without SMTP, verification codes are printed to the server console.

不配置 SMTP 时，验证码打印在控制台。

## Private / Public Repos / 公开/私密仓库

| Space / 空间 | Path / 路径 | Visibility / 可见性 |
|-------|------|------------|
| Private / 私密 | `file/private/{userId}/` | Only you / 仅自己 |
| Public / 公开 | `file/public/{userId}/` | Searchable, others can browse & download / 可搜索，他人可浏览下载 |

To go public: avatar menu → toggle "Public repo" → switch to public space and upload files → others can find you via the search bar.

开启公开：右上角头像 → "公开仓库" → 切换到公开仓库上传文件 → 他人通过搜索框查找你的用户名。

## Server CLI / 服务端 CLI

Available at the `> ` prompt in the server console:

服务器控制台 `> ` 提示符下可用命令：

| Command / 命令 | Description / 功能 |
|---------|-------------|
| `status` | Server status / 服务器状态 |
| `users` | List registered users / 用户列表 |
| `delete-user` | Delete a user account / 注销用户 |
| `change-email` | Change a user's email / 修改邮箱 |
| `ls [path]` | List files (default: root) / 列出文件，默认根目录 |
| `tree [path]` | Tree view of directory / 树形目录结构 |
| `mkdir <path>` | Create directory / 创建目录 |
| `rm <path>` | Delete file/directory (with confirmation) / 删除（需确认） |
| `du [path]` | Disk usage statistics / 磁盘占用统计 |
| `info <path>` | File/directory details / 文件详情 |
| `config` | Show current configuration / 查看当前配置 |
| `moveto <path>` | Migrate storage directory / 迁移存储目录 |
| `help` | Show help / 帮助 |
| `stop` / `restart` | Stop or restart server / 关闭/重启 |

## Public Access (frp) / 公网访问

Built-in frp configuration in `frp/` directory.

项目内置 frp 配置，位于 `frp/` 目录。

### Server (VPS) / 服务端

```bash
./frps -c frps.toml
```

### Client (this machine) / 客户端（本机）

Edit `frpc.toml` — set `serverAddr` and `auth.token`, then double-click `start-frpc.bat`.

修改 `frpc.toml` 中的 `serverAddr` 和 `auth.token`，双击 `start-frpc.bat`。

## Project Structure / 项目结构

```
├── start.bat               # Windows startup script / 启动脚本（自动安装 + 启动）
├── start.ps1               # PowerShell startup script / 启动脚本（备选）
├── .gitignore
├── LICENSE
├── README.md
├── server/                 # Backend / 后端（Express）
│   ├── package.json
│   └── src/
│       ├── index.js        # Entry point + API routes + CLI / 入口 + API + CLI
│       ├── config.js       # Configuration / 配置
│       ├── auth.js         # Token authentication / Token 认证
│       ├── users.js        # User system / 用户系统
│       ├── fileServer.js   # File storage & upload / 文件存储与上传
│       ├── repo-cli.js     # CLI file management commands / CLI 仓库管理命令
│       ├── discovery.js    # LAN device discovery (mDNS) / 设备发现
│       └── wsServer.js     # WebSocket notifications / WebSocket 通知
├── client/                 # Frontend / 前端（React + Vite）
│   ├── package.json
│   ├── index.html
│   └── src/
│       ├── App.jsx         # Main component / 主组件
│       └── App.css         # Styles / 样式
├── frp/                    # frp tunnel / 内网穿透（可选）
│   ├── frpc.exe / frps.exe
│   ├── frpc.toml / frps.toml
│   ├── start-frpc.bat
│   └── download.ps1
├── file/                   # File storage / 文件存储（gitignored）
│   ├── private/{userId}/
│   └── public/{userId}/
├── data/                   # User data / 用户数据（gitignored）
│   ├── users.json
│   ├── tokens.json
│   ├── avatars/
│   ├── backgrounds/
│   └── profiles/
└── logo/                   # Logo assets / Logo 资源
```

## API

### Auth / 认证

| Method | Path | Description / 说明 |
|--------|------|-------------|
| POST | `/api/auth/register` | Register / 注册 |
| POST | `/api/auth/verify` | Verify email / 验证邮箱 |
| POST | `/api/auth/resend` | Resend verification code / 重新发送验证码 |
| POST | `/api/auth/login` | Login / 登录 |
| POST | `/api/auth/logout` | Logout / 登出 |
| GET | `/api/auth/me` | Current user info / 当前用户信息 |
| PATCH | `/api/auth/profile` | Toggle public profile visibility / 切换公开资料可见性 |
| PATCH | `/api/auth/password` | Change password / 修改密码 |
| PATCH | `/api/auth/username` | Change username / 修改用户名 |
| PATCH | `/api/auth/signature` | Update status signature / 修改个性签名 |
| POST | `/api/auth/avatar` | Upload avatar / 上传头像 |
| POST | `/api/auth/profile-background` | Upload background image / 上传背景图 |
| GET | `/api/auth/profile-bio` | Get own bio / 获取个人简介 |
| DELETE | `/api/auth/account` | Delete account / 注销账号 |
| POST | `/api/auth/send-reset-code` | Send password reset code / 发送找回密码验证码 |
| POST | `/api/auth/reset-password` | Reset password / 重置密码 |

### Files / 文件

| Method | Path | Description / 说明 |
|--------|------|-------------|
| GET | `/api/files/browse` | Browse files / 浏览文件 |
| POST | `/api/files/upload` | Upload files (multipart) / 上传文件 |
| GET | `/api/files/download` | Download file / 下载文件 |
| POST | `/api/files/mkdir` | Create folder / 新建文件夹 |
| POST | `/api/files/rename` | Rename file/folder / 重命名 |
| DELETE | `/api/files` | Delete file/folder / 删除 |

### Public Users / 公开用户

| Method | Path | Description / 说明 |
|--------|------|-------------|
| GET | `/api/users/search?q=` | Search users by username / 搜索用户 |
| GET | `/api/users/:id/profile` | Get user profile / 查看个人信息 |
| GET | `/api/users/:id/profile/bio` | Get user bio / 查看个人简介 |
| GET | `/api/users/:id/public/browse` | Browse public files / 浏览公开文件 |
| GET | `/api/users/:id/public/download` | Download public file / 下载公开文件 |
| POST | `/api/users/:id/copytome` | Copy public file to private repo / 复制公开文件到私密仓库 |

### System / 系统

| Method | Path | Description / 说明 |
|--------|------|-------------|
| GET | `/api/ping` | Health check / 健康检查 |
| GET | `/api/self` | Server device info / 服务器设备信息 |
| GET | `/api/diagnose` | Network diagnostics / 网络诊断 |

## Environment Variables / 环境变量

| Variable / 变量 | Description / 说明 | Default / 默认 |
|----------|-------------|---------|
| `PORT` | Server port / 端口 | `3000` |
| `DEVICE_NAME` | Device display name / 设备名 | Hostname / 主机名 |
| `UPLOAD_DIR` | Storage root directory / 存储目录 | `file/` |
| `MAX_FILE_SIZE` | Max single file size (bytes, 0 = unlimited) / 单文件大小限制 | `0`（不限） |
| `MAX_FILE_COUNT` | Max files per upload batch / 单次最多上传文件数 | `500` |
| `REGISTRATION_OPEN` | Allow new registrations / 开放注册 | `true` |
| `SMTP_HOST` | SMTP server address / SMTP 地址 | — |
| `SMTP_PORT` | SMTP port / SMTP 端口 | `587` |
| `SMTP_USER` | SMTP username / SMTP 用户 | — |
| `SMTP_PASS` | SMTP password / SMTP 密码 | — |

## FAQ / 常见问题

**Can't find other users in search? / 无法搜索到其他用户？**

They must enable "Public repo" in their avatar menu first.

对方需在头像菜单中开启"公开仓库"。

**Can't access from other devices on LAN? / 其他设备无法访问局域网地址？**

Restart `start.bat` to auto-register the firewall rule, or manually:

重启 `start.bat` 自动注册防火墙规则，或手动执行：

```powershell
netsh advfirewall firewall add rule name="TransferHardDisk-Port" dir=in action=allow protocol=TCP localport=3000 enable=yes
```

**Upload fails with too many files? / 上传文件过多失败？**

The default limit is 500 files per batch. Increase it with `set MAX_FILE_COUNT=2000`, or zip files before uploading.

默认单次最多 500 个文件。可通过 `set MAX_FILE_COUNT=2000` 调大，或先压缩打包再上传。

**Can't access over the internet? / 公网无法访问？**

Forward port 3000 on your router, or use the built-in frp tunnel (see Public Access section).

在路由器上转发 3000 端口，或使用内置 frp 穿透（见公网访问章节）。

## License

MIT
