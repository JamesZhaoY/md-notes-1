/* MD Notes 前端逻辑：登录、笔记列表、编辑与自动保存、Markdown 预览。 */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const STORAGE = { token: 'mdnotes.token', view: 'mdnotes.view', last: 'mdnotes.lastNote' };
  const SAVE_DELAY = 800;
  const SEARCH_DELAY = 250;

  const els = {
    app: $('#app'),
    sidebar: $('#sidebar'),
    list: $('#note-list'),
    search: $('#search'),
    newBtn: $('#new-note'),
    emptyNewBtn: $('#empty-new'),
    count: $('#note-count'),
    logout: $('#logout'),
    workspace: $('#workspace'),
    panes: $('#panes'),
    editor: $('#editor'),
    preview: $('#preview'),
    empty: $('#empty'),
    status: $('#save-status'),
    words: $('#word-count'),
    seg: $('#view-seg'),
    exportBtn: $('#export'),
    deleteBtn: $('#delete'),
    menuBtn: $('#menu'),
    backdrop: $('#backdrop'),
    login: $('#login'),
    loginForm: $('#login-form'),
    loginFields: $('#login-fields'),
    loginUnconfigured: $('#login-unconfigured'),
    loginPwd: $('#login-password'),
    loginErr: $('#login-error'),
  };

  const state = {
    token: localStorage.getItem(STORAGE.token) || '',
    notes: [],
    current: null,
    dirty: false,
    saveTimer: 0,
    saving: null,
    query: '',
    view: localStorage.getItem(STORAGE.view) || 'split',
  };

  const mobile = window.matchMedia('(max-width: 768px)');
  let openSeq = 0;

  // ---------- Markdown ----------

  marked.use({ gfm: true, breaks: true });
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });

  function renderPreview() {
    els.preview.innerHTML = DOMPurify.sanitize(marked.parse(els.editor.value || ''));
  }

  let renderQueued = false;
  function renderPreviewSoon() {
    if (renderQueued || effectiveView() === 'edit') return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderPreview();
    });
  }

  // ---------- API ----------

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  async function api(path, { method = 'GET', body, keepalive = false } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (state.token) headers.authorization = `Bearer ${state.token}`;
    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive,
    });
    if (res.status === 401) {
      onUnauthorized();
      throw new ApiError(401, '未授权');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || `请求失败 (${res.status})`);
    return data;
  }

  // ---------- 登录 ----------

  // unconfigured=true 时不显示密码框，只提示管理员去设置环境变量 AUTH_PASSWORD
  function showLogin({ unconfigured = false } = {}) {
    els.app.hidden = true;
    els.login.hidden = false;
    els.loginFields.hidden = unconfigured;
    els.loginUnconfigured.hidden = !unconfigured;
    els.loginErr.textContent = '';
    if (!unconfigured) setTimeout(() => els.loginPwd.focus(), 0);
  }

  function onUnauthorized() {
    state.token = '';
    localStorage.removeItem(STORAGE.token);
    showLogin();
  }

  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.loginErr.textContent = '';
    const password = els.loginPwd.value;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '登录失败');
      state.token = data.token || '';
      if (state.token) localStorage.setItem(STORAGE.token, state.token);
      els.loginPwd.value = '';
      await enter();
    } catch (err) {
      els.loginErr.textContent = err.message;
      els.loginPwd.select();
    }
  });

  els.logout.addEventListener('click', async () => {
    await flushSave();
    state.token = '';
    localStorage.removeItem(STORAGE.token);
    state.notes = [];
    state.current = null;
    showLogin();
  });

  // ---------- 列表 ----------

  function byId(id) {
    return state.notes.find((n) => n.id === id);
  }

  function sortNotes() {
    state.notes.sort((a, b) => b.updated_at - a.updated_at);
  }

  function relTime(ts) {
    const diff = Date.now() - ts;
    const m = 60e3;
    const h = 60 * m;
    const d = 24 * h;
    if (diff < m) return '刚刚';
    if (diff < h) return `${Math.floor(diff / m)} 分钟前`;
    if (diff < d) return `${Math.floor(diff / h)} 小时前`;
    if (diff < 7 * d) return `${Math.floor(diff / d)} 天前`;
    const dt = new Date(ts);
    const md = `${dt.getMonth() + 1}月${dt.getDate()}日`;
    return dt.getFullYear() === new Date().getFullYear() ? md : `${dt.getFullYear()}年${md}`;
  }

  // 与后端 src/index.js 的 deriveTitle 保持一致。
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

  // 列表里的摘要：跳过标题行，取正文的开头。
  function excerptOf(text) {
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    return lines
      .slice(1)
      .join(' ')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#*`>~\-|]+/g, ' ')
      .replace(/(^|\s)_+|_+(?=\s|$)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  function renderList() {
    els.list.textContent = '';
    if (!state.notes.length) {
      const li = document.createElement('li');
      li.className = 'list-empty';
      li.textContent = state.query ? '没有匹配的笔记' : '还没有笔记，点右上角 + 新建一篇';
      els.list.append(li);
    } else {
      const frag = document.createDocumentFragment();
      for (const note of state.notes) frag.append(buildItem(note));
      els.list.append(frag);
    }
    els.count.textContent = state.query
      ? `找到 ${state.notes.length} 篇`
      : `${state.notes.length} 篇笔记`;
  }

  function buildItem(note) {
    const li = document.createElement('li');
    li.className = 'note-item';
    li.dataset.id = note.id;
    li.setAttribute('role', 'option');
    const title = document.createElement('div');
    title.className = 'title';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const time = document.createElement('span');
    time.className = 'time';
    const excerpt = document.createElement('span');
    excerpt.className = 'excerpt';
    meta.append(time, excerpt);
    li.append(title, meta);
    fillItem(li, note);
    return li;
  }

  function fillItem(li, note) {
    const title = li.querySelector('.title');
    title.textContent = note.title || '无标题';
    title.classList.toggle('untitled', !note.title);
    li.querySelector('.time').textContent = relTime(note.updated_at);
    li.querySelector('.excerpt').textContent = excerptOf(note.excerpt || '');
    li.classList.toggle('active', Boolean(state.current) && state.current.id === note.id);
    li.setAttribute('aria-selected', li.classList.contains('active'));
  }

  function patchItem(id) {
    const note = byId(id);
    const li = els.list.querySelector(`[data-id="${id}"]`);
    if (note && li) fillItem(li, note);
  }

  function updateActive() {
    for (const li of els.list.querySelectorAll('.note-item')) {
      const active = Boolean(state.current) && li.dataset.id === state.current.id;
      li.classList.toggle('active', active);
      li.setAttribute('aria-selected', active);
    }
  }

  async function loadNotes() {
    const q = state.query;
    const data = await api(`/notes${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    if (q !== state.query) return; // 搜索词已变化，忽略过期结果
    state.notes = data.notes;
    renderList();
  }

  els.list.addEventListener('click', (e) => {
    const li = e.target.closest('.note-item');
    if (li) selectNote(li.dataset.id);
  });

  let searchTimer = 0;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = els.search.value.trim();
      loadNotes().catch(reportError);
    }, SEARCH_DELAY);
  });

  // 每分钟刷新一次“x 分钟前”
  setInterval(() => {
    for (const li of els.list.querySelectorAll('.note-item')) {
      const note = byId(li.dataset.id);
      if (note) li.querySelector('.time').textContent = relTime(note.updated_at);
    }
  }, 60e3);

  // ---------- 打开 / 新建 / 删除 ----------

  async function selectNote(id) {
    if (state.current && state.current.id === id) {
      closeSidebar();
      return;
    }
    const seq = ++openSeq;
    await flushSave();
    let note;
    try {
      note = await api(`/notes/${id}`);
    } catch (err) {
      if (err.status === 404) {
        state.notes = state.notes.filter((n) => n.id !== id);
        renderList();
      }
      reportError(err);
      return;
    }
    if (seq !== openSeq) return; // 期间用户又点了别的笔记
    openNote(note);
  }

  function openNote(note) {
    clearTimeout(state.saveTimer);
    state.current = { ...note };
    state.dirty = false;
    els.editor.value = note.content;
    renderPreview();
    els.editor.scrollTop = 0;
    els.preview.scrollTop = 0;
    updateWordCount();
    setStatus('saved');
    showWorkspace(true);
    updateActive();
    closeSidebar();
    localStorage.setItem(STORAGE.last, note.id);
    if (!mobile.matches) els.editor.focus();
  }

  async function createNote() {
    await flushSave();
    const note = await api('/notes', { method: 'POST', body: { content: '' } });
    if (state.query) {
      state.query = '';
      els.search.value = '';
      await loadNotes();
    }
    if (!byId(note.id)) {
      state.notes.unshift({ ...note, excerpt: '' });
      renderList();
    }
    openNote(note);
    els.editor.focus();
  }

  async function deleteCurrent() {
    if (!state.current) return;
    const title = state.current.title || '无标题';
    if (!window.confirm(`确定删除「${title}」？删除后无法恢复。`)) return;
    const id = state.current.id;
    clearTimeout(state.saveTimer);
    state.dirty = false;
    if (state.saving) await state.saving.catch(() => {});
    await api(`/notes/${id}`, { method: 'DELETE' });
    const idx = state.notes.findIndex((n) => n.id === id);
    if (idx >= 0) state.notes.splice(idx, 1);
    state.current = null;
    localStorage.removeItem(STORAGE.last);
    renderList();
    const next = state.notes[Math.min(idx, state.notes.length - 1)];
    if (next && !mobile.matches) {
      await selectNote(next.id);
    } else {
      showWorkspace(false);
      if (mobile.matches) openSidebar();
    }
  }

  function exportCurrent() {
    if (!state.current) return;
    const content = els.editor.value;
    const name = (deriveTitle(content) || '无标题').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.md`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  els.newBtn.addEventListener('click', () => createNote().catch(reportError));
  els.emptyNewBtn.addEventListener('click', () => createNote().catch(reportError));
  els.deleteBtn.addEventListener('click', () => deleteCurrent().catch(reportError));
  els.exportBtn.addEventListener('click', exportCurrent);

  function showWorkspace(show) {
    els.panes.hidden = !show;
    els.empty.hidden = show;
    els.status.hidden = !show;
    els.words.hidden = !show;
    els.exportBtn.disabled = !show;
    els.deleteBtn.disabled = !show;
    els.seg.classList.toggle('disabled', !show);
  }

  // ---------- 编辑与保存 ----------

  function setStatus(kind, message) {
    const text = {
      saved: '已保存',
      saving: '保存中…',
      dirty: '未保存',
      error: `保存失败${message ? `：${message}` : ''}`,
    };
    els.status.textContent = text[kind];
    els.status.dataset.kind = kind;
  }

  function updateWordCount() {
    const n = els.editor.value.replace(/\s+/g, '').length;
    els.words.textContent = n ? `${n} 字` : '';
  }

  function scheduleSave() {
    state.dirty = true;
    setStatus('dirty');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => saveNow().catch(reportError), SAVE_DELAY);
  }

  async function saveNow({ keepalive = false } = {}) {
    clearTimeout(state.saveTimer);
    if (!state.current || !state.dirty) return;
    if (state.saving) {
      await state.saving.catch(() => {});
      if (!state.dirty) return;
    }
    const note = state.current;
    const content = els.editor.value;
    setStatus('saving');
    state.saving = api(`/notes/${note.id}`, {
      method: 'PUT',
      body: { content },
      keepalive: keepalive && content.length < 60_000, // keepalive 请求体上限 64KB
    })
      .then((res) => {
        const item = byId(note.id);
        if (item) {
          item.title = res.title;
          item.updated_at = res.updated_at;
          item.excerpt = content.slice(0, 200);
          sortNotes();
          renderList();
        }
        if (state.current && state.current.id === note.id) {
          state.current.title = res.title;
          state.current.updated_at = res.updated_at;
          state.current.content = content;
          if (els.editor.value === content) {
            state.dirty = false;
            setStatus('saved');
          } else {
            scheduleSave(); // 保存期间又有输入
          }
        }
      })
      .catch((err) => {
        if (err.status !== 401) setStatus('error', err.message);
      })
      .finally(() => {
        state.saving = null;
      });
    return state.saving;
  }

  async function flushSave() {
    if (state.dirty) await saveNow();
    else if (state.saving) await state.saving.catch(() => {});
  }

  els.editor.addEventListener('input', () => {
    if (!state.current) return;
    renderPreviewSoon();
    updateWordCount();
    const item = byId(state.current.id);
    if (item) {
      item.title = deriveTitle(els.editor.value);
      item.excerpt = els.editor.value.slice(0, 200);
      patchItem(item.id);
    }
    scheduleSave();
  });

  // Tab 插入两个空格（Shift+Tab 仍可移出编辑器）
  els.editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const { selectionStart, selectionEnd } = els.editor;
      els.editor.setRangeText('  ', selectionStart, selectionEnd, 'end');
      els.editor.dispatchEvent(new Event('input'));
    }
  });

  // 分栏模式下按比例同步预览滚动位置
  els.editor.addEventListener('scroll', () => {
    if (effectiveView() !== 'split') return;
    const ed = els.editor;
    const max = ed.scrollHeight - ed.clientHeight;
    if (max <= 0) return;
    els.preview.scrollTop = (ed.scrollTop / max) * (els.preview.scrollHeight - els.preview.clientHeight);
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveNow().catch(reportError);
    }
  });

  // 切到后台或关闭页面前尽量把改动发出去
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.dirty) saveNow({ keepalive: true }).catch(() => {});
  });
  window.addEventListener('pagehide', () => {
    if (state.dirty) saveNow({ keepalive: true }).catch(() => {});
  });

  // ---------- 视图 ----------

  function effectiveView() {
    return mobile.matches && state.view === 'split' ? 'edit' : state.view;
  }

  function applyView() {
    const view = effectiveView();
    els.workspace.dataset.view = view;
    for (const btn of els.seg.querySelectorAll('[data-view]')) {
      btn.classList.toggle('active', btn.dataset.view === view);
    }
    if (view !== 'edit' && state.current) renderPreview();
  }

  els.seg.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    state.view = btn.dataset.view;
    localStorage.setItem(STORAGE.view, state.view);
    applyView();
  });

  mobile.addEventListener('change', applyView);

  function openSidebar() {
    els.app.classList.add('sidebar-open');
  }

  function closeSidebar() {
    els.app.classList.remove('sidebar-open');
  }

  els.menuBtn.addEventListener('click', () => els.app.classList.toggle('sidebar-open'));
  els.backdrop.addEventListener('click', closeSidebar);

  // ---------- 启动 ----------

  function reportError(err) {
    if (err && err.status === 401) return;
    console.error(err);
    setStatus('error', err && err.message);
  }

  async function enter() {
    els.login.hidden = true;
    els.app.hidden = false;
    await loadNotes();
    const lastId = localStorage.getItem(STORAGE.last);
    const first = byId(lastId) || state.notes[0];
    if (first && !mobile.matches) {
      await selectNote(first.id);
    } else {
      showWorkspace(false);
      if (mobile.matches) openSidebar();
    }
  }

  async function init() {
    applyView();
    let configured = true;
    try {
      const res = await fetch('/api/auth/status');
      configured = Boolean((await res.json()).configured);
    } catch {
      // 状态接口不可用时照常往下走，由后续请求报错
    }
    if (!configured) {
      showLogin({ unconfigured: true });
      return;
    }
    if (!state.token) {
      showLogin();
      return;
    }
    await enter();
  }

  init().catch((err) => {
    if (err && err.status === 401) return;
    console.error(err);
    els.app.hidden = false;
    showWorkspace(false);
    setStatus('error', err && err.message);
  });
})();
