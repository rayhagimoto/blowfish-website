import Vditor from 'vditor';
import { createAuthClient } from 'better-auth/client';
import { twoFactorClient } from 'better-auth/client/plugins';
import QRCode from 'qrcode';
import katex from 'katex';
import { extractPhotoMetadata } from '../photo-metadata.mjs';
import './app.css';

const OWNER = 'rayhagimoto@gmail.com';
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const state = { user: null, tab: 'posts', posts: [], media: [], gallery: null, gallerySelection: new Set(), gallerySelectionAnchor: null, galleryBusy: false, editor: null, post: null,
  dirty: false, savePromise: null, saveTimer: null, conflict: false, editVersion: 0, theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', font: 'mono', mode: 'ir', uploads: 0, editorReady: false, editorMarkdown: '', navigating: false };
window.addEventListener('appearancechange', () => setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
const setupToken = new URLSearchParams(location.hash.slice(1)).get('setup') || '';
if (setupToken) history.replaceState(null, '', location.pathname + location.search);
// Vditor does not forward these limits to KaTeX. Supply its global renderer with
// fixed safe options, and mark it loaded so the editor does not replace it.
window.katex = { ...katex, renderToString: (math, options) => katex.renderToString(math,
  { ...options, trust: false, maxExpand: 1000, maxSize: 20 }) };
const katexMarker = document.createElement('meta'); katexMarker.id = 'vditorKatexScript'; document.head.append(katexMarker);
const auth = createAuthClient({ baseURL: `${location.origin}/api/auth`,
  plugins: [twoFactorClient({ onTwoFactorRedirect: () => challengeView() })] });

function esc(value = '') { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function notice(message, error = false) {
  const element = document.querySelector('#notice');
  element.textContent = message; element.hidden = false; element.dataset.error = String(error);
  clearTimeout(notice.timer); notice.timer = setTimeout(() => { element.hidden = true; }, error ? 12000 : 5500);
}
async function api(path, options = {}) {
  const { body, ...rest } = options;
  const response = await fetch(`/api/cms${path}`, { credentials: 'same-origin', cache: 'no-store', ...rest,
    headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || `Request failed (${response.status}).`);
    error.status = response.status; error.code = data.error?.code;
    if (response.status === 401) notice('Your session expired. Copy any unsaved work before signing in again.', true);
    throw error;
  }
  return data;
}
async function authCall(promise) { const result = await promise; if (result.error) throw new Error(result.error.message || 'Authentication failed.'); return result.data; }
function bindAction(selector, handler, scope = document) {
  scope.querySelector(selector)?.addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try { await handler(event); } catch (error) { notice(error.message, true); }
    finally { if (button.isConnected) button.disabled = false; }
  });
}
function bindForm(selector, handler, scope = document) {
  scope.querySelector(selector)?.addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('[type=submit]');
    button.disabled = true; const errorNode = form.querySelector('.form-error'); if (errorNode) errorNode.textContent = '';
    try { await handler(new FormData(form), form); }
    catch (error) { if (errorNode) errorNode.textContent = error.message; else notice(error.message, true); }
    finally { if (button.isConnected) button.disabled = false; }
  });
}
function field(label, name, value = '', extra = '', type = 'text') {
  return `<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function authFrame(title, description, content) {
  destroyEditor(); state.user = null;
  app.innerHTML = `<main class="auth-wrap"><section class="auth-card"><div class="brand-mark" aria-hidden="true">RH</div>
    <p class="eyebrow">Private studio</p><h1>${title}</h1><p class="muted">${description}</p>${content}
    <p class="muted" style="margin-top:1.6rem;margin-bottom:0;font-size:.78rem"><a href="/">Return to the public website</a></p></section></main>`;
}
async function loadSession() {
  const session = await api('/session');
  if (session.requiresMfa) return challengeView();
  if (!session.authenticated) return signInView();
  if (session.requiresEnrollment || !session.user.twoFactorEnabled) return enrollmentView();
  state.user = session.user; state.dirty = false; shell(); await navigate('posts');
}
function signInView() {
  authFrame('Welcome back.', 'Sign in to write, publish, and curate your photographs.', `<form id="signin" class="stack">
    ${field('Email', 'email', OWNER, 'required autocomplete="username"', 'email')}
    ${field('Password', 'password', '', 'required autocomplete="current-password"', 'password')}
    <p class="form-error" role="alert"></p><button class="primary" type="submit">Sign in securely</button></form>`);
  bindForm('#signin', async values => {
    const result = await authCall(auth.signIn.email({ email: values.get('email'), password: values.get('password') }));
    if (result?.twoFactorRedirect) challengeView(); else await loadSession();
  });
}
function setupView() {
  authFrame('Make this studio yours.', 'Create the sole administrator account, then secure it with an authenticator app.', `<form id="setup" class="stack">
    ${field('Administrator email', 'email', OWNER, 'readonly autocomplete="username"', 'email')}
    ${field('Setup token', 'token', '', 'required autocomplete="off"', 'password')}
    ${field('Your name', 'name', 'Ray Hagimoto', 'required maxlength="100" autocomplete="name"')}
    ${field('New password', 'password', '', 'required minlength="12" maxlength="128" autocomplete="new-password"', 'password')}
    <small>Use a unique password of at least 12 characters.</small><p class="form-error" role="alert"></p>
    <button class="primary" type="submit">Create administrator</button></form>`);
  document.querySelector('[name=token]').value = setupToken;
  bindForm('#setup', async (values, form) => { await api('/setup', { method: 'POST', body: {
    token: values.get('token'), name: values.get('name'), password: values.get('password') } });
    form.reset(); await loadSession(); });
}
function challengeView(recovery = false) {
  authFrame(recovery ? 'Use a recovery code.' : 'Verify it’s you.', recovery
    ? 'Each recovery code can be used once. Keep the remaining codes in a safe place.'
    : 'Enter the current six-digit code from your authenticator app.', `<form id="challenge" class="stack">
    ${field(recovery ? 'Recovery code' : 'Authenticator code', 'code', '', recovery
      ? 'required autocomplete="off"' : 'required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"')}
    <label class="check"><input type="checkbox" name="trust">Trust this browser for up to 30 days. Only use this on a private device.</label>
    <p class="form-error" role="alert"></p><button class="primary" type="submit">Verify and sign in</button>
    <button id="recovery-toggle" type="button" class="quiet">${recovery ? 'Use authenticator instead' : 'Use a recovery code'}</button>
    <button id="signin-back" type="button" class="quiet">Back to sign in</button></form>`);
  bindForm('#challenge', async values => {
    const details = { code: String(values.get('code')).trim(), trustDevice: values.has('trust') };
    await authCall(recovery ? auth.twoFactor.verifyBackupCode(details) : auth.twoFactor.verifyTotp(details));
    await loadSession();
  });
  bindAction('#recovery-toggle', () => challengeView(!recovery)); bindAction('#signin-back', () => signInView());
}
function enrollmentView() {
  authFrame('Protect your studio.', 'Two-factor authentication is required before you can access posts or photographs.', `<form id="enroll-start" class="stack">
    ${field('Confirm your password', 'password', '', 'required autocomplete="current-password"', 'password')}
    <p class="form-error" role="alert"></p><button class="primary" type="submit">Set up authenticator</button>
    <button id="enroll-signout" type="button" class="quiet">Sign out</button></form>`);
  bindForm('#enroll-start', async (values, form) => {
    const result = await authCall(auth.twoFactor.enable({ password: values.get('password') }));
    form.reset(); await enrollmentVerifyView(result);
  });
  bindAction('#enroll-signout', signOut);
}
async function enrollmentVerifyView({ totpURI, backupCodes }) {
  authFrame('Scan. Save. Verify.', 'Scan this QR code with your authenticator app. Save your recovery codes before continuing.', `
    <canvas id="totp-qr" class="qr" aria-label="Authenticator setup QR code"></canvas>
    <details><summary>Can’t scan the QR code?</summary><p class="muted">Enter this secret in your authenticator app:</p><pre id="totp-secret"></pre></details>
    <h2 style="margin-top:1.5rem">Recovery codes</h2><pre class="recovery-codes" id="recovery-codes"></pre>
    <button id="download-codes" type="button">Download recovery codes</button>
    <form id="enroll-verify" class="stack" style="margin-top:1.3rem">
    <label class="check"><input type="checkbox" required name="saved">I saved these codes in a secure place.</label>
    ${field('Authenticator code', 'code', '', 'required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"')}
    <p class="form-error" role="alert"></p><button class="primary" type="submit">Verify and open studio</button></form>`);
  document.querySelector('#recovery-codes').textContent = backupCodes.join('\n');
  document.querySelector('#totp-secret').textContent = new URL(totpURI).searchParams.get('secret');
  await QRCode.toCanvas(document.querySelector('#totp-qr'), totpURI, { width: 220, margin: 2, color: { dark: '#142b23', light: '#ffffff' } });
  bindAction('#download-codes', () => download('studio-recovery-codes.txt', `Ray Hagimoto CMS recovery codes\nStore privately. Each code works once.\n\n${backupCodes.join('\n')}\n`));
  bindForm('#enroll-verify', async values => {
    await authCall(auth.twoFactor.verifyTotp({ code: values.get('code') })); backupCodes.fill(''); await loadSession();
  });
}
function download(filename, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function destroyEditor() { clearTimeout(state.saveTimer); state.editor?.destroy(); state.editor = null; }
async function signOut() {
  if (state.navigating) return;
  setNavigating(true);
  try {
  if (!await leaveDirtyView()) return;
  await authCall(auth.signOut()); destroyEditor(); state.post = null; state.media = []; state.gallery = null; state.posts = [];
  signInView();
  } finally { setNavigating(false); }
}
function shell() {
  app.innerHTML = `<header class="header"><div class="wordmark"><div class="brand-mark" aria-hidden="true">RH</div>
    <span>Studio<small>Ray Hagimoto</small></span></div><div class="actions"><small class="identity">${esc(state.user.email)}</small>
    <button id="theme-toggle" class="quiet" aria-label="Switch color theme">${state.theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
    <button id="signout" class="quiet">Sign out</button></div></header>
    <div class="shell"><nav class="sidebar" aria-label="Studio sections"><button data-tab="posts">Journal</button>
    <button data-tab="gallery">Photo gallery</button><button data-tab="media">Image library</button><button data-tab="security">Security</button>
    <small>A space to write and curate.<br>Video uploads are planned for a future release.</small></nav>
    <main id="content" class="content" tabindex="-1"></main></div>`;
  bindAction('#theme-toggle', () => {
    setTheme(state.theme === 'dark' ? 'light' : 'dark');
    localStorage.setItem('appearance', state.theme);
  });
  bindAction('#signout', signOut);
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.tab).catch(error => notice(error.message, true))));
}
function setTheme(theme) {
  state.theme = theme; document.documentElement.classList.toggle('dark', theme === 'dark');
  const toggle = document.querySelector('#theme-toggle');
  if (toggle) toggle.textContent = theme === 'dark' ? 'Light theme' : 'Dark theme';
  state.editor?.setTheme(theme === 'dark' ? 'dark' : 'classic', theme === 'dark' ? 'dark' : 'light');
  document.querySelector('#safe-preview-frame')?.contentDocument?.documentElement.classList.toggle('dark', theme === 'dark');
}
function openDialog(title, content) {
  modal.classList.toggle('gallery-dialog', state.tab === 'gallery');
  modal.innerHTML = `<h2 id="modal-title">${title}</h2><button class="quiet modal-close" type="button" aria-label="Close dialog">${state.tab === 'gallery' ? galleryIcon('close') : '×'}</button>${content}`;
  modal.querySelector('.modal-close').addEventListener('click', () => modal.close()); modal.showModal(); return modal;
}
async function confirmAction(title, message, label = 'Confirm') {
  openDialog(title, `<p>${esc(message)}</p><div class="actions"><button id="cancel-confirm">Cancel</button><button id="accept-confirm" class="primary">${esc(label)}</button></div>`);
  return new Promise(resolve => {
    let accepted = false;
    modal.querySelector('#cancel-confirm').addEventListener('click', () => modal.close());
    modal.querySelector('#accept-confirm').addEventListener('click', () => { accepted = true; modal.close(); });
    modal.addEventListener('close', () => resolve(accepted), { once: true });
  });
}
async function leaveDirtyView() {
  if (state.tab === 'gallery' && state.galleryBusy) { notice('Wait for the gallery action to finish before leaving.', true); return false; }
  if (state.uploads) { notice('Wait for the image upload to finish before leaving.', true); return false; }
  if (state.tab === 'editor' && state.dirty && !state.conflict) {
    try { await savePost(); } catch { /* The confirmation below keeps failed saves visible. */ }
  }
  if (!state.dirty) return true;
  const leave = await confirmAction('Unsaved changes', 'Some changes have not been saved. Stay to save or download your work, or discard the changes to leave.', 'Discard and leave');
  if (leave) state.dirty = false; return leave;
}
async function navigate(tab) {
  if (state.navigating) return;
  setNavigating(true);
  try {
  if (!await leaveDirtyView()) return;
  destroyEditor(); state.post = null; state.tab = tab; state.conflict = false;
  document.querySelectorAll('[data-tab]').forEach(button => {
    if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  const content = document.querySelector('#content'); content.innerHTML = '<p class="muted" aria-live="polite">Loading…</p>';
  if (tab === 'posts') await postsView();
  else if (tab === 'gallery') await galleryView();
  else if (tab === 'media') await mediaView();
  else if (tab === 'security') await securityView();
  content.focus({ preventScroll: true });
  } finally { setNavigating(false); }
}
function setNavigating(busy) {
  state.navigating = busy;
  document.querySelectorAll('[data-tab],#signout,#back-posts').forEach(button => { button.disabled = busy; });
}
function heading(title, description, actions = '') {
  return `<div class="page-heading"><div><p class="eyebrow">Your studio</p><h1>${title}</h1><p class="muted">${description}</p></div><div class="actions">${actions}</div></div>`;
}
function postBadge(post) { return post.publishedAt ? (post.hasChanges ? 'Published · draft changes' : 'Published') : 'Draft'; }
async function postsView() {
  state.posts = (await api('/posts')).posts;
  document.querySelector('#content').innerHTML = heading('Your journal.', 'Ideas, stories, and notes in progress.', '<button id="new-post" class="primary">New post</button>') +
    `<label class="field" style="max-width:400px;margin-bottom:1.2rem">Find a post<input id="post-search" type="search" placeholder="Search titles or tags"></label><div id="post-list" class="post-list"></div>`;
  const renderList = (query = '') => {
    const posts = state.posts.filter(post => `${post.title} ${(post.tags || []).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
    document.querySelector('#post-list').innerHTML = posts.length ? posts.map(post => `<button class="post-row" data-post="${esc(post.id)}">
      <span><strong>${esc(post.title || 'Untitled')}</strong><small>${esc(post.date?.slice(0, 10))} ${post.tags?.length ? ` · ${esc(post.tags.join(', '))}` : ''}</small></span>
      <span class="badge">${postBadge(post)}</span></button>`).join('') : '<div class="empty">No posts yet. Start with a new story.</div>';
    document.querySelectorAll('[data-post]').forEach(button => button.addEventListener('click', () => openPost(button.dataset.post).catch(error => notice(error.message, true))));
  };
  renderList(); document.querySelector('#post-search').addEventListener('input', event => renderList(event.target.value));
  bindAction('#new-post', newPostDialog);
}
function slugify(value) { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function newPostDialog() {
  openDialog('Start a post', `<form id="new-post-form" class="stack">${field('Title', 'title', '', 'required maxlength="200"')}
    ${field('URL slug', 'slug', '', 'required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxlength="120"')}
    <small>The slug becomes the public post address.</small><p class="form-error" role="alert"></p>
    <button type="submit" class="primary">Create draft</button></form>`);
  let changed = false; modal.querySelector('[name=slug]').addEventListener('input', () => { changed = true; });
  modal.querySelector('[name=title]').addEventListener('input', event => { if (!changed) modal.querySelector('[name=slug]').value = slugify(event.target.value); });
  bindForm('#new-post-form', async values => {
    const { post } = await api('/posts', { method: 'POST', body: { title: values.get('title'), slug: values.get('slug'), description: '', markdown: '', tags: [], date: new Date().toISOString().slice(0, 10) } });
    modal.close(); await openPost(post.id);
  }, modal);
}
async function openPost(id) {
  if (state.navigating) return;
  setNavigating(true);
  try {
  if (!await leaveDirtyView()) return;
  destroyEditor(); const { post } = await api(`/posts/${encodeURIComponent(id)}`); state.post = post; state.tab = 'editor'; state.dirty = false;
  state.conflict = false; state.editVersion = 0;
  document.querySelector('#content').innerHTML = `<div class="actions" style="margin-bottom:1.3rem"><button id="back-posts" class="quiet">← Journal</button><span id="post-badge" class="badge">${postBadge(post)}</span></div>` +
    heading('Make room for an idea.', 'Markdown, mathematics, and photographs in one place.', `<button id="save-post" disabled>Save draft</button><button id="publish-post" class="primary" disabled>Publish</button>`) +
    (post.imported ? '<aside class="panel" role="note">This post uses existing website formatting. Editing the body converts it to the safe Markdown format; review equations, embeds, and shortcodes before publishing.</aside>' : '') +
    `<div id="conflict-box" class="conflict" hidden><p>A newer version exists on the server. Autosave is paused to protect both versions. Download your draft, then reload the server version and reconcile your changes.</p><div class="actions"><button id="download-draft">Download my draft</button><button id="reload-post">Reload server version</button></div></div>
    <div class="editor-meta"><div class="wide">${field('Title', 'title', post.title, 'required maxlength="200"')}</div>
    ${field('URL slug', 'slug', post.slug, 'required maxlength="120" pattern="[a-z0-9]+(?:-[a-z0-9]+)*"')}
    ${field('Date', 'date', post.date?.slice(0, 10), 'required', 'date')}
    <div class="wide"><label class="field">Description<textarea name="description" maxlength="500">${esc(post.description)}</textarea></label></div>
    <div class="wide">${field('Tags', 'tags', (post.tags || []).join(', '), 'placeholder="photography, travel, mathematics"')}</div></div>
    <div class="editor-tools"><div class="actions"><label>Editor mode <select id="editor-mode" disabled><option value="ir">Live preview · hybrid</option><option value="sv">Markdown source</option><option value="split">Source + preview</option><option value="wysiwyg">Rich text</option></select></label>
    <label>Source font <select id="source-font"><option value="mono">Unicode monospace</option><option value="sans">Unicode sans serif</option><option value="serif">Unicode serif</option></select></label></div>
    <button id="safe-preview">Published preview</button></div><div id="save-status" class="save-status" role="status">All changes saved</div>
    <div id="markdown-editor"></div><iframe id="safe-preview-frame" class="preview-frame" title="Safe published preview" sandbox="allow-same-origin" hidden></iframe>
    <div class="actions" style="margin-top:1rem"><button id="insert-equation">Insert equation</button><button id="insert-library">Insert library image</button><button id="export-post">Download Markdown</button></div>
    <p class="muted" style="margin-top:1rem;font-size:.8rem">Drop or paste images into the editor. Write inline equations with $…$ and display equations with $$…$$. Drafts stay private until you publish.</p>
    <div class="panel" style="margin-top:2rem"><div class="actions"><button id="unpublish-post" ${post.publishedAt ? '' : 'hidden'}>Unpublish</button><button id="delete-post" class="danger">Delete post</button></div></div>`;
  document.querySelector('#editor-mode').value = state.mode; document.querySelector('#source-font').value = state.font;
  document.querySelectorAll('.editor-meta input,.editor-meta textarea').forEach(element => element.addEventListener('input', changedPost));
  try { await createEditor(post.markdown || ''); } catch (error) { notice(error.message, true); }
  bindAction('#back-posts', () => navigate('posts')); bindAction('#save-post', savePost);
  bindAction('#publish-post', () => publishPost(false)); bindAction('#unpublish-post', () => publishPost(true));
  bindAction('#delete-post', async () => {
    if (!await confirmAction('Delete this post?', 'This removes the draft and its published version. This action cannot be undone.', 'Delete post')) return;
    clearTimeout(state.saveTimer); if (state.savePromise) await state.savePromise;
    await api(`/posts/${encodeURIComponent(state.post.id)}`, { method: 'DELETE', body: { revision: state.post.revision } }); state.dirty = false; await navigate('posts'); notice('Post deleted.');
  });
  bindAction('#safe-preview', safePreview);
  bindAction('#insert-equation', () => { state.editor.insertValue('\n$$\nE = mc^2\n$$\n'); changedPost(); });
  bindAction('#insert-library', () => mediaPicker(media => { state.editor.insertValue(`![${markdownLabel(media.filename)}](${media.url})\n`); changedPost(); }));
  bindAction('#export-post', () => downloadPost(false));
  bindAction('#download-draft', () => downloadPost(true));
  bindAction('#reload-post', async () => { if (await confirmAction('Reload the server version?', 'Download your draft first. Your unsaved local changes will be discarded.', 'Reload')) { state.dirty = false; await openPost(state.post.id); } });
  document.querySelector('#editor-mode').addEventListener('change', async event => {
    const markdown = currentPost().markdown; state.mode = event.target.value;
    setNavigating(true);
    try { await createEditor(markdown); } catch (error) { notice(error.message, true); }
    finally { setNavigating(false); }
  });
  document.querySelector('#source-font').addEventListener('change', event => { state.font = event.target.value; setSourceFont(); });
  } finally { setNavigating(false); }
}
function setSourceFont() { const editor = document.querySelector('#markdown-editor'); editor.classList.toggle('source-serif', state.font === 'serif'); editor.classList.toggle('source-sans', state.font === 'sans'); }
async function createEditor(markdown) {
  state.editorReady = false; state.editorMarkdown = markdown; clearTimeout(state.saveTimer);
  const controls = [...document.querySelectorAll('#content button,.editor-meta input,.editor-meta textarea,.editor-tools select')];
  controls.forEach(element => { element.disabled = true; });
  document.querySelector('#markdown-editor').inert = true; setSaveStatus('Loading editor…');
  state.editor?.destroy();
  let settled = false;
  let timeout;
  try {
  await new Promise((resolve, reject) => {
    timeout = setTimeout(() => { settled = true; reject(new Error('The editor could not load. Download your draft before reloading, or try another editor mode.')); }, 20000);
    state.editor = new Vditor('markdown-editor', { cdn: '/admin/vendor/vditor', lang: 'en_US', mode: state.mode === 'split' ? 'sv' : state.mode,
      theme: state.theme === 'dark' ? 'dark' : 'classic', value: markdown, minHeight: 480,
      cache: { enable: false }, resize: { enable: true }, counter: { enable: true, type: 'text' },
      placeholder: 'Begin with a thought…', link: { isOpen: false },
      toolbar: ['headings', 'bold', 'italic', 'strike', '|', 'link', 'quote', 'list', 'ordered-list', 'check', '|', 'code', 'inline-code', 'table', 'upload', '|', 'undo', 'redo', 'fullscreen'],
      preview: { mode: state.mode === 'split' ? 'both' : 'editor', delay: 350, actions: [],
        markdown: { sanitize: true, codeBlockPreview: false }, math: { engine: 'KaTeX', trust: false, maxExpand: 1000, maxSize: 20 }, theme: { current: state.theme === 'dark' ? 'dark' : 'light' }, render: { media: { enable: false } } },
      upload: { accept: 'image/jpeg,image/png,image/webp', multiple: true, max: 30 * 1024 * 1024,
        handler: async files => {
          try { for (const file of files) { const media = await uploadImage(file); state.editor.insertValue(`![${markdownLabel(file.name)}](${media.url})\n`); changedPost(); } }
          catch (error) { notice(error.message, true); return esc(error.message); }
          return null;
        } },
      input: changedPost,
      after: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout); state.editorReady = true; setSourceFont();
        controls.forEach(element => { element.disabled = false; });
        document.querySelector('#markdown-editor').inert = false;
        setSaveStatus(state.dirty ? 'Unsaved changes' : 'All changes saved');
        if (state.dirty && !state.conflict) state.saveTimer = setTimeout(() => savePost().catch(() => {}), 1300);
        resolve();
      },
    });
  });
  } catch (error) {
    clearTimeout(timeout);
    settled = true; controls.forEach(element => { if (element.isConnected) element.disabled = false; });
    for (const id of ['save-post', 'publish-post', 'unpublish-post', 'insert-equation', 'insert-library']) {
      const element = document.getElementById(id); if (element) element.disabled = true;
    }
    setSaveStatus('Editor unavailable. Your Markdown is preserved and can be downloaded.', true);
    throw error;
  }
}
function currentPost() {
  const values = Object.fromEntries([...document.querySelectorAll('.editor-meta [name]')].map(element => [element.name, element.value]));
  return { ...values, tags: values.tags.split(',').map(tag => tag.trim()).filter(Boolean), markdown: state.editorReady ? state.editor.getValue() : state.editorMarkdown, revision: state.post.revision };
}
function downloadPost(draft) {
  const post = currentPost(); const frontmatter = ['title', 'slug', 'description', 'tags', 'date'].map(key => `${key}: ${JSON.stringify(post[key])}`).join('\n');
  download(`${state.post.slug}${draft ? '-draft' : ''}.md`, `---\n${frontmatter}\n---\n\n${post.markdown}`);
}
function changedPost() {
  state.dirty = true; state.editVersion++; setSaveStatus(state.conflict ? 'Resolve the version conflict before saving.' : 'Unsaved changes');
  clearTimeout(state.saveTimer); if (!state.conflict) state.saveTimer = setTimeout(() => savePost().catch(() => {}), 1300);
}
function setSaveStatus(message, error = false) { const element = document.querySelector('#save-status'); if (element) { element.textContent = message; element.dataset.state = error ? 'error' : 'normal'; } }
async function savePost() {
  clearTimeout(state.saveTimer);
  if (state.conflict) throw new Error('Resolve the version conflict before saving.');
  if (!state.editorReady) throw new Error('Wait for the editor to finish loading before saving.');
  if (state.savePromise) { await state.savePromise; if (state.dirty) return savePost(); return; }
  if (!state.dirty) return;
  const invalid = [...document.querySelectorAll('.editor-meta input,.editor-meta textarea')].find(element => !element.checkValidity());
  if (invalid) { invalid.reportValidity(); throw new Error('Complete the post details before saving.'); }
  const version = state.editVersion; const snapshot = currentPost(); const postId = state.post.id;
  setSaveStatus('Saving draft…');
  state.savePromise = (async () => {
    try {
      const { post } = await api(`/posts/${encodeURIComponent(postId)}`, { method: 'PATCH', body: snapshot });
      state.post = post; state.dirty = state.editVersion !== version;
      document.querySelector('#post-badge').textContent = postBadge(post);
      setSaveStatus(state.dirty ? 'More changes waiting to save…' : `Saved at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    } catch (error) {
      if (error.status === 409) { state.conflict = true; document.querySelector('#conflict-box').hidden = false; }
      setSaveStatus(`Save failed: ${error.message} Your edits are still in this browser tab.`, true); notice(error.message, true); throw error;
    } finally { state.savePromise = null; }
  })();
  await state.savePromise;
  if (state.dirty && !state.conflict) return savePost();
}
async function publishPost(unpublish) {
  if (state.uploads) throw new Error('Wait for image uploads to finish before publishing.');
  await savePost();
  if (!await confirmAction(unpublish ? 'Unpublish this post?' : 'Publish this post?', unpublish
    ? 'The next successful website build will remove this post from the public website.'
    : 'Your saved draft will become public after the next successful website build.', unpublish ? 'Unpublish' : 'Publish')) return;
  const { post, build } = await api(`/posts/${encodeURIComponent(state.post.id)}/${unpublish ? 'unpublish' : 'publish'}`, { method: 'POST', body: { revision: state.post.revision } });
  state.post = post; document.querySelector('#post-badge').textContent = postBadge(post); document.querySelector('#unpublish-post').hidden = !post.publishedAt;
  notice(build?.message || (build?.queued ? 'Publication saved. Website build queued.' : 'Publication saved. A website build is needed to update the public site.'));
}
async function safePreview() {
  const frame = document.querySelector('#safe-preview-frame');
  if (!frame.hidden) { frame.hidden = true; document.querySelector('#safe-preview').textContent = 'Published preview'; return; }
  const { html } = await api('/preview', { method: 'POST', body: { markdown: currentPost().markdown } });
  // Same-origin access lets private image requests carry admin cookies. Scripts
  // remain blocked by both the sandbox and this preview-specific policy.
  frame.srcdoc = `<!doctype html><html lang="en" class="${state.theme === 'dark' ? 'dark' : ''}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><link rel="stylesheet" href="/admin/vendor/vditor/dist/js/katex/katex.min.css"><link rel="stylesheet" href="/admin/app.css"><style>body{font-size:18px;line-height:1.5;padding:2rem;max-width:800px;margin:auto;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{overflow:auto;background:var(--surface);padding:1rem}blockquote{border-left:3px solid var(--accent);padding-left:1rem}table{border-collapse:collapse}td,th{border:1px solid var(--line);padding:.5rem}</style></head><body>${html}</body></html>`;
  frame.hidden = false; document.querySelector('#safe-preview').textContent = 'Hide published preview';
}
function markdownLabel(value) { return String(value).replace(/[\[\]\\\r\n]/g, '').replace(/\.[^.]+$/, ''); }
async function prepareImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPEG, PNG, or WebP image. Video uploads are planned for later.');
  if (file.size > 30 * 1024 * 1024) throw new Error('Choose an image smaller than 30 MB.');
  if (file.size <= 3.8 * 1024 * 1024) return file;
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('This image could not be read. Export it as a JPEG or PNG and try again.'); }
  if (bitmap.width * bitmap.height > 80_000_000) { bitmap.close(); throw new Error('This image is too large to process in your browser. Resize it and try again.'); }
  const canvas = document.createElement('canvas'); const scale = Math.min(1, 4000 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  let blob;
  for (const quality of [.9, .8, .65, .5]) {
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
    if (blob && blob.size <= 3.8 * 1024 * 1024) break;
  }
  if (!blob || blob.size > 3.8 * 1024 * 1024) throw new Error('This image is too large after compression. Resize it and try again.');
  notice('Large image resized for the free upload limit.');
  return new File([blob], `${markdownLabel(file.name) || 'image'}.webp`, { type: 'image/webp' });
}
async function uploadImage(file) {
  state.uploads++;
  try {
    const metadata = file.size > 3.8 * 1024 * 1024 && file.size <= 30 * 1024 * 1024 ? await extractPhotoMetadata(new Uint8Array(await file.arrayBuffer())) : null;
    const upload = await prepareImage(file); const body = new FormData(); body.append('file', upload);
    if (metadata) body.append('metadata', JSON.stringify(metadata));
    const { media } = await api('/media', { method: 'POST', body }); return media;
  } finally { state.uploads--; }
}
function safeImageUrl(media) {
  if (typeof media.url !== 'string' || !media.url.startsWith('/') || /[\\\u0000-\u0020]/.test(media.url)) return '';
  const url = new URL(media.url, location.origin); return url.origin === location.origin ? url.pathname + url.search : '';
}
function imageCard(media, body, attributes = '') {
  return `<article class="image-card" ${attributes}><img src="${esc(safeImageUrl(media))}" alt="${esc(media.filename || '')}" loading="lazy"><div class="card-body">${body}</div></article>`;
}
async function mediaPicker(onSelect, title = 'Choose an image') {
  const { media } = await api('/media');
  openDialog(title, `<p class="muted">Select a photograph from your image library.</p><div class="media-grid">${media.map(item => imageCard(item,
    `<small>${esc(item.filename)}</small><button type="button" data-select-media="${esc(item.id)}" style="margin-top:.6rem">Select image</button>`)).join('') || '<p>No images yet. Upload images in the image library first.</p>'}</div>`);
  modal.querySelectorAll('[data-select-media]').forEach(button => button.addEventListener('click', () => { const selected = media.find(item => item.id === button.dataset.selectMedia); modal.close(); onSelect(selected); }));
}
async function mediaView() {
  state.media = (await api('/media')).media;
  document.querySelector('#content').innerHTML = heading('A library of moments.', 'Upload once. Use your images in posts and galleries.') +
    `<div id="image-drop" class="drop-zone" tabindex="0" aria-label="Image upload area. Drop images or paste from the clipboard."><div><strong>Drop images here, or paste from your clipboard.</strong><p class="muted">JPEG, PNG, or WebP. Larger images are resized before upload.</p></div><button id="choose-images">Choose images</button><input id="image-files" class="file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple></div>
    <p id="upload-status" class="muted" role="status"></p><div id="media-grid" class="media-grid"></div>`;
  renderMedia();
  const input = document.querySelector('#image-files'); const zone = document.querySelector('#image-drop');
  bindAction('#choose-images', () => input.click()); input.addEventListener('change', () => libraryUploads([...input.files]).finally(() => { input.value = ''; }));
  zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', event => { event.preventDefault(); zone.classList.remove('drag-over'); libraryUploads([...event.dataTransfer.files]); });
  zone.addEventListener('paste', event => { const files = [...event.clipboardData.items].filter(item => item.kind === 'file').map(item => item.getAsFile()); if (files.length) { event.preventDefault(); libraryUploads(files); } });
}
async function libraryUploads(files) {
  const status = document.querySelector('#upload-status');
  for (let index = 0; index < files.length; index++) {
    status.textContent = `Uploading ${index + 1} of ${files.length}…`;
    try { const media = await uploadImage(files[index]); state.media.unshift(media); renderMedia(); }
    catch (error) { notice(`${files[index].name}: ${error.message}`, true); }
  }
  status.textContent = 'Upload complete.';
}
function renderMedia() {
  document.querySelector('#media-grid').innerHTML = state.media.map(media => imageCard(media,
    `<h3>${esc(media.filename)}</h3><small>${media.width || '?'} × ${media.height || '?'} · ${Math.round((media.size || 0) / 1024)} KB</small>
    <div class="actions"><button data-copy="${esc(media.id)}">Copy link</button><button data-add-gallery="${esc(media.id)}">Add to gallery</button><button class="danger" data-delete-media="${esc(media.id)}">Delete</button></div>`)).join('') || '<div class="empty">Your image library is ready for its first photograph.</div>';
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(new URL(state.media.find(media => media.id === button.dataset.copy).url, location.origin).href); notice('Image link copied.'); }
    catch { notice('Could not copy the link. Your browser may require clipboard permission.', true); }
  }));
  document.querySelectorAll('[data-add-gallery]').forEach(button => button.addEventListener('click', async () => {
    try { await navigate('gallery'); addGalleryMedia(state.media.find(media => media.id === button.dataset.addGallery)); }
    catch (error) { notice(error.message, true); }
  }));
  document.querySelectorAll('[data-delete-media]').forEach(button => button.addEventListener('click', async () => {
    try {
      const id = button.dataset.deleteMedia;
      if (!await confirmAction('Delete this image?', 'Images referenced by a post or gallery cannot be deleted. Unreferenced uploads are permanently removed.', 'Delete image')) return;
      await api(`/media/${encodeURIComponent(id)}`, { method: 'DELETE' }); state.media = state.media.filter(media => media.id !== id); renderMedia(); notice('Image deleted.');
    } catch (error) { notice(error.message, true); }
  }));
}
function galleryIcon(name) {
  const paths = {
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    library: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
    publish: '<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>',
    edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-3 3 5 5"/>',
    albums: '<path d="M3 7V5a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M8 13h8m-4-4v8"/>',
    up: '<path d="m6 10 6-6 6 6M12 4v16"/>', down: '<path d="m6 14 6 6 6-6M12 4v16"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
function galleryButton(id, icon, label, extra = '') {
  return `<button id="${id}" class="gallery-icon ${extra}" type="button" aria-label="${label}" title="${label}">${galleryIcon(icon)}</button>`;
}
function bindGalleryAction(selector, handler) {
  document.querySelector(selector).addEventListener('click', async () => {
    if (state.galleryBusy) return;
    state.galleryBusy = true; updateGalleryToolbar();
    try { await handler(); } catch (error) { notice(error.message, true); }
    finally { state.galleryBusy = false; updateGalleryToolbar(); }
  });
}
async function galleryView() {
  const [result, media] = await Promise.all([api('/gallery'), api('/media')]); state.gallery = result.gallery; state.media = media.media;
  state.gallerySelection.clear(); state.gallerySelectionAnchor = null;
  document.querySelector('#content').innerHTML = `<section class="gallery-page" id="gallery-workspace">` +
    heading('Curate the gallery.', 'Click photos to edit; use checkboxes to select.',
      galleryButton('gallery-upload', 'upload', 'Upload photos') + galleryButton('gallery-library', 'library', 'Choose library photos') +
      galleryButton('gallery-save', 'save', 'Save draft') + galleryButton('gallery-publish', 'publish', 'Publish gallery', 'gallery-publish')) +
    `<input class="file-input" id="gallery-files" type="file" accept="image/jpeg,image/png,image/webp" multiple tabindex="-1" aria-label="Upload photo files">
    <div id="gallery-conflict" class="conflict" hidden><p>A newer gallery draft exists. Download your local gallery details before reloading the server version.</p><div class="actions"><button id="download-gallery">Download my gallery</button><button id="reload-gallery">Reload server version</button></div></div>
    <div class="gallery-toolbar" role="group" aria-label="Gallery actions">
      <label class="gallery-select-all"><input id="gallery-select-all" type="checkbox" aria-label="Select all visible photographs"><span id="gallery-selection-count" aria-live="polite">Select photos</span></label>
      <div class="gallery-selection-actions">${galleryButton('gallery-edit', 'edit', 'Edit selected photographs')}${galleryButton('gallery-albums', 'albums', 'Change albums for selected photographs')}${galleryButton('gallery-up', 'up', 'Move selected photographs up')}${galleryButton('gallery-down', 'down', 'Move selected photographs down')}${galleryButton('gallery-remove', 'trash', 'Remove selected photographs from gallery', 'danger')}</div>
      <label class="gallery-filter"><span class="sr-only">Album</span><select id="gallery-album" aria-label="Album"><option value="">All photographs</option></select></label>
    </div>
    <div class="gallery-info"><p class="muted">Drop photos here or use the upload icon. Albums are optional.</p><span id="gallery-status" class="save-status" role="status"></span></div>
    <p id="gallery-upload-status" class="muted" role="status" hidden></p>
    <div id="gallery-grid" class="gallery-grid"></div><div class="gallery-drop-overlay" aria-hidden="true">Drop photographs to upload</div></section>`;
  renderGallery();
  bindGalleryAction('#gallery-upload', () => document.querySelector('#gallery-files').click());
  bindGalleryAction('#gallery-library', galleryLibraryDialog);
  bindGalleryAction('#gallery-save', saveGallery); bindGalleryAction('#gallery-publish', publishGallery);
  bindGalleryAction('#gallery-edit', editGallerySelection); bindGalleryAction('#gallery-albums', galleryAlbumsDialog);
  bindGalleryAction('#gallery-up', () => moveGallerySelection(-1)); bindGalleryAction('#gallery-down', () => moveGallerySelection(1));
  bindGalleryAction('#gallery-remove', () => {
    const count = state.gallerySelection.size;
    state.gallery.items = state.gallery.items.filter(item => !state.gallerySelection.has(item.mediaId)); state.gallerySelection.clear(); state.gallerySelectionAnchor = null;
    galleryChanged(); renderGallery(); notice(`${count} ${count === 1 ? 'photograph removed' : 'photographs removed'} from the gallery draft. Library originals are kept.`);
  });
  document.querySelector('#gallery-album').addEventListener('change', () => { state.gallerySelection.clear(); state.gallerySelectionAnchor = null; renderGallery(); });
  document.querySelector('#gallery-select-all').addEventListener('change', event => {
    state.gallerySelection = new Set(event.target.checked ? visibleGalleryItems().map(item => item.mediaId) : []); state.gallerySelectionAnchor = null; updateGalleryToolbar();
  });
  document.querySelector('#gallery-files').addEventListener('change', async event => {
    await galleryUploadFiles([...event.target.files]); event.target.value = '';
  });
  const workspace = document.querySelector('#gallery-workspace'); let dragDepth = 0;
  const filesDragged = event => [...event.dataTransfer.types].includes('Files');
  workspace.addEventListener('dragenter', event => { if (filesDragged(event)) { event.preventDefault(); dragDepth++; workspace.classList.add('drag-over'); } });
  workspace.addEventListener('dragover', event => { if (filesDragged(event)) { event.preventDefault(); event.dataTransfer.dropEffect = state.galleryBusy ? 'none' : 'copy'; } });
  workspace.addEventListener('dragleave', event => { if (filesDragged(event) && --dragDepth <= 0) { dragDepth = 0; workspace.classList.remove('drag-over'); } });
  workspace.addEventListener('drop', event => {
    if (!filesDragged(event)) return;
    event.preventDefault(); dragDepth = 0; workspace.classList.remove('drag-over'); galleryUploadFiles([...event.dataTransfer.files]);
  });
  bindAction('#download-gallery', () => download('gallery-draft.json', JSON.stringify(state.gallery, null, 2)));
  bindAction('#reload-gallery', async () => { if (await confirmAction('Reload the server gallery?', 'Download your draft first. Unsaved local changes will be discarded.', 'Reload')) { state.dirty = false; state.conflict = false; await galleryView(); } });
}
function updateGalleryStatus() {
  document.querySelector('#gallery-status').textContent = state.dirty ? 'Unsaved gallery changes' : state.gallery.hasChanges ? 'Draft saved · not yet published' : state.gallery.publishedAt ? 'Published' : 'Draft saved';
}
function galleryChanged() { state.dirty = true; state.editVersion++; updateGalleryStatus(); }
function addGalleryMedia(media) {
  if (!media) return;
  if (state.gallery.items.some(item => item.mediaId === media.id)) { notice('This photograph is already in the gallery.'); return; }
  const metadata = structuredClone(media.metadata || {});
  state.gallery.items.push({ mediaId: media.id, title: markdownLabel(media.filename), description: '', location: metadata.location || '', date: metadata.date || '', albums: [], metadata });
  galleryChanged(); renderGallery(); return media.id;
}
async function galleryUploadFiles(files) {
  if (!files.length) return;
  if (state.galleryBusy) { notice('Wait for the current gallery action to finish.', true); return; }
  state.galleryBusy = true; state.uploads++; state.gallerySelection.clear(); state.gallerySelectionAnchor = null; document.querySelector('#gallery-album').value = '';
  const status = document.querySelector('#gallery-upload-status'); status.hidden = false; updateGalleryToolbar(); let added = 0; const failures = [];
  try {
    for (let index = 0; index < files.length; index++) {
      status.textContent = `Uploading ${index + 1} of ${files.length}…`;
      try {
        const media = await uploadImage(files[index]); state.media.unshift(media);
        const id = addGalleryMedia(media); if (id) { state.gallerySelection.add(id); added++; }
      } catch (error) { failures.push(`${files[index].name}: ${error.message}`); }
    }
    status.textContent = `${added} ${added === 1 ? 'photograph added' : 'photographs added'} to the gallery draft. Select an action to edit details or add albums.`;
    if (failures.length) { status.textContent += ` ${failures.length} upload(s) failed.`; notice(failures.join(' '), true); }
  } finally { state.uploads--; state.galleryBusy = false; renderGallery(); }
}
async function galleryLibraryDialog() {
  state.media = (await api('/media')).media;
  const available = state.media.filter(media => !state.gallery.items.some(item => item.mediaId === media.id));
  openDialog('Choose library photos', `<p class="muted">Select photographs to add to your gallery draft. Albums are optional.</p><div class="media-grid gallery-library-grid">${available.map(media =>
    `<label class="image-card gallery-photo"><img src="${esc(safeImageUrl(media))}" alt="${esc(media.filename)}" loading="lazy" draggable="false"><input type="checkbox" class="gallery-photo-check" name="library-photo" value="${esc(media.id)}" aria-label="Select ${esc(media.filename)}"><span class="gallery-photo-details"><strong>${esc(media.filename)}</strong></span></label>`).join('') || '<p class="muted">All library photographs are already in your gallery.</p>'}</div><div class="actions"><button id="gallery-library-add" class="primary" disabled>Add selected photographs</button></div>`);
  const selected = () => [...modal.querySelectorAll('[name=library-photo]:checked')].map(input => input.value);
  modal.querySelectorAll('[name=library-photo]').forEach(input => input.addEventListener('change', () => { modal.querySelector('#gallery-library-add').disabled = !selected().length; }));
  bindAction('#gallery-library-add', () => {
    const ids = selected(); document.querySelector('#gallery-album').value = ''; state.gallerySelection.clear(); state.gallerySelectionAnchor = null;
    ids.forEach(id => { if (addGalleryMedia(state.media.find(media => media.id === id))) state.gallerySelection.add(id); });
    modal.close(); renderGallery();
  }, modal);
}
function visibleGalleryItems() {
  const album = document.querySelector('#gallery-album').value;
  return state.gallery.items.filter(item => !album || item.albums?.includes(album));
}
function updateGalleryToolbar() {
  const items = visibleGalleryItems(); const visible = new Set(items.map(item => item.mediaId));
  state.gallerySelection.forEach(id => { if (!visible.has(id)) state.gallerySelection.delete(id); });
  if (!visible.has(state.gallerySelectionAnchor)) state.gallerySelectionAnchor = null;
  const count = state.gallerySelection.size; const busy = state.galleryBusy;
  document.querySelector('#gallery-selection-count').textContent = count ? `${count} selected` : 'Select photos';
  const all = document.querySelector('#gallery-select-all'); all.checked = !!items.length && count === items.length; all.indeterminate = count > 0 && count < items.length; all.disabled = busy || !items.length;
  document.querySelectorAll('#gallery-grid .gallery-photo-check').forEach(input => { input.checked = state.gallerySelection.has(input.value); input.disabled = busy; input.closest('.gallery-photo').classList.toggle('selected', input.checked); });
  document.querySelectorAll('.gallery-page .gallery-icon,#gallery-grid .gallery-photo-hit').forEach(button => { button.disabled = busy; });
  document.querySelector('#gallery-album').disabled = busy;
  ['edit', 'albums', 'remove'].forEach(action => { document.querySelector(`#gallery-${action}`).disabled = busy || !count; });
  for (const [action, direction] of [['up', -1], ['down', 1]]) {
    const movable = state.gallery.items.some((item, index, list) => state.gallerySelection.has(item.mediaId) && list[index + direction] && !state.gallerySelection.has(list[index + direction].mediaId));
    document.querySelector(`#gallery-${action}`).disabled = busy || !!document.querySelector('#gallery-album').value || !movable;
  }
}
function renderGallery() {
  const filter = document.querySelector('#gallery-album'); const selected = filter.value;
  const albums = [...new Set(state.gallery.items.flatMap(item => item.albums || []))].sort();
  filter.innerHTML = '<option value="">All photographs</option>' + albums.map(album => `<option value="${esc(album)}">${esc(album)}</option>`).join(''); filter.value = albums.includes(selected) ? selected : '';
  if (filter.value !== selected) { state.gallerySelection.clear(); state.gallerySelectionAnchor = null; }
  document.querySelector('#gallery-grid').innerHTML = visibleGalleryItems().map(item => {
    const media = state.media.find(media => media.id === item.mediaId);
    return `<article class="image-card gallery-photo"><button class="gallery-photo-hit" type="button" data-gallery-edit="${esc(item.mediaId)}" aria-label="Edit ${esc(item.title || 'Untitled')} attributes"><img src="${esc(safeImageUrl(media || { url: '' }))}" alt="${esc(item.title || 'Untitled')}" loading="lazy" draggable="false">
      <span class="gallery-photo-details"><strong>${esc(item.title || 'Untitled')}</strong>${[item.location, item.date?.slice(0, 10), (item.albums || []).join(' · ')].filter(Boolean).map(detail => `<small>${esc(detail)}</small>`).join('')}</span></button>
      <input class="gallery-photo-check" type="checkbox" value="${esc(item.mediaId)}" aria-label="Select ${esc(item.title || 'Untitled')}" title="Shift-click to select a range"></article>`;
  }).join('') || '<div class="empty">Upload photos or choose from your library to begin.</div>';
  document.querySelectorAll('#gallery-grid .gallery-photo-check').forEach(input => input.addEventListener('click', event => {
    const items = visibleGalleryItems(); const anchor = items.findIndex(item => item.mediaId === state.gallerySelectionAnchor);
    const index = items.findIndex(item => item.mediaId === input.value); const checked = input.checked;
    const range = event.shiftKey && anchor >= 0 ? items.slice(Math.min(anchor, index), Math.max(anchor, index) + 1) : [items[index]];
    range.forEach(item => { if (checked) state.gallerySelection.add(item.mediaId); else state.gallerySelection.delete(item.mediaId); });
    if (!event.shiftKey || anchor < 0) state.gallerySelectionAnchor = input.value;
    updateGalleryToolbar();
  }));
  document.querySelectorAll('#gallery-grid [data-gallery-edit]').forEach(button => button.addEventListener('click', () => {
    if (!state.galleryBusy) editGalleryItem(state.gallery.items.findIndex(item => item.mediaId === button.dataset.galleryEdit));
  }));
  updateGalleryStatus(); updateGalleryToolbar();
}
function moveGallerySelection(direction) {
  const items = state.gallery.items;
  for (let step = 0; step < items.length; step++) {
    const index = direction < 0 ? step : items.length - 1 - step; const neighbor = index + direction;
    if (items[neighbor] && state.gallerySelection.has(items[index].mediaId) && !state.gallerySelection.has(items[neighbor].mediaId)) [items[index], items[neighbor]] = [items[neighbor], items[index]];
  }
  galleryChanged(); renderGallery();
}
function editGallerySelection() {
  const ids = new Set(state.gallerySelection);
  if (ids.size === 1) return editGalleryItem(state.gallery.items.findIndex(item => ids.has(item.mediaId)));
  openDialog(`Edit ${ids.size} photographs`, `<form id="gallery-batch-details" class="stack"><p class="muted">Only checked fields will change. Each photograph keeps its other details and camera metadata.</p>
    ${[['Title', 'title', 'text', 200], ['Caption', 'description', 'textarea', 2000], ['Location', 'location', 'text', 200], ['Date', 'date', 'date']].map(([label, name, type, limit]) =>
      `<div class="gallery-batch-field"><label class="check"><input type="checkbox" name="change-${name}">Change ${label.toLowerCase()}</label><label class="field"><span class="sr-only">${label}</span>${type === 'textarea' ? `<textarea name="${name}" maxlength="${limit}" disabled></textarea>` : `<input name="${name}" type="${type}" ${limit ? `maxlength="${limit}"` : ''} disabled>`}</label></div>`).join('')}
    <p class="form-error" role="alert"></p><button class="primary" type="submit">Apply details</button></form>`);
  modal.querySelectorAll('[type=checkbox]').forEach(input => input.addEventListener('change', () => { modal.querySelector(`[name="${input.name.slice(7)}"]`).disabled = !input.checked; }));
  bindForm('#gallery-batch-details', async values => {
    const changes = {};
    ['title', 'description', 'location', 'date'].forEach(name => { if (values.has(`change-${name}`)) changes[name] = values.get(name); });
    if (!Object.keys(changes).length) throw new Error('Choose at least one field to change.');
    state.gallery.items.forEach(item => { if (ids.has(item.mediaId)) Object.assign(item, changes); }); galleryChanged(); modal.close(); renderGallery();
  }, modal);
}
function galleryAlbumsDialog() {
  const ids = new Set(state.gallerySelection); const albums = [...new Set(state.gallery.items.flatMap(item => item.albums || []))].sort();
  openDialog('Change albums', `<form id="gallery-album-details" class="stack"><p class="muted">Apply to ${ids.size} selected ${ids.size === 1 ? 'photograph' : 'photographs'}. Photos can belong to any number of albums, including none.</p>
    <label class="field">Album action<select name="operation" aria-label="Album action"><option value="add">Add to albums</option><option value="replace">Replace albums</option><option value="remove">Remove from albums</option></select></label>
    <div class="gallery-album-options">${albums.map(album => `<label class="check"><input type="checkbox" name="album" value="${esc(album)}">${esc(album)}</label>`).join('')}</div>
    ${field('New albums', 'new-albums', '', 'placeholder="Travel, Landscapes"')}<p class="muted">Choose Replace albums with no albums selected to clear all assignments.</p>
    <p class="form-error" role="alert"></p><button class="primary" type="submit">Apply albums</button></form>`);
  bindForm('#gallery-album-details', async values => {
    const chosen = [...new Set([...values.getAll('album'), ...String(values.get('new-albums')).split(',').map(album => album.trim()).filter(Boolean)])];
    const operation = values.get('operation');
    if (!chosen.length && operation !== 'replace') throw new Error('Choose an album or enter a new album name.');
    const changes = state.gallery.items.filter(item => ids.has(item.mediaId)).map(item => ({ item, albums: operation === 'replace' ? chosen : operation === 'remove' ? (item.albums || []).filter(album => !chosen.includes(album)) : [...new Set([...(item.albums || []), ...chosen])] }));
    if (changes.some(change => change.albums.length > 30 || change.albums.some(album => album.length > 80))) throw new Error('Use at most 30 albums per photograph, with names up to 80 characters.');
    changes.forEach(change => { change.item.albums = [...change.albums]; }); galleryChanged(); modal.close(); renderGallery();
  }, modal);
}
function editGalleryItem(index) {
  const item = state.gallery.items[index];
  openDialog('Photograph details', `<form id="gallery-details" class="stack">${field('Title', 'title', item.title, 'maxlength="200"')}
    <label class="field">Caption<textarea name="description" maxlength="2000">${esc(item.description)}</textarea></label>
    ${field('Location', 'location', item.location, 'maxlength="200"')}${field('Date', 'date', item.date?.slice(0, 10), '', 'date')}
    ${field('Albums', 'albums', (item.albums || []).join(', '), 'placeholder="Travel, Landscapes"')}
    <details><summary>Additional metadata</summary><label class="field">JSON metadata<textarea name="metadata" spellcheck="false">${esc(JSON.stringify(item.metadata || {}, null, 2))}</textarea><small>Store camera, lens, exposure, or other descriptive information.</small></label></details>
    <p class="form-error" role="alert"></p><button class="primary" type="submit">Apply details</button></form>`);
  bindForm('#gallery-details', async values => {
    let metadata; try { metadata = JSON.parse(values.get('metadata')); } catch { throw new Error('Metadata must be valid JSON.'); }
    if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') throw new Error('Metadata must be a JSON object.');
    const scalar = value => value === null || (typeof value === 'string' && value.length <= 4000) ||
      (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean';
    if (Object.keys(metadata).length > 100 || JSON.stringify(metadata).length > 16384 || Object.entries(metadata).some(([key, value]) =>
      key.length > 80 || !(scalar(value) || (Array.isArray(value) && value.length <= 100 && value.every(scalar))))) {
      throw new Error('Metadata values must be text, numbers, booleans, null, or arrays of those values. Keep metadata below 16 KB.');
    }
    state.gallery.items[index] = { mediaId: item.mediaId, title: values.get('title'), description: values.get('description'), location: values.get('location'), date: values.get('date'),
      albums: String(values.get('albums')).split(',').map(album => album.trim()).filter(Boolean), metadata };
    galleryChanged(); modal.close(); renderGallery();
  }, modal);
}
async function saveGallery() {
  if (state.uploads) throw new Error('Wait for image uploads to finish before saving.');
  if (!state.dirty) return;
  if (state.conflict) throw new Error('Download your gallery draft and reload the server version to resolve the conflict.');
  const version = state.editVersion; const snapshot = structuredClone(state.gallery.items);
  try {
    const result = await api('/gallery', { method: 'PUT', body: { items: snapshot, revision: state.gallery.revision } });
    const saved = result.gallery || result;
    if (version === state.editVersion) { state.gallery = saved; state.dirty = false; }
    else { state.gallery.revision = saved.revision; state.gallery.hasChanges = saved.hasChanges; }
    updateGalleryStatus(); notice('Gallery draft saved.');
  } catch (error) {
    if (error.status === 409) { state.conflict = true; document.querySelector('#gallery-conflict').hidden = false; notice('The gallery was edited elsewhere. Download your draft before reloading the server version.', true); }
    throw error;
  }
}
async function publishGallery() {
  await saveGallery();
  if (!await confirmAction('Publish your gallery?', 'The saved gallery order, albums, and captions will become public after the next successful website build.', 'Publish gallery')) return;
  const { gallery, build } = await api('/gallery/publish', { method: 'POST', body: { revision: state.gallery.revision } }); state.gallery = gallery; updateGalleryStatus();
  notice(build?.message || (build?.queued ? 'Gallery published. Website build queued.' : 'Gallery publication saved. A website build is needed to update the public site.'));
}
async function securityView() {
  const { sessions = [], trustedDevices = [] } = await api('/security');
  document.querySelector('#content').innerHTML = heading('Keep your studio private.', 'Two-factor authentication protects every administrator login.') +
    `<section class="panel"><h2>Two-factor authentication</h2><p><span class="badge">Authenticator enabled</span></p><p class="muted">Store your recovery codes privately. Trusted browsers expire and can be revoked here.</p><div class="actions"><button id="regenerate-codes">Replace recovery codes</button></div></section>
    <section class="panel"><h2>Trusted browsers</h2><p class="muted">${trustedDevices.length} trusted ${trustedDevices.length === 1 ? 'browser' : 'browsers'}. Revoking trust requires a fresh authenticator code the next time you sign in.</p>
    ${trustedDevices.length ? `<ul>${trustedDevices.map(device => `<li>Trust expires ${esc(formatDate(device.expiresAt))}</li>`).join('')}</ul>` : ''}<button id="revoke-trusted">Revoke all trusted browsers</button></section>
    <section class="panel"><div class="page-heading"><h2 style="margin:0">Active sessions</h2><button id="revoke-others">Sign out other sessions</button></div><div class="table-wrap"><table><thead><tr><th>Browser</th><th>Last known IP</th><th>Expires</th><th>Action</th></tr></thead><tbody>${sessions.map(session => `<tr><td class="session-device">${esc(session.userAgent || 'Unknown browser')}${session.isCurrent ? '<br><span class="badge">This session</span>' : ''}</td><td>${esc(session.ipAddress || 'Unavailable')}</td><td>${esc(formatDate(session.expiresAt))}</td><td>${session.isCurrent ? 'Current' : `<button data-revoke-session="${esc(session.id)}">Sign out</button>`}</td></tr>`).join('')}</tbody></table></div></section>`;
  bindAction('#revoke-trusted', async () => {
    if (!await confirmAction('Revoke trusted browsers?', 'Every browser will need two-factor authentication at its next sign-in.', 'Revoke trust')) return;
    await api('/security/revoke-trusted', { method: 'POST', body: {} }); await securityView(); notice('All browser trust revoked.');
  });
  bindAction('#revoke-others', async () => {
    if (!await confirmAction('Sign out other sessions?', 'Your current session remains signed in.', 'Sign out others')) return;
    await api('/security/revoke-others', { method: 'POST', body: {} }); await securityView(); notice('Other sessions signed out.');
  });
  document.querySelectorAll('[data-revoke-session]').forEach(button => button.addEventListener('click', async () => {
    try { await api('/security/revoke-session', { method: 'POST', body: { id: button.dataset.revokeSession } }); await securityView(); notice('Session signed out.'); }
    catch (error) { notice(error.message, true); }
  }));
  bindAction('#regenerate-codes', recoveryCodesDialog);
}
function formatDate(value) { return value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Unavailable'; }
function recoveryCodesDialog() {
  openDialog('Replace recovery codes', `<p class="muted">Your previous recovery codes will stop working immediately.</p><form id="replace-codes" class="stack">${field('Confirm password', 'password', '', 'required autocomplete="current-password"', 'password')}<p class="form-error" role="alert"></p><button class="primary" type="submit">Generate new codes</button></form>`);
  bindForm('#replace-codes', async (values, form) => {
    const { backupCodes } = await authCall(auth.twoFactor.generateBackupCodes({ password: values.get('password') })); form.reset();
    modal.innerHTML = '<h2 id="modal-title">Save your new recovery codes</h2><p class="muted">These replace every previous code. Keep them privately.</p><pre id="new-codes" class="recovery-codes"></pre><div class="actions"><button id="download-new-codes">Download codes</button><button id="close-new-codes" class="primary">I saved my codes</button></div>';
    modal.querySelector('#new-codes').textContent = backupCodes.join('\n');
    bindAction('#download-new-codes', () => download('studio-recovery-codes.txt', backupCodes.join('\n')), modal);
    bindAction('#close-new-codes', () => { backupCodes.fill(''); modal.close(); }, modal);
  }, modal);
}
window.addEventListener('beforeunload', event => { if (state.dirty || state.uploads) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
  event.preventDefault(); if (state.tab === 'editor') savePost().catch(error => notice(error.message, true)); else if (state.tab === 'gallery') saveGallery().catch(error => notice(error.message, true));
} });
async function start() {
  const status = await api('/status'); if (status.setupRequired || !status.configured) setupView(); else await loadSession();
}
start().catch(error => { authFrame('Studio unavailable.', 'The studio could not connect to its secure backend.', '<p id="startup-error" class="form-error" role="alert"></p><button id="retry-start" class="primary" style="margin-top:1rem">Try again</button>'); document.querySelector('#startup-error').textContent = error.message; bindAction('#retry-start', () => location.reload()); });
