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
