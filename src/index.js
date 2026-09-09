/**
 * MD Notes — Cloudflare Worker 后端。
 *
 * 前端静态文件由 Workers Static Assets 直接托管（见 wrangler.toml 的 [assets]），
 * 这里只处理 /api/* 接口，数据保存在 D1（SQLite）。
 *
 * 单用户设计：唯一的凭据是环境变量 AUTH_PASSWORD（用 wrangler secret 或 [vars] 设置），
 * 没有注册接口，也没有用户表。AUTH_PASSWORD 未配置时除 status 外的接口一律返回 503。
 *
 * 接口一览（除 auth 外都需要 `Authorization: Bearer <token>`）：
 *   GET    /api/auth/status      服务端是否已配置密码
 *   POST   /api/auth/login       { password } -> { token }
 *   GET    /api/notes?q=关键词    笔记列表（按更新时间倒序，可搜索）
 *   POST   /api/notes            { content } -> 新笔记
 *   GET    /api/notes/:id        单篇笔记
 *   PUT    /api/notes/:id        { content } -> { id, title, updated_at }
 *   DELETE /api/notes/:id
 */

const MAX_CONTENT_LENGTH = 1_000_000; // 字符数；D1 单行上限约 2MB
const LIST_LIMIT = 500;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS notes (
    id         TEXT PRIMARY KEY,
    title      TEXT    NOT NULL DEFAULT '',
    content    TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes (updated_at DESC)`,
];

const NOTE_COLUMNS = 'id, title, content, created_at, updated_at';
const LIST_COLUMNS = 'id, title, substr(content, 1, 200) AS excerpt, created_at, updated_at';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// 每个 isolate 只建一次表；失败则下一个请求重试。
let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    try {
      return await handleApi(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: '服务器内部错误' }, 500);
    }
  },
};

async function handleApi(request, env, url) {
  const { method } = request;
  const path = url.pathname.replace(/\/+$/, '');

  if (path === '/api/auth/status') {
    return json({ configured: Boolean(env.AUTH_PASSWORD) });
  }
  if (!env.AUTH_PASSWORD) {
    throw new HttpError(503, '服务端未配置访问密码（环境变量 AUTH_PASSWORD）');
  }
  if (path === '/api/auth/login') {
    if (method !== 'POST') throw new HttpError(405, '方法不允许');
    return login(request, env);
  }

  if (!(await isAuthorized(request, env))) {
    throw new HttpError(401, '未授权');
  }
  await ensureSchema(env.DB);

  if (path === '/api/notes') {
    if (method === 'GET') return listNotes(env.DB, url.searchParams.get('q'));
    if (method === 'POST') return createNote(env.DB, await readJson(request));
    throw new HttpError(405, '方法不允许');
  }

  const match = path.match(/^\/api\/notes\/([0-9a-fA-F-]{36})$/);
  if (match) {
    const id = match[1];
    if (method === 'GET') return getNote(env.DB, id);
    if (method === 'PUT') return updateNote(env.DB, id, await readJson(request));
    if (method === 'DELETE') return deleteNote(env.DB, id);
    throw new HttpError(405, '方法不允许');
  }

  throw new HttpError(404, '接口不存在');
}

// ---------- 鉴权 ----------

async function isAuthorized(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return false;
  return safeEqual(token, await tokenFor(env.AUTH_PASSWORD));
}

async function login(request, env) {
  const { password } = await readJson(request);
  if (typeof password !== 'string' || !password) throw new HttpError(400, '请输入密码');
  const expected = await tokenFor(env.AUTH_PASSWORD);
  if (!safeEqual(await tokenFor(password), expected)) throw new HttpError(401, '密码错误');
  return json({ token: expected });
}

// 令牌 = SHA-256(密码) 的十六进制，浏览器里只保存令牌而不是明文密码。
async function tokenFor(password) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(ab, bb);
  }
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

// ---------- 笔记 ----------

async function listNotes(db, q) {
  const keyword = (q || '').trim();
  let stmt;
  if (keyword) {
    const pattern = `%${keyword.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    stmt = db
      .prepare(
        `SELECT ${LIST_COLUMNS} FROM notes
         WHERE title LIKE ?1 ESCAPE '\\' OR content LIKE ?1 ESCAPE '\\'
         ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}`,
      )
      .bind(pattern);
  } else {
    stmt = db.prepare(`SELECT ${LIST_COLUMNS} FROM notes ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}`);
  }
  const { results } = await stmt.all();
  return json({ notes: results });
}

async function getNote(db, id) {
  const note = await db.prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ?1`).bind(id).first();
  if (!note) throw new HttpError(404, '笔记不存在');
  return json(note);
}

async function createNote(db, body) {
  const content = normalizeContent(body.content);
  const now = Date.now();
  const note = {
    id: crypto.randomUUID(),
    title: deriveTitle(content),
    content,
    created_at: now,
    updated_at: now,
  };
  await db
    .prepare('INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(note.id, note.title, note.content, note.created_at, note.updated_at)
    .run();
  return json(note, 201);
}

async function updateNote(db, id, body) {
  const content = normalizeContent(body.content);
  const title = deriveTitle(content);
  const now = Date.now();
  const { meta } = await db
    .prepare('UPDATE notes SET title = ?2, content = ?3, updated_at = ?4 WHERE id = ?1')
    .bind(id, title, content, now)
    .run();
  if (!meta.changes) throw new HttpError(404, '笔记不存在');
  return json({ id, title, updated_at: now });
}

async function deleteNote(db, id) {
  const { meta } = await db.prepare('DELETE FROM notes WHERE id = ?1').bind(id).run();
  if (!meta.changes) throw new HttpError(404, '笔记不存在');
  return new Response(null, { status: 204 });
}

// ---------- 工具 ----------

function normalizeContent(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new HttpError(400, 'content 必须是字符串');
  if (value.length > MAX_CONTENT_LENGTH) throw new HttpError(413, '笔记内容过长');
  return value.replace(/\r\n?/g, '\n');
}

// 取第一行有效文字作标题，去掉标题井号、列表/引用符号和强调标记。
// 下划线只去掉词首词尾的（_强调_），保留 snake_case 里的。
// 前端 app.js 里有一份相同的实现，改动时请同步。
function deriveTitle(content) {
  const line = content.split('\n').find((l) => l.trim().length > 0);
  if (!line) return '';
  return line
    .trim()
    .replace(/^(#{1,6}|>|[-*+]|\d+[.)])\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/[*`~]+/g, '')
    .replace(/(^|\s)_+|_+(?=\s|$)/g, '$1')
    .trim()
    .slice(0, 100);
}

async function readJson(request) {
  let data;
  try {
    data = await request.json();
  } catch {
    throw new HttpError(400, '请求体必须是 JSON');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(400, '请求体必须是 JSON 对象');
  }
  return data;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
