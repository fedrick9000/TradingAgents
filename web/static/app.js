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
  _pendingSubmit: false,  // retry flag: set when 401 triggers auth overlay
  completedTeams: new Set(),   // NEW
  totalTeams: 0,               // NEW
  lastSignal: null,            // NEW
  lastDecisionText: null,      // NEW
};

// ── team colour palette ────────────────────────────────────────────────────
const TEAM_COLORS = {
  'Analyst Team':         { hex: '#3B82F6', rgb: '59,130,246' },
  'Research Team':        { hex: '#8B5CF6', rgb: '139,92,246' },
  'Trading Team':         { hex: '#10B981', rgb: '16,185,129' },
  'Risk Management':      { hex: '#EF4444', rgb: '239,68,68'  },
  'Portfolio Management': { hex: '#F59E0B', rgb: '245,158,11' },
};

// agent → team lookup (derived at module load from TEAM_AGENTS defined below)
// Populated in wireTeamLookups() called from DOMContentLoaded
const AGENT_TO_TEAM = {};

const TEAM_TO_SCROLL_TARGET = {
  'Analyst Team':         null,              // scrolls to first visible analyst card
  'Research Team':        'panel-invest-debate',
  'Trading Team':         'panel-trader',
  'Risk Management':      'panel-risk-debate',
  'Portfolio Management': 'panel-final',
};

const CARD_TEAM = {
  'panel-market':        'Analyst Team',
  'panel-sentiment':     'Analyst Team',
  'panel-news':          'Analyst Team',
  'panel-fundamentals':  'Analyst Team',
  'panel-invest-debate': 'Research Team',
  'panel-trader':        'Trading Team',
  'panel-risk-debate':   'Risk Management',
  'panel-final':         'Portfolio Management',
};

function wireTeamLookups() {
  Object.entries(TEAM_AGENTS).forEach(([team, agents]) => {
    agents.forEach(agent => { AGENT_TO_TEAM[agent] = team; });
  });
}

// ── bootstrap ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  wireTeamLookups();   // NEW — must run before any agent event
  setDefaultDate();
  loadProviders();
  wireForm();
  wireHomeBtn();
  wireAuthForm();
  loadRecentAnalyses();
  wireTickerAutocomplete();
});

// ── auth overlay ───────────────────────────────────────────────────────────
function showAuthOverlay() {
  const overlay = document.getElementById('auth-overlay');
  overlay.classList.remove('hidden');
  setTimeout(() => document.getElementById('auth-password').focus(), 50);
}

function hideAuthOverlay() {
  document.getElementById('auth-overlay').classList.add('hidden');
}

function wireAuthForm() {
  const btn   = document.getElementById('auth-btn');
  const input = document.getElementById('auth-password');
  const err   = document.getElementById('auth-error');

  async function attempt() {
    err.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Verifying…';
    try {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: input.value }),
      });
      if (!r.ok) throw new Error('wrong');
      input.value = '';
      hideAuthOverlay();
      // Retry the analysis that triggered the auth prompt
      if (AppState._pendingSubmit) {
        AppState._pendingSubmit = false;
        submitForm();
      }
    } catch {
      err.classList.remove('hidden');
      input.select();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Unlock & Start Analysis';
    }
  }

  btn.addEventListener('click', attempt);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
}

function setDefaultDate() {
  const d = document.getElementById('date-input');
  d.value = new Date().toISOString().slice(0, 10);
  d.max   = new Date().toISOString().slice(0, 10);
}

// ── providers ─────────────────────────────────────────────────────────────
async function loadProviders() {
  try {
    const r = await fetch('/api/providers');
    if (r.status === 401) { showAuthOverlay(); return; }
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
    if (p.available === false) opt.disabled = true;
    sel.appendChild(opt);
  });
  // Default to first available provider
  const firstAvailable = Object.entries(providers).find(([, p]) => p.available !== false);
  if (firstAvailable) sel.value = firstAvailable[0];
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

// ── ticker autocomplete ───────────────────────────────────────────────
function wireTickerAutocomplete() {
  const input   = document.getElementById('ticker-input');
  const formRow = input.closest('.form-row');
  formRow.style.position = 'relative';

  const ul = document.createElement('ul');
  ul.id        = 'ticker-suggestions';
  ul.className = 'ticker-suggestions hidden';
  formRow.appendChild(ul);

  let debounceTimer = null;
  let activeIndex   = -1;

  function closeSuggestions() {
    ul.classList.add('hidden');
    ul.innerHTML = '';
    activeIndex  = -1;
  }

  function selectSuggestion(symbol) {
    input.value = symbol;
    closeSuggestions();
  }

  function setActive(items, index) {
    items.forEach((item, i) => item.classList.toggle('active', i === index));
  }

  function renderSuggestions(results) {
    ul.innerHTML = '';
    activeIndex  = -1;
    if (!results.length) { ul.classList.add('hidden'); return; }
    results.forEach(r => {
      const li = document.createElement('li');
      li.className = 'ticker-suggestion-item';
      const sym  = document.createElement('span');
      sym.className   = 'ts-symbol';
      sym.textContent = r.symbol;
      const name = document.createElement('span');
      name.className   = 'ts-name';
      name.textContent = r.name;
      const exch = document.createElement('span');
      exch.className   = 'ts-exchange';
      exch.textContent = r.exchange;
      li.append(sym, name, exch);
      li.addEventListener('mousedown', e => {
        e.preventDefault();
        selectSuggestion(r.symbol);
      });
      ul.appendChild(li);
    });
    ul.classList.remove('hidden');
  }

  async function fetchSuggestions(q) {
    try {
      const r = await fetch('/api/search?q=' + encodeURIComponent(q));
      if (!r.ok) return [];
      return await r.json();
    } catch {
      return [];
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 2) { closeSuggestions(); return; }
    debounceTimer = setTimeout(async () => {
      const results = await fetchSuggestions(q);
      renderSuggestions(results);
    }, 300);
  });

  input.addEventListener('keydown', e => {
    const items = Array.from(ul.querySelectorAll('.ticker-suggestion-item'));
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      setActive(items, activeIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      setActive(items, activeIndex);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      selectSuggestion(items[activeIndex].querySelector('.ts-symbol').textContent);
    } else if (e.key === 'Escape') {
      closeSuggestions();
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(closeSuggestions, 150);
  });

  document.addEventListener('click', e => {
    if (!formRow.contains(e.target)) closeSuggestions();
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
    if (r.status === 401) {
      setAnalyzing(false);
      AppState._pendingSubmit = true;
      showAuthOverlay();
      return;
    }
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
  const btn = document.getElementById('analyze-btn');
  btn.disabled = busy;
  btn.innerHTML = busy
    ? '<span class="btn-icon">⏳</span> Analysing…'
    : '<span class="btn-icon">⚡</span> Start Analysis';
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
  AppState.completedTeams = new Set();   // reset
  AppState.totalTeams = 0;              // reset (set by buildPipelineStrip below)
  AppState.lastSignal = null;
  AppState.lastDecisionText = null;

  // Remove hero card from any previous run
  const existingHero = document.getElementById('hero-card');
  if (existingHero) existingHero.remove();

  document.getElementById('idle-view').classList.add('hidden');
  document.getElementById('running-view').classList.remove('hidden');

  const { ticker, date, provider } = AppState.currentMeta;
  document.getElementById('compact-bar').textContent =
    `${ticker}  ·  ${date}  ·  ${provider}`;

  buildPipelineStrip(selectedAnalysts);
  resetProgressIndicator();             // reset after buildPipelineStrip sets totalTeams
  resetStoryPanels(selectedAnalysts);
  applyTeamColors();    // NEW — colors card headers after DOM is built
  clearFeed();
  startElapsed();
}

function transitionToComplete() {
  AppState.phase = 'complete';
  stopElapsed();
  setConnectionStatus(false);
}

function transitionToIdle() {
  if (AppState.eventSource) {
    AppState.eventSource.close();
    AppState.eventSource = null;
  }
  stopElapsed();
  setAnalyzing(false);
  AppState.phase = 'idle';
  document.getElementById('running-view').classList.add('hidden');
  document.getElementById('idle-view').classList.remove('hidden');
  loadRecentAnalyses();
}

function wireHomeBtn() {
  const btn = document.getElementById('home-btn');
  if (btn) btn.addEventListener('click', transitionToIdle);
  const brand = document.getElementById('running-brand');
  if (brand) brand.addEventListener('click', transitionToIdle);
}

function scrollToRecent() {
  const el = document.getElementById('recent-section');
  if (el && !el.classList.contains('hidden')) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function setConnectionStatus(connected) {
  const dot = document.getElementById('status-dot');
  if (!dot) return;
  dot.classList.toggle('connected',    connected);
  dot.classList.toggle('disconnected', !connected);
}

// ── progress indicator ─────────────────────────────────────────────────────
function resetProgressIndicator() {
  const fraction  = document.getElementById('progress-fraction');
  const fill      = document.getElementById('progress-fill');
  const agentName = document.getElementById('progress-agent-name');
  if (fraction)  fraction.textContent  = `0 / ${AppState.totalTeams}`;
  if (fill)      { fill.style.width = '0%'; fill.style.backgroundColor = 'var(--accent)'; }
  if (agentName) agentName.textContent = '';
}

function updateProgressIndicator(agent, status) {
  const team  = AGENT_TO_TEAM[agent];
  if (!team) return;
  const color = TEAM_COLORS[team] || { hex: 'var(--accent)', rgb: '99,102,241' };

  const fraction  = document.getElementById('progress-fraction');
  const fill      = document.getElementById('progress-fill');
  const agentName = document.getElementById('progress-agent-name');

  if (status === 'in_progress') {
    if (agentName) agentName.textContent = `● ${team}`;
    if (fill) fill.style.backgroundColor = color.hex;
  }

  if (status === 'completed') {
    // Mark team complete if ALL its registered agents are done
    const teamAgents = (TEAM_AGENTS[team] || []).filter(a => a in AppState.agentStatus);
    if (teamAgents.length > 0 && teamAgents.every(a => AppState.agentStatus[a] === 'completed')) {
      AppState.completedTeams.add(team);
    }
  }

  const count = AppState.completedTeams.size;
  const total = AppState.totalTeams;
  if (!total) return;
  if (fraction) fraction.textContent = `${count} / ${total}`;
  if (fill) fill.style.width = `${(count / total) * 100}%`;

  if (count === total && total > 0) {
    if (fill) fill.style.backgroundColor = '#10B981';
    if (agentName) agentName.textContent = 'Complete ✓';
  }
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

// ── recent analyses ───────────────────────────────────────────────────────
async function loadRecentAnalyses() {
  try {
    const r = await fetch('/api/sessions');
    if (!r.ok) return;   // 401 before login — silently skip
    const sessions = await r.json();
    if (!Array.isArray(sessions)) return;
    AppState.recentAnalyses = sessions;
    renderRecentAnalyses(sessions);
  } catch (e) {
    // Non-fatal — recent list is optional
  }
}

function renderRecentAnalyses(sessions) {
  const section = document.getElementById('recent-section');
  const list    = document.getElementById('recent-list');
  if (!sessions || sessions.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  list.innerHTML = '';
  // Show newest first
  [...sessions].reverse().forEach(s => {
    const li = document.createElement('li');
    li.className = 'recent-item';
    li.innerHTML = `
      <span class="recent-ticker">${s.ticker}</span>
      <span class="recent-date">${s.date}</span>
      <span class="recent-signal ${s.signal}">${s.signal || '—'}</span>
      <span class="recent-meta">${s.provider} / ${s.model}</span>
      <span class="recent-elapsed">${formatElapsed(s.elapsed)}</span>`;
    li.addEventListener('click', () => replaySession(s));
    list.appendChild(li);
  });
}

function formatElapsed(secs) {
  if (!secs) return '';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function replaySession(session) {
  try {
    const r = await fetch(`/api/sessions/${session.session_id}/events`);
    const { events } = await r.json();
    AppState.currentMeta = {
      ticker: session.ticker,
      date:   session.date,
      provider: `${session.provider}/${session.model}`,
    };

    // POC: default all 4 analyst panels for replay (session metadata doesn't store selection)
    transitionToRunning(['market', 'social', 'news', 'fundamentals']);

    events.forEach(ev => handleEvent(ev));
    transitionToComplete();
  } catch (e) {
    console.error('Replay failed', e);
  }
}

// ── story panel management ────────────────────────────────────────────────
function resetStoryPanels(selectedAnalysts) {
  // Build analyst cards with correct labels and collapse them
  const analystCards = [
    { id: 'panel-market',       key: 'market',       label: 'Market Analyst' },
    { id: 'panel-sentiment',    key: 'social',        label: 'Sentiment Analyst' },
    { id: 'panel-news',         key: 'news',          label: 'News Analyst' },
    { id: 'panel-fundamentals', key: 'fundamentals',  label: 'Fundamentals Analyst' },
  ];

  analystCards.forEach(({ id, key, label }) => {
    const card = document.getElementById(id);
    const included = selectedAnalysts.includes(key);
    card.classList.toggle('hidden', !included);
    if (included) initCard(card, label);
  });

  // Fixed panels
  initCard(document.getElementById('panel-invest-debate'), 'Research Debate');
  initCard(document.getElementById('panel-trader'), 'Trader');
  initCard(document.getElementById('panel-risk-debate'), 'Risk Deliberation');
  initCard(document.getElementById('panel-final'), 'Final Decision');

  // Reset debate content
  ['invest-bull-content', 'invest-bear-content', 'invest-research-content',
   'invest-judge-content', 'risk-agg-content', 'risk-con-content',
   'risk-neu-content', 'risk-judge-content', 'risk-trader-recap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  ['invest-research-content', 'invest-judge-content',
   'risk-judge-content', 'risk-trader-recap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = 'Waiting…'; el.classList.add('muted'); }
  });

  // Reset final card
  document.getElementById('panel-final').innerHTML =
    `<div class="final-placeholder">Awaiting Portfolio Manager…</div>`;
}

function applyTeamColors() {
  Object.entries(CARD_TEAM).forEach(([cardId, team]) => {
    const card = document.getElementById(cardId);
    if (!card || card.classList.contains('hidden')) return;
    const color = TEAM_COLORS[team];
    if (!color) return;
    const header = card.querySelector('.card-header');
    if (header) {
      header.style.borderLeft = `4px solid ${color.hex}`;
      header.style.background  = `rgba(${color.rgb}, 0.06)`;
    }
  });
}

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

  let visibleTeamCount = 0;
  Object.entries(TEAM_AGENTS).forEach(([team, agents]) => {
    const relevant = team === 'Analyst Team'
      ? agents.filter(a => selectedAgents.has(a))
      : agents;
    if (relevant.length === 0) return;

    visibleTeamCount++;
    const color = TEAM_COLORS[team] || { hex: '#6366f1', rgb: '99,102,241' };

    const block = document.createElement('div');
    block.className = 'team-block';
    block.dataset.team = team;
    // Color accent
    block.style.borderLeft = `4px solid ${color.hex}`;
    block.style.background  = `rgba(${color.rgb}, 0.10)`;
    block.style.paddingLeft  = '14px';

    const nameEl = document.createElement('div');
    nameEl.className = 'team-name';
    nameEl.style.color = color.hex;
    nameEl.textContent = team;
    block.appendChild(nameEl);

    const dotsEl = document.createElement('div');
    dotsEl.className = 'agent-dots';
    relevant.forEach(agent => {
      AppState.agentStatus[agent] = 'pending';
      const dot = document.createElement('div');
      dot.className = 'agent-dot';
      dot.dataset.agent  = agent;
      dot.dataset.status = 'pending';
      dot.title = agent;
      dot.style.setProperty('--team-color', color.hex);
      dotsEl.appendChild(dot);
    });
    block.appendChild(dotsEl);

    // Click → scroll to matching report card
    block.addEventListener('click', () => {
      const targetId = TEAM_TO_SCROLL_TARGET[team];
      if (targetId) {
        const card = document.getElementById(targetId);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (team === 'Analyst Team') {
        // Scroll to first visible analyst card
        const analystIds = ['panel-market', 'panel-sentiment', 'panel-news', 'panel-fundamentals'];
        const first = analystIds.map(id => document.getElementById(id))
                                .find(el => el && !el.classList.contains('hidden'));
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    strip.appendChild(block);
  });

  AppState.totalTeams = visibleTeamCount;
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

// Returns the story card DOM element for a given agent name
function agentToCard(agent) {
  const id = AGENT_TO_CARD_ID[agent];
  return id ? document.getElementById(id) : null;
}

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
  feed.insertBefore(row, feed.firstChild);
  // No scroll needed — newest item is always at the top
}

// ── Task 5: SSE client ─────────────────────────────────────────────────────
function openSSE(sessionId) {
  if (AppState.eventSource) AppState.eventSource.close();
  const es = new EventSource(`/api/stream/${sessionId}`);
  AppState.eventSource = es;

  es.onopen = () => setConnectionStatus(true);

  es.onmessage = e => {
    try {
      const event = JSON.parse(e.data);
      handleEvent(event);
    } catch (err) {
      console.error('SSE parse error', err);
    }
  };

  es.onerror = () => {
    setConnectionStatus(false);
    if (AppState.phase === 'running') {
      appendSystemFeed('⚠ Connection lost — results may be incomplete.');
      stopElapsed();
      setAnalyzing(false);
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
  updateProgressIndicator(event.agent, event.status);   // NEW
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

// ── report event handler ──────────────────────────────────────────────────
function onReport(event) {
  AppState.reports[event.section] = event.content;

  const cardId = SECTION_TO_CARD[event.section];
  if (cardId) {
    const card = document.getElementById(cardId);
    if (card) setCardContent(card, event.content);
    return;
  }

  // investment_plan goes into the Research Debate panel's research zone
  if (event.section === 'investment_plan') {
    const el = document.getElementById('invest-research-content');
    if (el) {
      el.classList.remove('muted');
      el.innerHTML = typeof marked !== 'undefined'
        ? marked.parse(event.content)
        : event.content;
      // Open invest debate panel
      const panel = document.getElementById('panel-invest-debate');
      if (panel) openCard(panel);
    }

    // Also recap in risk panel
    const recap = document.getElementById('risk-trader-recap');
    if (recap) {
      recap.textContent = event.content.slice(0, 200) + (event.content.length > 200 ? '…' : '');
      recap.classList.remove('muted');
    }
  }
}

// ── debate panel updates ──────────────────────────────────────────────────
const INVEST_SPEAKER_ID = {
  'Bull Researcher':    'invest-bull-content',
  'Bear Researcher':    'invest-bear-content',
  'Research Manager':   'invest-judge-content',
};
const RISK_SPEAKER_ID = {
  'Aggressive Analyst':  'risk-agg-content',
  'Conservative Analyst':'risk-con-content',
  'Neutral Analyst':     'risk-neu-content',
  'Portfolio Manager':   'risk-judge-content',
};

function renderDebateContent(elId, content) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.classList.remove('muted');
  el.innerHTML = typeof marked !== 'undefined'
    ? marked.parse(content)
    : content.replace(/\n/g, '<br>');
}

function onDebateUpdate(event) {
  const { debate, speaker, content } = event;

  if (debate === 'investment') {
    const elId = INVEST_SPEAKER_ID[speaker];
    if (elId) {
      renderDebateContent(elId, content);
      AppState.debateData[debate] = AppState.debateData[debate] || {};
      AppState.debateData[debate][speaker] = content;

      // If it's the judge, render in judgment zone (not debate columns)
      if (speaker === 'Research Manager') {
        const judgeEl = document.getElementById('invest-judge-content');
        if (judgeEl) {
          judgeEl.classList.remove('muted');
          judgeEl.innerHTML = typeof marked !== 'undefined'
            ? marked.parse(content)
            : content;
        }
      }
    }
    const panel = document.getElementById('panel-invest-debate');
    if (panel) {
      openCard(panel);
      panel.classList.remove('pending');
      panel.classList.add(
        speaker === 'Research Manager' ? 'done' : 'active'
      );
    }
    appendSystemFeed(`Research Debate: ${speaker} (round ${event.round})`);
  }

  if (debate === 'risk') {
    const elId = RISK_SPEAKER_ID[speaker];
    if (elId) {
      AppState.debateData[debate] = AppState.debateData[debate] || {};
      AppState.debateData[debate][speaker] = content;
      if (speaker === 'Portfolio Manager') {
        renderDebateContent('risk-judge-content', content);
      } else {
        renderDebateContent(elId, content);
      }
    }
    const panel = document.getElementById('panel-risk-debate');
    if (panel) {
      openCard(panel);
      panel.classList.remove('pending');
      panel.classList.add(
        speaker === 'Portfolio Manager' ? 'done' : 'active'
      );
    }
    appendSystemFeed(`Risk Debate: ${speaker} (round ${event.round})`);
  }
}

// ── hero card helpers ─────────────────────────────────────────────────────
function extractCompanyName(ticker, marketReport) {
  if (!marketReport) return ticker;
  const escaped = ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = marketReport.match(new RegExp(escaped + '\\s*\\(([^)]+)\\)'));
  return m ? m[1].trim() : ticker;
}

function extractSynthesis(fullText) {
  // Return the first substantive paragraph (skip headings and short lines)
  const lines = fullText.split('\n');
  let para = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('**') && line.endsWith('**')) continue;
    // Strip inline bold/italic markdown
    const clean = line.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1').trim();
    if (clean.length < 30) continue;
    para = clean;
    break;
  }
  return para.length > 320 ? para.slice(0, 317) + '…' : para;
}

function extractKeyLevels(fullText) {
  const supportM  = fullText.match(/support[^.]{0,60}?((?:HKD|USD|\$|€)\s*[\d,.]+)/i);
  const resistM   = fullText.match(/(?:resist|reclaim)[^.]{0,60}?((?:HKD|USD|\$|€)\s*[\d,.]+)/i);
  const levels = [];
  if (supportM) levels.push(`Support ${supportM[1]}`);
  if (resistM)  levels.push(`Resistance ${resistM[1]}`);
  return levels.join(' · ');
}

function renderHeroCard(signal, fullText) {
  const panels = document.getElementById('story-panels');
  const old = document.getElementById('hero-card');
  if (old) old.remove();

  const { ticker, date } = AppState.currentMeta;
  const company  = extractCompanyName(ticker, AppState.reports.market_report);
  const synopsis = extractSynthesis(fullText);
  const levels   = extractKeyLevels(fullText);

  const heroClass = signal.replace(/\s+/g, '-');   // e.g. "OVERWEIGHT" → "OVERWEIGHT"

  const card = document.createElement('div');
  card.id = 'hero-card';
  card.className = `hero-card story-card hero-${heroClass}`;

  card.innerHTML = `
    <div class="hero-signal-badge signal-${signal}">${signal}</div>
    <div class="hero-meta">
      <span class="hero-ticker">${ticker}</span>
      <span class="hero-date">${company !== ticker ? company + ' · ' : ''}${date}</span>
    </div>
    ${synopsis ? `<div class="hero-summary">${synopsis}</div>` : ''}
    ${levels    ? `<div class="hero-key-levels">${levels}</div>` : ''}
    <div class="hero-actions">
      <button id="pdf-btn"  class="export-btn export-btn-pdf">Download PDF</button>
      <button id="pptx-btn" class="export-btn export-btn-pptx">Generate PPT</button>
    </div>`;

  panels.insertBefore(card, panels.firstChild);
  panels.scrollTop = 0;

  document.getElementById('pdf-btn').addEventListener('click', downloadPDF);
  document.getElementById('pptx-btn').addEventListener('click', exportPPTX);
}

function downloadPDF() {
  const ticker = AppState.currentMeta.ticker || 'analysis';
  const date   = AppState.currentMeta.date   || '';
  const orig   = document.title;
  document.title = date ? `${ticker}-${date}-analysis` : `${ticker}-analysis`;

  document.querySelectorAll('#story-panels .story-card').forEach(card => {
    if (!card.classList.contains('pending') && !card.classList.contains('hidden')) {
      card.classList.add('open');
    }
  });
  window.print();
  setTimeout(() => { document.title = orig; }, 1000);
}
async function exportPPTX() {
  const btn = document.getElementById('pptx-btn');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Generating…';

  const payload = {
    ticker:        AppState.currentMeta.ticker || '',
    date:          AppState.currentMeta.date   || '',
    signal:        AppState.lastSignal         || 'HOLD',
    reports:       AppState.reports,
    debate:        AppState.debateData,
    decision_text: AppState.lastDecisionText   || '',
  };

  try {
    const r = await fetch('/api/export/pptx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.detail || 'Export failed');
    }
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${payload.ticker}-${payload.date}-analysis.pptx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(`PPT generation failed: ${e.message}`);
  } finally {
    btn.disabled  = false;
    btn.textContent = 'Generate PPT';
  }
}

// ── final decision ────────────────────────────────────────────────────────
function onDecision(event) {
  const { signal, full_text } = event;

  // Store for PPT/PDF export
  AppState.lastSignal = signal;
  AppState.lastDecisionText = full_text;

  // Update final panel
  const card = document.getElementById('panel-final');
  if (!card) return;

  card.innerHTML = `
    <div class="final-body">
      <div class="signal-badge signal-${signal}">${signal}</div>
      <div class="final-text">${
        typeof marked !== 'undefined'
          ? marked.parse(full_text)
          : full_text.replace(/\n/g, '<br>')
      }</div>
    </div>`;

  card.classList.remove('pending', 'active');
  card.classList.add('done');

  // Render hero card at top of story panels
  renderHeroCard(signal, full_text);

  appendSystemFeed(`Decision: ${signal}`);
}

// ── Task 6: story panel constants and helpers ─────────────────────────────
const SECTION_TO_CARD = {
  market_report:          'panel-market',
  sentiment_report:       'panel-sentiment',
  news_report:            'panel-news',
  fundamentals_report:    'panel-fundamentals',
  trader_investment_plan: 'panel-trader',
  // investment_plan and debate sections handled separately in onReport
};

const AGENT_TO_CARD_ID = {
  'Market Analyst':       'panel-market',
  'Sentiment Analyst':    'panel-sentiment',
  'News Analyst':         'panel-news',
  'Fundamentals Analyst': 'panel-fundamentals',
  'Trader':               'panel-trader',
};

function initCard(card, label) {
  card.className = 'story-card pending';
  card.innerHTML = `
    <div class="card-header" onclick="toggleCard(this.closest('.story-card'))">
      <div class="card-header-left">
        <div class="card-status-dot"></div>
        <span class="card-label">${label}</span>
      </div>
      <span class="card-chevron">▾</span>
    </div>
    <div class="card-body">
      <div class="card-markdown"></div>
    </div>`;
}

function toggleCard(card) {
  card.classList.toggle('open');
}

function openCard(card) {
  card.classList.add('open');
}

function setCardContent(card, markdownText) {
  const body = card.querySelector('.card-markdown');
  if (body) {
    body.innerHTML = typeof marked !== 'undefined'
      ? marked.parse(markdownText)
      : markdownText.replace(/\n/g, '<br>');
  }
  openCard(card);
}
