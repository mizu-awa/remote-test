'use strict';

const STORAGE_KEY = 'backlog.v1';
const STATUS = { TODO: 'todo', DONE: 'done' };

// tasks の並び順 = 優先順位（未実施タスクのみ意味を持つ）。
// 完了→未実施に戻したときに元の位置へ戻せるよう、完了タスクも配列内に残す。
let tasks = load();

const $ = (id) => document.getElementById(id);
const todoList = $('todo-list');
const doneList = $('done-list');

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && Array.isArray(data.tasks)) return data.tasks.filter(isValidTask);
  } catch (e) {
    console.warn('load failed', e);
  }
  return [];
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, tasks }));
  } catch (e) {
    alert('保存に失敗しました: ' + e.message);
  }
}

function isValidTask(t) {
  return t && typeof t.id === 'string' && typeof t.title === 'string'
    && Object.values(STATUS).includes(t.status);
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function findTask(id) {
  return tasks.find((t) => t.id === id);
}

/* ---------- 描画 ---------- */

function render() {
  if (editingId) closeEdit();
  const todos = tasks.filter((t) => t.status === STATUS.TODO);
  const dones = tasks
    .filter((t) => t.status === STATUS.DONE)
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  todoList.replaceChildren(...todos.map((t, i) => taskEl(t, i + 1)));
  doneList.replaceChildren(...dones.map((t) => taskEl(t)));

  $('todo-count').textContent = todos.length || '';
  $('done-count').textContent = dones.length || '';
  $('todo-empty').hidden = todos.length > 0;
}

function taskEl(task, rank) {
  const li = document.createElement('li');
  li.className = 'task' + (task.status === STATUS.DONE ? ' is-done' : '');
  li.dataset.id = task.id;

  if (rank) {
    const r = document.createElement('span');
    r.className = 'rank';
    r.textContent = rank;
    li.append(r);
  }

  const check = document.createElement('button');
  check.className = 'check';
  check.dataset.action = 'toggle';
  check.setAttribute('aria-label', task.status === STATUS.DONE ? '未実施に戻す' : '完了にする');

  const title = document.createElement('button');
  title.className = 'title';
  title.dataset.action = 'edit';
  title.textContent = task.title;

  li.append(check, title);

  if (task.status === STATUS.TODO) {
    const handle = document.createElement('button');
    handle.className = 'handle';
    handle.dataset.action = 'drag';
    handle.setAttribute('aria-label', '並び替え（ドラッグ / ↑↓キー）');
    handle.textContent = '≡';
    li.append(handle);
  }
  return li;
}

/* ---------- 操作 ---------- */

function addTask(title) {
  tasks.push({ id: newId(), title, status: STATUS.TODO, createdAt: Date.now() });
  save();
  render();
  todoList.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function toggleTask(id) {
  const t = findTask(id);
  if (!t) return;
  if (t.status === STATUS.TODO) {
    t.status = STATUS.DONE;
    t.completedAt = Date.now();
  } else {
    t.status = STATUS.TODO;
    delete t.completedAt;
  }
  save();
  render();
}

function deleteTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  save();
  render();
}

// 未実施リスト内で fromIndex → toIndex へ移動
function moveTodo(fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  const todos = tasks.filter((t) => t.status === STATUS.TODO);
  const moving = todos[fromIndex];
  const target = todos[toIndex];
  tasks.splice(tasks.indexOf(moving), 1);
  const at = tasks.indexOf(target) + (toIndex > fromIndex ? 1 : 0);
  tasks.splice(at, 0, moving);
  save();
  render();
}

$('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('add-input');
  const title = input.value.trim();
  if (!title) return;
  addTask(title);
  input.value = '';
});

function onListClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.closest('.task').dataset.id;
  if (btn.dataset.action === 'toggle') toggleTask(id);
  else if (btn.dataset.action === 'edit') openEdit(id);
}
todoList.addEventListener('click', onListClick);
doneList.addEventListener('click', onListClick);

// キーボードでの並び替え（ハンドルにフォーカスして ↑↓）
todoList.addEventListener('keydown', (e) => {
  if (!e.target.matches('.handle') || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const items = [...todoList.children];
  const from = items.indexOf(e.target.closest('.task'));
  const to = from + (e.key === 'ArrowUp' ? -1 : 1);
  if (to < 0 || to >= items.length) return;
  moveTodo(from, to);
  todoList.children[to].querySelector('.handle').focus();
});

$('done-toggle').addEventListener('click', (e) => {
  const open = e.currentTarget.getAttribute('aria-expanded') !== 'true';
  e.currentTarget.setAttribute('aria-expanded', open);
  doneList.hidden = !open;
});

/* ---------- ドラッグで並び替え（タッチ / マウス共通） ---------- */

let drag = null;

todoList.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.handle');
  if (!handle || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
  e.preventDefault();

  const el = handle.closest('.task');
  const items = [...todoList.children];
  const from = items.indexOf(el);
  const rects = items.map((it) => it.getBoundingClientRect());
  const gap = items.length > 1 ? rects[1].top - rects[0].bottom : 0;

  handle.setPointerCapture(e.pointerId);
  el.classList.add('dragging');
  todoList.classList.add('sorting');
  navigator.vibrate?.(10);

  drag = {
    el, items, from, to: from, rects,
    shift: rects[from].height + gap,
    pointerId: e.pointerId,
    startY: e.clientY, lastY: e.clientY,
    startScroll: window.scrollY,
    raf: 0,
  };
  drag.raf = requestAnimationFrame(autoScroll);
});

todoList.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.lastY = e.clientY;
  updateDrag();
});

function updateDrag() {
  const { el, items, from, rects, shift } = drag;
  // rects はドラッグ開始時のビューポート座標なので、スクロール量を足して補正
  const dy = drag.lastY - drag.startY + (window.scrollY - drag.startScroll);
  el.style.transform = `translateY(${dy}px)`;

  const center = rects[from].top + rects[from].height / 2 + dy;
  let to = from;
  for (let i = 0; i < items.length; i++) {
    const mid = rects[i].top + rects[i].height / 2;
    if (i > from && center > mid) to = i;
    if (i < from && center < mid && to === from) to = i;
  }
  drag.to = to;

  items.forEach((it, i) => {
    if (i === from) return;
    let offset = 0;
    if (from < to && i > from && i <= to) offset = -shift;
    if (to < from && i >= to && i < from) offset = shift;
    it.style.transform = offset ? `translateY(${offset}px)` : '';
  });
}

function autoScroll() {
  if (!drag) return;
  const edge = 80;
  const h = window.innerHeight;
  let speed = 0;
  if (drag.lastY < edge) speed = -(edge - drag.lastY) / 4;
  else if (drag.lastY > h - edge - 70) speed = (drag.lastY - (h - edge - 70)) / 4; // 下部の入力欄ぶん余裕を取る
  if (speed) {
    window.scrollBy(0, speed);
    updateDrag();
  }
  drag.raf = requestAnimationFrame(autoScroll);
}

function endDrag(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const { from, to, items, raf } = drag;
  cancelAnimationFrame(raf);
  items.forEach((it) => { it.style.transform = ''; it.classList.remove('dragging'); });
  todoList.classList.remove('sorting');
  drag = null;
  moveTodo(from, to);
}
todoList.addEventListener('pointerup', endDrag);
todoList.addEventListener('pointercancel', endDrag);

/* ---------- 編集シート ---------- */

const editDialog = $('edit-dialog');
const editInput = $('edit-input');
let editingId = null;

function openEdit(id) {
  const t = findTask(id);
  if (!t) return;
  if (editingId) closeEdit();
  editingId = id;
  editInput.value = t.title;
  const row = [...todoList.children, ...doneList.children].find((el) => el.dataset.id === id);
  row.classList.add('is-editing');
  row.append(editDialog);
  editDialog.hidden = false;
  editInput.focus({ preventScroll: true });
  requestAnimationFrame(() => editDialog.scrollIntoView({ block: 'nearest' }));
}

function closeEdit() {
  const row = editDialog.closest('.task');
  editDialog.hidden = true;
  document.body.append(editDialog);
  row?.classList.remove('is-editing');
  editingId = null;
  row?.querySelector('.title').focus({ preventScroll: true });
}

$('edit-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.submitter?.value !== 'save') return;
  const t = findTask(editingId);
  const title = editInput.value.trim();
  if (t && title) {
    closeEdit();
    t.title = title;
    save();
    render();
  }
});
editInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('edit-form').requestSubmit(editDialog.querySelector('.primary'));
  }
});
$('edit-cancel').addEventListener('click', closeEdit);
editInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeEdit(); }
});
$('edit-delete').addEventListener('click', () => {
  if (!confirm('このタスクを削除しますか？')) return;
  const id = editingId;
  closeEdit();
  deleteTask(id);
});

/* ---------- メニュー ---------- */

const menuDialog = $('menu-dialog');
$('menu-btn').addEventListener('click', () => menuDialog.showModal());
$('menu-close').addEventListener('click', () => menuDialog.close());

// シート外（背景）タップで閉じる
for (const d of [menuDialog]) {
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}

$('clear-done').addEventListener('click', () => {
  const n = tasks.filter((t) => t.status === STATUS.DONE).length;
  if (!n || !confirm(`完了済みの ${n} 件を削除しますか？`)) return;
  tasks = tasks.filter((t) => t.status !== STATUS.DONE);
  save();
  render();
  menuDialog.close();
});

$('export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ version: 1, tasks }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `backlog-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('import-btn').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const imported = (Array.isArray(data) ? data : data.tasks || []).filter(isValidTask);
    if (!imported.length) throw new Error('タスクが見つかりません');
    if (!confirm(`${imported.length} 件のタスクで現在のデータを置き換えますか？`)) return;
    tasks = imported;
    save();
    render();
    menuDialog.close();
  } catch (err) {
    alert('インポートに失敗しました: ' + err.message);
  }
});

// 他のタブで変更されたら反映
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY && !drag) { tasks = load(); render(); }
});

// iOS のキーボードは layout viewport を縮めないため、見えている領域に合わせる。
function syncViewport() {
  const viewport = window.visualViewport;
  const bottom = viewport && viewport.scale === 1
    ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
  document.documentElement.style.setProperty('--keyboard-offset', `${bottom}px`);
  if (document.activeElement === editInput) {
    editDialog.scrollIntoView({ block: 'nearest' });
  }
}
window.visualViewport?.addEventListener('resize', syncViewport);
window.visualViewport?.addEventListener('scroll', syncViewport);
window.addEventListener('resize', syncViewport);
syncViewport();
render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

