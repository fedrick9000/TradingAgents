// ── global state ──────────────────────────────────────────────────────────
const AppState = {
  phase: 'idle',          // 'idle' | 'running' | 'complete'
  sessionId: null,
  eventSource: null,
  providers: {},
  agentStatus: {},        // agent → status
  reports: {},            // section → content
  debateData: {           // speaker → content (latest)
    investment: {},
    risk: {},
  },
  feedEvents: [],
  recentAnalyses: [],     // populated from server on load + after each run
  currentMeta: {},        // ticker, date, provider for compact bar
  elapsedInterval: null,
  startTime: null,
};

// ── bootstrap ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setDefaultDate();
  loadProviders();
  wireForm();
  wireAdvancedToggle();
  loadRecentAnalyses();
});

function setDefaultDate() {
  const d = document.getElementById('date-input');
  d.value = new Date().toISOString().slice(0, 10);
  d.max   = new Date().toISOString().slice(0, 10);
}

// ── providers ─────────────────────────────────────────────────────────────
async function loadProviders() {
  try {
    const r = await fetch('/api/providers');
    const { providers } = await r.json();
    AppState.providers = providers;
    populateProviderSelect(providers);
  } catch (e) {
    showError('Failed to load providers: ' + e.message);
  }
}

function populateProviderSelect(providers) {
  const sel = document.getElementById('provider-select');
  sel.innerHTML = '';
  Object.entries(providers).forEach(([id, p]) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = p.label;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => updateModelSelects(sel.value));
  updateModelSelects(sel.value);
}

function updateModelSelects(providerId) {
  const p = AppState.providers[providerId];
  if (!p) return;
  populateSelect('deep-model-select',  p.deep_models);
  populateSelect('quick-model-select', p.quick_models);
}

function populateSelect(id, options) {
  const sel = document.getElementById(id);
  sel.innerHTML = '';
  options.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    sel.appendChild(opt);
  });
}

// ── advanced toggle ───────────────────────────────────────────────────────
function wireAdvancedToggle() {
  const btn   = document.getElementById('advanced-toggle');
  const panel = document.getElementById('advanced-panel');
  btn.addEventListener('click', () => {
    const open = !panel.classList.contains('hidden');
    panel.classList.toggle('hidden', open);
    btn.textContent = open ? 'Advanced options ▾' : 'Advanced options ▴';
  });
}

// ── form submission ───────────────────────────────────────────────────────
function wireForm() {
  document.getElementById('analyze-btn').addEventListener('click', submitForm);
}

async function submitForm() {
  clearError();
  const ticker = document.getElementById('ticker-input').value.trim().toUpperCase();
  const date   = document.getElementById('date-input').value.trim();
  const provider   = document.getElementById('provider-select').value;
  const deepModel  = document.getElementById('deep-model-select').value;
  const quickModel = document.getElementById('quick-model-select').value;
  const depth      = parseInt(document.getElementById('depth-select').value, 10);
  const language   = document.getElementById('language-select').value;

  const analysts = Array.from(
    document.querySelectorAll('#analyst-checkboxes input:checked')
  ).map(cb => cb.value);

  if (!ticker)   return showError('Please enter a ticker symbol.');
  if (!date)     return showError('Please enter a date.');
  if (!provider) return showError('Please select a provider.');
  if (analysts.length === 0) return showError('Select at least one analyst.');

  setAnalyzing(true);

  try {
    const r = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker, date, provider,
        deep_model: deepModel, quick_model: quickModel,
        selected_analysts: analysts,
        research_depth: depth,
        output_language: language,
      }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      const msg = body.detail
        ? (Array.isArray(body.detail)
            ? body.detail.map(d => d.msg).join('; ')
            : String(body.detail))
        : 'Server error';
      throw new Error(msg);
    }
    const { session_id } = await r.json();
    AppState.sessionId = session_id;
    AppState.currentMeta = { ticker, date, provider: `${provider}/${deepModel}` };
    transitionToRunning(analysts);
    openSSE(session_id);
  } catch (e) {
    setAnalyzing(false);
    showError(e.message);
  }
}

function setAnalyzing(busy) {
  document.getElementById('analyze-btn').disabled = busy;
  document.getElementById('analyze-btn').textContent = busy ? 'Analysing…' : 'Analyze';
}

function showError(msg) {
  const el = document.getElementById('analyze-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearError() {
  document.getElementById('analyze-error').classList.add('hidden');
}

// ── view transitions ──────────────────────────────────────────────────────
function transitionToRunning(selectedAnalysts) {
  AppState.phase = 'running';
  AppState.agentStatus = {};
  AppState.reports = {};
  AppState.debateData = { investment: {}, risk: {} };
  AppState.feedEvents = [];

  document.getElementById('idle-view').classList.add('hidden');
  document.getElementById('running-view').classList.remove('hidden');

  const { ticker, date, provider } = AppState.currentMeta;
  document.getElementById('compact-bar').textContent =
    `${ticker}  ·  ${date}  ·  ${provider}`;

  buildPipelineStrip(selectedAnalysts);
  resetStoryPanels(selectedAnalysts);
  clearFeed();
  startElapsed();
}

function transitionToComplete() {
  AppState.phase = 'complete';
  stopElapsed();
  // Final decision card is already rendered — nothing else needed for POC
}

// ── elapsed timer ─────────────────────────────────────────────────────────
function startElapsed() {
  AppState.startTime = Date.now();
  AppState.elapsedInterval = setInterval(() => {
    const secs = Math.floor((Date.now() - AppState.startTime) / 1000);
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    document.getElementById('elapsed-display').textContent = `${m}:${s}`;
  }, 1000);
}

function stopElapsed() {
  clearInterval(AppState.elapsedInterval);
}

// ── recent analyses (stub — populated by Task 7) ──────────────────────────
function loadRecentAnalyses() { /* Task 7 */ }

// ── Stubs — replaced/extended by Tasks 5-7 ───────────────────────────────
function buildPipelineStrip(selectedAnalysts) { /* Task 5 */ }
function resetStoryPanels(selectedAnalysts) { /* Task 6 */ }
function clearFeed() { /* Task 5 */ }
function openSSE(sessionId) { /* Task 5 */ }

// ── Task 5: pipeline strip ─────────────────────────────────────────────────
const TEAM_AGENTS = {
  'Analyst Team':       ['Market Analyst', 'Sentiment Analyst', 'News Analyst', 'Fundamentals Analyst'],
  'Research Team':      ['Bull Researcher', 'Bear Researcher', 'Research Manager'],
  'Trading Team':       ['Trader'],
  'Risk Management':    ['Aggressive Analyst', 'Neutral Analyst', 'Conservative Analyst'],
  'Portfolio Management': ['Portfolio Manager'],
};

function buildPipelineStrip(selectedAnalysts) {
  const strip = document.getElementById('pipeline-strip');
  strip.innerHTML = '';

  const analystMap = {
    market: 'Market Analyst', social: 'Sentiment Analyst',
    news: 'News Analyst', fundamentals: 'Fundamentals Analyst',
  };
  const selectedAgents = new Set(selectedAnalysts.map(k => analystMap[k]).filter(Boolean));

  Object.entries(TEAM_AGENTS).forEach(([team, agents]) => {
    // Only include agents that are relevant (selected analysts + fixed teams)
    const relevant = team === 'Analyst Team'
      ? agents.filter(a => selectedAgents.has(a))
      : agents;
    if (relevant.length === 0) return;

    const block = document.createElement('div');
    block.className = 'team-block';

    const nameEl = document.createElement('div');
    nameEl.className = 'team-name';
    nameEl.textContent = team;
    block.appendChild(nameEl);

    const dotsEl = document.createElement('div');
    dotsEl.className = 'agent-dots';
    relevant.forEach(agent => {
      AppState.agentStatus[agent] = 'pending';
      const dot = document.createElement('div');
      dot.className = 'agent-dot';
      dot.dataset.agent = agent;
      dot.dataset.status = 'pending';
      dot.title = agent;
      dotsEl.appendChild(dot);
    });
    block.appendChild(dotsEl);
    strip.appendChild(block);
  });
}

function updatePipelineStrip(agent, status) {
  AppState.agentStatus[agent] = status;
  const dot = document.querySelector(`.agent-dot[data-agent="${CSS.escape(agent)}"]`);
  if (dot) dot.dataset.status = status;

  // Also sync story card status dot
  const card = agentToCard(agent);
  if (card) {
    const statusDot = card.querySelector('.card-status-dot');
    if (statusDot) {
      statusDot.className = `card-status-dot ${status}`;
    }
    card.classList.remove('pending', 'active', 'done');
    if (status === 'in_progress') card.classList.add('active');
    if (status === 'completed')   card.classList.add('done');
  }
}

// Stub for Task 6 — returns the story card DOM element for a given agent name
function agentToCard(agent) { /* Task 6 */ return null; }

// ── Task 5: live feed ──────────────────────────────────────────────────────
function clearFeed() {
  const feed = document.getElementById('live-feed');
  feed.innerHTML = '';
}

function appendFeedRow(event) {
  const feed = document.getElementById('live-feed');
  const placeholder = feed.querySelector('.feed-placeholder');
  if (placeholder) placeholder.remove();

  const row = document.createElement('div');
  row.className = 'feed-row';

  const ts = document.createElement('span');
  ts.className = 'feed-ts';
  ts.textContent = event.ts || '';

  const badge = document.createElement('span');
  badge.className = `feed-kind kind-${event.kind}`;
  badge.textContent = event.kind === 'tool_group' ? 'tools' : event.kind;

  const content = document.createElement('div');
  content.className = 'feed-content';

  if (event.kind === 'tool_group') {
    content.textContent = event.content;
    // Expandable tool args
    badge.addEventListener('click', () => {
      content.classList.toggle('expanded');
      const existing = row.querySelector('.tool-args');
      if (existing) { existing.remove(); return; }
      const args = document.createElement('div');
      args.className = 'tool-args';
      args.textContent = (event.tools || []).join('\n');
      content.after(args);
    });
  } else {
    content.textContent = event.content || '';
  }

  row.appendChild(ts);
  row.appendChild(badge);
  row.appendChild(content);
  feed.appendChild(row);
  feed.scrollTop = feed.scrollHeight;
}

// ── Task 5: SSE client ─────────────────────────────────────────────────────
function openSSE(sessionId) {
  if (AppState.eventSource) AppState.eventSource.close();
  const es = new EventSource(`/api/stream/${sessionId}`);
  AppState.eventSource = es;

  es.onmessage = e => {
    try {
      const event = JSON.parse(e.data);
      handleEvent(event);
    } catch (err) {
      console.error('SSE parse error', err);
    }
  };

  es.onerror = () => {
    if (AppState.phase === 'running') {
      appendSystemFeed('⚠ Connection lost — results may be incomplete.');
    }
    es.close();
  };
}

function appendSystemFeed(text) {
  appendFeedRow({ ts: nowTs(), kind: 'system', content: text });
}

function nowTs() {
  return new Date().toTimeString().slice(0, 8);
}

// ── Task 5: central event dispatcher ──────────────────────────────────────
function handleEvent(event) {
  switch (event.type) {
    case 'agent_status': onAgentStatus(event); break;
    case 'feed':         onFeed(event);        break;
    case 'report':       onReport(event);      break;
    case 'debate_update':onDebateUpdate(event);break;
    case 'decision':     onDecision(event);    break;
    case 'done':         onDone(event);        break;
    case 'error':        onError(event);       break;
    default: break;
  }
}

function onAgentStatus(event) {
  updatePipelineStrip(event.agent, event.status);
  appendSystemFeed(`${event.agent} → ${event.status}`);
}

function onFeed(event) {
  appendFeedRow(event);
}

function onDone(event) {
  appendSystemFeed(`Analysis complete — ${event.elapsed_seconds}s`);
  transitionToComplete();
  loadRecentAnalyses();  // refresh the recent list
}

function onError(event) {
  appendSystemFeed(`Error: ${event.message}`);
  stopElapsed();
  setAnalyzing(false);
}

// Stubs for Tasks 6 and 7 — overridden by later appends
function onReport(event) { /* Task 6 */ }
function onDebateUpdate(event) { /* Task 7 */ }
function onDecision(event) { /* Task 7 */ }
