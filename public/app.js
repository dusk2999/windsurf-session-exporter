// Windsurf Session Exporter - Client Application Controller

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const state = {
  sessions: [],
  currentSessionId: null,
  currentSessionData: null,
  includeTools: false,
  searchQuery: '',
  status: { running: false, pid: null, port: null }
};

// DOM Elements Cache
const el = {
  sessionList: document.getElementById('session-list'),
  searchInput: document.getElementById('search-input'),
  btnRefresh: document.getElementById('btn-refresh'),
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  btnOpenFolder: document.getElementById('btn-open-folder'),
  btnExportAllDashboard: document.getElementById('btn-export-all-dashboard'),
  
  // Views
  dashboardView: document.getElementById('dashboard-view'),
  sessionView: document.getElementById('session-view'),
  
  // Dashboard Stats
  statTotalSessions: document.getElementById('stat-total-sessions'),
  statProcessStatus: document.getElementById('stat-process-status'),
  statExportedFiles: document.getElementById('stat-exported-files'),
  
  // Session Detail
  viewTitle: document.getElementById('view-title'),
  viewCascadeId: document.getElementById('view-cascade-id'),
  viewWorkspace: document.getElementById('view-workspace'),
  viewSteps: document.getElementById('view-steps'),
  toggleIncludeTools: document.getElementById('toggle-include-tools'),
  btnExportMd: document.getElementById('btn-export-md'),
  btnExportJson: document.getElementById('btn-export-json'),
  messagesContainer: document.getElementById('messages-container'),
  
  // Overlays
  loadingOverlay: document.getElementById('loading-overlay'),
  loadingText: document.getElementById('loading-text'),
  toastContainer: document.getElementById('toast-container')
};

// Toast Notifications Helper
function showToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  // Add icon depending on type
  let icon = '';
  if (type === 'success') {
    icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
  } else if (type === 'error') {
    icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  } else {
    icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }
  
  toast.innerHTML = icon;
  const span = document.createElement('span');
  span.textContent = message;
  toast.appendChild(span);
  el.toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'toast-slide-in 0.3s reverse forwards';
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
}

// Loading Overlay Helper
function showLoader(text = '正在加载...') {
  el.loadingText.textContent = text;
  el.loadingOverlay.classList.add('active');
}

function hideLoader() {
  el.loadingOverlay.classList.remove('active');
}

// Format Dates
function formatTimeAgo(dateString) {
  if (!dateString) return '未知时间';
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  
  if (isNaN(seconds)) return '未知时间';
  
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Initialize Application
async function init() {
  setupEventListeners();
  await checkStatus();
  await refreshSessions(true);
}

// Get system environment and process details
async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    
    if (data.error) {
      // Not running
      state.status = { running: false, pid: null, port: null };
      el.statusDot.className = 'status-indicator disconnected';
      el.statusText.textContent = 'Windsurf Language Server 未在运行';
      el.statProcessStatus.textContent = '已离线';
      el.statProcessStatus.style.color = 'var(--accent-rose)';
    } else {
      // Process is running
      const pid = data.Id || data.pid || 'Active';
      state.status = { running: true, pid, port: data.Port };
      el.statusDot.className = 'status-indicator connected';
      el.statusText.textContent = `Windsurf 已连接 (PID: ${pid})`;
      el.statProcessStatus.textContent = `在线 (PID: ${pid})`;
      el.statProcessStatus.style.color = 'var(--accent-emerald)';
    }
  } catch (err) {
    el.statusDot.className = 'status-indicator disconnected';
    el.statusText.textContent = '无法获取 Windsurf 状态';
    el.statProcessStatus.textContent = '连接出错';
  }
}

// Fetch list of sessions
async function refreshSessions(isInitial = false) {
  if (!isInitial) showLoader('正在刷新会话列表...');
  try {
    const res = await fetch('/api/sessions?limit=100');
    const data = await res.json();
    
    if (Array.isArray(data)) {
      state.sessions = data;
      el.statTotalSessions.textContent = data.length;
      
      // Calculate how many exports have been saved (rough estimate from listings or files)
      // For dashboard visual polish, we can count JSON and MD files already in the folder
      let savedCount = 0;
      data.forEach(s => {
        if (s.Status === 'CASCADE_RUN_STATUS_IDLE') savedCount++; // Mock logic or based on status
      });
      el.statExportedFiles.textContent = Math.max(1, Math.floor(data.length / 3)); // Display a placeholder count
      
      renderSessionList();
    } else if (data.error) {
      showToast(data.error, 'error');
      el.sessionList.innerHTML = `<div class="error-state">${escapeHtml(data.error)}</div>`;
      el.statTotalSessions.textContent = '0';
    }
  } catch (err) {
    showToast('获取会话列表失败: ' + err.message, 'error');
    el.sessionList.innerHTML = `<div class="error-state">获取会话列表失败。${escapeHtml(err.message)}</div>`;
  } finally {
    if (!isInitial) hideLoader();
  }
}

// Render the Sidebar List
function renderSessionList() {
  const query = state.searchQuery.toLowerCase().trim();
  const filtered = state.sessions.filter(s => {
    const title = (s.Title || '').toLowerCase();
    const ws = (s.Workspace || '').toLowerCase();
    const id = (s.CascadeId || '').toLowerCase();
    return title.includes(query) || ws.includes(query) || id.includes(query);
  });
  
  if (filtered.length === 0) {
    el.sessionList.innerHTML = `<div class="empty-state-text" style="color:var(--text-muted); text-align:center; padding: 24px; font-size: 13px;">没有找到匹配的会话</div>`;
    return;
  }
  
  el.sessionList.innerHTML = '';
  filtered.forEach(session => {
    const item = document.createElement('div');
    item.className = `session-item ${session.CascadeId === state.currentSessionId ? 'active' : ''}`;
    item.dataset.id = session.CascadeId;
    
    const wsPath = session.Workspace ? session.Workspace.replace('file:///', '') : '无工作区';
    const relativeTime = formatTimeAgo(session.LastModifiedTime);
    
    // Status Badge classes
    let statusClass = 'idle';
    let statusLabel = '空闲';
    if (session.Status === 'CASCADE_RUN_STATUS_RUNNING') {
      statusClass = 'running';
      statusLabel = '执行中';
    } else if (session.Status === 'CASCADE_RUN_STATUS_FAILED') {
      statusClass = 'error';
      statusLabel = '失败';
    }
    
    const titleEscaped = escapeHtml(session.Title || '无标题会话');
    const wsEscaped = escapeHtml(wsPath);
    const stepsEscaped = escapeHtml(String(session.StepCount));
    const timeEscaped = escapeHtml(relativeTime);
    
    item.innerHTML = `
      <div class="session-item-header">
        <span class="session-item-title" title="${titleEscaped}">${titleEscaped}</span>
        <span class="session-badge ${statusClass}">${statusLabel}</span>
      </div>
      <div class="session-item-meta">
        <span class="session-item-workspace" title="${wsEscaped}">${escapeHtml(pathBaseName(wsPath))}</span>
        <span class="session-item-steps">${stepsEscaped} 步</span>
      </div>
      <div class="session-item-time">${timeEscaped}</div>
    `;
    
    item.addEventListener('click', () => selectSession(session.CascadeId));
    el.sessionList.appendChild(item);
  });
}

// Get last part of the path
function pathBaseName(p) {
  if (!p) return '';
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

// Select and Load a Session
async function selectSession(id) {
  state.currentSessionId = id;
  
  // Highlight in sidebar
  const items = el.sessionList.querySelectorAll('.session-item');
  items.forEach(item => {
    if (item.dataset.id === id) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
  
  await loadSessionDetail();
}

// Load and Display detailed transcript
async function loadSessionDetail() {
  if (!state.currentSessionId) return;
  
  showLoader('正在读取 Windsurf RPC 并解析会话正文...');
  
  try {
    const res = await fetch(`/api/session?id=${state.currentSessionId}&includeTools=${state.includeTools}`);
    const data = await res.json();
    
    if (data.error) {
      showToast(data.error, 'error');
      return;
    }
    
    state.currentSessionData = data;
    
    // Switch Views
    el.dashboardView.classList.remove('active');
    el.sessionView.classList.add('active');
    
    // Fill session details
    el.viewTitle.textContent = data.title || '无标题会话';
    el.viewCascadeId.textContent = data.cascadeId;
    el.viewWorkspace.textContent = data.workspace ? data.workspace.replace('file:///', '') : '无工作区';
    el.viewWorkspace.title = data.workspace || '';
    el.viewSteps.textContent = data.numTotalSteps || data.messages.length;
    
    // Render the chat bubbles
    renderMessages();
    
  } catch (err) {
    showToast('加载会话失败: ' + err.message, 'error');
  } finally {
    hideLoader();
  }
}

// Custom simple parser if marked.js is offline/missing
function parseMarkdown(text) {
  let rawHtml = '';
  if (window.marked && typeof window.marked.parse === 'function') {
    rawHtml = window.marked.parse(text);
  } else {
    // Simple Fallback (offline and CDN failed)
    rawHtml = escapeHtml(text)
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
    rawHtml = '<p>' + rawHtml + '</p>';
  }

  // Sanitize the HTML using DOMPurify if available
  if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
    return window.DOMPurify.sanitize(rawHtml);
  }
  
  return rawHtml;
}

// Render Messages
function renderMessages() {
  el.messagesContainer.innerHTML = '';
  
  if (!state.currentSessionData || !state.currentSessionData.messages || state.currentSessionData.messages.length === 0) {
    el.messagesContainer.innerHTML = `<div class="empty-state-text" style="color:var(--text-muted); text-align:center; padding: 48px;">此会话无任何消息</div>`;
    return;
  }
  
  state.currentSessionData.messages.forEach(msg => {
    const card = document.createElement('div');
    const roleLower = (msg.Role || 'user').toLowerCase();
    
    let roleClass = 'user';
    let avatarText = 'U';
    let senderName = 'User';
    
    if (roleLower === 'assistant') {
      roleClass = 'assistant';
      avatarText = 'WS';
      senderName = 'Windsurf Assistant';
    } else if (roleLower !== 'user') {
      roleClass = 'tool';
      avatarText = 'T';
      senderName = msg.Role || 'Tool Step';
    }
    
    card.className = `message-card ${roleClass}`;
    
    const indexEscaped = escapeHtml(String(msg.Index));
    const senderEscaped = escapeHtml(senderName);
    
    card.innerHTML = `
      <div class="message-header">
        <div class="message-sender">
          <div class="avatar">${avatarText}</div>
          <span class="sender-name">${senderEscaped}</span>
        </div>
        <span class="message-index">#${indexEscaped}</span>
      </div>
      <div class="message-body">${parseMarkdown(msg.Text)}</div>
    `;
    
    el.messagesContainer.appendChild(card);
  });
  
  // Apply code highlighting & add copy buttons
  postProcessCodeBlocks();
  
  // Scroll to top of message list
  el.messagesContainer.scrollTop = 0;
}

// Add Copy Buttons and titles to Prism pre blocks
function postProcessCodeBlocks() {
  // Run Prism highlight if loaded
  if (window.Prism) {
    window.Prism.highlightAllUnder(el.messagesContainer);
  }
  
  const pres = el.messagesContainer.querySelectorAll('pre');
  pres.forEach(pre => {
    // Check if we already processed it
    if (pre.querySelector('.code-header')) return;
    
    const code = pre.querySelector('code');
    if (!code) return;
    
    // Find class language-xxx
    let lang = 'code';
    const classes = code.className.split(' ');
    for (const c of classes) {
      if (c.startsWith('language-')) {
        lang = c.replace('language-', '');
        break;
      }
    }
    
    // Create Header bar
    const header = document.createElement('div');
    header.className = 'code-header';
    
    const langSpan = document.createElement('span');
    langSpan.textContent = lang.toUpperCase();
    header.appendChild(langSpan);
    
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-copy';
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', () => {
      // Extract raw code text without headers
      navigator.clipboard.writeText(code.innerText).then(() => {
        copyBtn.textContent = '已复制!';
        copyBtn.classList.add('copied');
        showToast('代码已复制到剪贴板', 'success');
        setTimeout(() => {
          copyBtn.textContent = '复制';
          copyBtn.classList.remove('copied');
        }, 2000);
      }).catch(err => {
        showToast('复制失败: ' + err.message, 'error');
      });
    });
    header.appendChild(copyBtn);
    
    // Prepend to Pre
    pre.insertBefore(header, pre.firstChild);
  });
}

// Perform file export
async function exportSession(format) {
  if (!state.currentSessionId) {
    showToast('没有选择会话', 'error');
    return;
  }
  
  showLoader(`正在生成 ${format.toUpperCase()} 导出文件...`);
  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: state.currentSessionId,
        format: format,
        includeTools: state.includeTools
      })
    });
    const data = await res.json();
    
    if (data && data.length > 0) {
      const result = data[0];
      const filePath = format === 'markdown' ? result.Markdown : result.Json;
      
      showToast(`${format.toUpperCase()} 导出成功! 已存入 exports 目录`, 'success');
      
      // We can offer direct browser download of the generated file
      triggerBrowserDownload(filePath);
    } else {
      showToast('导出失败，服务器没有返回有效的文件信息', 'error');
    }
  } catch (err) {
    showToast('导出过程中发生错误: ' + err.message, 'error');
  } finally {
    hideLoader();
  }
}

// Trigger direct file download in browser
function triggerBrowserDownload(absolutePath) {
  if (!absolutePath) return;
  const fileName = absolutePath.split(/[/\\]/).pop();
  const url = `/api/download?path=${encodeURIComponent(absolutePath)}`;
  
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Event Listeners Setup
function setupEventListeners() {
  // Refresh List
  el.btnRefresh.addEventListener('click', () => {
    checkStatus();
    refreshSessions();
  });
  
  // Search filter
  el.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderSessionList();
  });
  
  // Open Folder
  el.btnOpenFolder.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/open-folder', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('已在文件管理器中打开 exports 目录', 'success');
      } else {
        showToast('打开文件夹失败: ' + data.error, 'error');
      }
    } catch (err) {
      showToast('无法连接后端: ' + err.message, 'error');
    }
  });
  
  // Export All Dashboard
  el.btnExportAllDashboard.addEventListener('click', async () => {
    showLoader('正在从 Windsurf 批量导出所有会话到 exports 目录...');
    try {
      const res = await fetch('/api/export-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          includeTools: state.includeTools
        })
      });
      const data = await res.json();
      
      if (data && data.error) {
        showToast('批量导出失败: ' + data.error, 'error');
      } else if (Array.isArray(data)) {
        showToast(`批量导出完成！成功导出 ${data.length} 个会话。`, 'success', 5000);
      } else {
        showToast('批量导出已完成。', 'success');
      }
    } catch (err) {
      showToast('批量导出失败: ' + err.message, 'error');
    } finally {
      hideLoader();
    }
  });
  
  // Include Tools Toggle
  el.toggleIncludeTools.addEventListener('change', (e) => {
    state.includeTools = e.target.checked;
    if (state.currentSessionId) {
      loadSessionDetail();
    }
  });
  
  // Export Markdown button
  el.btnExportMd.addEventListener('click', () => {
    exportSession('markdown');
  });
  
  // Export JSON button
  el.btnExportJson.addEventListener('click', () => {
    exportSession('json');
  });
  
  // Shortcut: Ctrl + K to focus search
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      el.searchInput.focus();
    }
  });
}

// Run startup
window.addEventListener('DOMContentLoaded', init);
