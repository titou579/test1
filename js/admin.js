// public/js/admin.js — panneau d'administration

// Auto-detect backend URL from the socket.io.js script tag
(function() {
  var script = document.querySelector('script[src*="socket.io/socket.io.js"]');
  if (script && script.src) {
    window.BACKEND = script.src.replace(/\/socket\.io\/socket\.io\.js.*$/, '');
  }
})();

const API = {
  async post(url, body, token) {
    const res = await fetch((window.BACKEND || '') + url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(body || {})
    });
    return res.json();
  },
  async get(url, token) {
    const res = await fetch((window.BACKEND || '') + url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    return res.json();
  },
  async del(url, token) {
    const res = await fetch((window.BACKEND || '') + url, { method: 'DELETE', headers: token ? { Authorization: 'Bearer ' + token } : {} });
    return res.json();
  }
};

const SafeStorage = {
  get(key) { try { return localStorage.getItem(key); } catch(e) { return null; } },
  set(key, val) { try { localStorage.setItem(key, val); } catch(e) {} },
  remove(key) { try { localStorage.removeItem(key); } catch(e) {} }
};

function getSession() {
  // First try URL hash (passed from index.html for cross-page navigation in sandboxed iframes)
  if (location.hash && location.hash.length > 1) {
    try {
      const data = JSON.parse(decodeURIComponent(location.hash.slice(1)));
      if (data.token && data.user) {
        // Store it for later use
        SafeStorage.set('sod_token', data.token);
        SafeStorage.set('sod_user', JSON.stringify(data.user));
        return { token: data.token, user: data.user };
      }
    } catch(e) {}
  }
  // Fallback to SafeStorage (localStorage or memStore)
  let token = SafeStorage.get('sod_token');
  let userStr = SafeStorage.get('sod_user');
  // Fallback to cookies
  if (!token) {
    try {
      const cookies = document.cookie.split(';').map(c => c.trim());
      for (const c of cookies) {
        if (c.startsWith('sod_token=')) token = c.slice(10);
        if (c.startsWith('sod_user=')) userStr = decodeURIComponent(c.slice(8));
      }
    } catch(e) {}
  }
  return { token, user: JSON.parse(userStr || 'null') };
}

let SHOP_CACHE = [];

// ===== MODALE D'ACTION ADMIN GÉNÉRIQUE =====
// Remplace les prompt() natifs par une vraie fenêtre avec champs (nombre, mot de
// passe, liste déroulante...). fields: [{id,label,type,value,min,max,options}]
function openAdminModal({ title, desc, fields, submitLabel, onSubmit }) {
  const modal = document.getElementById('adminActionModal');
  const descEl = document.getElementById('adminActionDesc');
  document.getElementById('adminActionTitle').textContent = title;
  descEl.textContent = desc || '';
  descEl.classList.toggle('hidden', !desc);

  const body = document.getElementById('adminActionBody');
  body.innerHTML = fields.map(f => {
    if (f.type === 'select') {
      const opts = f.options.map(o => `<option value="${o.value}"${String(o.value) === String(f.value) ? ' selected' : ''}>${o.label}</option>`).join('');
      return `<div class="field"><label>${f.label}</label><select id="aaf_${f.id}">${opts}</select></div>`;
    }
    const attrs = [
      f.min !== undefined ? `min="${f.min}"` : '',
      f.max !== undefined ? `max="${f.max}"` : '',
    ].filter(Boolean).join(' ');
    return `<div class="field"><label>${f.label}</label><input id="aaf_${f.id}" type="${f.type || 'text'}" value="${f.value ?? ''}" ${attrs}></div>`;
  }).join('');

  const confirmBtn = document.getElementById('btnConfirmAdminAction');
  confirmBtn.textContent = submitLabel || 'Confirmer';
  modal.classList.remove('hidden');
  const firstField = body.querySelector('input,select');
  if (firstField) setTimeout(() => firstField.focus(), 30);

  function closeModal() { modal.classList.add('hidden'); }
  function submit() {
    const values = {};
    fields.forEach(f => { values[f.id] = document.getElementById('aaf_' + f.id).value; });
    onSubmit(values, closeModal);
  }
  confirmBtn.onclick = submit;
  document.getElementById('btnCancelAdminAction').onclick = closeModal;
  document.getElementById('btnCloseAdminAction').onclick = closeModal;
  modal.onclick = (e) => { if (e.target.id === 'adminActionModal') closeModal(); };
  body.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const { token, user } = getSession();
  if (!token || !user || !user.isAdmin) {
    document.getElementById('gate').classList.remove('hidden');
    document.getElementById('panel').classList.add('hidden');
    return;
  }
  document.getElementById('gate').classList.add('hidden');
  document.getElementById('panel').classList.remove('hidden');

  loadAll();
});

async function loadAll() {
  await Promise.all([
    loadUsers(),
    loadShop(),
    loadBattlePassAdmin(),
    loadConfig(),
    loadRooms()
  ]);
  refreshKPIs();
}

function refreshKPIs() {
  const { token } = getSession();
  API.get('/api/admin/users', token).then(d => {
    document.getElementById('kpiUsers').textContent = (d.users || []).length;
  });
  API.get('/api/admin/rooms', token).then(d => {
    document.getElementById('kpiRooms').textContent = (d.rooms || []).length;
    let total = 0;
    (d.rooms || []).forEach(r => total += r.players);
    document.getElementById('kpiPlayers').textContent = total;
  });
  API.get('/api/admin/config', token).then(d => {
    document.getElementById('kpiMonetization').textContent = d.config?.monetizationEnabled ? 'ON' : 'OFF';
  });
}

// ===== TABS =====
document.querySelectorAll('nav.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
    if (btn.dataset.tab === 'users') loadUsers();
    if (btn.dataset.tab === 'shop') loadShop();
    if (btn.dataset.tab === 'battlepass') loadBattlePassAdmin();
    if (btn.dataset.tab === 'rooms') loadRooms();
    if (btn.dataset.tab === 'reports') loadReports();
    if (btn.dataset.tab === 'config') loadConfig();
  });
});

// ===== USERS =====
async function loadUsers() {
  const { token } = getSession();
  const d = await API.get('/api/admin/users', token);
  const users = d.users || [];
  const search = (document.getElementById('userSearch')?.value || '').toLowerCase();
  const filtered = search ? users.filter(u => u.username.toLowerCase().includes(search)) : users;
  const body = document.getElementById('usersBody');
  body.innerHTML = filtered.map(u => `
    <tr>
      <td>${u.username}${u.isAdmin ? ' <span class="badge-admin">★</span>' : ''}${u.banned ? ' <span class="badge-banned">BANNI</span>' : ''}</td>
      <td>${u.level || 1}</td>
      <td>${u.xp || 0}</td>
      <td>${u.currency || 0}</td>
      <td>${u.banned ? 'Banni' : u.muted ? 'Muet' : 'Actif'}</td>
      <td class="user-actions-cell">
        <button class="btn small" onclick="adminGrantCurrency('${u.username}')">💎 Gemmes</button>
        <button class="btn small" onclick="adminGrantXP('${u.username}')">⭐ XP</button>
        <button class="btn small" onclick="adminSetLevel('${u.username}')">📊 Niveau</button>
        <button class="btn small" onclick="adminGrantCosmetic('${u.username}')">🎁 Objet</button>
        <button class="btn small" onclick="adminGrantAll('${u.username}')">✅ Tout</button>
        <button class="btn small ${u.isAdmin ? 'danger' : 'ghost'}" onclick="adminToggle('${u.username}','admin',${!u.isAdmin})">${u.isAdmin ? 'Retirer admin' : 'Admin'}</button>
        <button class="btn small ${u.banned ? 'primary' : 'danger'}" onclick="adminToggle('${u.username}','ban',${!u.banned})">${u.banned ? 'Débannir' : 'Bannir'}</button>
        <button class="btn small ${u.muted ? 'primary' : 'ghost'}" onclick="adminToggle('${u.username}','mute',${!u.muted})">${u.muted ? 'Démuter' : 'Muter'}</button>
        <button class="btn small ghost" onclick="adminResetPass('${u.username}')">🔑 Reset mdp</button>
      </td>
    </tr>`).join('');
}

window.adminGrantCurrency = function(username) {
  openAdminModal({
    title: `💎 Gemmes — ${username}`,
    desc: 'Montant à ajouter (négatif pour retirer).',
    fields: [{ id: 'amount', label: 'Montant', type: 'number', value: 100 }],
    submitLabel: 'Donner',
    onSubmit: (v, close) => {
      const amt = Number(v.amount);
      if (!Number.isFinite(amt) || amt === 0) { showToast('Entre un montant valide.', 'warning'); return; }
      const { token } = getSession();
      API.post(`/api/admin/users/${username}/currency`, { amount: amt }, token).then(d => {
        if (d.error) { showToast(d.error, 'error'); return; }
        close();
        showToast(`${username} a maintenant ${d.newBalance} 💎`, 'success');
        loadUsers();
      });
    }
  });
};

window.adminGrantXP = function(username) {
  openAdminModal({
    title: `⭐ XP — ${username}`,
    desc: "Montant d'XP à ajouter (négatif pour retirer).",
    fields: [{ id: 'amount', label: 'XP', type: 'number', value: 500 }],
    submitLabel: 'Donner',
    onSubmit: (v, close) => {
      const amt = Number(v.amount);
      if (!Number.isFinite(amt) || amt === 0) { showToast('Entre un montant valide.', 'warning'); return; }
      const { token } = getSession();
      API.post(`/api/admin/users/${username}/xp`, { amount: amt }, token).then(d => {
        if (d.error) { showToast(d.error, 'error'); return; }
        close();
        showToast(`${username} est maintenant niveau ${d.newLevel} (${d.newXP} XP)`, 'success');
        loadUsers();
      });
    }
  });
};

window.adminSetLevel = function(username) {
  openAdminModal({
    title: `📊 Niveau — ${username}`,
    desc: 'Niveau à définir (1-100).',
    fields: [{ id: 'level', label: 'Niveau', type: 'number', value: 10, min: 1, max: 100 }],
    submitLabel: 'Définir',
    onSubmit: (v, close) => {
      const lvl = Number(v.level);
      if (!Number.isFinite(lvl) || lvl < 1) { showToast('Entre un niveau valide.', 'warning'); return; }
      const { token } = getSession();
      API.post(`/api/admin/users/${username}/level`, { level: lvl }, token).then(d => {
        if (d.error) { showToast(d.error, 'error'); return; }
        close();
        showToast(`${username} est maintenant niveau ${d.newLevel}`, 'success');
        loadUsers();
      });
    }
  });
};

window.adminGrantCosmetic = function(username) {
  if (!SHOP_CACHE.length) { showToast("Catalogue boutique vide — ouvre l'onglet Boutique puis réessaie.", 'warning'); return; }
  openAdminModal({
    title: `🎁 Objet — ${username}`,
    desc: 'Choisis le cosmétique à offrir.',
    fields: [{
      id: 'cosmeticId', label: 'Objet', type: 'select', value: SHOP_CACHE[0].id,
      options: SHOP_CACHE.map(i => ({ value: i.id, label: `${i.name} (${i.rarity})` }))
    }],
    submitLabel: 'Offrir',
    onSubmit: (v, close) => {
      const { token } = getSession();
      API.post(`/api/admin/users/${username}/grant-cosmetic`, { cosmeticId: v.cosmeticId }, token).then(d => {
        if (d.error) { showToast(d.error, 'error'); return; }
        close();
        showToast(`Objet donné à ${username}`, 'success');
        loadUsers();
      });
    }
  });
};

window.adminGrantAll = function(username) {
  if (!confirm(`Donner TOUS les cosmétiques à ${username} ?`)) return;
  const { token } = getSession();
  API.post(`/api/admin/users/${username}/grant-all-cosmetics`, {}, token).then(d => {
    if (d.error) { showToast(d.error, 'error'); return; }
    showToast(`${d.count} objets donnés à ${username}`, 'success');
    loadUsers();
  });
};

window.adminToggle = function(username, action, value) {
  const { token } = getSession();
  const url = action === 'admin' ? `/api/admin/users/${username}/admin`
    : action === 'ban' ? `/api/admin/users/${username}/ban`
    : `/api/admin/users/${username}/mute`;
  API.post(url, { value }, token).then(d => {
    if (d.error) { showToast(d.error, 'error'); return; }
    loadUsers();
  });
};

window.adminResetPass = function(username) {
  openAdminModal({
    title: `🔑 Réinitialiser le mot de passe — ${username}`,
    desc: 'Le nouveau mot de passe doit contenir au moins 4 caractères.',
    fields: [{ id: 'newPass', label: 'Nouveau mot de passe', type: 'password', value: '' }],
    submitLabel: 'Réinitialiser',
    onSubmit: (v, close) => {
      if (!v.newPass || v.newPass.length < 4) { showToast('Mot de passe trop court (min 4).', 'warning'); return; }
      const { token } = getSession();
      API.post(`/api/admin/users/${username}/reset-password`, { newPassword: v.newPass }, token).then(d => {
        if (d.error) { showToast(d.error, 'error'); return; }
        close();
        showToast(`Mot de passe réinitialisé pour ${username}`, 'success');
      });
    }
  });
};

document.getElementById('userSearch')?.addEventListener('input', () => loadUsers());

// ===== SHOP =====
async function loadShop() {
  const { token } = getSession();
  const d = await API.get('/api/admin/shop', token);
  SHOP_CACHE = d.shop || [];
  const body = document.getElementById('shopBody');
  body.innerHTML = SHOP_CACHE.map(item => `
    <tr>
      <td>${item.name}</td>
      <td>${item.type}</td>
      <td>💎 ${item.price}</td>
      <td><span class="tag ${item.rarity}">${item.rarity}</span></td>
      <td>${item.available ? '✅' : '❌'}</td>
      <td class="user-actions-cell">
        <button class="btn small" onclick="editShopItem('${item.id}')">✏️ Modifier</button>
        <button class="btn small danger" onclick="deleteShopItem('${item.id}')">🗑️ Supprimer</button>
      </td>
    </tr>`).join('');
}

window.editShopItem = function(id) {
  const item = SHOP_CACHE.find(i => i.id === id);
  if (!item) return;
  document.getElementById('shopEditorTitle').textContent = 'Modifier: ' + item.name;
  document.getElementById('itId').value = item.id;
  document.getElementById('itName').value = item.name;
  document.getElementById('itType').value = item.type;
  document.getElementById('itColor').value = item.color;
  document.getElementById('itPattern').value = item.pattern;
  document.getElementById('itPrice').value = item.price;
  document.getElementById('itRarity').value = item.rarity;
  document.getElementById('itAvailable').checked = item.available;
  document.getElementById('itPremium').checked = item.premiumOnly;
};

window.deleteShopItem = function(id) {
  if (!confirm('Supprimer cet article ?')) return;
  const { token } = getSession();
  API.del(`/api/admin/shop/${id}`, token).then(d => {
    if (d.error) { showToast(d.error, 'error'); return; }
    loadShop();
  });
};

document.getElementById('btnSaveItem')?.addEventListener('click', () => {
  const item = {
    id: document.getElementById('itId').value,
    name: document.getElementById('itName').value,
    type: document.getElementById('itType').value,
    color: document.getElementById('itColor').value,
    pattern: document.getElementById('itPattern').value,
    price: Number(document.getElementById('itPrice').value),
    rarity: document.getElementById('itRarity').value,
    available: document.getElementById('itAvailable').checked,
    premiumOnly: document.getElementById('itPremium').checked
  };
  if (!item.id) { showToast('ID requis.', 'warning'); return; }
  const { token } = getSession();
  API.post('/api/admin/shop', item, token).then(d => {
    if (d.error) { showToast(d.error, 'error'); return; }
    showToast('Article enregistré', 'success');
    loadShop();
    document.getElementById('btnClearItem').click();
  });
});

document.getElementById('btnClearItem')?.addEventListener('click', () => {
  document.getElementById('shopEditorTitle').textContent = 'Nouvel article';
  document.getElementById('itId').value = '';
  document.getElementById('itName').value = '';
  document.getElementById('itType').value = 'skin';
  document.getElementById('itColor').value = '#4da3ff';
  document.getElementById('itPattern').value = 'plain';
  document.getElementById('itPrice').value = '100';
  document.getElementById('itRarity').value = 'commun';
  document.getElementById('itAvailable').checked = true;
  document.getElementById('itPremium').checked = false;
});

// ===== BATTLE PASS =====
async function loadBattlePassAdmin() {
  const { token } = getSession();
  const d = await API.get('/api/admin/battlepass', token);
  const tiers = d.tiers || [];
  const container = document.getElementById('bpTiers');
  if (!container) return;
  container.innerHTML = tiers.map(t => {
    const rType = t.reward?.type || 'currency';
    const rAmount = t.reward?.amount || '';
    const rItemId = t.reward?.itemId || '';
    const pType = t.premiumReward?.type || '';
    const pAmount = t.premiumReward?.amount || '';
    const pItemId = t.premiumReward?.itemId || '';
    const shopOptions = SHOP_CACHE.map(i => `<option value="${i.id}" ${rItemId === i.id ? 'selected' : ''}>${i.name}</option>`).join('');
    const pShopOptions = SHOP_CACHE.map(i => `<option value="${i.id}" ${pItemId === i.id ? 'selected' : ''}>${i.name}</option>`).join('');
    return `<div class="bp-tier-row">
      <span class="tier-num">P${t.tier}</span>
      <select onchange="updateBPTier(${t.tier},'reward.type',this.value)">
        <option value="currency" ${rType === 'currency' ? 'selected' : ''}>Cristaux</option>
        <option value="item" ${rType === 'item' ? 'selected' : ''}>Objet</option>
      </select>
      <input type="number" placeholder="Montant" value="${rAmount}" onchange="updateBPTier(${t.tier},'reward.amount',this.value)" style="width:70px;" ${rType === 'item' ? 'disabled' : ''}>
      <select onchange="updateBPTier(${t.tier},'reward.itemId',this.value)" ${rType !== 'item' ? 'disabled' : ''}>
        <option value="">— Objet —</option>
        ${shopOptions}
      </select>
      <span style="color:var(--gold);">| Premium:</span>
      <select onchange="updateBPTier(${t.tier},'premiumReward.type',this.value)">
        <option value="" ${!pType ? 'selected' : ''}>Aucune</option>
        <option value="currency" ${pType === 'currency' ? 'selected' : ''}>Cristaux</option>
        <option value="item" ${pType === 'item' ? 'selected' : ''}>Objet</option>
      </select>
      <input type="number" placeholder="Montant P" value="${pAmount}" onchange="updateBPTier(${t.tier},'premiumReward.amount',this.value)" style="width:70px;" ${pType !== 'currency' ? 'disabled' : ''}>
      <select onchange="updateBPTier(${t.tier},'premiumReward.itemId',this.value)" ${pType !== 'item' ? 'disabled' : ''}>
        <option value="">— Objet P —</option>
        ${pShopOptions}
      </select>
      <label style="display:flex;align-items:center;gap:4px;font-size:11px;margin:0;text-transform:none;">XP: <input type="number" value="${t.xpRequired || t.tier * 100}" onchange="updateBPTier(${t.tier},'xpRequired',this.value)" style="width:60px;"></label>
      <div class="bp-actions">
        <button class="btn small danger" onclick="removeBPTier(${t.tier})">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

window.updateBPTier = function(tier, path, value) {
  const { token } = getSession();
  // Build the patch object from dot path
  const parts = path.split('.');
  const patch = {};
  let cur = patch;
  for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = {}; cur = cur[parts[i]]; }
  // Convert value
  let val = value;
  if (parts[parts.length - 1] === 'amount' || parts[parts.length - 1] === 'xpRequired') val = Number(val);
  if (value === '') val = null;
  cur[parts[parts.length - 1]] = val;
  // For reward type changes, send full reward object
  if (path === 'reward.type') {
    patch.reward = { type: value, amount: value === 'currency' ? 50 : undefined, itemId: value === 'item' ? '' : undefined };
    if (value === 'currency') { patch.reward.amount = 50; delete patch.reward.itemId; }
    else { patch.reward.itemId = ''; delete patch.reward.amount; }
  } else if (path === 'premiumReward.type') {
    if (value === '') { patch.premiumReward = null; }
    else if (value === 'currency') { patch.premiumReward = { type: 'currency', amount: 100 }; }
    else { patch.premiumReward = { type: 'item', itemId: '' }; }
  } else if (path.startsWith('reward.')) {
    // Need to send full reward
    const tierData = getCurrentBPTier(tier);
    if (tierData) {
      const r = { ...tierData.reward };
      if (parts[1] === 'amount') r.amount = Number(value);
      if (parts[1] === 'itemId') r.itemId = value;
      patch.reward = r;
    }
  } else if (path.startsWith('premiumReward.')) {
    const tierData = getCurrentBPTier(tier);
    if (tierData && tierData.premiumReward) {
      const p = { ...tierData.premiumReward };
      if (parts[1] === 'amount') p.amount = Number(value);
      if (parts[1] === 'itemId') p.itemId = value;
      patch.premiumReward = p;
    }
  }
  API.post(`/api/admin/battlepass/${tier}`, patch, token).then(d => {
    if (d.error) { showToast(d.error, 'error'); }
    loadBattlePassAdmin();
  });
};

let _bpTiersCache = [];
function getCurrentBPTier(tier) {
  return _bpTiersCache.find(t => t.tier === tier);
}

window.removeBPTier = function(tier) {
  if (!confirm(`Supprimer le palier ${tier} ?`)) return;
  const { token } = getSession();
  API.del(`/api/admin/battlepass/${tier}`, token).then(d => {
    if (d.error) { showToast(d.error, 'error'); return; }
    loadBattlePassAdmin();
  });
};

document.getElementById('btnAddBPTier')?.addEventListener('click', () => {
  openAdminModal({
    title: '+ Ajouter un palier',
    desc: 'Numéro du nouveau palier.',
    fields: [{ id: 'num', label: 'Palier n°', type: 'number', value: 51, min: 1 }],
    submitLabel: 'Ajouter',
    onSubmit: (v, close) => {
      const num = Number(v.num);
      if (!Number.isFinite(num) || num < 1) { showToast('Entre un numéro de palier valide.', 'warning'); return; }
      const { token } = getSession();
      API.post(`/api/admin/battlepass/${num}/add`, {}, token).then(d => {
        if (d.error) { showToast(d.error, 'error'); return; }
        close();
        loadBattlePassAdmin();
      });
    }
  });
});

document.getElementById('btnResetBP')?.addEventListener('click', () => {
  if (!confirm('Réinitialiser TOUS les paliers du pass de combat aux valeurs par défaut ?')) return;
  const { token } = getSession();
  API.post('/api/admin/battlepass/reset', {}, token).then(d => {
    if (d.error) { showToast(d.error, 'error'); return; }
    showToast('Pass de combat réinitialisé', 'success');
    loadBattlePassAdmin();
  });
});

// ===== ROOMS =====
async function loadRooms() {
  const { token } = getSession();
  const d = await API.get('/api/admin/rooms', token);
  const body = document.getElementById('roomsBody');
  if (!body) return;
  body.innerHTML = (d.rooms || []).map(r => `
    <tr>
      <td>${r.code}</td>
      <td>${r.mode}</td>
      <td>${r.map}</td>
      <td>${r.phase}</td>
      <td>${r.players}/${r.maxPlayers}</td>
      <td><button class="btn small danger" onclick="closeRoom('${r.code}')">Fermer</button></td>
    </tr>`).join('') || '<tr><td colspan="6" style="color:var(--muted);">Aucun salon actif.</td></tr>';
}

window.closeRoom = function(code) {
  if (!confirm(`Fermer le salon ${code} ?`)) return;
  const { token } = getSession();
  API.post(`/api/admin/rooms/${code}/close`, {}, token).then(d => {
    if (d.error) { showToast(d.error, 'error'); return; }
    loadRooms();
    refreshKPIs();
  });
};

// ===== REPORTS =====
async function loadReports() {
  const { token } = getSession();
  const d = await API.get('/api/admin/reported-skins', token);
  const grid = document.getElementById('reportsGrid');
  if (!grid) return;
  grid.innerHTML = (d.users || []).map(u => `
    <div class="card" style="padding:12px;">
      <h4>${u.username}</h4>
      <p style="font-size:12px;color:var(--muted);">Signalements: ${u.skinReportCount}</p>
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button class="btn small primary" onclick="approveSkin('${u.username}')">Approuver</button>
        <button class="btn small danger" onclick="clearSkin('${u.username}')">Effacer</button>
      </div>
    </div>`).join('') || '<p style="color:var(--muted);">Aucun signalement.</p>';
}

window.approveSkin = function(username) {
  const { token } = getSession();
  API.post(`/api/admin/users/${username}/skin/approve`, {}, token).then(d => {
    if (d.error) { showToast(d.error, 'error'); return; }
    loadReports();
  });
};

window.clearSkin = function(username) {
  if (!confirm(`Effacer le skin peint de ${username} ?`)) return;
  const { token } = getSession();
  API.post(`/api/admin/users/${username}/skin/clear`, {}, token).then(d => {
    if (d.error) { showToast(d.error, 'error'); return; }
    loadReports();
  });
};

// ===== CONFIG =====
async function loadConfig() {
  const { token } = getSession();
  const d = await API.get('/api/admin/config', token);
  const cfg = d.config || {};
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('cfgMin', cfg.baseSwapMinSeconds);
  set('cfgMax', cfg.baseSwapMaxSeconds);
  set('cfgImmBase', cfg.swapImmunityBase);
  set('cfgImmHigh', cfg.swapImmunityHighPing);
  set('cfgPingThresh', cfg.highPingThresholdMs);
  set('cfgDailyBase', cfg.dailyRewardBase);
  set('cfgDailyStep', cfg.dailyRewardStep);
  set('cfgDailyMax', cfg.dailyRewardMaxStreak);
  const mon = document.getElementById('cfgMonetization');
  if (mon) mon.checked = cfg.monetizationEnabled;
}

document.getElementById('btnSaveConfig')?.addEventListener('click', () => {
  const get = id => document.getElementById(id)?.value;
  const patch = {
    baseSwapMinSeconds: Number(get('cfgMin')),
    baseSwapMaxSeconds: Number(get('cfgMax')),
    swapImmunityBase: Number(get('cfgImmBase')),
    swapImmunityHighPing: Number(get('cfgImmHigh')),
    highPingThresholdMs: Number(get('cfgPingThresh')),
    dailyRewardBase: Number(get('cfgDailyBase')),
    dailyRewardStep: Number(get('cfgDailyStep')),
    dailyRewardMaxStreak: Number(get('cfgDailyMax')),
    monetizationEnabled: document.getElementById('cfgMonetization').checked
  };
  const { token } = getSession();
  API.post('/api/admin/config', patch, token).then(d => {
    if (d.error) { showToast(d.error, 'error'); return; }
    showToast('Configuration enregistrée', 'success');
    refreshKPIs();
  });
});

document.getElementById('btnAnnounce')?.addEventListener('click', () => {
  const text = document.getElementById('announceText').value;
  if (!text.trim()) { showToast('Annonce vide.', 'warning'); return; }
  const { token } = getSession();
  API.post('/api/admin/announce', { text }, token).then(d => {
    if (d.error) { showToast(d.error, 'error'); return; }
    showToast('Annonce diffusée', 'success');
    document.getElementById('announceText').value = '';
  });
});

// Cache BP tiers for updateBPTier
const _origLoadBP = loadBattlePassAdmin;
loadBattlePassAdmin = async function() {
  const { token } = getSession();
  const d = await API.get('/api/admin/battlepass', token);
  _bpTiersCache = d.tiers || [];
  return _origLoadBP();
};
