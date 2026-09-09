<p align="right">简体中文 | <a href="./README.en.md">English</a></p>

# MD Notes

一个部署在 **Cloudflare Workers + D1** 上的 Markdown 笔记网页，完全跑在免费额度内，不需要服务器。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/JamesZhaoY/md-notes)

> 按钮指向 `github.com/JamesZhaoY/md-notes`。如果你 fork 到了别的地址，把链接里的仓库地址换掉即可。

- 左侧笔记列表 + 全文搜索，右侧编辑 / 分栏 / 预览三种视图
- 输入后自动保存（800ms 防抖），`⌘/Ctrl + S` 立即保存
- GFM 语法：表格、任务列表、代码块、引用，链接自动新窗口打开
- 标题自动取正文第一行，列表显示摘要和相对时间
- 一键导出 `.md`；跟随系统的浅色 / 深色主题；手机端抽屉式列表
- **单用户**：登录密码来自环境变量 `AUTH_PASSWORD`，没有注册功能、没有用户表；浏览器只保存密码的 SHA-256 令牌
- 前端零框架、零构建；`marked` 与 `DOMPurify` 自托管，不依赖外部 CDN
- MIT 协议开源

## 目录结构

```
md-notes/
├── wrangler.toml            Cloudflare 配置（Worker、静态资源、D1 绑定）
├── schema.sql               数据表（Worker 首次运行会自动建表，此文件仅备用）
├── src/index.js             Worker：/api/* 接口 + 鉴权
├── public/                  前端静态文件，由 Cloudflare 边缘直接托管
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── vendor/              marked.min.js、purify.min.js（npm run vendor 生成）
├── scripts/vendor.mjs       把 node_modules 里的前端库拷到 public/vendor
├── docs/
│   ├── deploy-dashboard.md      图形界面部署手册（不用命令行）
│   └── deploy-dashboard.en.md   同上，英文版
├── .dev.vars.example        本地开发环境变量示例
├── README.en.md             英文说明
└── LICENSE                  MIT
```

## 部署

三种方式任选其一，都在 Cloudflare 免费套餐内。

| 方式 | 需要什么 | 适合谁 |
| --- | --- | --- |
| **① 一键部署按钮** | Cloudflare 账号 + GitHub 账号 | 最快，约 3 分钟，全程点按钮 |
| **② 控制台图形界面** | Cloudflare 账号 + GitHub 账号 | 不想装任何东西，想看清每一步 |
| **③ 命令行 wrangler** | 本机有 Node.js 18+ | 开发者，想本地改代码再部署 |

### 方式一：一键部署按钮

点上面的 **Deploy to Cloudflare** 按钮 → 登录 Cloudflare 并授权 GitHub → 在设置页确认仓库名、Worker 名、D1 数据库名，并填入 `AUTH_PASSWORD` 的值 → **Create and deploy**。

Cloudflare 会把代码复制到你的 GitHub 账号、自动创建 D1 数据库、部署 Worker，并在以后每次 push 时自动重新部署。详细说明见 [图形界面部署手册 · 方式 A](./docs/deploy-dashboard.md#方式-a一键部署按钮约-3-分钟)。

### 方式二：控制台图形界面

不用命令行，全部在浏览器里操作：把代码放到 GitHub → 在控制台创建 D1 → 填 Database ID → 导入仓库创建 Worker → 设置密码。

完整的分步手册（含每一步要点的按钮名称、常见报错）：**[docs/deploy-dashboard.md](./docs/deploy-dashboard.md)**

### 方式三：命令行

前提：Node.js 18+。

```bash
# 1. 安装依赖（wrangler 作为项目依赖安装，不需要全局安装）
npm install

# 2. 登录 Cloudflare（会打开浏览器授权）
npx wrangler login

# 3. 部署。wrangler 会自动创建名为 md-notes 的 D1 数据库并把 ID 写回 wrangler.toml
npm run deploy

# 4. 设置登录密码（必需）—— 环境变量 AUTH_PASSWORD，输入一个 16 位以上的随机密码
npx wrangler secret put AUTH_PASSWORD
```

部署成功后会打印地址，形如 `https://md-notes.<你的子域>.workers.dev`，打开后输入第 4 步的密码即可使用。数据表会在第一次请求时自动创建，不需要执行迁移。

以后改了代码，再执行一次 `npm run deploy` 即可。第 3 步写回的 `database_id` 建议保留，这样后续部署不再查询数据库。

### 关于登录密码

这是一个单用户应用：**唯一的登录凭据就是环境变量 `AUTH_PASSWORD`**，没有注册页面、没有用户表，谁知道密码谁就能读写全部笔记。没有配置这个变量时，所有接口返回 503，页面会显示配置提示而不是放开访问。

设置方式有三种，效果相同，选一种即可（不要同时用两种）：

| 方式 | 命令 / 位置 | 适用场景 |
| --- | --- | --- |
| Secret（推荐） | `npx wrangler secret put AUTH_PASSWORD` | 加密存储，不进代码仓库 |
| 控制台 | Workers & Pages → md-notes → Settings → Variables and Secrets → Add，类型选 **Secret** | 图形界面部署、不想装 wrangler 时 |
| 明文环境变量 | `wrangler.toml` 里加 `[vars]` `AUTH_PASSWORD = "..."` | 仓库私有、图省事时 |

本地开发写在 `.dev.vars` 文件里（见下文）。

### 绑定自己的域名（可选）

`workers.dev` 域名在部分地区访问不稳定。如果你的域名已托管在 Cloudflare：
控制台 → Workers & Pages → `md-notes` → Settings → Domains & Routes → Add → Custom Domain，填一个子域名（如 `notes.example.com`）即可，证书自动签发。

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars   # 必需：改成你的本地密码
npm run dev                      # http://localhost:8787
```

本地使用 wrangler 内置的 SQLite 模拟 D1，数据存在 `.wrangler/` 目录，不会影响线上。

## 免费额度

以下为撰写时 Cloudflare 免费套餐的额度，实际以[官方文档](https://developers.cloudflare.com/workers/platform/pricing/)为准：

| 资源 | 免费额度 | 说明 |
| --- | --- | --- |
| Workers 请求 | 100,000 次 / 天 | 只有 `/api/*` 计入；HTML/CSS/JS 等静态文件由 Static Assets 托管，**不计入** |
| D1 存储 | 5 GB | 一篇 1 万字的笔记约 30 KB |
| D1 读 | 500 万行 / 天 | |
| D1 写 | 10 万行 / 天 | 每次自动保存写 1 行 |
| Workers Logs | 20 万条 / 天 | `wrangler.toml` 里已开启 observability |
| Workers Builds | 每月 3,000 分钟构建时长 | 方式一、二用到；本项目每次构建约 1 分钟 |

个人使用远远用不完。

## 接口说明

除 `/api/auth/*` 外，其余接口都需要请求头 `Authorization: Bearer <token>`，token 由登录接口返回（即密码的 SHA-256 十六进制）。`AUTH_PASSWORD` 未配置时，除 `status` 外全部返回 503。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/auth/status` | `{ configured: boolean }` 服务端是否已配置密码 |
| POST | `/api/auth/login` | `{ password }` → `{ token }` |
| GET | `/api/notes?q=关键词` | 列表（按更新时间倒序，最多 500 条），`q` 为可选的标题/正文搜索 |
| POST | `/api/notes` | `{ content }` → 新建的笔记 |
| GET | `/api/notes/:id` | 单篇笔记全文 |
| PUT | `/api/notes/:id` | `{ content }` → `{ id, title, updated_at }` |
| DELETE | `/api/notes/:id` | 删除，返回 204 |

有了接口就可以自己写脚本批量导入，比如把一个目录下的 `.md` 全部导入：

```bash
TOKEN=$(curl -s -X POST https://你的域名/api/auth/login \
  -H 'content-type: application/json' -d '{"password":"你的密码"}' | jq -r .token)
for f in *.md; do
  jq -Rs '{content: .}' "$f" | curl -s -X POST https://你的域名/api/notes \
    -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d @-
done
```

## 常见问题

**打开页面提示"服务端还没有配置访问密码"？**
环境变量 `AUTH_PASSWORD` 没设置，见上文"关于登录密码"。本地开发则是缺少 `.dev.vars` 文件。

**忘记密码 / 想换密码？**
再执行一次 `npx wrangler secret put AUTH_PASSWORD`（或在控制台改 Secret 后点 Deploy）即可，所有已登录设备的旧令牌立即失效，需要重新输入新密码。

**能加多个用户吗？**
设计上就是单用户，没有注册和用户管理。如果要给别人用，各自部署一份即可，成本为零。

**密码会被暴力破解吗？**
接口没有做登录限流，安全性取决于密码强度，请用 16 位以上的随机密码。如果想要更强的保护，可以在 Cloudflare Zero Trust 里给这个域名加一层 Access（50 个用户以内免费），支持邮箱验证码 / GitHub 等登录方式。

**多设备同时编辑同一篇会怎样？**
后写入的覆盖先写入的（last-write-wins）。这是个人笔记工具，没有做协同编辑。

**想要代码高亮 / 数学公式？**
在 `public/index.html` 里引入 highlight.js 或 KaTeX，然后在 `public/app.js` 的 `marked.use({...})` 里配置对应的渲染器即可，其余代码不用动。

**升级 marked / DOMPurify？**
`npm update marked dompurify && npm run vendor`，然后重新部署。

## 技术要点

- **Static Assets**：`wrangler.toml` 的 `[assets]` 让 Cloudflare 直接托管 `public/`，静态请求不经过 Worker、不计费；只有 `/api/*` 才会进入 `src/index.js`。
- **D1 自动建表**：Worker 在每个实例首次处理请求时执行 `CREATE TABLE IF NOT EXISTS`，因此不需要手动跑迁移。
- **D1 自动创建**：`database_id` 留空时 wrangler 会按 `database_name` 查找或创建数据库，命令行部署不需要 `d1 create`。
- **鉴权**：唯一凭据是环境变量 `AUTH_PASSWORD`，服务端用 `crypto.subtle.timingSafeEqual` 做常量时间比较，避免时序侧信道；浏览器只保存 SHA-256 令牌。
- **XSS 防护**：预览用 `DOMPurify` 清洗 `marked` 的输出；列表等处全部用 `textContent` 写入。
- **搜索**：SQLite `LIKE`，对 `%`、`_`、`\` 做了转义，中文按子串匹配。

## 开源协议

[MIT](./LICENSE)。可以随意使用、修改、再分发，保留版权声明即可。
