/**
 * app.js – Reminder Bot Dashboard
 *
 * Pure vanilla JS frontend that reads/writes reminders.yaml
 * from a GitHub repository via the GitHub REST API.
 *
 * No backend server required — runs entirely in the browser.
 */

// ============================================================================
// State
// ============================================================================
const state = {
  reminders: [],
  logs: [],
  fileSha: null,      // SHA of reminders.yaml (needed for GitHub updates)
  logsSha: null,      // SHA of logs.json
  editingId: null,     // ID of reminder being edited, null = adding new
  connected: false,
};

// ============================================================================
// GitHub Config — persisted in localStorage
// ============================================================================
function getGHConfig() {
  return {
    owner:  localStorage.getItem('gh_owner')  || '',
    repo:   localStorage.getItem('gh_repo')   || '',
    branch: localStorage.getItem('gh_branch') || 'main',
    token:  localStorage.getItem('gh_token')  || '',
  };
}

function saveGHConfig(owner, repo, branch, token) {
  localStorage.setItem('gh_owner',  owner);
  localStorage.setItem('gh_repo',   repo);
  localStorage.setItem('gh_branch', branch);
  localStorage.setItem('gh_token',  token);
}

function isConfigured() {
  const c = getGHConfig();
  return c.owner && c.repo && c.token;
}

// ============================================================================
// GitHub API helpers
// ============================================================================
async function ghFetch(path, options = {}) {
  const c = getGHConfig();
  const url = `https://api.github.com/repos/${c.owner}/${c.repo}${path}`;
  const headers = {
    'Authorization': `Bearer ${c.token}`,
    'Accept': 'application/vnd.github.v3+json',
    ...options.headers,
  };
  const resp = await fetch(url, { ...options, headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`GitHub API ${resp.status}: ${body}`);
  }
  return resp.json();
}

/**
 * Read a file from the repo and return { content, sha }.
 */
async function readFile(filePath) {
  const c = getGHConfig();
  const data = await ghFetch(`/contents/${filePath}?ref=${c.branch}`);
  const content = atob(data.content.replace(/\n/g, ''));
  return { content, sha: data.sha };
}

/**
 * Write (create or update) a file in the repo.
 */
async function writeFile(filePath, content, sha, message) {
  const c = getGHConfig();
  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: c.branch,
  };
  if (sha) body.sha = sha;
  return ghFetch(`/contents/${filePath}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

// ============================================================================
// YAML mini parser/serializer
// (Handles the subset needed for reminders.yaml — no external deps)
// ============================================================================
function parseYAML(text) {
  /*
   * We use a simple line-by-line parser for our known structure:
   *   reminders:
   *     - id: ...
   *       message: "..."
   *       schedule: "..."
   *       ...
   *       channels:
   *         - google_chat
   *         - email
   *       metadata:
   *         team: "..."
   *         tags:
   *           - tag1
   */
  const reminders = [];
  const lines = text.split('\n');
  let current = null;
  let inChannels = false;
  let inEmailRecipients = false;
  let inMetadata = false;
  let inTags = false;
  let inMessage = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');

    // New reminder item
    if (/^\s*-\s+id:\s*(.+)/.test(line)) {
      if (current) reminders.push(current);
      current = {
        id: RegExp.$1.trim().replace(/^["']|["']$/g, ''),
        message: '',
        schedule: '',
        schedule_type: 'cron',
        interval_days: 0,
        start_date: '',
        timezone: 'Asia/Kolkata',
        enabled: true,
        channels: [],
        gchat_webhook: '',
        email_recipients: [],
        metadata: {},
      };
      inChannels = false;
      inEmailRecipients = false;
      inMetadata = false;
      inTags = false;
      inMessage = false;
      continue;
    }

    if (!current) continue;

    // Block scalar message lines (indented under "message: |")
    if (inMessage) {
      if (/^      /.test(rawLine) || rawLine.trim() === '') {
        current.message += (current.message ? '\n' : '') + rawLine.replace(/^      /, '');
        continue;
      } else {
        inMessage = false;
        current.message = current.message.trimEnd();
      }
    }

    // Detect section headers
    if (/^\s+channels:\s*$/.test(line)) {
      inChannels = true;
      inEmailRecipients = false;
      inMetadata = false;
      inTags = false;
      continue;
    }
    if (/^\s+email_recipients:\s*$/.test(line)) {
      inEmailRecipients = true;
      inChannels = false;
      inMetadata = false;
      inTags = false;
      continue;
    }
    if (/^\s+metadata:\s*$/.test(line)) {
      inMetadata = true;
      inChannels = false;
      inEmailRecipients = false;
      inTags = false;
      continue;
    }
    if (inMetadata && /^\s+tags:\s*$/.test(line)) {
      inTags = true;
      continue;
    }

    // Channel list items
    if (inChannels && /^\s+-\s+(.+)/.test(line)) {
      current.channels.push(RegExp.$1.trim().replace(/^["']|["']$/g, ''));
      continue;
    }

    // Email recipients list items
    if (inEmailRecipients && /^\s+-\s+(.+)/.test(line)) {
      current.email_recipients.push(RegExp.$1.trim().replace(/^["']|["']$/g, ''));
      continue;
    }

    // Tags list items
    if (inTags && /^\s+-\s+(.+)/.test(line)) {
      if (!current.metadata.tags) current.metadata.tags = [];
      current.metadata.tags.push(RegExp.$1.trim().replace(/^["']|["']$/g, ''));
      continue;
    }

    // Metadata key-value
    if (inMetadata && !inTags && /^\s+(team|priority):\s*(.+)/.test(line)) {
      current.metadata[RegExp.$1.trim()] = RegExp.$2.trim().replace(/^["']|["']$/g, '');
      continue;
    }

    // Top-level keys of current reminder
    if (/^\s+message:\s*\|/.test(line)) {
      current.message = '';
      inMessage = true;
      inChannels = false; inEmailRecipients = false; inMetadata = false; inTags = false;
    } else if (/^\s+message:\s*(.+)/.test(line)) {
      current.message = RegExp.$1.trim().replace(/^["']|["']$/g, '');
      inChannels = false; inEmailRecipients = false; inMetadata = false; inTags = false;
    } else if (/^\s+schedule_type:\s*(.+)/.test(line)) {
      current.schedule_type = RegExp.$1.trim().replace(/^["']|["']$/g, '');
      inChannels = false; inEmailRecipients = false; inMetadata = false; inTags = false;
    } else if (/^\s+interval_days:\s*(.+)/.test(line)) {
      current.interval_days = parseInt(RegExp.$1.trim(), 10);
      inChannels = false; inEmailRecipients = false; inMetadata = false; inTags = false;
    } else if (/^\s+start_date:\s*(.+)/.test(line)) {
      current.start_date = RegExp.$1.trim().replace(/^["']|["']$/g, '');
      inChannels = false; inEmailRecipients = false; inMetadata = false; inTags = false;
    } else if (/^\s+schedule:\s*(.+)/.test(line)) {
      current.schedule = RegExp.$1.trim().replace(/^["']|["']$/g, '');
      inChannels = false; inEmailRecipients = false; inMetadata = false; inTags = false;
    } else if (/^\s+timezone:\s*(.+)/.test(line)) {
      current.timezone = RegExp.$1.trim().replace(/^["']|["']$/g, '');
      inChannels = false; inEmailRecipients = false; inMetadata = false; inTags = false;
    } else if (/^\s+enabled:\s*(.+)/.test(line)) {
      current.enabled = RegExp.$1.trim() === 'true';
      inChannels = false; inEmailRecipients = false; inMetadata = false; inTags = false;
    } else if (/^\s+gchat_webhook:\s*(.+)/.test(line)) {
      current.gchat_webhook = RegExp.$1.trim().replace(/^["']|["']$/g, '');
      inChannels = false; inEmailRecipients = false; inMetadata = false; inTags = false;
    }
  }
  if (current) reminders.push(current);
  return reminders;
}

function serializeYAML(reminders) {
  let out = 'reminders:\n';
  for (const r of reminders) {
    out += `  - id: ${r.id}\n`;
    // Use block scalar (|) so multi-line messages and special characters never break YAML
    const msgLines = r.message.split('\n').map(l => `      ${l}`).join('\n');
    out += `    message: |\n${msgLines}\n`;
    if (r.schedule_type === 'interval_days') {
      out += `    schedule_type: interval_days\n`;
      out += `    interval_days: ${r.interval_days}\n`;
      out += `    start_date: "${r.start_date}"\n`;
    } else {
      out += `    schedule: "${r.schedule}"\n`;
    }
    out += `    timezone: "${r.timezone}"\n`;
    out += `    enabled: ${r.enabled}\n`;
    out += `    channels:\n`;
    for (const ch of r.channels) {
      out += `      - ${ch}\n`;
    }
    if (r.gchat_webhook) {
      out += `    gchat_webhook: "${r.gchat_webhook}"\n`;
    }
    if (r.email_recipients && r.email_recipients.length) {
      out += `    email_recipients:\n`;
      for (const addr of r.email_recipients) {
        out += `      - ${addr}\n`;
      }
    }
    if (r.metadata && (r.metadata.team || (r.metadata.tags && r.metadata.tags.length))) {
      out += `    metadata:\n`;
      if (r.metadata.team) out += `      team: "${r.metadata.team}"\n`;
      if (r.metadata.tags && r.metadata.tags.length) {
        out += `      tags:\n`;
        for (const t of r.metadata.tags) {
          out += `        - ${t}\n`;
        }
      }
    }
    out += '\n';
  }
  return out;
}

// ============================================================================
// Cron helpers (using cronstrue CDN loaded in HTML)
// ============================================================================
function humanCron(expr) {
  try {
    return cronstrue.toString(expr, { use24HourTimeFormat: true });
  } catch {
    return 'Invalid cron';
  }
}

function isValidCron(expr) {
  try {
    cronstrue.toString(expr);
    return true;
  } catch {
    return false;
  }
}

/**
 * Calculate next run times from a cron expression.
 * Uses a simple brute-force minute-by-minute scan (good enough for UI preview).
 */
function getNextRuns(cronExpr, count = 1) {
  try {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return [];

    const [minP, hourP, domP, monP, dowP] = parts;
    const now = new Date();
    const results = [];
    const check = new Date(now.getTime() + 60000); // start from next minute
    check.setSeconds(0, 0);

    for (let i = 0; i < 525600 && results.length < count; i++) { // scan up to 1 year
      const m = check.getMinutes();
      const h = check.getHours();
      const dom = check.getDate();
      const mon = check.getMonth() + 1;
      const dow = check.getDay();

      if (
        matchCronField(minP, m, 0, 59) &&
        matchCronField(hourP, h, 0, 23) &&
        matchCronField(domP, dom, 1, 31) &&
        matchCronField(monP, mon, 1, 12) &&
        matchCronField(dowP, dow, 0, 6)
      ) {
        results.push(new Date(check));
      }
      check.setTime(check.getTime() + 60000);
    }
    return results;
  } catch {
    return [];
  }
}

function matchCronField(field, value, min, max) {
  if (field === '*') return true;

  // Handle step: */n or range/n
  if (field.includes('/')) {
    const [base, step] = field.split('/');
    const s = parseInt(step, 10);
    if (isNaN(s) || s <= 0) return false;
    let start = min;
    if (base !== '*') start = parseInt(base, 10);
    return (value - start) % s === 0 && value >= start;
  }

  // Handle range: a-b
  if (field.includes('-')) {
    const [a, b] = field.split('-').map(Number);
    return value >= a && value <= b;
  }

  // Handle list: a,b,c
  if (field.includes(',')) {
    return field.split(',').map(Number).includes(value);
  }

  return parseInt(field, 10) === value;
}

function formatDate(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function timeUntil(d) {
  const ms = d.getTime() - Date.now();
  if (ms < 0) return 'overdue';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `in ${days}d ${hours % 24}h`;
}

// ============================================================================
// Toast system
// ============================================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

// ============================================================================
// DOM references
// ============================================================================
const $ = (sel) => document.querySelector(sel) || { addEventListener: () => {}, classList: { remove: () => {}, add: () => {} }, style: {}, value: '', checked: false, textContent: '', innerHTML: '', disabled: false, readOnly: false };
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  settingsModal: $('#settings-modal'),
  settingsClose: $('#settings-close'),
  settingsCancel: $('#settings-cancel'),
  settingsSave: $('#settings-save'),
  btnSettings: $('#btn-settings'),
  ghOwner: $('#gh-owner'),
  ghRepo: $('#gh-repo'),
  ghBranch: $('#gh-branch'),
  ghToken: $('#gh-token'),
  statusBar: $('#status-bar'),
  statusText: $('#status-text'),
  reminderCount: $('#reminder-count'),
  btnRefresh: $('#btn-refresh'),
  btnAdd: $('#btn-add'),
  tbody: $('#reminders-body'),
  logsContainer: $('#logs-container'),
  reminderModal: $('#reminder-modal'),
  modalTitle: $('#modal-title'),
  reminderClose: $('#reminder-close'),
  reminderCancel: $('#reminder-cancel'),
  reminderSave: $('#reminder-save'),
  remId: $('#rem-id'),
  remMessage: $('#rem-message'),
  remSchedule: $('#rem-schedule'),
  remTimezone: $('#rem-timezone'),
  remEnabled: $('#rem-enabled'),
  remTeam: $('#rem-team'),
  remTags: $('#rem-tags'),
  cronPreview: $('#cron-preview'),
  chGoogleChat: $('#ch-google-chat'),
  chEmail: $('#ch-email'),
  chWebhook: $('#ch-webhook'),
  remGchatWebhook: $('#rem-gchat-webhook'),
  remEmailRecipients: $('#rem-email-recipients'),
  gchatWebhookContainer: $('#gchat-webhook-container'),
  emailRecipientsContainer: $('#email-recipients-container'),
  deleteModal: $('#delete-modal'),
  deleteId: $('#delete-id'),
  deleteClose: $('#delete-close'),
  deleteCancel: $('#delete-cancel'),
  deleteConfirm: $('#delete-confirm'),
  remScheduleType: $('#rem-schedule-type'),
  cronContainer: $('#cron-container'),
  intervalContainer: $('#interval-container'),
  remIntervalDays: $('#rem-interval-days'),
  remStartDate: $('#rem-start-date'),
  viewModal: $('#view-modal'),
  viewId: $('#view-id'),
  viewMessage: $('#view-message'),
  viewSchedule: $('#view-schedule'),
  viewTimezone: $('#view-timezone'),
  viewChannels: $('#view-channels'),
  viewEmailRecipients: $('#view-email-recipients'),
  viewClose: $('#view-close'),
  viewCloseBtn: $('#view-close-btn'),
};

// ============================================================================
// Render
// ============================================================================
function renderTable() {
  const { reminders } = state;
  dom.reminderCount.textContent = `Reminders (${reminders.length})`;

  if (!reminders.length) {
    dom.tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">
          <div class="empty-state-content">
            <span class="empty-icon">📭</span>
            <p>No reminders found</p>
            <small>Click "Add Reminder" to create one</small>
          </div>
        </td>
      </tr>`;
    return;
  }

  dom.tbody.innerHTML = reminders.map(r => {
    let human = '';
    let nextRuns = [];
    if (r.schedule_type === 'interval_days') {
        human = `Every ${r.interval_days} days from ${r.start_date}`;
        // approximate next run
        const start = new Date(r.start_date);
        const now = new Date();
        const diffMs = now.getTime() - start.getTime();
        const diffDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
        let nextInterval = Math.ceil(diffDays / r.interval_days) * r.interval_days;
        if (nextInterval === 0 && start > now) nextInterval = 0; // hasn't started yet
        // if today is exactly matching (diff%interval == 0), the next one might be today or later today. We'll simplify UI.
        const nextDate = new Date(start.getTime() + nextInterval * 24 * 60 * 60 * 1000);
        nextRuns = [nextDate];
    } else {
        human = humanCron(r.schedule);
        nextRuns = getNextRuns(r.schedule, 1);
    }
    const nextStr = nextRuns.length
      ? `<span class="next-run-time">${formatDate(nextRuns[0])}</span><span>${timeUntil(nextRuns[0])}</span>`
      : '<span>—</span>';

    const channelPills = r.channels.map(
      ch => `<span class="channel-pill ${ch}">${ch.replace('_', ' ')}</span>`
    ).join(' ');

    const statusClass = r.enabled ? 'enabled' : 'disabled';
    const statusLabel = r.enabled ? 'Active' : 'Paused';

    const scheduleCode = r.schedule_type === 'interval_days' ? `interval: ${r.interval_days}d` : r.schedule;

    return `
      <tr data-id="${r.id}">
        <td>
          <button class="status-badge ${statusClass}" data-action="toggle" data-id="${r.id}" title="Click to toggle">
            <span class="status-dot"></span>
            ${statusLabel}
          </button>
        </td>
        <td><span class="rem-id">${r.id}</span></td>
        <td><span class="rem-message" title="${r.message}">${r.message}</span></td>
        <td>
          <div class="schedule-group">
            <code class="schedule-cron">${scheduleCode}</code>
            <span class="schedule-human">${human}</span>
          </div>
        </td>
        <td><div class="next-run">${nextStr}</div></td>
        <td>${channelPills}</td>
        <td>
          <div class="actions-cell">
            <button class="btn-icon" data-action="view" data-id="${r.id}" title="View">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="btn-icon" data-action="edit" data-id="${r.id}" title="Edit">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-icon" data-action="test" data-id="${r.id}" title="Send test">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
            <button class="btn-icon" data-action="delete" data-id="${r.id}" title="Delete">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function renderLogs() {
  if (!state.logs.length) {
    dom.logsContainer.innerHTML = '<p class="logs-empty">No logs available</p>';
    return;
  }
  // Show last 30 logs, newest first
  const recent = [...state.logs].reverse().slice(0, 30);
  dom.logsContainer.innerHTML = recent.map(e => {
    const icon = e.status === 'success' ? '✅' : '❌';
    const time = e.timestamp ? e.timestamp.replace('T', ' ').replace('Z', '') : '—';
    return `
      <div class="log-entry">
        <span class="log-icon">${icon}</span>
        <span class="log-time">${time}</span>
        <span class="log-id">${e.reminder_id || '—'}</span>
        <span class="log-status ${e.status}">${e.status}</span>
        <span class="log-message">${e.message || ''}</span>
      </div>`;
  }).join('');
}

function setStatus(type, text) {
  dom.statusBar.className = `status-bar status-${type}`;
  dom.statusText.textContent = text;
}

// ============================================================================
// Data operations
// ============================================================================
async function loadReminders() {
  try {
    setStatus('connected', 'Loading reminders …');
    const { content, sha } = await readFile('reminders.yaml');
    state.fileSha = sha;
    state.reminders = parseYAML(content);
    state.connected = true;
    setStatus('connected', `Connected to ${getGHConfig().owner}/${getGHConfig().repo}`);
    renderTable();
    showToast(`Loaded ${state.reminders.length} reminder(s)`, 'success');
  } catch (err) {
    state.connected = false;
    setStatus('error', `Failed to load: ${err.message}`);
    showToast('Failed to load reminders', 'error');
    console.error(err);
  }
}

async function loadLogs() {
  try {
    const { content, sha } = await readFile('logs.json');
    state.logsSha = sha;
    const parsed = JSON.parse(content);
    state.logs = parsed.runs || [];
    renderLogs();
  } catch {
    // logs.json might not exist yet — that's fine
    state.logs = [];
    renderLogs();
  }
}

async function saveReminders(commitMsg) {
  try {
    const yaml = serializeYAML(state.reminders);
    // Re-fetch latest SHA to avoid 409 when the CI bot has modified the file
    const { sha: latestSha } = await readFile('reminders.yaml');
    state.fileSha = latestSha;
    const result = await writeFile('reminders.yaml', yaml, state.fileSha, commitMsg);
    state.fileSha = result.content.sha;
    showToast('Changes saved to repository', 'success');
  } catch (err) {
    showToast(`Save failed: ${err.message}`, 'error');
    throw err;
  }
}

// ============================================================================
// Settings modal
// ============================================================================
function openSettings() {
  const c = getGHConfig();
  dom.ghOwner.value = c.owner;
  dom.ghRepo.value = c.repo;
  dom.ghBranch.value = c.branch || 'main';
  dom.ghToken.value = c.token;
  dom.settingsModal.classList.remove('hidden');
}

function closeSettings() {
  dom.settingsModal.classList.add('hidden');
}

dom.btnSettings.addEventListener('click', openSettings);
dom.settingsClose.addEventListener('click', closeSettings);
dom.settingsCancel.addEventListener('click', closeSettings);
dom.settingsSave.addEventListener('click', async () => {
  const owner = dom.ghOwner.value.trim();
  const repo = dom.ghRepo.value.trim();
  const branch = dom.ghBranch.value.trim() || 'main';
  const token = dom.ghToken.value.trim();

  if (!owner || !repo || !token) {
    showToast('Please fill in all required fields', 'error');
    return;
  }

  saveGHConfig(owner, repo, branch, token);
  closeSettings();
  await loadReminders();
  await loadLogs();
});

// ============================================================================
// Reminder modal (Add / Edit)
// ============================================================================
function openReminderModal(reminder = null) {
  if (reminder) {
    state.editingId = reminder.id;
    dom.modalTitle.textContent = '✏️ Edit Reminder';
    dom.remId.value = reminder.id;
    dom.remId.disabled = true;
    dom.remMessage.value = reminder.message;
    dom.remMessage.readOnly = true;
    dom.remMessage.style.opacity = '0.6';
    dom.remMessage.style.cursor = 'not-allowed';
    dom.remSchedule.value = reminder.schedule_type === 'cron' ? (reminder.schedule || '') : '';
    dom.remScheduleType.value = reminder.schedule_type === 'interval_days' ? 'interval_days' : 'cron';
    dom.remIntervalDays.value = reminder.interval_days || '';
    dom.remStartDate.value = reminder.start_date || '';
    dom.remTimezone.value = reminder.timezone || 'Asia/Kolkata';
    dom.remEnabled.checked = reminder.enabled;
    dom.remTeam.value = reminder.metadata?.team || '';
    dom.remTags.value = (reminder.metadata?.tags || []).join(', ');
    dom.chGoogleChat.checked = reminder.channels.includes('google_chat');
    dom.chEmail.checked = reminder.channels.includes('email');
    dom.chWebhook.checked = reminder.channels.includes('webhook');
    dom.remGchatWebhook.value = reminder.gchat_webhook || '';
    dom.remEmailRecipients.value = (reminder.email_recipients || []).join(', ');
  } else {
    state.editingId = null;
    dom.modalTitle.textContent = '➕ Add Reminder';
    dom.remId.value = '';
    dom.remId.disabled = false;
    dom.remMessage.value = '';
    dom.remMessage.readOnly = false;
    dom.remMessage.style.opacity = '';
    dom.remMessage.style.cursor = '';
    dom.remScheduleType.value = 'cron';
    dom.remIntervalDays.value = '';
    dom.remStartDate.value = '';
    dom.remSchedule.value = '';
    dom.remTimezone.value = 'Asia/Kolkata';
    dom.remEnabled.checked = true;
    dom.remTeam.value = '';
    dom.remTags.value = '';
    dom.chGoogleChat.checked = true;
    dom.chEmail.checked = false;
    dom.chWebhook.checked = false;
    dom.remGchatWebhook.value = '';
    dom.remEmailRecipients.value = '';
  }
  applyScheduleTypeToggle();
  applyChannelToggle();
  updateCronPreview();
  dom.reminderModal.classList.remove('hidden');
}

function closeReminderModal() {
  dom.reminderModal.classList.add('hidden');
}

function updateCronPreview() {
  const expr = dom.remSchedule.value.trim();
  if (!expr) {
    dom.cronPreview.textContent = '';
    return;
  }
  if (isValidCron(expr)) {
    dom.cronPreview.textContent = humanCron(expr);
    dom.cronPreview.style.color = '';
  } else {
    dom.cronPreview.textContent = '❌ Invalid cron expression';
    dom.cronPreview.style.color = 'var(--clr-danger)';
  }
}

dom.remSchedule.addEventListener('input', updateCronPreview);

function applyScheduleTypeToggle() {
  if (dom.remScheduleType.value === 'interval_days') {
    dom.cronContainer.style.display = 'none';
    dom.intervalContainer.style.display = 'flex';
  } else {
    dom.cronContainer.style.display = 'flex';
    dom.intervalContainer.style.display = 'none';
  }
}

dom.remScheduleType.addEventListener('change', applyScheduleTypeToggle);

function applyChannelToggle() {
  dom.gchatWebhookContainer.style.display = dom.chGoogleChat.checked ? '' : 'none';
  dom.emailRecipientsContainer.style.display = dom.chEmail.checked ? '' : 'none';
}

dom.chGoogleChat.addEventListener('change', applyChannelToggle);
dom.chEmail.addEventListener('change', applyChannelToggle);

dom.btnAdd.addEventListener('click', () => openReminderModal());
dom.reminderClose.addEventListener('click', closeReminderModal);
dom.reminderCancel.addEventListener('click', closeReminderModal);

dom.reminderSave.addEventListener('click', async () => {
  const id = dom.remId.value.trim();
  const message = dom.remMessage.value.trim();
  const scheduleType = dom.remScheduleType.value;
  const schedule = dom.remSchedule.value.trim();
  const intervalDays = parseInt(dom.remIntervalDays.value, 10);
  const startDate = dom.remStartDate.value.trim();
  const timezone = dom.remTimezone.value.trim() || 'Asia/Kolkata';
  const enabled = dom.remEnabled.checked;
  const team = dom.remTeam.value.trim();
  const tagsRaw = dom.remTags.value.trim();
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  const channels = [];
  if (dom.chGoogleChat.checked) channels.push('google_chat');
  if (dom.chEmail.checked) channels.push('email');
  if (dom.chWebhook.checked) channels.push('webhook');

  const gchatWebhook = dom.remGchatWebhook.value.trim();
  const emailRecipientsRaw = dom.remEmailRecipients.value.trim();
  const emailRecipients = emailRecipientsRaw
    ? emailRecipientsRaw.split(',').map(e => e.trim()).filter(Boolean)
    : [];

  // Validation
  if (!id || !message) {
    showToast('ID, and Message are required', 'error');
    return;
  }
  if (!/^[a-z0-9_]+$/.test(id)) {
    showToast('ID must be snake_case (lowercase, numbers, underscores)', 'error');
    return;
  }
  if (scheduleType === 'cron' && !isValidCron(schedule)) {
    showToast('Invalid cron expression', 'error');
    return;
  }
  if (scheduleType === 'interval_days') {
    if (isNaN(intervalDays) || intervalDays <= 0) {
      showToast('Interval must be > 0', 'error');
      return;
    }
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || isNaN(Date.parse(startDate))) {
      showToast('Enter a valid Start Date (YYYY-MM-DD)', 'error');
      return;
    }
  }
  if (!channels.length) {
    showToast('Select at least one channel', 'error');
    return;
  }

  const reminder = {
    id,
    message,
    schedule_type: scheduleType,
    schedule: scheduleType === 'cron' ? schedule : '',
    interval_days: scheduleType === 'interval_days' ? intervalDays : 0,
    start_date: scheduleType === 'interval_days' ? startDate : '',
    timezone,
    enabled,
    channels,
    gchat_webhook: gchatWebhook || '',
    email_recipients: emailRecipients,
    metadata: {},
  };
  if (team) reminder.metadata.team = team;
  if (tags.length) reminder.metadata.tags = tags;

  if (state.editingId) {
    // Update existing
    const idx = state.reminders.findIndex(r => r.id === state.editingId);
    if (idx >= 0) state.reminders[idx] = reminder;
  } else {
    // Check for duplicate ID
    if (state.reminders.some(r => r.id === id)) {
      showToast(`Reminder "${id}" already exists`, 'error');
      return;
    }
    state.reminders.push(reminder);
  }

  closeReminderModal();
  renderTable();

  try {
    const action = state.editingId ? 'Update' : 'Add';
    await saveReminders(`📝 ${action} reminder: ${id}`);
  } catch {
    // revert on failure
    await loadReminders();
  }
});

// ============================================================================
// Delete modal
// ============================================================================
let pendingDeleteId = null;

function openViewModal(reminder) {
  dom.viewId.textContent = reminder.id;
  dom.viewMessage.value = reminder.message;
  const schedule = reminder.schedule_type === 'interval_days'
    ? `Every ${reminder.interval_days} days from ${reminder.start_date}`
    : reminder.schedule;
  dom.viewSchedule.value = schedule || '';
  dom.viewTimezone.value = reminder.timezone || '';
  dom.viewChannels.value = (reminder.channels || []).join(', ');
  dom.viewEmailRecipients.value = (reminder.email_recipients || []).join(', ');
  dom.viewModal.classList.remove('hidden');
}

function closeViewModal() {
  dom.viewModal.classList.add('hidden');
}

dom.viewClose.addEventListener('click', closeViewModal);
dom.viewCloseBtn.addEventListener('click', closeViewModal);
dom.viewModal.addEventListener('click', (e) => { if (e.target === dom.viewModal) closeViewModal(); });

function openDeleteModal(id) {
  pendingDeleteId = id;
  dom.deleteId.textContent = id;
  dom.deleteModal.classList.remove('hidden');
}

function closeDeleteModal() {
  dom.deleteModal.classList.add('hidden');
  pendingDeleteId = null;
}

dom.deleteClose.addEventListener('click', closeDeleteModal);
dom.deleteCancel.addEventListener('click', closeDeleteModal);
dom.deleteConfirm.addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  state.reminders = state.reminders.filter(r => r.id !== pendingDeleteId);
  const deletedId = pendingDeleteId;
  closeDeleteModal();
  renderTable();
  try {
    await saveReminders(`🗑️ Delete reminder: ${deletedId}`);
  } catch {
    await loadReminders();
  }
});

// ============================================================================
// Table action delegation
// ============================================================================
dom.tbody.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;
  const reminder = state.reminders.find(r => r.id === id);

  switch (action) {
    case 'view':
      if (reminder) openViewModal(reminder);
      break;

    case 'edit':
      if (reminder) openReminderModal(reminder);
      break;

    case 'delete':
      openDeleteModal(id);
      break;

    case 'toggle':
      if (reminder) {
        reminder.enabled = !reminder.enabled;
        renderTable();
        try {
          const status = reminder.enabled ? 'Enable' : 'Disable';
          await saveReminders(`🔀 ${status} reminder: ${id}`);
        } catch {
          await loadReminders();
        }
      }
      break;

    case 'test': {
      const c = getGHConfig();
      if (!c.owner || !c.repo || !c.token) {
        showToast('Configure GitHub settings first', 'error');
        break;
      }
      try {
        showToast(`🧪 Triggering test for "${id}" …`, 'info');
        await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}/actions/workflows/reminder.yml/dispatches`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${c.token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ref: c.branch, inputs: { test_reminder_id: id } }),
        }).then(r => {
          if (r.ok || r.status === 204) {
            showToast(`✅ Test triggered for "${id}" – check GitHub Actions for results.`, 'success');
          } else {
            return r.text().then(t => { throw new Error(t); });
          }
        });
      } catch (err) {
        showToast(`❌ Failed to trigger test: ${err.message}`, 'error');
      }
      break;
    }
  }
});

// ============================================================================
// Refresh
// ============================================================================
dom.btnRefresh.addEventListener('click', async () => {
  if (!isConfigured()) {
    showToast('Configure GitHub settings first', 'error');
    return;
  }
  await loadReminders();
  await loadLogs();
});

// ============================================================================
// Close modals with Escape
// ============================================================================
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSettings();
    closeDeleteModal();
  }
});

// Close only settings/delete modals on overlay click — reminder modal requires explicit Cancel/close
[dom.settingsModal, dom.deleteModal].forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeSettings();
      closeDeleteModal();
    }
  });
});

// ============================================================================
// Init
// ============================================================================
(async function init() {
  if (isConfigured()) {
    await loadReminders();
    await loadLogs();
  } else {
    setStatus('disconnected', 'Not connected – click ⚙️ to configure GitHub settings');
  }
})();
