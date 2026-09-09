<p align="right">简体中文 | <a href="./deploy-dashboard.en.md">English</a></p>

# MD Notes 图形界面部署手册（不用命令行）

这份手册面向不想安装 Node.js / wrangler、只用浏览器点按钮完成部署的用户。全程免费，约 3～10 分钟。

Cloudflare 控制台部署 Worker 的方式是"连接一个 Git 仓库，每次代码变动自动构建部署"，所以除了 Cloudflare 账号还需要一个 GitHub 账号。两者都免费。

> 手册里的按钮名称以 Cloudflare 英文界面为准，括号里是中文界面的大致对应。控制台右上角头像 → 语言可以切换。

## 准备

| 需要 | 在哪申请 | 备注 |
| --- | --- | --- |
| Cloudflare 账号 | <https://dash.cloudflare.com/sign-up> | 免费套餐即可，不需要绑卡 |
| GitHub 账号 | <https://github.com/signup> | 免费 |
| 一个访问密码 | 自己想一个 | 16 位以上随机字符，这是笔记本唯一的钥匙 |

## 流程总览

```mermaid
flowchart LR
    A[代码放到你的 GitHub] --> B[创建 D1 数据库]
    B --> C[把 Database ID 填进 wrangler.toml]
    C --> D[导入仓库创建 Worker]
    D --> E[设置 AUTH_PASSWORD]
    E --> F[打开网址登录使用]
    F -.可选.-> G[绑定自己的域名]
```

有两种走法：

- **方式 A：一键部署按钮** —— 上面的 A、B、C、D、E 五步由 Cloudflare 自动完成，你只需在一个页面填密码。最快，推荐。
- **方式 B：手动导入仓库** —— 每一步自己点，适合想弄清楚每个环节、或者一键按钮不可用的情况。

---

## 方式 A：一键部署按钮（约 3 分钟）

前提：项目仓库在 GitHub 上是公开的（README 里的按钮指向 `github.com/JamesZhaoY/md-notes`；如果你用的是自己 fork 的公开仓库，把按钮链接里的地址换成你的仓库即可）。

1. 点击 README 顶部的 **Deploy to Cloudflare** 按钮，或直接打开：
   `https://deploy.workers.cloudflare.com/?url=https://github.com/JamesZhaoY/md-notes`
2. 登录 Cloudflare。首次使用会要求 **连接 GitHub 账号**（Connect GitHub），在 GitHub 的授权页选择允许 Cloudflare 访问的仓库（选 All repositories 或稍后会创建的那个都可以），点 **Install & Authorize**。
3. 回到 Cloudflare 的设置页，确认或修改：
   - **Repository name（仓库名）**：Cloudflare 会把代码复制成你账号下的一个新仓库，默认 `md-notes`。
   - **Worker name（Worker 名）**：默认 `md-notes`，决定网址 `https://md-notes.<你的子域>.workers.dev`。
   - **D1 database（数据库）**：默认名 `md-notes`，Cloudflare 会自动创建。
   - **Secrets（机密）**：会列出 `AUTH_PASSWORD`，**在这里填你的访问密码**。
4. 点 **Create and deploy**。页面会显示构建进度，等约 1 分钟出现 **Success**。
5. 点页面上的网址（或到 **Workers & Pages** 列表里找到 `md-notes`），打开后输入第 3 步填的密码，开始写笔记。

之后想改代码，直接在 GitHub 上你的那份仓库里编辑并提交，Cloudflare 会自动重新部署。

> 如果第 3 步没看到 `AUTH_PASSWORD` 的输入框，部署完成后按照 [方式 B 第 6 步](#第-6-步设置登录密码) 手动添加即可。

---

## 方式 B：手动导入仓库（约 10 分钟）

### 第 1 步：把代码放到你的 GitHub

选一种：

**Fork（如果代码在 GitHub 上）**
打开项目仓库页面 → 右上角 **Fork** → **Create fork**。你的账号下会出现一份 `md-notes`。

**上传（如果代码在你电脑上）**
1. GitHub 右上角 **+** → **New repository** → Repository name 填 `md-notes` → 选 **Public** 或 **Private** 都可以 → **Create repository**。
2. 在新仓库页面点 **uploading an existing file**（或 **Add file → Upload files**）。
3. 把项目文件夹里的**全部内容**（`src`、`public`、`docs`、`scripts` 文件夹和 `wrangler.toml`、`package.json`、`package-lock.json`、`schema.sql`、`.gitignore`、`.dev.vars.example`、`LICENSE`、`README.md`、`README.en.md`）拖进上传区。**不要**上传 `node_modules`、`.wrangler`、`.dev.vars`。
   - 用 Chrome / Edge 拖拽文件夹可以保留目录结构；Safari 需要逐个进入子文件夹上传。
4. 底部 **Commit changes**。

上传完成后，仓库根目录应能看到 `wrangler.toml`、`src/index.js`、`public/index.html` 等文件。

### 第 2 步：创建 D1 数据库

1. 打开 <https://dash.cloudflare.com> → 左侧菜单 **Storage & Databases（存储和数据库）** → **D1 SQL Database**。
   直达链接：<https://dash.cloudflare.com/?to=/:account/workers/d1>
2. 点 **Create Database（创建数据库）**。
3. **Name（名称）** 填 `md-notes`（与 `wrangler.toml` 里的 `database_name` 一致）；**Location（位置）** 保持 Automatic。
4. 点 **Create**。
5. 进入刚创建的数据库页面，在概览区找到 **Database ID**（一串形如 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` 的字符），点旁边的复制图标。

不需要在这里建表，Worker 第一次收到请求时会自动建。

### 第 3 步：把 Database ID 填进 wrangler.toml

1. 回到 GitHub 你的 `md-notes` 仓库，点开 `wrangler.toml`。
2. 点右上角的铅笔图标 **Edit this file**。
3. 找到这几行：
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "md-notes"
   database_id = ""
   ```
   把第 2 步复制的 ID 粘贴到 `database_id = ""` 的引号之间，变成：
   ```toml
   database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
   ```
4. 右上角 **Commit changes…** → 再点一次 **Commit changes**。

> 为什么要手填？控制台部署使用 Cloudflare 自动生成的 API 令牌，它有 Workers 权限但没有 D1 的创建权限，所以不能像命令行那样自动建库。填了 ID 之后部署过程完全不需要碰 D1 接口。

### 第 4 步：从仓库创建 Worker

1. 左侧菜单 **Workers & Pages（Workers 和 Pages）** → 右上角 **Create application（创建应用程序）**。
2. 保持在 **Workers** 标签页，找到 **Import a repository（导入存储库）**，点 **Get started**。
3. 选择 **Git account**。首次使用会跳到 GitHub 授权页：安装 **Cloudflare Workers & Pages** 应用，选择 **Only select repositories** 并勾选 `md-notes`（或 All repositories），点 **Install & Authorize**。
4. 回到 Cloudflare，在仓库列表里选中 **md-notes**（可以用搜索框过滤）。
5. 填写构建设置（Set up your build）：

   | 字段 | 填什么 | 说明 |
   | --- | --- | --- |
   | **Project name（项目名）** | `md-notes` | **必须与 `wrangler.toml` 里的 `name` 完全一致**，否则构建报错 |
   | **Production branch（生产分支）** | `main` | 默认值。如果你的仓库默认分支叫 `master`，改成 `master` |
   | **Build command（构建命令）** | 留空 | 本项目没有构建步骤 |
   | **Deploy command（部署命令）** | `npx wrangler deploy` | 默认值，不用改 |
   | **Root directory（根目录）** | 留空 | 代码就在仓库根目录 |
   | **Build variables and secrets** | 不填 | 这是构建期变量，**不是**运行时的 `AUTH_PASSWORD`，下一步再设 |

6. 点 **Save and Deploy（保存并部署）**。

### 第 5 步：等待构建完成

页面会跳到 Worker 的 **Deployments** 视图，显示构建进度。Cloudflare 会自动 `npm install` 再执行 `npx wrangler deploy`，通常 1 分钟内出现绿色的 **Success**。

完成后，在 Worker 页面顶部能看到网址 `https://md-notes.<你的子域>.workers.dev`。点开它——此时页面会显示 **"服务端还没有配置访问密码"**，这是正常的，说明部署成功、只差密码。

如果构建失败，点进去看日志，对照文末 [常见报错](#常见报错) 处理。

### 第 6 步：设置登录密码

1. 在 Worker 页面点 **Settings（设置）** 标签。
2. 找到 **Variables and Secrets（变量和机密）** → 点 **Add（添加）**。
3. **Type（类型）** 选 **Secret**，**Variable name** 填 `AUTH_PASSWORD`，**Value** 填你的访问密码。
4. 点 **Deploy（部署）**。Cloudflare 会立即用新的环境变量重新发布 Worker，几秒即可生效。

> 类型选 Secret 之后，值在控制台和命令行里都不再可见，只能覆盖不能查看，所以请自己记好密码。

### 第 7 步：登录使用

刷新刚才的网址，输入密码，进入笔记本。第一次进入时数据表会自动创建。

- 左上角 **+** 新建笔记，输入即自动保存
- 顶部 **编辑 / 分栏 / 预览** 切换视图
- **导出** 下载当前笔记为 `.md`
- 手机浏览器打开同一个网址即可使用，也可以"添加到主屏幕"

### 第 8 步（可选）：绑定自己的域名

`workers.dev` 域名在部分地区访问不稳定。如果你有一个域名并且 DNS 已托管在 Cloudflare：

1. Worker 页面 → **Settings** → **Domains & Routes（域和路由）** → **Add（添加）** → **Custom Domain（自定义域）**。
2. 输入一个子域名，例如 `notes.example.com` → **Add domain**。
3. 等待状态变成 Active（通常 1 分钟内），证书自动签发。之后用这个域名访问即可。

---

## 日常维护

| 想做什么 | 操作 |
| --- | --- |
| 更新代码 | 在 GitHub 上编辑并提交，Cloudflare 自动重新构建部署；也可以在 Worker → **Deployments** → 底部 **View build history** → 某次构建右侧 **⋯** → **Retry build** |
| 换密码 | Worker → **Settings** → **Variables and Secrets** → `AUTH_PASSWORD` 右侧编辑 → 输入新值 → **Deploy**。所有设备需要重新登录 |
| 查看数据 | **Storage & Databases** → **D1 SQL Database** → `md-notes` → **Tables** → `notes`，可以直接浏览每一行；**Console** 里可以执行 SQL |
| 备份 | 在 D1 的 **Console** 执行 `SELECT * FROM notes` 后导出结果；或者在应用里逐篇 **导出**；也可以用 README 里的接口写脚本批量导出 |
| 看日志 | Worker → **Observability**（或 **Logs**）标签，能看到每个请求和 `console.error` 输出 |
| 看用量 | Worker → **Metrics**；D1 → 数据库页面 → **Metrics** |
| 删除重来 | Worker → **Settings** → 最底部 **Delete**；D1 → 数据库 → **Settings** → **Delete** |

## 常见报错

**构建日志里出现 `The name in your Wrangler configuration file (md-notes) must match the name of your Worker`**
第 4 步的 Project name 和 `wrangler.toml` 里的 `name = "md-notes"` 不一致。两种修法：在 GitHub 上把 `wrangler.toml` 的 `name` 改成你的项目名；或者删掉这个 Worker，重新导入时项目名填 `md-notes`。

**构建日志里出现 D1 相关错误，例如 `database_id` 无效、`couldn't find a D1 DB` 或 `not found`**
第 3 步没填、填错、或多了空格。核对 `database_id` 与 D1 页面显示的 ID 完全一致后提交，构建会自动重跑。

**构建日志里出现 `Missing entry-point` 或找不到 `wrangler.toml`**
第 1 步上传时文件没放在仓库根目录（例如多套了一层 `md-notes/` 文件夹）。要么把文件移到根目录，要么在 Worker → **Settings** → **Build** → Root directory 填那层文件夹名。

**页面一直显示"服务端还没有配置访问密码"**
第 6 步没做，或者变量名拼错（必须是大写的 `AUTH_PASSWORD`），或者添加后没点 **Deploy**。

**输入密码后提示"密码错误"，但确定没输错**
Secret 是重新部署后才生效的，等几秒再试；如果同时在 `wrangler.toml` 的 `[vars]` 里也写了 `AUTH_PASSWORD`，两处会互相冲突，只保留一种设置方式。

**网址打不开 / 很慢**
`workers.dev` 在部分地区被干扰，按第 8 步绑定自己的域名。

**GitHub 授权页看不到我的仓库**
安装 Cloudflare Workers & Pages 应用时选了 Only select repositories 但没勾上这个仓库。到 GitHub → Settings → Applications → Cloudflare Workers & Pages → Configure，加上它。

## 费用

以上所有资源都在 Cloudflare 免费套餐内：Workers 每天 10 万次请求（静态文件不计入）、D1 5 GB 存储与每天 10 万次写入、Workers Builds 每月 3,000 分钟构建时长。个人笔记远用不完，也不需要绑定信用卡。额度以 [官方定价页](https://developers.cloudflare.com/workers/platform/pricing/) 为准。
