const { useState, useEffect } = React;

function App() {
  const [sources, setSources] = useState([]);
  const [categories, setCategories] = useState([]);
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

  // Category management states
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [catForm, setCatForm] = useState({ slug: '', display_name: '', bot_token: '', chat_id: '', ai_prompt: '' });
  const [catMsg, setCatMsg] = useState({ text: '', type: 'info' });
  const [editingCat, setEditingCat] = useState(null);

  useEffect(() => {
    fetchSources();
    fetchCategories();
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

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/categories');
      if (res.ok) {
        const data = await res.json();
        setCategories(data);
      }
    } catch (err) {
      console.error('Failed to fetch categories', err);
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
        setFormData({ name: '', source_id: '', type: formData.type });
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

  // ─── Category Handlers ───────────────────────────────────────────────────
  const handleCatInputChange = (e) => {
    setCatForm({ ...catForm, [e.target.name]: e.target.value });
  };

  const handleAddCategory = async (e) => {
    e.preventDefault();
    setCatMsg({ text: 'Creating category...', type: 'info' });
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(catForm)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCatForm({ slug: '', display_name: '', bot_token: '', chat_id: '', ai_prompt: '' });
        setCatMsg({ text: 'Category created successfully!', type: 'success' });
        setShowAddCategory(false);
        fetchCategories();
      } else {
        setCatMsg({ text: `Error: ${data.error || 'Failed to create'}`, type: 'error' });
      }
    } catch (err) {
      setCatMsg({ text: err.message, type: 'error' });
    }
  };

  const handleUpdateCategory = async (e) => {
    e.preventDefault();
    setCatMsg({ text: 'Updating category...', type: 'info' });
    try {
      const res = await fetch(`/api/categories/${editingCat.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(catForm)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCatMsg({ text: 'Category updated successfully!', type: 'success' });
        setEditingCat(null);
        setCatForm({ slug: '', display_name: '', bot_token: '', chat_id: '', ai_prompt: '' });
        fetchCategories();
      } else {
        setCatMsg({ text: `Error: ${data.error || 'Failed to update'}`, type: 'error' });
      }
    } catch (err) {
      setCatMsg({ text: err.message, type: 'error' });
    }
  };

  const handleDeleteCategory = async (id) => {
    if (!confirm('Delete this category? All associated sources will also be removed.')) return;
    try {
      const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        fetchCategories();
        fetchSources();
        setCatMsg({ text: 'Category deleted.', type: 'info' });
      } else {
        setCatMsg({ text: `Error: ${data.error}`, type: 'error' });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleTestCategory = async (id) => {
    setCatMsg({ text: 'Sending test message...', type: 'info' });
    try {
      const res = await fetch(`/api/categories/${id}/test`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setCatMsg({ text: '✅ Test message sent! Check your Telegram.', type: 'success' });
      } else {
        setCatMsg({ text: `Error: ${data.error || 'Test failed'}`, type: 'error' });
      }
    } catch (err) {
      setCatMsg({ text: err.message, type: 'error' });
    }
  };

  const startEditCategory = (cat) => {
    setEditingCat(cat);
    setCatForm({
      slug: cat.slug,
      display_name: cat.display_name,
      bot_token: cat.bot_token || '',
      chat_id: cat.chat_id || '',
      ai_prompt: cat.ai_prompt || ''
    });
    setShowAddCategory(false);
  };

  const cancelEditCategory = () => {
    setEditingCat(null);
    setCatForm({ slug: '', display_name: '', bot_token: '', chat_id: '', ai_prompt: '' });
    setCatMsg({ text: '', type: 'info' });
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
      
      let data = {};
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(`Server returned non-JSON response (${res.status}): ${text.substring(0, 100)}`);
      }

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

      let data = {};
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(`Server returned non-JSON response (${res.status}): ${text.substring(0, 100)}`);
      }

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

  const handleAddDiscoveredSource = async (item, categorySlug) => {
    const isTg = discoverType === 'telegram';
    const type = isTg 
      ? `${categorySlug}-telegram`
      : `${categorySlug}-whatsapp`;

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

  // Build dynamic source type dropdown options from categories
  const buildTypeOptions = () => {
    const platforms = [
      { suffix: 'whatsapp', label: 'WhatsApp Group/Channel' },
      { suffix: 'telegram', label: 'Telegram Channel' },
      { suffix: 'reddit', label: 'Reddit Subreddit' },
      { suffix: 'forum', label: 'Web Forum' },
      { suffix: 'youtube', label: 'YouTube Channel' }
    ];
    const options = [];
    for (const cat of categories) {
      for (const p of platforms) {
        options.push({
          value: `${cat.slug}-${p.suffix}`,
          label: `${cat.display_name} (${p.label})`
        });
      }
    }
    return options;
  };

  // Get category icon/emoji from slug
  const getCategoryIcon = (slug) => {
    const icons = { cc: '💳', deals: '🔥' };
    return icons[slug] || '📂';
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

      {/* WhatsApp QR scanner when disconnected */}
      {sysStatus.whatsapp !== 'connected' && sysStatus.whatsappQr && (
        <div className="panel-card" style={{ background: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '16px', padding: '24px', marginBottom: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem' }}>📱</div>
          <h2 style={{ color: 'var(--warning)', margin: 0 }}>Scan WhatsApp QR Code</h2>
          <p style={{ maxWidth: '600px', margin: 0, color: 'var(--text-muted)' }}>
            Your WhatsApp session is currently disconnected. Scan the QR code below using your phone's WhatsApp linked devices settings to connect instantly.
          </p>
          <div style={{ background: '#fff', padding: '16px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
            <img 
              src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(sysStatus.whatsappQr)}`} 
              alt="WhatsApp QR Code" 
              style={{ display: 'block', width: '250px', height: '250px' }}
            />
          </div>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>⏳ Refreshing automatically in the background...</span>
        </div>
      )}

      {/* SECTION 0: Categories Management Panel */}
      <div className="panel-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h2>📂 Briefing Categories</h2>
          <button onClick={() => { setShowAddCategory(!showAddCategory); setEditingCat(null); setCatMsg({ text: '', type: 'info' }); }} className="btn-action">
            {showAddCategory ? '✕ Cancel' : '➕ Add Custom Category'}
          </button>
        </div>
        <p style={{ marginBottom: '20px' }}>
          Each category gets its own Telegram bot, AI prompt, and source assignments. Briefs are sent at 6 AM, 2 PM & 10 PM IST.
        </p>

        {catMsg.text && (
          <div className={`alert alert-${catMsg.type}`}>
            {catMsg.text}
          </div>
        )}

        {/* Category cards grid */}
        <div className="source-grid" style={{ marginBottom: showAddCategory || editingCat ? '24px' : '0' }}>
          {categories.map(cat => (
            <div className="source-card" key={cat.id} style={{ position: 'relative' }}>
              <div className="source-type" style={{ fontSize: '0.75em' }}>
                {cat.bot_token && cat.chat_id ? '🟢 Bot Connected' : '⚠️ No Bot Token'}
              </div>
              <h3>{getCategoryIcon(cat.slug)} {cat.display_name}</h3>
              <div className="source-id">{cat.slug}</div>
              {cat.ai_prompt && (
                <div style={{ fontSize: '0.8em', color: 'var(--text-muted)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  🤖 {cat.ai_prompt.substring(0, 60)}...
                </div>
              )}
              <div style={{ fontSize: '0.8em', color: 'var(--text-muted)', marginTop: '4px' }}>
                📊 {sources.filter(s => s.type.startsWith(cat.slug + '-')).length} sources
              </div>

              <div className="card-actions">
                <button onClick={() => startEditCategory(cat)} style={{ background: 'none', border: '1px solid var(--glass-border)', color: 'var(--text-muted)', cursor: 'pointer', padding: '6px 12px', borderRadius: '8px', fontSize: '0.85em' }}>
                  ✏️ Edit
                </button>
                {cat.bot_token && cat.chat_id && (
                  <button onClick={() => handleTestCategory(cat.id)} style={{ background: 'none', border: '1px solid rgba(16,185,129,0.3)', color: 'var(--success)', cursor: 'pointer', padding: '6px 12px', borderRadius: '8px', fontSize: '0.85em' }}>
                    🔔 Test
                  </button>
                )}
                {cat.slug !== 'cc' && cat.slug !== 'deals' && (
                  <button className="btn-delete" onClick={() => handleDeleteCategory(cat.id)}>Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Add new category form */}
        {showAddCategory && (
          <form onSubmit={handleAddCategory} style={{ display: 'flex', flexDirection: 'column', gap: '14px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--glass-border)', borderRadius: '16px', padding: '24px' }}>
            <h3 style={{ margin: 0, fontSize: '1.1em' }}>➕ Create New Category</h3>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div className="input-group" style={{ flex: 1, minWidth: '180px' }}>
                <label>Slug (ID)</label>
                <input type="text" name="slug" value={catForm.slug} onChange={handleCatInputChange} placeholder="e.g. office, crypto" required pattern="[a-z0-9-]+" title="Lowercase letters, numbers, and hyphens only" />
              </div>
              <div className="input-group" style={{ flex: 1, minWidth: '220px' }}>
                <label>Display Name</label>
                <input type="text" name="display_name" value={catForm.display_name} onChange={handleCatInputChange} placeholder="e.g. Office Updates" required />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div className="input-group" style={{ flex: 1, minWidth: '280px' }}>
                <label>Telegram Bot Token</label>
                <input type="text" name="bot_token" value={catForm.bot_token} onChange={handleCatInputChange} placeholder="Paste bot token from @BotFather" />
              </div>
              <div className="input-group" style={{ flex: 1, minWidth: '180px' }}>
                <label>Your Telegram Chat ID</label>
                <input type="text" name="chat_id" value={catForm.chat_id} onChange={handleCatInputChange} placeholder="e.g. 123456789" />
              </div>
            </div>
            <div className="input-group">
              <label>Custom AI Prompt (optional)</label>
              <textarea name="ai_prompt" value={catForm.ai_prompt} onChange={handleCatInputChange} rows="2" placeholder="e.g. You are an office communication summarizer. Summarize key decisions, deadlines, and action items..." />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => { setShowAddCategory(false); setCatMsg({ text: '', type: 'info' }); }} className="btn-delete" style={{ height: '46px' }}>Cancel</button>
              <button type="submit" className="btn-add">Create Category</button>
            </div>
          </form>
        )}

        {/* Edit category form */}
        {editingCat && (
          <form onSubmit={handleUpdateCategory} style={{ display: 'flex', flexDirection: 'column', gap: '14px', background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '16px', padding: '24px' }}>
            <h3 style={{ margin: 0, fontSize: '1.1em' }}>✏️ Edit Category: {editingCat.display_name}</h3>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div className="input-group" style={{ flex: 1, minWidth: '180px' }}>
                <label>Slug (read-only)</label>
                <input type="text" value={catForm.slug} disabled style={{ opacity: 0.5 }} />
              </div>
              <div className="input-group" style={{ flex: 1, minWidth: '220px' }}>
                <label>Display Name</label>
                <input type="text" name="display_name" value={catForm.display_name} onChange={handleCatInputChange} required />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div className="input-group" style={{ flex: 1, minWidth: '280px' }}>
                <label>Telegram Bot Token</label>
                <input type="text" name="bot_token" value={catForm.bot_token} onChange={handleCatInputChange} placeholder="Paste bot token from @BotFather" />
              </div>
              <div className="input-group" style={{ flex: 1, minWidth: '180px' }}>
                <label>Your Telegram Chat ID</label>
                <input type="text" name="chat_id" value={catForm.chat_id} onChange={handleCatInputChange} placeholder="e.g. 123456789" />
              </div>
            </div>
            <div className="input-group">
              <label>Custom AI Prompt (optional)</label>
              <textarea name="ai_prompt" value={catForm.ai_prompt} onChange={handleCatInputChange} rows="2" placeholder="Custom summarization prompt for this category..." />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={cancelEditCategory} className="btn-delete" style={{ height: '46px' }}>Cancel</button>
              <button type="submit" className="btn-add">Save Changes</button>
            </div>
          </form>
        )}
      </div>

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
            <label>Category & Platform</label>
            <select name="type" value={formData.type} onChange={handleInputChange}>
              {buildTypeOptions().map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-add">Add Source</button>
        </form>
      </div>

      {/* SECTION 4: Sources list grid — grouped by category */}
      {loading ? (
        <div className="loader"></div>
      ) : (
        <div>
          {categories.map(cat => {
            const catSources = sources.filter(s => s.type.startsWith(cat.slug + '-'));
            return (
              <div key={cat.slug}>
                <h2 style={{ marginTop: '20px', marginBottom: '20px', fontSize: '1.6rem' }}>
                  {getCategoryIcon(cat.slug)} {cat.display_name} Monitored Sources
                </h2>
                <div className="source-grid" style={{ marginBottom: '40px' }}>
                  {catSources.map(s => (
                    <div className="source-card" key={s.id}>
                      <div className="source-type">{s.type.replace(cat.slug + '-', '').replace('-', ' ')}</div>
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
                  {catSources.length === 0 && (
                    <p style={{ color: 'var(--text-muted)', gridColumn: '1/-1' }}>No sources added for {cat.display_name} yet.</p>
                  )}
                </div>
              </div>
            );
          })}
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
              ) : (() => {
                const addedSourceIds = new Set(sources.map(s => (s.source_id || '').toLowerCase().trim()));
                const filteredList = discoverList.filter(item => item && item.id && !addedSourceIds.has(item.id.toLowerCase().trim()));
                
                if (filteredList.length === 0) {
                  return (
                    <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                      No new channels or chats found (all discovered sources are already being monitored!).
                    </p>
                  );
                }
                
                return (
                  <div>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9em', marginBottom: '15px' }}>
                      Click a category button to add the chat to that category's monitoring list.
                    </p>
                    {filteredList.map(item => (
                      <div className="modal-list-item" key={item.id}>
                        <div className="modal-list-item-info">
                          <span className="modal-list-item-name">{item.name}</span>
                          <span className="modal-list-item-id">{item.id}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {categories.map(cat => (
                            <button 
                              key={cat.slug}
                              onClick={() => handleAddDiscoveredSource(item, cat.slug)} 
                              className="btn-add" 
                              style={{ 
                                height: '36px', 
                                padding: '0 10px', 
                                fontSize: '0.82em', 
                                background: cat.slug === 'cc' 
                                  ? 'linear-gradient(135deg, var(--primary) 0%, #1e40af 100%)' 
                                  : cat.slug === 'deals'
                                    ? 'linear-gradient(135deg, #10b981 0%, #047857 100%)'
                                    : 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '4px' 
                              }}
                            >
                              {getCategoryIcon(cat.slug)} {cat.display_name}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
