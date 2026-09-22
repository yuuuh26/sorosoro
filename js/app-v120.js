'use strict';

// Soro Soro v1.2.0 — clean single-file runtime built from the known-good v1.0.0 base.
const DB_NAME = 'sorosoro-db';
const DB_VERSION = 1;
const STORES = { items: 'items', history: 'history', settings: 'settings' };
let dbPromise;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.items)) {
        const items = db.createObjectStore(STORES.items, { keyPath: 'id' });
        items.createIndex('tab', 'tab');
        items.createIndex('active', 'active');
      }
      if (!db.objectStoreNames.contains(STORES.history)) {
        const history = db.createObjectStore(STORES.history, { keyPath: 'id' });
        history.createIndex('itemId', 'itemId');
        history.createIndex('performedDate', 'performedDate');
      }
      if (!db.objectStoreNames.contains(STORES.settings)) db.createObjectStore(STORES.settings, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('データベースの更新がブロックされました'));
  });
  return dbPromise;
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('保存処理が中断されました'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll(storeName) {
  const db = await openDatabase();
  return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

async function getOne(storeName, key) {
  const db = await openDatabase();
  return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
}

async function putOne(storeName, value) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await transactionDone(tx);
  return value;
}

async function deleteOne(storeName, key) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  await transactionDone(tx);
}

async function saveItemWithHistory(item, historyEntry = null) {
  const db = await openDatabase();
  const tx = db.transaction([STORES.items, STORES.history], 'readwrite');
  tx.objectStore(STORES.items).put(item);
  if (historyEntry) tx.objectStore(STORES.history).put(historyEntry);
  await transactionDone(tx);
}

async function deleteItemAndHistory(itemId) {
  const db = await openDatabase();
  const tx = db.transaction([STORES.items, STORES.history], 'readwrite');
  tx.objectStore(STORES.items).delete(itemId);
  const cursorRequest = tx.objectStore(STORES.history).index('itemId').openKeyCursor(IDBKeyRange.only(itemId));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (cursor) { tx.objectStore(STORES.history).delete(cursor.primaryKey); cursor.continue(); }
  };
  await transactionDone(tx);
}

async function getHistoryForItem(itemId) {
  const db = await openDatabase();
  return requestResult(db.transaction(STORES.history, 'readonly').objectStore(STORES.history).index('itemId').getAll(itemId));
}


const DAY_MS = 86400000;

function toDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function addInterval(dateKey, value, unit) {
  const date = parseDateKey(dateKey);
  if (unit === 'day') date.setDate(date.getDate() + value);
  if (unit === 'week') date.setDate(date.getDate() + value * 7);
  if (unit === 'month') {
    const originalDay = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + value);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(originalDay, lastDay));
  }
  return toDateKey(date);
}

function calendarDayDiff(fromKey, toKey) {
  return Math.round((parseDateKey(toKey) - parseDateKey(fromKey)) / DAY_MS);
}

function formatDate(dateKey, includeYear = false) {
  if (!dateKey) return '記録なし';
  const options = includeYear ? { year: 'numeric', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' };
  return new Intl.DateTimeFormat('ja-JP', options).format(parseDateKey(dateKey));
}

function formatLongDate(dateKey) {
  if (!dateKey) return '記録なし';
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(parseDateKey(dateKey));
}

function getDueState(item, today = toDateKey()) {
  const diff = calendarDayDiff(today, item.nextDueDate);
  if (diff < 0) return { key: 'overdue', rank: 0, diff, label: `${Math.abs(diff)}日過ぎています` };
  if (diff === 0) return { key: 'today', rank: 1, diff, label: '今日です' };
  if (diff <= Number(item.riseDays || 0)) return { key: 'soon', rank: 2, diff, label: `あと${diff}日` };
  return { key: 'safe', rank: 3, diff, label: `あと${diff}日` };
}

function intervalLabel(item) {
  return `${item.intervalValue}${{ day: '日', week: '週', month: 'か月' }[item.intervalUnit]}ごと`;
}


const APP_URL = 'https://yuuuh26.github.io/sorosoro/';
const REPO_URL = 'https://github.com/yuuuh26/sorosoro';
const state = { items: [], history: [], route: 'home', undo: null, toastTimer: null, privacyVisible: false };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = (prefix) => `${prefix}-${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;

function escapeHtml(value = '') {
  const node = document.createElement('div');
  node.textContent = value;
  return node.innerHTML;
}

async function refreshData() {
  [state.items, state.history] = await Promise.all([getAll(STORES.items), getAll(STORES.history)]);
  renderAll();
}

const itemIsVisible = (item) => state.privacyVisible || item.private !== true;
const visibleItems = () => state.items.filter(itemIsVisible);
const activeItems = () => visibleItems().filter((item) => item.active !== false);

function sortedItems(items) {
  return [...items].sort((a, b) => {
    const aState = getDueState(a);
    const bState = getDueState(b);
    return aState.rank - bState.rank || a.nextDueDate.localeCompare(b.nextDueDate) || a.name.localeCompare(b.name, 'ja');
  });
}

function homeItems() {
  return sortedItems(activeItems());
}

function renderSummary() {
  const dueStates = activeItems().map((item) => getDueState(item));
  const count = (key) => dueStates.filter((entry) => entry.key === key).length;
  $('#summaryGrid').innerHTML = `<div class="summary-card over"><span>超過</span><strong>${count('overdue')}件</strong></div><div class="summary-card today"><span>今日</span><strong>${count('today')}件</strong></div><div class="summary-card soon"><span>もうすぐ</span><strong>${count('soon')}件</strong></div>`;
}

function itemCard(item) {
  const due = getDueState(item);
  const privateBadge = item.private === true ? '<span class="privacy-badge">PRIVATE</span>' : '';
  return `<article class="item-card state-${due.key}${item.private === true ? ' is-private' : ''}" data-item-id="${item.id}"><div class="card-top"><div class="item-emoji" aria-hidden="true">${escapeHtml(item.icon || '✓')}</div><div class="card-main"><p class="status-line"><span>${due.label}</span>${privateBadge}</p><h3 class="item-name">${escapeHtml(item.name)}</h3><div class="item-meta"><span>前回 ${formatDate(item.lastCompletedDate)}</span><span>予定 ${formatDate(item.nextDueDate)}</span><span>${intervalLabel(item)}</span></div></div></div><div class="card-actions"><button class="done-button" type="button" data-action="done" data-id="${item.id}">やった ✓</button><button class="detail-button" type="button" data-action="detail" data-id="${item.id}">詳細</button></div></article>`;
}

function emptyState(kind) {
  const home = kind === 'home';
  return `<div class="empty-state"><span class="empty-icon" aria-hidden="true">${home ? '◎' : '○'}</span><h3>${home ? '今は落ち着いています' : '項目はまだありません'}</h3><p>${home ? '期限が近づいた項目や、ホーム常駐の項目がここに表示されます。' : '右上の＋から、このタブで管理したい項目を追加できます。'}</p><button class="primary-button" type="button" data-action="add">最初の項目を追加</button></div>`;
}

function renderLists() {
  const items = homeItems();
  $('#homeList').innerHTML = items.length ? items.map(itemCard).join('') : emptyState('home');
  $('#homeCount').textContent = `${items.length}件`;
}

function renderHistoryFilter() {
  const filter = $('#historyFilter');
  const current = filter.value;
  filter.innerHTML = '<option value="all">すべて</option>' + visibleItems().sort((a, b) => a.name.localeCompare(b.name, 'ja')).map((item) => `<option value="${item.id}">${escapeHtml(item.icon || '✓')} ${escapeHtml(item.name)}</option>`).join('');
  filter.value = [...filter.options].some((option) => option.value === current) ? current : 'all';
}

function renderHistory() {
  renderHistoryFilter();
  const filter = $('#historyFilter').value;
  const visibleItemIds = new Set(visibleItems().map((item) => item.id));
  const entries = state.history.filter((entry) => visibleItemIds.has(entry.itemId) && (filter === 'all' || entry.itemId === filter)).sort((a, b) => b.performedDate.localeCompare(a.performedDate) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  if (!entries.length) {
    $('#historyList').innerHTML = '<div class="empty-state"><span class="empty-icon">◷</span><h3>履歴はまだありません</h3><p>「やった」を押すと、実施日がここに残ります。</p></div>';
    return;
  }
  const groups = entries.reduce((all, entry) => ((all[entry.performedDate] ||= []).push(entry), all), {});
  $('#historyList').innerHTML = Object.entries(groups).map(([date, rows]) => `<section class="history-group"><h2>${formatLongDate(date)}</h2>${rows.map((entry) => {
    const item = state.items.find((candidate) => candidate.id === entry.itemId);
    if (!item) return '';
    return `<article class="history-entry"><div class="item-emoji">${escapeHtml(item.icon)}</div><div><strong>${escapeHtml(item.name)}</strong><span>${entry.source === 'initial' ? '初回登録' : '完了記録'}</span></div><button type="button" data-action="edit-history" data-id="${entry.id}">編集</button></article>`;
  }).join('')}</section>`).join('');
}

function renderPaused() {
  const paused = visibleItems().filter((item) => item.active === false);
  $('#pausedList').innerHTML = paused.length ? paused.map((item) => `<div class="paused-row"><b>${escapeHtml(item.icon)}</b><span>${escapeHtml(item.name)}</span><button type="button" data-action="resume" data-id="${item.id}">再開</button></div>`).join('') : '<p class="muted-copy">停止中の項目はありません。</p>';
}

function renderPrivacyControls() {
  const button = $('#privacySettingsToggle');
  const status = $('#privacyState');
  if (button) {
    button.textContent = state.privacyVisible ? '隠す' : '表示する';
    button.classList.toggle('active', state.privacyVisible);
    button.setAttribute('aria-pressed', String(state.privacyVisible));
  }
  if (status) status.textContent = state.privacyVisible ? '現在：表示中' : '現在：非表示';
}

function togglePrivacyMode() {
  state.privacyVisible = !state.privacyVisible;
  if (!state.privacyVisible && $('#detailDialog')?.open) $('#detailDialog').close();
  renderAll();
  showToast(state.privacyVisible ? 'プライベート項目を表示中' : 'プライベート項目を隠しました');
}

function renderAll() { renderSummary(); renderLists(); renderHistory(); renderPaused(); renderPrivacyControls(); }

function switchRoute(route) {
  state.route = route;
  const titles = { home: 'Soro Soro', short: '短期', long: '長期', history: '履歴', settings: '設定' };
  $$('.view').forEach((view) => view.classList.toggle('active', view.dataset.view === route));
  $$('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.route === route));
  $('#pageTitle').textContent = titles[route];
  $('#pageTitle').classList.toggle('brand-title', route === 'home');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('#mainContent').focus({ preventScroll: true });
}

function openItemForm(item = null) {
  $('#itemForm').reset();
  $('#itemFormTitle').textContent = item ? '項目を編集' : '項目を追加';
  $('#itemId').value = item?.id || '';
  $('#itemName').value = item?.name || '';
  $('#intervalValue').value = item?.intervalValue || 7;
  $('#intervalUnit').value = item?.intervalUnit || 'day';
  $('#lastCompletedDate').value = item?.lastCompletedDate || toDateKey();
  $('#itemTab').value = item?.tab || (state.route === 'long' ? 'long' : 'short');
  $('#riseDays').value = item?.riseDays ?? 3;
  $('#pinHome').checked = item?.pinHome || false;
  $('#itemPrivate').checked = item?.private || false;
  $('#itemNote').value = item?.note || '';
  $('#formError').textContent = '';
  $('#itemDialog').showModal();
  setTimeout(() => $('#itemName').focus(), 50);
}

async function saveItem(event) {
  event.preventDefault();
  const oldItem = state.items.find((item) => item.id === $('#itemId').value);
  const name = $('#itemName').value.trim();
  const intervalValue = Number($('#intervalValue').value);
  const lastCompletedDate = $('#lastCompletedDate').value;
  if (!name || !lastCompletedDate || !Number.isInteger(intervalValue) || intervalValue < 1) {
    $('#formError').textContent = '項目名・周期・前回実施日を確認してください。';
    return;
  }
  const now = new Date().toISOString();
  const item = {
    id: oldItem?.id || uid('item'), name, icon: oldItem?.icon || '✓', category: oldItem?.category || '',
    intervalValue, intervalUnit: $('#intervalUnit').value, lastCompletedDate,
    nextDueDate: addInterval(lastCompletedDate, intervalValue, $('#intervalUnit').value), tab: $('#itemTab').value,
    pinHome: $('#pinHome').checked, riseDays: Math.max(0, Number($('#riseDays').value) || 0), note: $('#itemNote').value.trim(), private: $('#itemPrivate').checked,
    active: oldItem?.active ?? true, createdAt: oldItem?.createdAt || now, updatedAt: now,
  };
  let initialHistory = null;
  if (!oldItem) initialHistory = { id: uid('history'), itemId: item.id, performedDate: lastCompletedDate, source: 'initial', createdAt: now };
  else if (oldItem.lastCompletedDate !== lastCompletedDate) {
    const latest = state.history.filter((entry) => entry.itemId === item.id).sort((a, b) => b.performedDate.localeCompare(a.performedDate))[0];
    if (latest) await putOne(STORES.history, { ...latest, performedDate: lastCompletedDate, updatedAt: now });
  }
  try {
    await saveItemWithHistory(item, initialHistory);
    $('#itemDialog').close();
    await requestPersistentStorage(false);
    await refreshData();
    showToast('保存しました', `${item.name}を更新しました`);
  } catch (error) {
    $('#formError').textContent = '保存できませんでした。空き容量などを確認してください。';
    console.error(error);
  }
}

async function completeItem(itemId, performedDate = toDateKey()) {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) return;
  const history = { id: uid('history'), itemId, performedDate, source: 'complete', createdAt: new Date().toISOString() };
  const previous = { ...item };
  const updated = { ...item, lastCompletedDate: performedDate, nextDueDate: addInterval(performedDate, item.intervalValue, item.intervalUnit), updatedAt: new Date().toISOString() };
  try {
    await saveItemWithHistory(updated, history);
    state.undo = { historyId: history.id, item: previous };
    await refreshData();
    if ($('#detailDialog').open) $('#detailDialog').close();
    showToast(`${item.name}を完了しました`, `次回：${formatDate(updated.nextDueDate)}`, true);
  } catch (error) { showToast('保存できませんでした', '時間をおいてもう一度お試しください'); console.error(error); }
}

async function undoCompletion() {
  if (!state.undo) return;
  const undo = state.undo;
  state.undo = null;
  await Promise.all([deleteOne(STORES.history, undo.historyId), putOne(STORES.items, undo.item)]);
  await refreshData();
  showToast('取り消しました', '完了前の状態に戻しました');
}

function showToast(title, message = '', withUndo = false) {
  clearTimeout(state.toastTimer);
  $('#toastTitle').textContent = title; $('#toastMessage').textContent = message; $('#toastAction').hidden = !withUndo;
  $('#toast').classList.add('show');
  state.toastTimer = setTimeout(() => $('#toast').classList.remove('show'), withUndo ? 6500 : 3000);
}

function openDetail(itemId) {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) return;
  const due = getDueState(item);
  const count = state.history.filter((entry) => entry.itemId === item.id).length;
  $('#detailContent').innerHTML = `<div class="modal-header"><div class="detail-hero"><div class="item-emoji">${escapeHtml(item.icon)}</div><div><span class="detail-status">${due.label}</span><h2>${escapeHtml(item.name)}</h2></div></div><button class="close-button" type="button" data-close="detailDialog" aria-label="閉じる">×</button></div><div class="detail-grid"><div class="detail-stat"><span>前回</span><strong>${formatDate(item.lastCompletedDate, true)}</strong></div><div class="detail-stat"><span>次回予定</span><strong>${formatDate(item.nextDueDate, true)}</strong></div><div class="detail-stat"><span>周期</span><strong>${intervalLabel(item)}</strong></div><div class="detail-stat"><span>ホーム浮上</span><strong>${item.pinHome ? '常時表示' : `${item.riseDays}日前`}</strong></div><div class="detail-stat"><span>分類</span><strong>${item.tab === 'short' ? '短期' : '長期'}</strong></div><div class="detail-stat"><span>履歴</span><strong>${count}件</strong></div></div>${item.note ? `<div class="note-box">${escapeHtml(item.note)}</div>` : ''}<div class="detail-actions"><button class="done-button" type="button" data-action="done" data-id="${item.id}">今日やった ✓</button><button class="secondary-button" type="button" data-action="done-date" data-id="${item.id}">日付を指定</button><button class="secondary-button" type="button" data-action="edit" data-id="${item.id}">編集</button><button class="secondary-button" type="button" data-action="item-history" data-id="${item.id}">履歴を見る</button><button class="secondary-button" type="button" data-action="pause" data-id="${item.id}">一時停止</button><button class="danger-button" type="button" data-action="delete-item" data-id="${item.id}">削除</button></div>`;
  $('#detailDialog').showModal();
}

function confirmAction(title, message, confirmLabel = '削除する') {
  $('#confirmTitle').textContent = title; $('#confirmMessage').textContent = message;
  $('.danger-solid', $('#confirmDialog')).textContent = confirmLabel;
  $('#confirmDialog').showModal();
  return new Promise((resolve) => $('#confirmDialog').addEventListener('close', () => resolve($('#confirmDialog').returnValue === 'confirm'), { once: true }));
}

async function recalculateItem(itemId) {
  const item = await getOne(STORES.items, itemId);
  if (!item) return;
  const history = (await getHistoryForItem(itemId)).sort((a, b) => b.performedDate.localeCompare(a.performedDate) || b.createdAt.localeCompare(a.createdAt));
  if (!history.length) return putOne(STORES.items, { ...item, lastCompletedDate: null, nextDueDate: toDateKey(), updatedAt: new Date().toISOString() });
  const latest = history[0].performedDate;
  return putOne(STORES.items, { ...item, lastCompletedDate: latest, nextDueDate: addInterval(latest, item.intervalValue, item.intervalUnit), updatedAt: new Date().toISOString() });
}

async function handleAction(button) {
  const { action, id } = button.dataset;
  if (action === 'add') return openItemForm();
  if (action === 'done') return completeItem(id);
  if (action === 'detail') return openDetail(id);
  if (action === 'edit') { $('#detailDialog').close(); return openItemForm(state.items.find((item) => item.id === id)); }
  if (action === 'done-date') { $('#detailDialog').close(); $('#dateItemId').value = id; $('#specifiedDate').value = toDateKey(); return $('#dateDialog').showModal(); }
  if (action === 'item-history') { $('#detailDialog').close(); switchRoute('history'); $('#historyFilter').value = id; return renderHistory(); }
  if (action === 'pause') {
    const item = state.items.find((candidate) => candidate.id === id);
    await putOne(STORES.items, { ...item, active: false, updatedAt: new Date().toISOString() });
    $('#detailDialog').close(); await refreshData(); return showToast('一時停止しました', '設定からいつでも再開できます');
  }
  if (action === 'resume') {
    const item = state.items.find((candidate) => candidate.id === id);
    await putOne(STORES.items, { ...item, active: true, updatedAt: new Date().toISOString() });
    await refreshData(); return showToast('再開しました', item.name);
  }
  if (action === 'delete-item') {
    const item = state.items.find((candidate) => candidate.id === id);
    if (!await confirmAction('項目を削除しますか？', `${item.name}と関連する履歴がすべて削除されます。一時停止なら履歴を残せます。`)) return;
    await deleteItemAndHistory(id); $('#detailDialog').close(); await refreshData(); return showToast('削除しました', item.name);
  }
  if (action === 'edit-history') {
    const entry = state.history.find((candidate) => candidate.id === id);
    $('#historyEditId').value = id; $('#historyEditDate').value = entry.performedDate; return $('#historyEditDialog').showModal();
  }
}

async function requestPersistentStorage(withFeedback = true) {
  if (!navigator.storage?.persist) {
    $('#persistStatus').textContent = '未対応';
    if (withFeedback) showToast('この端末では申請できません', '通常の端末保存は利用できます');
    return false;
  }
  let persisted = await navigator.storage.persisted();
  if (!persisted) persisted = await navigator.storage.persist();
  $('#persistStatus').textContent = persisted ? '有効' : '未適用';
  if (withFeedback) showToast(persisted ? '永続ストレージが有効です' : '永続ストレージは未適用です', persisted ? '端末側で保護されています' : '通常の端末保存で利用できます');
  return persisted;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const area = document.createElement('textarea'); area.value = text; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); }
  showToast('コピーしました');
}

function bindEvents() {
  const homeNav = $('.nav-button[data-route="home"]');
  $$('.nav-button').filter((button) => button.dataset.route !== 'home').forEach((button) => button.addEventListener('click', () => switchRoute(button.dataset.route)));

  let homePressTimer = null;
  let homeLongPressTriggered = false;
  if (homeNav) {
    homeNav.addEventListener('pointerdown', (event) => {
      homeLongPressTriggered = false;
      clearTimeout(homePressTimer);
      try { homeNav.setPointerCapture?.(event.pointerId); } catch {}
      homePressTimer = setTimeout(() => {
        homeLongPressTriggered = true;
        navigator.vibrate?.(35);
        togglePrivacyMode();
        switchRoute('home');
      }, 1200);
    });
    const cancelHomePress = (event) => {
      clearTimeout(homePressTimer);
      homePressTimer = null;
      try {
        if (event?.pointerId != null && homeNav.hasPointerCapture?.(event.pointerId)) homeNav.releasePointerCapture?.(event.pointerId);
      } catch {}
    };
    homeNav.addEventListener('pointerup', cancelHomePress);
    homeNav.addEventListener('pointercancel', cancelHomePress);
    homeNav.addEventListener('contextmenu', (event) => event.preventDefault());
    homeNav.addEventListener('click', (event) => {
      if (homeLongPressTriggered) {
        event.preventDefault();
        homeLongPressTriggered = false;
        return;
      }
      switchRoute('home');
    });
  }

  $('#quickAdd').addEventListener('click', () => openItemForm());
  $('#privacySettingsToggle').addEventListener('click', togglePrivacyMode);
  $('#itemForm').addEventListener('submit', saveItem);
  $('#historyFilter').addEventListener('change', renderHistory);
  $('#toastAction').addEventListener('click', undoCompletion);
  $('#requestPersist').addEventListener('click', () => requestPersistentStorage(true));
  $('#dateForm').addEventListener('submit', async (event) => { event.preventDefault(); const id = $('#dateItemId').value; const date = $('#specifiedDate').value; if (!date) return; $('#dateDialog').close(); await completeItem(id, date); });
  $('#historyEditForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const entry = state.history.find((item) => item.id === $('#historyEditId').value); if (!entry) return;
    await putOne(STORES.history, { ...entry, performedDate: $('#historyEditDate').value, updatedAt: new Date().toISOString() });
    await recalculateItem(entry.itemId); $('#historyEditDialog').close(); await refreshData(); showToast('履歴を更新しました');
  });
  $('#deleteHistory').addEventListener('click', async () => {
    const entry = state.history.find((item) => item.id === $('#historyEditId').value); if (!entry) return;
    if (!await confirmAction('履歴を削除しますか？', '削除後、最新の実施日から次回予定日を計算し直します。')) return;
    await deleteOne(STORES.history, entry.id); await recalculateItem(entry.itemId); $('#historyEditDialog').close(); await refreshData(); showToast('履歴を削除しました');
  });
  document.addEventListener('click', (event) => {
    const close = event.target.closest('[data-close]'); if (close) return document.getElementById(close.dataset.close).close();
    const action = event.target.closest('[data-action]'); if (action) handleAction(action).catch(console.error);
    const copy = event.target.closest('[data-copy]'); if (copy) copyText(copy.dataset.copy === 'app' ? APP_URL : REPO_URL);
  });
  $$('.modal').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));
}

async function initialize() {
  $('#todayLabel').textContent = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
  $('#appUrl').textContent = APP_URL; $('#repoUrl').textContent = REPO_URL;
  bindEvents();
  try {
    await openDatabase();
    await putOne(STORES.settings, { key: 'schemaVersion', value: DB_VERSION, updatedAt: new Date().toISOString() });
    $('#dbStatus').textContent = '有効';
    $('#persistStatus').textContent = navigator.storage?.persisted && await navigator.storage.persisted() ? '有効' : navigator.storage?.persisted ? '未適用' : '未対応';
    await refreshData();
  } catch (error) { $('#dbStatus').textContent = '利用不可'; showToast('保存機能を使用できません', 'ブラウザ設定を確認してください'); console.error(error); }
  window.__SOROSORO_APP_READY__ = true;
}

initialize();
