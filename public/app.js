/* ============================================================
   Brief Agent Dashboard — Premium React SPA
   Per-category scheduling, source management, health feed
   ============================================================ */

const { useState, useEffect, useCallback, useRef } = React;

// ---- SVG ICONS ---- //
const Icon = ({ name, size = 18 }) => {
  const icons = {
    dashboard: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
    schedule:  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    sources:   <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>,
    settings:  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>,
    health:    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    cookies:   <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><path d="M8.5 8.5v.01"/><path d="M16 15.5v.01"/><path d="M12 12v.01"/></svg>,
    play:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
    plus:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    trash:     <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
    edit:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    refresh:   <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
    sun:       <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
    moon:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
    close:     <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    check:     <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>,
    bolt:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
    menu:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
  };
  return icons[name] || null;
};

// ---- HELPERS ---- //
const api = {
  get: (url) => fetch(url).then(r => r.json()),
  post: (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  delete: (url) => fetch(url, { method: 'DELETE' }).then(r => r.json()),
  patch: (url, body) => fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
};

function cronToHuman(cron) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hr, dom, mon, dow] = parts;
  if (dom === '*' && mon === '*' && dow === '*') {
    const h = parseInt(hr), m = parseInt(min);
    if (!isNaN(h) && !isNaN(m)) {
      const period = h >= 12 ? 'PM' : 'AM';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const mm = String(m).padStart(2, '0');
      return `Daily ${h12}:${mm} ${period} IST`;
    }
  }
  if (dow !== '*' && dom === '*') {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const dayList = dow.split(',').map(d => days[parseInt(d)] || d).join(', ');
    const h = parseInt(hr), m = parseInt(min);
    if (!isNaN(h) && !isNaN(m)) {
      const period = h >= 12 ? 'PM' : 'AM';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const mm = String(m).padStart(2, '0');
      return `${dayList} ${h12}:${mm} ${period} IST`;
    }
  }
  return cron;
}

function Alert({ type = 'info', children, onClose }) {
  return (
    <div className={`alert-banner alert-${type}`}>
      <span style={{flex:1}}>{children}</span>
      {onClose && <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><Icon name="close" size={14}/></button>}
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle-wrap" style={{cursor:'pointer'}}>
      <span className="toggle">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
        <span className="toggle-slider"></span>
      </span>
      {label && <span style={{fontSize:'var(--text-sm)',color:'var(--text-muted)'}}>{label}</span>}
    </label>
  );
}

function Spinner() { return <div className="spinner"></div>; }

// ---- OVERVIEW PAGE ---- //
function OverviewPage({ categories, sources, health }) {
  const totalSources = sources.length;
  const activeSources = sources.filter(s => s.is_active).length;
  const failingScrapers = health.filter(h => h.consecutive_failures >= 3).length;
  const healthyScrapers = health.filter(h => h.consecutive_failures === 0).length;

  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Active Sources</div>
          <div className="kpi-value">{activeSources}<span style={{fontSize:'var(--text-base)',color:'var(--text-muted)',fontWeight:400}}>/{totalSources}</span></div>
          <div className="kpi-sub">Across all categories</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Categories</div>
          <div className="kpi-value">{categories.filter(c=>c.is_active).length}<span style={{fontSize:'var(--text-base)',color:'var(--text-muted)',fontWeight:400}}>/{categories.length}</span></div>
          <div className="kpi-sub">Active briefing streams</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Scraper Health</div>
          <div className="kpi-value" style={{color: failingScrapers > 0 ? 'var(--red)' : 'var(--green)'}}>
            {failingScrapers > 0 ? `${failingScrapers} failing` : `${healthyScrapers} healthy`}
          </div>
          <div className="kpi-sub">{health.length} scrapers monitored</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Server Time</div>
          <div className="kpi-value" style={{fontSize:'var(--text-base)',letterSpacing:'-0.01em'}}>{now.split(',')[3] || now.split(' ').slice(-1)[0]}</div>
          <div className="kpi-sub">IST (Asia/Kolkata)</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header"><span className="card-title">Category Status</span></div>
          <div className="card-body" style={{padding:0}}>
            {categories.length === 0 ? <div style={{padding:'var(--sp-6)',color:'var(--text-muted)',fontSize:'var(--text-sm)'}}>No categories configured.</div> :
            categories.map(cat => (
              <div key={cat.id} style={{display:'flex',alignItems:'center',gap:'var(--sp-3)',padding:'var(--sp-3) var(--sp-5)',borderBottom:'1px solid var(--border)'}}>
                <span className={`status-dot ${cat.is_active ? 'green' : 'gray'}`}></span>
                <span style={{fontWeight:600,fontSize:'var(--text-sm)',flex:1}}>{cat.display_name}</span>
                <span className={`badge ${cat.is_active ? 'badge-green' : 'badge-gray'}`}>{cat.is_active ? 'Active' : 'Paused'}</span>
                <span className="badge badge-accent" style={{fontFamily:'var(--font-mono)',fontSize:'10px'}}>{cat.slug}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Scraper Health</span></div>
          <div className="card-body">
            {health.length === 0 ? <div className="empty-state" style={{padding:'var(--sp-6)'}}><div className="empty-state-icon">❤️</div><p>Health data will appear after first run.</p></div> :
            <div className="health-feed">
              {health.map(h => (
                <div key={h.scraper_name} className="health-item">
                  <span className={`status-dot ${h.consecutive_failures === 0 ? 'green' : h.consecutive_failures < 3 ? 'yellow' : 'red'}`}></span>
                  <span className="health-item-name">{h.scraper_name}</span>
                  {h.consecutive_failures > 0 && <span className="health-item-failures">{h.consecutive_failures}x</span>}
                  <span className="health-item-time">{h.last_success_at ? new Date(h.last_success_at + 'Z').toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'}) : 'Never'}</span>
                </div>
              ))}
            </div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- SCHEDULE PAGE ---- //
const PRESET_TIMES = [
  { label: '6 AM',  cron_min: '0', cron_hr: '6' },
  { label: '8 AM',  cron_min: '0', cron_hr: '8' },
  { label: '10 AM', cron_min: '0', cron_hr: '10' },
  { label: '12 PM', cron_min: '0', cron_hr: '12' },
  { label: '2 PM',  cron_min: '0', cron_hr: '14' },
  { label: '4 PM',  cron_min: '0', cron_hr: '16' },
  { label: '6 PM',  cron_min: '0', cron_hr: '18' },
  { label: '8 PM',  cron_min: '0', cron_hr: '20' },
  { label: '10 PM', cron_min: '0', cron_hr: '22' },
  { label: '11 PM', cron_min: '0', cron_hr: '23' },
];
const WEEKDAYS = [{l:'S',v:'0'},{l:'M',v:'1'},{l:'T',v:'2'},{l:'W',v:'3'},{l:'T',v:'4'},{l:'F',v:'5'},{l:'S',v:'6'}];

function AddRuleModal({ categorySlug, categoryName, onClose, onSaved }) {
  const [label, setLabel] = useState('');
  const [mode, setMode] = useState('preset'); // 'preset' | 'custom'
  const [selectedTime, setSelectedTime] = useState(null);
  const [selectedDays, setSelectedDays] = useState([]); // [] = every day
  const [customCron, setCustomCron] = useState('0 9 * * *');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const buildCron = () => {
    if (mode === 'custom') return customCron.trim();
    if (!selectedTime) return null;
    const dow = selectedDays.length === 0 || selectedDays.length === 7 ? '*' : selectedDays.join(',');
    return `${selectedTime.cron_min} ${selectedTime.cron_hr} * * ${dow}`;
  };

  const toggleDay = (v) => setSelectedDays(prev => prev.includes(v) ? prev.filter(d => d !== v) : [...prev, v]);

  const handleSave = async () => {
    const cron = buildCron();
    if (!cron) { setError('Please select a time.'); return; }
    if (!label.trim()) { setError('Please enter a label (e.g. Morning).'); return; }
    setSaving(true); setError('');
    try {
      const res = await api.post('/api/schedules', { category_slug: categorySlug, cron_expression: cron, label: label.trim() });
      if (res.error) throw new Error(res.error);
      onSaved();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Add Schedule — {categoryName}</span>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><Icon name="close"/></button>
        </div>
        <div className="modal-body">
          {error && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}
          <div className="form-group">
            <label className="form-label">Slot Label</label>
            <input className="form-input" placeholder="e.g. Morning, Evening, Night" value={label} onChange={e => setLabel(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Schedule Mode</label>
            <div className="tab-list">
              <button className={`tab-btn ${mode==='preset'?'active':''}`} onClick={() => setMode('preset')}>Preset Times</button>
              <button className={`tab-btn ${mode==='custom'?'active':''}`} onClick={() => setMode('custom')}>Custom Cron</button>
            </div>
          </div>
          {mode === 'preset' && (
            <>
              <div className="form-group">
                <label className="form-label">Time (IST)</label>
                <div className="time-slots-grid">
                  {PRESET_TIMES.map(t => (
                    <button key={t.label} className={`time-slot-btn ${selectedTime && selectedTime.label===t.label ? 'selected' : ''}`} onClick={() => setSelectedTime(t)}>{t.label}</button>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Days <span style={{fontWeight:400,textTransform:'none',letterSpacing:0,color:'var(--text-faint)'}}>(leave blank = every day)</span></label>
                <div className="weekday-grid">
                  {WEEKDAYS.map((d,i) => (
                    <button key={i} className={`weekday-btn ${selectedDays.includes(d.v)?'selected':''}`} onClick={() => toggleDay(d.v)}>{d.l}</button>
                  ))}
                </div>
              </div>
            </>
          )}
          {mode === 'custom' && (
            <div className="form-group">
              <label className="form-label">Cron Expression</label>
              <input className="form-input" style={{fontFamily:'var(--font-mono)'}} value={customCron} onChange={e => setCustomCron(e.target.value)} placeholder="0 6 * * *" />
              <div className="form-hint">Format: minute hour day month weekday &mdash; All times in IST (Asia/Kolkata).</div>
              {buildCron() && <div style={{marginTop:'var(--sp-2)',fontSize:'var(--text-xs)',color:'var(--accent)'}}>→ {cronToHuman(buildCron())}</div>}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? <Spinner/> : <><Icon name="check" size={16}/>Save Rule</>}</button>
        </div>
      </div>
    </div>
  );
}

function SchedulePage({ categories, scheduler }) {
  const [rules, setRules] = useState({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(null);
  const [alert, setAlert] = useState(null);
  const [triggering, setTriggering] = useState(null);

  const loadRules = useCallback(async () => {
    try {
      const data = await api.get('/api/schedules');
      const grouped = {};
      for (const r of data) {
        if (!grouped[r.category_slug]) grouped[r.category_slug] = [];
        grouped[r.category_slug].push(r);
      }
      setRules(grouped);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRules(); }, [loadRules]);

  const deleteRule = async (id) => {
    if (!confirm('Delete this schedule slot?')) return;
    await api.delete(`/api/schedules/${id}`);
    setAlert({ type: 'success', msg: 'Schedule slot deleted.' });
    loadRules();
  };

  const toggleRule = async (id, current) => {
    await api.patch(`/api/schedules/${id}`, { is_active: !current });
    loadRules();
  };

  const triggerNow = async (slug) => {
    setTriggering(slug);
    try {
      await api.post('/api/trigger', { slug });
      setAlert({ type: 'success', msg: `Brief triggered for ${slug}. Check Telegram!` });
    } catch(e) { setAlert({ type: 'error', msg: e.message }); }
    finally { setTimeout(() => setTriggering(null), 3000); }
  };

  if (loading) return <div style={{display:'flex',justifyContent:'center',padding:'var(--sp-16)'}}><Spinner/></div>;

  return (
    <div>
      {alert && <Alert type={alert.type} onClose={() => setAlert(null)}>{alert.msg}</Alert>}
      {showModal && (
        <AddRuleModal
          categorySlug={showModal.slug}
          categoryName={showModal.name}
          onClose={() => setShowModal(null)}
          onSaved={() => { setShowModal(null); loadRules(); setAlert({ type: 'success', msg: 'Schedule rule saved. Scheduler reloaded.' }); }}
        />
      )}

      {categories.filter(c => c.is_active).map(cat => (
        <div key={cat.id} className="schedule-category-panel">
          <div className="schedule-category-header">
            <span className={`status-dot ${cat.is_active ? 'green' : 'gray'}`}></span>
            <span className="schedule-category-name">{cat.display_name}</span>
            <span className="badge badge-accent" style={{fontFamily:'var(--font-mono)'}}>{cat.slug}</span>
            <div style={{marginLeft:'auto',display:'flex',gap:'var(--sp-2)'}}>
              <button
                className="btn btn-success btn-sm"
                onClick={() => triggerNow(cat.slug)}
                disabled={triggering === cat.slug}
              >
                {triggering === cat.slug ? <Spinner/> : <><Icon name="bolt" size={14}/>Run Now</>}
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setShowModal({ slug: cat.slug, name: cat.display_name })}>
                <Icon name="plus" size={14}/>Add Slot
              </button>
            </div>
          </div>
          <div className="schedule-slots">
            {(!rules[cat.slug] || rules[cat.slug].length === 0) ? (
              <div className="empty-state" style={{padding:'var(--sp-8)'}}>
                <div className="empty-state-icon">📅</div>
                <h3>No schedule slots</h3>
                <p>Add a slot to schedule when this brief fires.</p>
              </div>
            ) : rules[cat.slug].map(rule => (
              <div key={rule.id} className="schedule-slot" style={{opacity: rule.is_active ? 1 : 0.5}}>
                <span className="slot-label">{rule.label}</span>
                <span className="slot-cron">{rule.cron_expression}</span>
                <span style={{fontSize:'var(--text-xs)',color:'var(--text-muted)',minWidth:140}}>{cronToHuman(rule.cron_expression)}</span>
                <div className="slot-actions">
                  <Toggle checked={!!rule.is_active} onChange={() => toggleRule(rule.id, !!rule.is_active)} />
                  <button className="btn btn-danger btn-icon btn-sm" onClick={() => deleteRule(rule.id)} title="Delete"><Icon name="trash" size={14}/></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- SOURCES PAGE ---- //
function SourcesPage({ sources, onReload }) {
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [alert, setAlert] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSource, setNewSource] = useState({ name: '', source_id: '', type: '' });
  const [saving, setSaving] = useState(false);

  const types = ['all', ...Array.from(new Set(sources.map(s => s.type)))];
  const filtered = sources.filter(s => {
    const matchText = filter === '' || s.name.toLowerCase().includes(filter.toLowerCase()) || s.source_id.toLowerCase().includes(filter.toLowerCase());
    const matchType = typeFilter === 'all' || s.type === typeFilter;
    return matchText && matchType;
  });

  const toggle = async (id, current) => {
    try {
      await api.patch(`/api/sources/${id}`, { is_active: !current });
      onReload();
    } catch(e) { setAlert({ type: 'error', msg: e.message }); }
  };

  const remove = async (id) => {
    if (!confirm('Remove this source?')) return;
    await api.delete(`/api/sources/${id}`);
    setAlert({ type: 'success', msg: 'Source removed.' });
    onReload();
  };

  const addSource = async () => {
    if (!newSource.name || !newSource.source_id || !newSource.type) { setAlert({ type: 'error', msg: 'All fields required.' }); return; }
    setSaving(true);
    try {
      const res = await api.post('/api/sources', newSource);
      if (res.error) throw new Error(res.error);
      setShowAddModal(false);
      setNewSource({ name: '', source_id: '', type: '' });
      setAlert({ type: 'success', msg: 'Source added.' });
      onReload();
    } catch(e) { setAlert({ type: 'error', msg: e.message }); }
    finally { setSaving(false); }
  };

  const typeColorMap = { 'cc-whatsapp': 'badge-green', 'cc-telegram': 'badge-blue', 'deals-whatsapp': 'badge-accent', 'deals-telegram': 'badge-yellow', 'cc-reddit': 'badge-red', 'deals-reddit': 'badge-red' };

  return (
    <div>
      {alert && <Alert type={alert.type} onClose={() => setAlert(null)}>{alert.msg}</Alert>}
      {showAddModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setShowAddModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">Add Source</span>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowAddModal(false)}><Icon name="close"/></button>
            </div>
            <div className="modal-body">
              <div className="form-group"><label className="form-label">Name</label><input className="form-input" placeholder="e.g. CC India WA Group" value={newSource.name} onChange={e => setNewSource(p => ({...p, name: e.target.value}))}/></div>
              <div className="form-group"><label className="form-label">Source ID</label><input className="form-input" placeholder="WhatsApp JID, Telegram channel ID, subreddit..." value={newSource.source_id} onChange={e => setNewSource(p => ({...p, source_id: e.target.value}))}/></div>
              <div className="form-group">
                <label className="form-label">Type</label>
                <select className="form-select" value={newSource.type} onChange={e => setNewSource(p => ({...p, type: e.target.value}))}>
                  <option value="">Select type...</option>
                  <option value="cc-whatsapp">cc-whatsapp</option>
                  <option value="cc-telegram">cc-telegram</option>
                  <option value="cc-reddit">cc-reddit</option>
                  <option value="deals-whatsapp">deals-whatsapp</option>
                  <option value="deals-telegram">deals-telegram</option>
                  <option value="deals-reddit">deals-reddit</option>
                  <option value="cc-youtube">cc-youtube</option>
                  <option value="deals-youtube">deals-youtube</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addSource} disabled={saving}>{saving ? <Spinner/> : <><Icon name="check" size={16}/>Add Source</>}</button>
            </div>
          </div>
        </div>
      )}
      <div style={{display:'flex',gap:'var(--sp-3)',marginBottom:'var(--sp-5)',flexWrap:'wrap'}}>
        <input className="form-input" style={{maxWidth:260}} placeholder="Search sources..." value={filter} onChange={e => setFilter(e.target.value)}/>
        <select className="form-select" style={{maxWidth:200}} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          {types.map(t => <option key={t} value={t}>{t === 'all' ? 'All Types' : t}</option>)}
        </select>
        <button className="btn btn-primary" style={{marginLeft:'auto'}} onClick={() => setShowAddModal(true)}><Icon name="plus" size={16}/>Add Source</button>
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-state-icon">📦</div><h3>No sources found</h3><p>Add your first source or adjust filters.</p><button className="btn btn-primary" onClick={() => setShowAddModal(true)}><Icon name="plus" size={16}/>Add Source</button></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Name</th><th>Source ID</th><th>Type</th><th>Status</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id}>
                  <td style={{fontWeight:500}}>{s.name}</td>
                  <td className="td-mono truncate">{s.source_id}</td>
                  <td><span className={`badge ${typeColorMap[s.type] || 'badge-gray'}`}>{s.type}</span></td>
                  <td><Toggle checked={!!s.is_active} onChange={() => toggle(s.id, !!s.is_active)}/></td>
                  <td><button className="btn btn-danger btn-icon btn-sm" onClick={() => remove(s.id)} title="Remove"><Icon name="trash" size={14}/></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- COOKIES PAGE ---- //
function CookiesPage() {
  const [cookies, setCookies] = useState({});
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  const SITES = [
    { key: 'youtube',     label: 'YouTube', icon: '🎥', hint: 'Export cookies from browser with EditThisCookie or Get cookies.txt extension.' },
    { key: 'technofino',  label: 'Technofino', icon: '🌐', hint: 'Login to technofino.com, then export cookies.' },
    { key: 'desidime',    label: 'DesiDime', icon: '🛡️', hint: 'Export cookies if DesiDime requires login for VIP sections.' },
  ];

  const loadCookies = async () => {
    try {
      const data = await api.get('/api/cookies');
      const map = {};
      for (const item of data) map[item.site] = item;
      setCookies(map);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadCookies(); }, []);

  const handleFileSelect = async (site, file) => {
    if (!file) return;
    try {
      const text = await file.text();
      let parsed;
      try { parsed = JSON.parse(text); }
      catch (e) {
        // Try Netscape cookie format (txt)
        parsed = text.split('\n')
          .filter(l => !l.startsWith('#') && l.trim())
          .map(line => {
            const [domain,,,path,expires,name,value] = line.split('\t');
            return { domain, path, name, value, expires: parseInt(expires) };
          }).filter(c => c.name);
      }
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('No valid cookies found in file.');
      const res = await api.post('/api/cookies', { site, cookies: parsed });
      if (res.error) throw new Error(res.error);
      setAlert({ type: 'success', msg: `✅ ${parsed.length} cookies saved for ${site}!` });
      loadCookies();
    } catch(e) { setAlert({ type: 'error', msg: e.message }); }
  };

  const deleteCookies = async (site) => {
    if (!confirm(`Delete cookies for ${site}?`)) return;
    await api.delete(`/api/cookies/${site}`);
    setAlert({ type: 'success', msg: `Cookies cleared for ${site}.` });
    loadCookies();
  };

  if (loading) return <div style={{display:'flex',justifyContent:'center',padding:'var(--sp-16)'}}><Spinner/></div>;

  return (
    <div>
      {alert && <Alert type={alert.type} onClose={() => setAlert(null)}>{alert.msg}</Alert>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:'var(--sp-5)'}}>
        {SITES.map(site => (
          <div key={site.key} className="card">
            <div className="card-header">
              <span style={{fontSize:'1.25rem'}}>{site.icon}</span>
              <span className="card-title">{site.label}</span>
              {cookies[site.key] && (
                <span className="badge badge-green" style={{marginLeft:'auto'}}>Loaded</span>
              )}
            </div>
            <div className="card-body">
              {cookies[site.key] && (
                <div style={{marginBottom:'var(--sp-3)',fontSize:'var(--text-xs)',color:'var(--text-muted)',fontFamily:'var(--font-mono)'}}>
                  Updated: {new Date(cookies[site.key].updated_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                </div>
              )}
              <label
                className={`cookie-drop-zone ${dragOver === site.key ? 'drag-over' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOver(site.key); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={e => { e.preventDefault(); setDragOver(null); handleFileSelect(site.key, e.dataTransfer.files[0]); }}
              >
                <input type="file" accept=".txt,.json" style={{display:'none'}} onChange={e => handleFileSelect(site.key, e.target.files[0])}/>
                <div className="cookie-drop-zone-icon">🍪</div>
                <div className="cookie-drop-zone-text">Drop cookie file or click to browse</div>
                <div className="cookie-drop-zone-sub">{site.hint}</div>
              </label>
              {cookies[site.key] && (
                <button className="btn btn-danger btn-sm" style={{marginTop:'var(--sp-3)',width:'100%'}} onClick={() => deleteCookies(site.key)}>
                  <Icon name="trash" size={14}/>Clear Cookies
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- CATEGORIES PAGE ---- //
function CategoriesPage({ categories, onReload }) {
  const [alert, setAlert] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [saving, setSaving] = useState(false);

  const toggleCat = async (id, current) => {
    await api.patch(`/api/categories/${id}`, { is_active: !current });
    onReload();
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const res = await api.patch(`/api/categories/${editModal.id}`, editModal);
      if (res.error) throw new Error(res.error);
      setEditModal(null);
      setAlert({ type: 'success', msg: 'Category updated.' });
      onReload();
    } catch(e) { setAlert({ type: 'error', msg: e.message }); }
    finally { setSaving(false); }
  };

  return (
    <div>
      {alert && <Alert type={alert.type} onClose={() => setAlert(null)}>{alert.msg}</Alert>}
      {editModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setEditModal(null)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">Edit — {editModal.display_name}</span>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditModal(null)}><Icon name="close"/></button>
            </div>
            <div className="modal-body">
              <div className="form-group"><label className="form-label">Display Name</label><input className="form-input" value={editModal.display_name} onChange={e => setEditModal(p => ({...p, display_name: e.target.value}))}/></div>
              <div className="form-group"><label className="form-label">Telegram Bot Token</label><input className="form-input" type="password" value={editModal.bot_token || ''} onChange={e => setEditModal(p => ({...p, bot_token: e.target.value}))}/></div>
              <div className="form-group"><label className="form-label">Telegram Chat ID</label><input className="form-input" value={editModal.chat_id || ''} onChange={e => setEditModal(p => ({...p, chat_id: e.target.value}))}/></div>
              <div className="form-group"><label className="form-label">AI Prompt</label><textarea className="form-textarea" value={editModal.ai_prompt || ''} onChange={e => setEditModal(p => ({...p, ai_prompt: e.target.value}))}/></div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setEditModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>{saving ? <Spinner/> : <><Icon name="check" size={16}/>Save</>}</button>
            </div>
          </div>
        </div>
      )}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:'var(--sp-5)'}}>
        {categories.map(cat => (
          <div key={cat.id} className="card">
            <div className="card-header">
              <span className={`status-dot ${cat.is_active ? 'green' : 'gray'}`}></span>
              <span className="card-title">{cat.display_name}</span>
              <span className="badge badge-accent" style={{fontFamily:'var(--font-mono)'}}>{cat.slug}</span>
            </div>
            <div className="card-body">
              <div style={{display:'flex',gap:'var(--sp-3)',marginBottom:'var(--sp-3)'}}>
                <Toggle checked={!!cat.is_active} onChange={() => toggleCat(cat.id, !!cat.is_active)} label={cat.is_active ? 'Active' : 'Paused'}/>
              </div>
              <div style={{fontSize:'var(--text-xs)',color:'var(--text-faint)',fontFamily:'var(--font-mono)',marginBottom:'var(--sp-3)'}}>
                Chat: {cat.chat_id || '—'}
              </div>
              {cat.ai_prompt && <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)',background:'var(--surface-2)',borderRadius:'var(--r-md)',padding:'var(--sp-2) var(--sp-3)',maxHeight:60,overflow:'hidden',lineHeight:1.5}}>{cat.ai_prompt.substring(0, 120)}...</div>}
              <button className="btn btn-secondary btn-sm" style={{marginTop:'var(--sp-4)',width:'100%'}} onClick={() => setEditModal({...cat})}><Icon name="edit" size={14}/>Edit Category</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- APP SHELL ---- //
function App() {
  const [page, setPage] = useState('overview');
  const [theme, setTheme] = useState('dark');
  const [categories, setCategories] = useState([]);
  const [sources, setSources] = useState([]);
  const [health, setHealth] = useState([]);
  const [scheduler, setScheduler] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [cats, srcs, hlth] = await Promise.all([
        api.get('/api/categories'),
        api.get('/api/sources'),
        api.get('/api/health').catch(() => []),
      ]);
      setCategories(cats);
      setSources(srcs);
      setHealth(Array.isArray(hlth) ? hlth : []);
    } catch(e) { console.error('Failed to load data', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
  };

  const navItems = [
    { id: 'overview',    label: 'Overview',    icon: 'dashboard' },
    { id: 'schedule',    label: 'Schedule',     icon: 'schedule' },
    { id: 'sources',     label: 'Sources',      icon: 'sources', badge: sources.filter(s=>!s.is_active).length || null },
    { id: 'categories',  label: 'Categories',   icon: 'settings' },
    { id: 'cookies',     label: 'Cookies',      icon: 'cookies' },
    { id: 'health',      label: 'Health',       icon: 'health', badge: health.filter(h=>h.consecutive_failures>=3).length || null },
  ];

  const pageTitles = { overview: 'Overview', schedule: 'Schedule', sources: 'Sources', categories: 'Categories', cookies: 'Cookies', health: 'Health' };
  const pageSubtitles = {
    overview: 'System status and active categories',
    schedule: 'Per-category briefing schedules (IST)',
    sources: 'Manage data sources across all categories',
    categories: 'Configure briefing categories and bots',
    cookies: 'Upload cookies for gated sources',
    health: 'Scraper health and failure tracking',
  };

  if (loading) return (
    <div data-theme={theme} className="full-page-loader">
      <div className="spinner" style={{width:32,height:32,borderWidth:3}}></div>
      <span>Loading Brief Agent...</span>
    </div>
  );

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <nav className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">📊</div>
          <div>
            <div className="sidebar-logo-text">Brief Agent</div>
            <div className="sidebar-logo-sub">AI Briefing Dashboard</div>
          </div>
        </div>
        <div className="sidebar-nav">
          <div className="nav-section-label">Main</div>
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => { setPage(item.id); setSidebarOpen(false); }}
            >
              <span className="nav-item-icon"><Icon name={item.icon} size={16}/></span>
              {item.label}
              {item.badge > 0 && <span className="nav-badge">{item.badge}</span>}
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <button className="theme-toggle" onClick={toggleTheme}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14}/>
            {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </button>
        </div>
      </nav>

      {/* Main */}
      <div className="main-content">
        <header className="page-header">
          <button className="btn btn-ghost btn-icon mobile-menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}><Icon name="menu"/></button>
          <div>
            <div className="page-title">{pageTitles[page]}</div>
            <div className="page-subtitle">{pageSubtitles[page]}</div>
          </div>
          <div className="header-actions">
            <button className="btn btn-secondary btn-sm" onClick={loadAll}><Icon name="refresh" size={14}/>Refresh</button>
          </div>
        </header>

        <main className="page-body">
          {page === 'overview'   && <OverviewPage categories={categories} sources={sources} health={health}/>}
          {page === 'schedule'   && <SchedulePage categories={categories} scheduler={scheduler}/>}
          {page === 'sources'    && <SourcesPage sources={sources} onReload={loadAll}/>}
          {page === 'categories' && <CategoriesPage categories={categories} onReload={loadAll}/>}
          {page === 'cookies'    && <CookiesPage/>}
          {page === 'health'     && (
            <div className="card">
              <div className="card-header"><span className="card-title">All Scrapers</span></div>
              <div className="card-body">
                {health.length === 0 ? (
                  <div className="empty-state"><div className="empty-state-icon">❤️</div><h3>No health data yet</h3><p>Scraper health records appear after the first run.</p></div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Scraper</th><th>Last Success</th><th>Last Failure</th><th>Failures</th><th>Last Error</th></tr></thead>
                      <tbody>
                        {health.map(h => (
                          <tr key={h.scraper_name}>
                            <td><span className={`status-dot ${h.consecutive_failures===0?'green':h.consecutive_failures<3?'yellow':'red'}`} style={{marginRight:'var(--sp-2)'}}></span>{h.scraper_name}</td>
                            <td className="td-mono">{h.last_success_at || '—'}</td>
                            <td className="td-mono">{h.last_failure_at || '—'}</td>
                            <td>{h.consecutive_failures > 0 ? <span className="badge badge-red">{h.consecutive_failures}</span> : <span className="badge badge-green">0</span>}</td>
                            <td style={{maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>{h.last_error || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App/>);
