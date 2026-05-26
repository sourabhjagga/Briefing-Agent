const { useState, useEffect } = React;

function App() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({ name: '', source_id: '', type: 'cc-whatsapp' });

  // System statuses
  const [sysStatus, setSysStatus] = useState({ healthy: false, whatsapp: 'connecting', messagesToday: 0, targetGroups: 0, uptime: 0 });

  // Telegram login states
  const [tgStatus, setTgStatus] = useState({ isReady: false, tempPhone: null });
  const [tgPhone, setTgPhone] = useState('');
  const [tgCode, setTgCode] = useState('');
  const [tgPassword, setTgPassword] = useState('');
  const [tgStep, setTgStep] = useState(1); // 1 = Phone, 2 = OTP, 3 = Connected
  const [tgMsg, setTgMsg] = useState({ text: '', type: 'info' });

  // Discovered channels/groups modal states
  const [discoverType, setDiscoverType] = useState(null); // 'telegram' or 'whatsapp'
  const [discoverList, setDiscoverList] = useState([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);

  // Cookies session manager states
  const [cookieStatus, setCookieStatus] = useState({ desidime: false, reddit: false, technofino: false });
  const [cookieText, setCookieText] = useState('');
  const [cookieSite, setCookieSite] = useState('desidime');
  const [cookieMsg, setCookieMsg] = useState({ text: '', type: 'info' });

  useEffect(() => {
    fetchSources();
    fetchSystemStatus();
    fetchTelegramStatus();
    fetchCookieStatus();
    
    // Poll system status every 15 seconds
    const interval = setInterval(fetchSystemStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  const fetchSources = async () => {
    try {
      const res = await fetch('/api/sources');
      const data = await res.json();
      setSources(data);
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch sources', err);
    }
  };

  const fetchSystemStatus = async () => {
    try {
      const res = await fetch('/health');
      if (res.ok) {
        const data = await res.json();
        setSysStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch health status', err);
    }
  };

  const fetchTelegramStatus = async () => {
    try {
      const res = await fetch('/api/telegram/status');
      const data = await res.json();
      setTgStatus(data);
      if (data.isReady) {
        setTgStep(3);
      } else if (data.tempPhone) {
        setTgPhone(data.tempPhone);
        setTgStep(2);
      } else {
        setTgStep(1);
      }
    } catch (err) {
      console.error('Failed to fetch Telegram user status', err);
    }
  };

  const fetchCookieStatus = async () => {
    try {
      const res = await fetch('/api/cookies/status');
      const data = await res.json();
      setCookieStatus(data);
    } catch (err) {
      console.error('Failed to fetch cookie status', err);
    }
  };

  // Sources CRUD Handlers
  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleAddSource = async (e) => {
    if (e) e.preventDefault();
    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setFormData({ name: '', source_id: '', type: 'cc-whatsapp' });
        fetchSources();
      }
    } catch (err) {
      console.error('Failed to add source', err);
    }
  };

  const toggleSource = async (id, currentStatus) => {
    try {
      await fetch(`/api/sources/${id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: currentStatus === 1 ? 0 : 1 })
      });
      fetchSources();
    } catch (err) {
      console.error(err);
    }
  };

  const deleteSource = async (id) => {
    if (!confirm('Are you sure you want to delete this source?')) return;
    try {
      await fetch(`/api/sources/${id}`, { method: 'DELETE' });
      fetchSources();
    } catch (err) {
      console.error(err);
    }
  };

  // Telegram userbot auth handlers
  const handleSendTgCode = async (e) => {
    e.preventDefault();
    setTgMsg({ text: 'Sending OTP login code...', type: 'info' });
    try {
      const res = await fetch('/api/telegram/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: tgPhone })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTgStep(2);
        setTgMsg({ text: 'OTP code successfully sent! Check your Telegram App.', type: 'success' });
      } else {
        setTgMsg({ text: `Error: ${data.error || 'Failed to request code'}`, type: 'error' });
      }
    } catch (err) {
      setTgMsg({ text: err.message, type: 'error' });
    }
  };

  const handleSubmitTgCode = async (e) => {
    e.preventDefault();
    setTgMsg({ text: 'Authenticating session...', type: 'info' });
    try {
      const res = await fetch('/api/telegram/submit-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: tgCode, password: tgPassword })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTgStep(3);
        setTgMsg({ text: 'Successfully authenticated and logged into Telegram!', type: 'success' });
        fetchTelegramStatus();
      } else {
        setTgMsg({ text: `Error: ${data.error || 'Verification failed'}`, type: 'error' });
      }
    } catch (err) {
      setTgMsg({ text: err.message, type: 'error' });
    }
  };

  const handleTgLogout = async () => {
    if (!confirm('Are you sure you want to log out of Telegram? This stops private channel scraping.')) return;
    try {
      await fetch('/api/telegram/logout', { method: 'POST' });
      setTgPhone('');
      setTgCode('');
      setTgPassword('');
      setTgStep(1);
      setTgMsg({ text: 'Logged out successfully.', type: 'info' });
      fetchTelegramStatus();
    } catch (err) {
      console.error(err);
    }
  };

  // Dynamic discovery triggers
  const handleOpenDiscover = async (type) => {
    setDiscoverType(type);
    setDiscoverLoading(true);
    setDiscoverList([]);
    try {
      const endpoint = type === 'telegram' ? '/api/telegram/discover' : '/api/whatsapp/discover';
      const res = await fetch(endpoint);
      if (res.ok) {
        const data = await res.json();
        setDiscoverList(data);
      }
    } catch (err) {
      console.error('Discovery sync failed', err);
    } finally {
      setDiscoverLoading(false);
    }
  };

  const handleAddDiscoveredSource = async (item) => {
    const isTg = discoverType === 'telegram';
    const type = isTg 
      ? (item.type === 'channel' ? 'cc-telegram' : 'deals-telegram')
      : 'cc-whatsapp';

    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: item.name,
          source_id: item.id,
          type
        })
      });
      if (res.ok) {
        fetchSources();
        // Remove from local discover list so user doesn't double add
        setDiscoverList(discoverList.filter(d => d.id !== item.id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Cookies session handlers
  const handleImportCookies = async (e) => {
    e.preventDefault();
    setCookieMsg({ text: 'Importing cookies...', type: 'info' });
    try {
      const res = await fetch('/api/cookies/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: cookieSite, cookies: cookieText })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCookieText('');
        setCookieMsg({ text: `Cookies imported successfully for ${cookieSite.toUpperCase()}!`, type: 'success' });
        fetchCookieStatus();
      } else {
        setCookieMsg({ text: `Error: ${data.error || 'Failed to import'}`, type: 'error' });
      }
    } catch (err) {
      setCookieMsg({ text: err.message, type: 'error' });
    }
  };

  const handleDeleteCookies = async (site) => {
    if (!confirm(`Are you sure you want to clear session cookies for ${site.toUpperCase()}?`)) return;
    try {
      const res = await fetch('/api/cookies/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site })
      });
      if (res.ok) {
        setCookieMsg({ text: `Session cookies cleared for ${site.toUpperCase()}.`, type: 'info' });
        fetchCookieStatus();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="dashboard-container">
      <header className="header">
        <div>
          <h1>CC & Deals Agent</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>Frosted glass system monitoring dynamic financial feeds.</p>
        </div>
        
        {/* Status widget */}
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', padding: '10px 16px', borderRadius: '12px', fontSize: '0.85em', textAlign: 'right' }}>
            <span style={{ display: 'block', color: 'var(--text-muted)' }}>Messages Ingested Today</span>
            <strong style={{ fontSize: '1.4em', color: 'var(--primary)' }}>{sysStatus.messagesToday}</strong>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', padding: '10px 16px', borderRadius: '12px', fontSize: '0.85em', textAlign: 'right' }}>
            <span style={{ display: 'block', color: 'var(--text-muted)' }}>WhatsApp Socket</span>
            <strong style={{ fontSize: '1.2em', color: sysStatus.whatsapp === 'connected' ? 'var(--success)' : 'var(--warning)' }}>
              {sysStatus.whatsapp === 'connected' ? '🟢 Active' : '🟡 Offline'}
            </strong>
          </div>
        </div>
      </header>

      {/* SECTION 1: Telegram userbot auth panel */}
      <div className="panel-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h2>📱 Telegram Personal Account Connection</h2>
          {tgStep === 3 && (
            <button onClick={() => handleOpenDiscover('telegram')} className="btn-action">🔍 Browse & Add My Channels</button>
          )}
        </div>
        <p style={{ marginBottom: '20px' }}>
          Connects a user session to read private subscribed channels. OTP and 2FA are handled natively in the background.
        </p>

        {tgMsg.text && (
          <div className={`alert alert-${tgMsg.type}`}>
            {tgMsg.text}
          </div>
        )}

        {tgStep === 1 && (
          <form onSubmit={handleSendTgCode} style={{ display: 'flex', gap: '12px' }}>
            <input 
              type="text" 
              value={tgPhone} 
              onChange={(e) => setTgPhone(e.target.value)} 
              placeholder="Phone number (+919876543210)" 
              style={{ width: '300px' }}
              required 
            />
            <button type="submit" className="btn-add">Request Login OTP</button>
          </form>
        )}

        {tgStep === 2 && (
          <form onSubmit={handleSubmitTgCode} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <input 
              type="text" 
              value={tgCode} 
              onChange={(e) => setTgCode(e.target.value)} 
              placeholder="Telegram OTP" 
              style={{ width: '120px' }}
              required 
            />
            <input 
              type="password" 
              value={tgPassword} 
              onChange={(e) => setTgPassword(e.target.value)} 
              placeholder="2FA Password (optional)" 
              style={{ width: '220px' }}
            />
            <button type="submit" className="btn-add">Verify & Login</button>
            <button type="button" onClick={() => { setTgStep(1); setTgMsg({ text: '', type: 'info' }); }} className="btn-delete" style={{ height: '46px' }}>Cancel</button>
          </form>
        )}

        {tgStep === 3 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '12px' }}>
            <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>🟢 Session active. Listening to Telegram private sources.</span>
            <button onClick={handleTgLogout} className="btn-delete">Disconnect Account</button>
          </div>
        )}
      </div>

      {/* SECTION 2: Session cookies manager */}
      <div className="panel-card">
        <h2>🔑 Browser Session Cookies Manager</h2>
        <p style={{ marginBottom: '20px' }}>
          Avoid captchas and blocks on Technofino, Reddit, and DesiDime. Export JSON cookies using <b>EditThisCookie</b> extension and paste below.
        </p>

        <div style={{ display: 'flex', gap: '15px', marginBottom: '24px', flexWrap: 'wrap' }}>
          {['desidime', 'reddit', 'technofino'].map(site => (
            <div key={site} style={{ padding: '10px 16px', borderRadius: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ textTransform: 'capitalize' }}>{site}:</span>
              {cookieStatus[site] ? (
                <span style={{ color: 'var(--success)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  🟢 Active 
                  <button onClick={() => handleDeleteCookies(site)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', textDecoration: 'underline', padding: '0', fontSize: '0.9em' }}>(Clear)</button>
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>❌ No Session</span>
              )}
            </div>
          ))}
        </div>

        {cookieMsg.text && (
          <div className={`alert alert-${cookieMsg.type}`}>
            {cookieMsg.text}
          </div>
        )}

        <form onSubmit={handleImportCookies} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <label style={{ fontSize: '0.9em', color: 'var(--text-muted)', fontWeight: '600' }}>Select Site:</label>
            <select value={cookieSite} onChange={(e) => setCookieSite(e.target.value)} style={{ width: '180px' }}>
              <option value="desidime">DesiDime Forum</option>
              <option value="reddit">Reddit Subreddits</option>
              <option value="technofino">Technofino Forum</option>
            </select>
          </div>

          <textarea 
            rows="3" 
            value={cookieText}
            onChange={(e) => setCookieText(e.target.value)}
            placeholder='[{"name": "session_cookie", "value": "cookie_value_here", "domain": ".site.com"}]'
            required
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>💡 Tip: Ensure you copy the entire JSON array.</span>
            <button type="submit" className="btn-add">Import Cookies</button>
          </div>
        </form>
      </div>

      {/* SECTION 3: Add new source manually */}
      <div className="panel-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h2>➕ Add New Data Source</h2>
          {sysStatus.whatsapp === 'connected' && (
            <button onClick={() => handleOpenDiscover('whatsapp')} className="btn-action">🔍 Browse & Add My WhatsApp Chats</button>
          )}
        </div>
        <form className="add-form" onSubmit={handleAddSource}>
          <div className="input-group">
            <label>Display Name</label>
            <input type="text" name="name" value={formData.name} onChange={handleInputChange} placeholder="e.g. TechnoFino VIP Lounge" required />
          </div>
          <div className="input-group">
            <label>Source JID / Subreddit / Handle / URL</label>
            <input type="text" name="source_id" value={formData.source_id} onChange={handleInputChange} placeholder="e.g. 1203630xxx@g.us, technofino, @handle" required />
          </div>
          <div className="input-group">
            <label>Type / Module</label>
            <select name="type" value={formData.type} onChange={handleInputChange}>
              <option value="cc-whatsapp">Credit Cards (WhatsApp Group/Channel)</option>
              <option value="cc-telegram">Credit Cards (Telegram Channel)</option>
              <option value="cc-reddit">Credit Cards (Reddit Subreddit)</option>
              <option value="cc-forum">Credit Cards (Web Forum)</option>
              <option value="cc-youtube">Credit Cards (YouTube Channel)</option>
              <option value="deals-whatsapp">Online Deals (WhatsApp Group/Channel)</option>
              <option value="deals-telegram">Online Deals (Telegram Channel)</option>
              <option value="deals-reddit">Online Deals (Reddit Subreddit)</option>
              <option value="deals-forum">Online Deals (Web Forum)</option>
              <option value="deals-youtube">Online Deals (YouTube Channel)</option>
            </select>
          </div>
          <button type="submit" className="btn-add">Add Source</button>
        </form>
      </div>

      {/* SECTION 4: Sources list grid */}
      {loading ? (
        <div className="loader"></div>
      ) : (
        <div>
          <h2 style={{ marginTop: '20px', marginBottom: '20px', fontSize: '1.6rem' }}>💳 Credit Cards Monitored Sources</h2>
          <div className="source-grid" style={{ marginBottom: '40px' }}>
            {sources.filter(s => s.type.startsWith('cc-')).map(s => (
              <div className="source-card" key={s.id}>
                <div className="source-type">{s.type.replace('cc-', '').replace('-', ' ')}</div>
                <h3>{s.name}</h3>
                <div className="source-id">{s.source_id}</div>
                
                <div className="card-actions">
                  <label className="toggle-switch">
                    <input type="checkbox" checked={s.is_active === 1} onChange={() => toggleSource(s.id, s.is_active)} />
                    <span className="slider"></span>
                  </label>
                  <button className="btn-delete" onClick={() => deleteSource(s.id)}>Delete</button>
                </div>
              </div>
            ))}
            {sources.filter(s => s.type.startsWith('cc-')).length === 0 && (
              <p style={{ color: 'var(--text-muted)', gridColumn: '1/-1' }}>No credit card sources added yet.</p>
            )}
          </div>

          <h2 style={{ marginTop: '20px', marginBottom: '20px', fontSize: '1.6rem' }}>🔥 Shopping Deals Monitored Sources</h2>
          <div className="source-grid">
            {sources.filter(s => s.type.startsWith('deals-')).map(s => (
              <div className="source-card" key={s.id}>
                <div className="source-type">{s.type.replace('deals-', '').replace('-', ' ')}</div>
                <h3>{s.name}</h3>
                <div className="source-id">{s.source_id}</div>
                
                <div className="card-actions">
                  <label className="toggle-switch">
                    <input type="checkbox" checked={s.is_active === 1} onChange={() => toggleSource(s.id, s.is_active)} />
                    <span className="slider"></span>
                  </label>
                  <button className="btn-delete" onClick={() => deleteSource(s.id)}>Delete</button>
                </div>
              </div>
            ))}
            {sources.filter(s => s.type.startsWith('deals-')).length === 0 && (
              <p style={{ color: 'var(--text-muted)', gridColumn: '1/-1' }}>No deals sources added yet.</p>
            )}
          </div>
        </div>
      )}

      {/* DISCOVERY OVERLAY MODAL */}
      {discoverType && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 style={{ fontSize: '1.4em' }}>
                🔍 Discover My Subscribed {discoverType === 'telegram' ? 'Telegram Channels' : 'WhatsApp Chats'}
              </h3>
              <button 
                onClick={() => setDiscoverType(null)} 
                className="btn-delete" 
                style={{ borderRadius: '50%', padding: '6px 12px' }}
              >
                ✕
              </button>
            </div>
            
            <div className="modal-body">
              {discoverLoading ? (
                <div className="loader"></div>
              ) : discoverList.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                  No channels or chats found. Verify your active session connection.
                </p>
              ) : (
                <div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9em', marginBottom: '15px' }}>
                    Click "Monitor Source" to add any discovered chat into your active monitor grid (seeded as inactive first).
                  </p>
                  {discoverList.map(item => (
                    <div className="modal-list-item" key={item.id}>
                      <div className="modal-list-item-info">
                        <span className="modal-list-item-name">{item.name}</span>
                        <span className="modal-list-item-id">{item.id}</span>
                      </div>
                      <button 
                        onClick={() => handleAddDiscoveredSource(item)} 
                        className="btn-add" 
                        style={{ height: '36px', padding: '0 16px', fontSize: '0.85em' }}
                      >
                        ➕ Monitor Source
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
