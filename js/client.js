// public/js/client.js — logique du menu principal (hors partie)

// Auto-detect backend URL from the socket.io.js script tag.
// The deploy tool replaces port/3000 in the src attr with a proxy path;
// the browser resolves it to an absolute URL we can extract.
(function() {
  var script = document.querySelector('script[src*="socket.io/socket.io.js"]');
  if (script && script.src) {
    window.BACKEND = script.src.replace(/\/socket\.io\/socket\.io\.js.*$/, '');
  }
})();

const API = {
  async post(url, body, token) {
    const res = await fetch((window.BACKEND || '') + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(body || {})
    });
    return res.json();
  },
  async get(url, token) {
    const res = await fetch((window.BACKEND || '') + url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    return res.json();
  }
};

// Storage wrapper: uses localStorage when available, falls back to in-memory storage
// (needed for sandboxed preview iframes that block localStorage)
const _memStore = {};
window._memStore = _memStore; // Expose for game.js
const SafeStorage = {
  get(key) {
    try { return localStorage.getItem(key); }
    catch(e) { return _memStore[key] ?? null; }
  },
  set(key, val) {
    try { localStorage.setItem(key, val); }
    catch(e) { _memStore[key] = val; }
  },
  remove(key) {
    try { localStorage.removeItem(key); }
    catch(e) { delete _memStore[key]; }
  }
};

function saveSession(token, user) {
  SafeStorage.set('sod_token', token);
  SafeStorage.set('sod_user', JSON.stringify(user));
  // Also set cookies as cross-page fallback for sandboxed iframes
  try {
    document.cookie = `sod_token=${token}; path=/; max-age=86400`;
    document.cookie = `sod_user=${encodeURIComponent(JSON.stringify(user))}; path=/; max-age=86400`;
  } catch(e) {}
}
function getSession() {
  let token = SafeStorage.get('sod_token');
  let userStr = SafeStorage.get('sod_user');
  // Fallback to cookies for cross-page navigation in sandboxed iframes
  if (!token) {
    try {
      const cookies = document.cookie.split(';').map(c => c.trim());
      for (const c of cookies) {
        if (c.startsWith('sod_token=')) token = c.slice(10);
        if (c.startsWith('sod_user=')) userStr = decodeURIComponent(c.slice(8));
      }
    } catch(e) {}
  }
  const user = JSON.parse(userStr || 'null');
  return { token, user };
}
function clearSession() {
  SafeStorage.remove('sod_token');
  SafeStorage.remove('sod_user');
  try {
    document.cookie = 'sod_token=; path=/; max-age=0';
    document.cookie = 'sod_user=; path=/; max-age=0';
  } catch(e) {}
}

let SHOP_CACHE = [];
let profileAvatarEngine = null;

async function refreshMe() {
  const { token } = getSession();
  if (!token) return null;
  const data = await API.get('/api/me', token);
  if (data.error) { clearSession(); return null; }
  saveSession(token, data.user);
  return data.user;
}

function showApp(user) {
  document.getElementById('view-auth').classList.add('hidden');
  document.getElementById('view-app').classList.remove('hidden');
  const badge = document.getElementById('userBadge');
  badge.classList.remove('hidden');
  badge.textContent = `${user.username} · Niv. ${user.level} · 💎 ${user.currency}`;
  document.getElementById('adminSoloBox').classList.toggle('hidden', !user.isAdmin);
  document.getElementById('adminLinkBox').classList.toggle('hidden', !user.isAdmin);
  loadShop().then(() => renderProfile(user)); // le profil a besoin du catalogue (aperçu du skin équipé)
  refreshDailyReward();
  refreshOnlineStats();
  if (!window._sodStatsPoll) window._sodStatsPoll = setInterval(refreshOnlineStats, 8000);
}

function showAuth() {
  document.getElementById('view-auth').classList.remove('hidden');
  document.getElementById('view-app').classList.add('hidden');
}

// ---- Auth handlers ----
document.getElementById('btnLogin').addEventListener('click', async () => {
  const username = document.getElementById('loginUser').value;
  const password = document.getElementById('loginPass').value;
  const data = await API.post('/api/login', { username, password });
  const err = document.getElementById('loginError');
  if (data.error) { err.textContent = data.error; return; }
  err.textContent = '';
  saveSession(data.token, data.user);
  showApp(data.user);
});

document.getElementById('btnRegister').addEventListener('click', async () => {
  const username = document.getElementById('regUser').value;
  const password = document.getElementById('regPass').value;
  const data = await API.post('/api/register', { username, password });
  const err = document.getElementById('regError');
  if (data.error) { err.textContent = data.error; return; }
  err.textContent = '';
  saveSession(data.token, data.user);
  showApp(data.user);
});

// ---- Tabs ----
document.querySelectorAll('nav.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    if (tab === 'logout') { clearSession(); location.reload(); return; }
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById('tab-' + tab).classList.remove('hidden');
    if (tab === 'shop') loadShop();
    if (tab === 'pass') loadBattlePass();
    if (tab === 'profile') refreshMe().then(u => u && renderProfile(u));
  });
});

// ---- Shop ----
const RARITY_ORDER = { commun: 0, rare: 1, 'légendaire': 2, exclusif: 3 };

async function loadShop() {
  const { token } = getSession();
  const data = await API.get('/api/shop', token);
  SHOP_CACHE = data.shop || [];
  renderShopGrid();
}

function renderShopGrid() {
  const user = getSession().user;
  const search = (document.getElementById('shopSearch').value || '').toLowerCase();
  const typeFilter = document.getElementById('shopTypeFilter').value;
  const sort = document.getElementById('shopSort').value;
  const ownedOnly = document.getElementById('shopOwnedOnly').checked;

  let items = SHOP_CACHE.filter(item => {
    if (item.passExclusive && !(user && (user.ownedCosmetics || []).includes(item.id))) return false;
    if (typeFilter && item.type !== typeFilter) return false;
    if (search && !item.name.toLowerCase().includes(search)) return false;
    const owned = user && (user.ownedCosmetics || []).includes(item.id);
    if (ownedOnly && !owned) return false;
    return true;
  });

  if (sort === 'price-asc') items.sort((a, b) => a.price - b.price);
  else if (sort === 'price-desc') items.sort((a, b) => b.price - a.price);
  else if (sort === 'rarity') items.sort((a, b) => (RARITY_ORDER[b.rarity] || 0) - (RARITY_ORDER[a.rarity] || 0));
  else if (sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name));

  // Split into featured (rare+) and daily items
  const featured = items.filter(i => (RARITY_ORDER[i.rarity] || 0) >= 2 && i.price > 0);
  const daily = items.filter(i => (RARITY_ORDER[i.rarity] || 0) < 2 || i.price === 0);

  const featuredEl = document.getElementById('shopFeatured');
  if (featured.length) {
    featuredEl.innerHTML = '<h4 class="shop-section-title">Articles en vedette <span class="line"></span></h4><div class="shop-featured"></div>';
    const featGrid = featuredEl.querySelector('.shop-featured');
    featured.forEach(item => featGrid.appendChild(makeShopCard(item, user)));
  } else {
    featuredEl.innerHTML = '';
  }

  const grid = document.getElementById('shopGrid');
  grid.innerHTML = '';
  if (!daily.length) {
    if (!featured.length) grid.innerHTML = '<p style="color:var(--muted); grid-column:1/-1;">Aucun article ne correspond à ces filtres.</p>';
    return;
  }

  daily.forEach(item => grid.appendChild(makeShopCard(item, user)));
  grid.querySelectorAll('[data-equip]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    equipItem(b.dataset.equip, b.dataset.slot);
  }));
}

function makeShopCard(item, user) {
  const owned = user && (user.ownedCosmetics || []).includes(item.id);
  const equipped = user && (item.type === 'skin' ? user.equippedSkin === item.id : item.type === 'trail' && user.equippedTrail === item.id);
  const el = document.createElement('div');
  el.className = 'item-card' + (owned ? ' owned-item' : '');
  el.setAttribute('data-rarity', item.rarity || 'commun');
  el.style.cursor = 'pointer';

  let typeIcon = item.type === 'skin' ? '👕' : item.type === 'trail' ? '✨' : item.type === 'emote' ? '🎭' : '📦';
  let footActions = `<span class="pill currency">💎 ${item.price}</span><button class="btn small primary" data-preview="${item.id}">Voir en 3D</button>`;
  if (owned && equipped) footActions = '<span class="pill">✓ Équipé</span>';
  else if (owned && (item.type === 'skin' || item.type === 'trail')) footActions = `<span class="pill">Possédé</span><button class="btn small" data-equip="${item.id}" data-slot="${item.type}">Équiper</button>`;
  else if (owned) footActions = '<span class="pill">Possédé</span>';

  el.innerHTML = `
    <div class="swatch" style="background:${item.color}">${typeIcon}</div>
    <div class="item-body">
      <div class="item-name">${item.name} <span class="tag ${item.rarity}">${item.rarity}</span></div>
      <div class="item-foot">${footActions}</div>
    </div>`;
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-equip]')) return;
    openItemPreview(item.id);
  });
  return el;
}

['shopSearch', 'shopTypeFilter', 'shopSort', 'shopOwnedOnly'].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener(id === 'shopSearch' ? 'input' : 'change', renderShopGrid);
});

const BIG_PURCHASE_THRESHOLD = 800;
function isBigPurchase(item, user) {
  if (!item.price) return false;
  return item.price >= BIG_PURCHASE_THRESHOLD || item.price > (user.currency || 0) * 0.5;
}

let itemPreviewEngine = null;
function getItemPreviewEngine() {
  if (!itemPreviewEngine) itemPreviewEngine = createCharacterPreview(document.getElementById('itemPreviewCanvas'));
  return itemPreviewEngine;
}

function applyItemToPreview(engine, item, user) {
  // Toujours partir de l'équipement actuel du joueur, puis superposer l'objet
  // regardé pour qu'on voie bien "comment ça rendrait sur moi".
  const equippedSkin = SHOP_CACHE.find(i => i.id === (user && user.equippedSkin)) || { color: '#4da3ff', pattern: 'plain' };
  const equippedTrail = SHOP_CACHE.find(i => i.id === (user && user.equippedTrail));
  if (item.type === 'skin') engine.setSkin(item.color, item.pattern);
  else engine.setSkin(equippedSkin.color, equippedSkin.pattern);
  if (item.type === 'trail') engine.setTrail(item.color);
  else engine.setTrail(equippedTrail ? equippedTrail.color : null);
  engine.setCustomHead(item.type === 'skin' ? null : (user && user.customSkinData));
}

function openItemPreview(itemId) {
  const item = SHOP_CACHE.find(i => i.id === itemId);
  if (!item) return;
  const { user } = getSession();
  const owned = user && (user.ownedCosmetics || []).includes(item.id);

  document.getElementById('previewItemName').textContent = item.name;
  document.getElementById('previewItemRarity').textContent = item.rarity;
  document.getElementById('previewItemRarity').className = 'tag ' + item.rarity;
  document.getElementById('previewItemDesc').textContent = item.passExclusive
    ? 'Récompense exclusive du Pass de combat — non disponible à l\'achat.'
    : `Type : ${{ skin: 'Skin', trail: 'Traînée', emote: 'Emote', bundle: 'Pack' }[item.type] || item.type}.`;
  document.getElementById('previewItemPrice').innerHTML = item.price ? `💎 ${item.price}` : (owned ? '' : 'Récompense du Pass');

  const actions = document.getElementById('previewItemActions');
  actions.innerHTML = '';
  document.getElementById('previewConfirmBox').classList.add('hidden');

  if (owned) {
    const equipped = item.type === 'skin' ? user.equippedSkin === item.id : user.equippedTrail === item.id;
    if (equipped) {
      actions.innerHTML = '<span class="pill">Équipé</span>';
    } else if (item.type === 'skin' || item.type === 'trail') {
      const btn = document.createElement('button');
      btn.className = 'btn primary'; btn.textContent = 'Équiper';
      btn.onclick = () => equipItem(item.id, item.type).then(() => openItemPreview(item.id));
      actions.appendChild(btn);
    } else {
      actions.innerHTML = '<span class="pill">Possédé</span>';
    }
  } else if (item.passExclusive) {
    actions.innerHTML = '<span class="pill">🎫 Débloque via le Pass de combat</span>';
  } else {
    const btn = document.createElement('button');
    btn.className = 'btn primary'; btn.textContent = 'Acheter';
    btn.onclick = () => requestPurchase(item);
    actions.appendChild(btn);
  }

  document.getElementById('itemPreviewModal').classList.remove('hidden');
  const engine = getItemPreviewEngine();
  applyItemToPreview(engine, item, user);
}

function requestPurchase(item) {
  const { user } = getSession();
  if (!isBigPurchase(item, user)) { buyItem(item.id); return; }
  const box = document.getElementById('previewConfirmBox');
  document.getElementById('previewConfirmText').textContent =
    `Es-tu sûr(e) de vouloir dépenser ${item.price} 💎 pour "${item.name}" ? ` +
    `Il te restera ${Math.max(0, (user.currency || 0) - item.price)} 💎.`;
  box.classList.remove('hidden');
  document.getElementById('btnConfirmPurchase').onclick = () => { box.classList.add('hidden'); buyItem(item.id); };
  document.getElementById('btnCancelPurchase').onclick = () => box.classList.add('hidden');
}

document.getElementById('btnCloseItemPreview').addEventListener('click', () => {
  document.getElementById('itemPreviewModal').classList.add('hidden');
});
document.getElementById('itemPreviewModal').addEventListener('click', (e) => {
  if (e.target.id === 'itemPreviewModal') e.currentTarget.classList.add('hidden');
});

async function buyItem(itemId) {
  const { token } = getSession();
  const item = SHOP_CACHE.find(i => i.id === itemId);
  const data = await API.post('/api/shop/buy', { itemId }, token);
  if (data.error) { showToast(data.error, 'error'); return; }
  saveSession(token, data.user);
  document.getElementById('userBadge').textContent = `${data.user.username} · Niv. ${data.user.level} · 💎 ${data.user.currency}`;
  showToast(`Acheté : ${item ? item.name : 'Article'} 🎉`, 'success');
  renderShopGrid();
  openItemPreview(itemId); // met à jour la modale (bouton "Équiper" à la place d'"Acheter")
}

// ---- Profile ----
// ---- Hauts faits (calculés côté client à partir des stats, aucune donnée serveur dédiée) ----
const ACHIEVEMENTS = [
  { id: 'first_blood', icon: '🩸', name: 'Premier sang', desc: '1 élimination', check: s => (s.kills || 0) >= 1 },
  { id: 'killer_10', icon: '⚔️', name: 'Chasseur', desc: '10 éliminations', check: s => (s.kills || 0) >= 10 },
  { id: 'killer_50', icon: '💀', name: 'Faucheur', desc: '50 éliminations', check: s => (s.kills || 0) >= 50 },
  { id: 'first_win', icon: '🏆', name: 'Premier sacre', desc: '1 victoire', check: s => (s.wins || 0) >= 1 },
  { id: 'win_10', icon: '👑', name: 'Habitué du trône', desc: '10 victoires', check: s => (s.wins || 0) >= 10 },
  { id: 'veteran', icon: '🎖️', name: 'Vétéran', desc: '25 parties jouées', check: s => (s.matchesPlayed || 0) >= 25 },
  { id: 'looter', icon: '🎁', name: 'Pilleur', desc: '20 coffres ouverts', check: s => (s.chestsOpened || 0) >= 20 },
  { id: 'looter_100', icon: '💰', name: 'Trésorier', desc: '100 coffres ouverts', check: s => (s.chestsOpened || 0) >= 100 },
];

function renderAchievements(stats) {
  const grid = document.getElementById('achievementsGrid');
  grid.innerHTML = ACHIEVEMENTS.map(a => {
    const unlocked = a.check(stats || {});
    return `<div class="achv-card${unlocked ? '' : ' locked'}">
      <div class="icon">${a.icon}</div>
      <div class="name">${a.name}</div>
      <div class="desc">${a.desc}</div>
    </div>`;
  }).join('');
}

function renderMatchHistory(history) {
  const body = document.getElementById('matchHistoryBody');
  const mapLabels = { jungle: '🌴 Jungle', arctic: '❄️ Arctique', desert: '🏜️ Désert' };
  body.innerHTML = (history || []).map(m => `
    <tr${m.result === 'victoire' ? ' style="color:var(--gold);font-weight:600;"' : ''}>
      <td>${mapLabels[m.map] || m.map}</td>
      <td>${m.result === 'victoire' ? '🏆 Victoire' : 'Défaite'}</td>
      <td>${m.kills}</td><td>${m.deaths}</td>
    </tr>`).join('') || '<tr><td colspan="4" style="color:var(--muted);">Aucune partie jouée pour le moment.</td></tr>';
}

function renderProfile(user) {
  document.getElementById('profileName').textContent = user.username;
  document.getElementById('profileLevel').textContent = 'Niveau ' + user.level;
  document.getElementById('profileCurrency').textContent = '💎 ' + user.currency;
  const stats = user.stats || {};
  document.getElementById('statMatches').textContent = stats.matchesPlayed || 0;
  document.getElementById('statWins').textContent = stats.wins || 0;
  document.getElementById('statKills').textContent = stats.kills || 0;
  document.getElementById('statChests').textContent = stats.chestsOpened || 0;
  renderAchievements(stats);
  renderMatchHistory(user.matchHistory || []);
  const needed = Math.round(100 * Math.pow(user.level, 1.5));
  const pct = Math.min(100, Math.round((user.xp / needed) * 100));
  document.getElementById('xpFill').style.width = pct + '%';
  document.getElementById('xpLabel').textContent = `${user.xp} / ${needed} XP`;

  const equippedSkin = SHOP_CACHE.find(i => i.id === user.equippedSkin) || { color: '#4da3ff', pattern: 'plain' };
  const equippedTrail = SHOP_CACHE.find(i => i.id === user.equippedTrail);
  try {
    if (!profileAvatarEngine) profileAvatarEngine = createCharacterPreview(document.getElementById('profileAvatarCanvas'));
    if (profileAvatarEngine) {
      profileAvatarEngine.setSkin(equippedSkin.color, equippedSkin.pattern);
      profileAvatarEngine.setTrail(equippedTrail ? equippedTrail.color : null);
      profileAvatarEngine.setCustomHead(user.customSkinData || null);
    }
  } catch(e) { console.warn('Avatar preview error:', e.message); }

  const ownedGrid = document.getElementById('ownedGrid');
  ownedGrid.innerHTML = '';
  const owned = (user.ownedCosmetics || []).map(id => SHOP_CACHE.find(i => i.id === id)).filter(Boolean);
  const skins = owned.filter(i => i.type === 'skin');
  const trails = owned.filter(i => i.type === 'trail');
  const emotes = owned.filter(i => i.type === 'emote');
  const bundles = owned.filter(i => i.type === 'bundle');
  
  if (!owned.length) {
    ownedGrid.innerHTML = '<p style="color:var(--muted);grid-column:1/-1;">Aucun cosmétique possédé pour le moment.</p>';
  } else {
    const makeCard = (item) => {
      const el = document.createElement('div');
      el.className = 'item-card';
      el.setAttribute('data-rarity', item.rarity || 'commun');
      const equipped = (item.type === 'skin' && user.equippedSkin === item.id) || (item.type === 'trail' && user.equippedTrail === item.id);
      const typeIcon = item.type === 'skin' ? '👕' : item.type === 'trail' ? '✨' : item.type === 'emote' ? '🎭' : '📦';
      let footHtml;
      if (equipped) footHtml = '<span class="pill">✓ Équipé</span>';
      else if (item.type === 'skin' || item.type === 'trail') footHtml = `<button class="btn small primary" data-equip="${item.id}" data-slot="${item.type}">Équiper</button>`;
      else footHtml = '<span class="pill">Possédé</span>';
      el.innerHTML = `
        <div class="swatch" style="background:${item.color}">${typeIcon}</div>
        <div class="item-body">
          <div class="item-name">${item.name} <span class="tag ${item.rarity}">${item.rarity}</span></div>
          <div class="item-foot">${footHtml}</div>
        </div>`;
      return el;
    };
    
    if (skins.length) {
      const title = document.createElement('h4');
      title.style.cssText = 'grid-column:1/-1;margin:0 0 -4px;';
      title.textContent = `Skins (${skins.length})`;
      ownedGrid.appendChild(title);
      skins.forEach(s => ownedGrid.appendChild(makeCard(s)));
    }
    if (trails.length) {
      const title = document.createElement('h4');
      title.style.cssText = 'grid-column:1/-1;margin:16px 0 -4px;';
      title.textContent = `Traînées (${trails.length})`;
      ownedGrid.appendChild(title);
      trails.forEach(t => ownedGrid.appendChild(makeCard(t)));
    }
    if (emotes.length) {
      const title = document.createElement('h4');
      title.style.cssText = 'grid-column:1/-1;margin:16px 0 -4px;';
      title.textContent = `Emotes (${emotes.length})`;
      ownedGrid.appendChild(title);
      emotes.forEach(e => ownedGrid.appendChild(makeCard(e)));
    }
    if (bundles.length) {
      const title = document.createElement('h4');
      title.style.cssText = 'grid-column:1/-1;margin:16px 0 -4px;';
      title.textContent = `Packs (${bundles.length})`;
      ownedGrid.appendChild(title);
      bundles.forEach(b => ownedGrid.appendChild(makeCard(b)));
    }
  }
  ownedGrid.querySelectorAll('[data-equip]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    equipItem(b.dataset.equip, b.dataset.slot);
  }));
}

async function equipItem(itemId, slot) {
  const { token } = getSession();
  const item = SHOP_CACHE.find(i => i.id === itemId);
  const data = await API.post('/api/shop/equip', { itemId, slot: slot || 'skin' }, token);
  if (data.error) { showToast(data.error, 'error'); return; }
  saveSession(token, data.user);
  showToast(`${item ? item.name : 'Objet'} équipé`, 'success', 2600);
  renderProfile(data.user);
  renderShopGrid();
}

// ---- Play ----
// Pass join intent via URL hash so it survives page navigation in sandboxed iframes
function goToGame(joinData) {
  const { token, user } = getSession();
  const hash = encodeURIComponent(JSON.stringify({ join: joinData, token, user }));
  location.href = 'game.html#' + hash;
}

function goToAdmin() {
  const { token, user } = getSession();
  const hash = encodeURIComponent(JSON.stringify({ token, user }));
  location.href = 'admin.html#' + hash;
}
document.getElementById('btnJoinPublic').addEventListener('click', () => {
  goToGame({ mode: 'public' });
});
document.getElementById('btnCreatePrivate').addEventListener('click', () => {
  const map = document.querySelector('input[name="mapPick"]:checked').value;
  const bots = parseInt(document.getElementById('privateBotsCount')?.value || '0');
  goToGame({ mode: 'create-private', map, bots });
});
document.getElementById('btnJoinPrivate').addEventListener('click', () => {
  const code = document.getElementById('joinCode').value.trim().toUpperCase();
  const err = document.getElementById('playError');
  if (!code) { err.textContent = 'Entre un code de salon.'; return; }
  goToGame({ mode: 'private', code });
});

// ---- Test solo (admin) ----
document.getElementById('btnSoloTest').addEventListener('click', () => {
  const map = document.querySelector('input[name="mapPick"]:checked')?.value || 'jungle';
  const bots = parseInt(document.getElementById('soloBotsCount')?.value || '0');
  goToGame({ mode: 'solo-admin', map, bots });
});

// ---- Amis ----
async function loadFriends() {
  const { token } = getSession();
  const data = await API.get('/api/friends', token);
  const list = document.getElementById('friendsList');
  list.innerHTML = (data.friends || []).map(f => `
    <div class="friend-row">
      <span><span class="dot ${f.online ? 'online' : ''}"></span>${f.username} <span class="pill level" style="margin-left:6px;">Niv. ${f.level}</span></span>
      <button class="btn small danger" data-remove-friend="${f.username}">Retirer</button>
    </div>`).join('') || '<p style="color:var(--muted)">Aucun ami pour le moment.</p>';
  list.querySelectorAll('[data-remove-friend]').forEach(b => b.addEventListener('click', async () => {
    const name = b.dataset.removeFriend;
    const res = await API.post('/api/friends/remove', { username: name }, token);
    if (res.error) showToast(res.error, 'error');
    else showToast(`${name} retiré de tes amis`, 'info', 2600);
    loadFriends();
  }));

  const reqList = document.getElementById('friendRequestsList');
  reqList.innerHTML = (data.requests || []).map(name => `
    <div class="friend-row">
      <span>${name}</span>
      <span style="display:flex; gap:6px;">
        <button class="btn small primary" data-accept="${name}">Accepter</button>
        <button class="btn small ghost" data-decline="${name}">Refuser</button>
      </span>
    </div>`).join('') || '<p style="color:var(--muted)">Aucune demande en attente.</p>';
  reqList.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', async () => {
    const name = b.dataset.accept;
    const res = await API.post('/api/friends/accept', { username: name }, token);
    if (res.error) showToast(res.error, 'error');
    else showToast(`Vous êtes maintenant amis avec ${name}`, 'success', 2600);
    loadFriends();
  }));
  reqList.querySelectorAll('[data-decline]').forEach(b => b.addEventListener('click', async () => {
    await API.post('/api/friends/decline', { username: b.dataset.decline }, token);
    loadFriends();
  }));
}

document.getElementById('btnAddFriend').addEventListener('click', async () => {
  const { token } = getSession();
  const username = document.getElementById('addFriendInput').value.trim();
  const err = document.getElementById('friendError');
  if (!username) return;
  const data = await API.post('/api/friends/request', { username }, token);
  err.textContent = data.error || '';
  if (!data.error) {
    document.getElementById('addFriendInput').value = '';
    showToast('Demande envoyée à ' + username, 'success', 2600);
  }
});

// Ajout du chargement des amis quand on ouvre l'onglet
const originalTabHandler = document.querySelectorAll('nav.tabs button');
originalTabHandler.forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'friends') loadFriends();
    if (btn.dataset.tab === 'leaderboard') loadLeaderboard();
  });
});

// ---- Pass de combat ----
async function loadBattlePass() {
  const { token } = getSession();
  const data = await API.get('/api/battlepass', token);
  document.getElementById('passLevel').textContent = data.level;
  const progressFill = document.getElementById('passProgressFill');
  if (progressFill) {
    const pct = Math.min(100, (data.level / 50) * 100);
    progressFill.style.width = pct + '%';
  }
  const track = document.getElementById('passTrack');
  track.innerHTML = data.tiers.map(t => {
    const claimed = data.claimed.includes(t.tier);
    const unlocked = data.level >= t.tier;
    const milestone = t.tier % 10 === 0;
    let rewardIcon = '💎';
    let label = `${t.reward.amount || ''} 💎`;
    if (t.reward.type === 'item') {
      rewardIcon = t.reward.itemType === 'trail' ? '✨' : t.reward.itemType === 'emote' ? '🎭' : '👕';
      label = t.reward.name;
    }
    let stateHtml;
    if (claimed) stateHtml = '<span class="pill">✅ Récupéré</span>';
    else if (unlocked) stateHtml = `<button class="btn small ${milestone ? 'gold' : 'primary'}" data-claim-tier="${t.tier}">Récupérer</button>`;
    else stateHtml = `<span class="pill">🔒 Niv. ${t.tier}</span>`;
    
    // Premium track
    let premiumHtml = '';
    if (t.premiumReward) {
      let pIcon = '💎';
      let pLabel = `${t.premiumReward.amount || ''} 💎`;
      if (t.premiumReward.type === 'item') {
        pIcon = t.premiumReward.itemType === 'trail' ? '✨' : t.premiumReward.itemType === 'emote' ? '🎭' : '👕';
        pLabel = t.premiumReward.name || 'Objet exclusif';
      }
      premiumHtml = `<div class="tier-premium"><div class="premium-icon">${pIcon}</div><div class="premium-label">${pLabel}</div></div>`;
    } else {
      premiumHtml = `<div class="tier-premium empty"><div class="premium-icon">—</div></div>`;
    }
    
    return `<div class="pass-tier${milestone ? ' milestone' : ''}${claimed ? ' claimed' : ''}${!unlocked ? ' locked' : ''}">
      <div class="tier-header">Palier ${t.tier}</div>
      <div class="tier-reward-area">
        <div class="tier-reward">${rewardIcon}</div>
        <div class="tier-label">${label}</div>
        ${stateHtml}
      </div>
      ${premiumHtml}
    </div>`;
  }).join('');
  track.querySelectorAll('[data-claim-tier]').forEach(b => {
    b.addEventListener('click', () => claimPassTier(Number(b.dataset.claimTier)));
  });
}

async function claimPassTier(tier) {
  const { token } = getSession();
  const data = await API.post('/api/battlepass/claim', { tier }, token);
  if (data.error) { showToast(data.error, 'error'); return; }
  saveSession(token, data.user);
  document.getElementById('userBadge').textContent = `${data.user.username} · Niv. ${data.user.level} · 💎 ${data.user.currency}`;
  showToast(`Palier ${tier} récupéré 🎁`, 'success', 2600);
  loadBattlePass();
}

document.getElementById('btnClaimAllPass').addEventListener('click', async () => {
  const { token } = getSession();
  const data = await API.post('/api/battlepass/claim-all', {}, token);
  if (data.error) { showToast(data.error, 'error'); return; }
  saveSession(token, data.user);
  document.getElementById('userBadge').textContent = `${data.user.username} · Niv. ${data.user.level} · 💎 ${data.user.currency}`;
  if (data.currencyGain || data.itemsGained.length) {
    showToast(`Récupéré : +${data.currencyGain} 💎${data.itemsGained.length ? ' + ' + data.itemsGained.length + ' objet(s)' : ''}`, 'success');
  } else {
    showToast('Aucun palier disponible à récupérer.', 'info');
  }
  loadBattlePass();
});

// Bandeau "Se termine dans XjXXh" façon saison de battle pass : la saison
// tourne simplement avec le mois calendaire (fin de mois = fin de saison),
// aucune donnée serveur nécessaire pour cet habillage.
function updatePassCountdown() {
  const el = document.getElementById('passCountdown');
  if (!el) return;
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1); // 1er du mois prochain
  const ms = end - now;
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  el.textContent = `Se termine dans ${days}j ${hours}h`;
}
updatePassCountdown();
setInterval(updatePassCountdown, 60000);

// ---- Classement ----
async function loadLeaderboard() {
  const data = await API.get('/api/leaderboard');
  const body = document.getElementById('leaderboardBody');
  body.innerHTML = (data.leaderboard || []).map((p, i) => `
    <tr>
      <td>${i + 1}</td><td>${p.username}</td><td>${p.level}</td>
      <td>${p.wins}</td><td>${p.kills}</td><td>${p.matchesPlayed}</td>
    </tr>`).join('') || '<tr><td colspan="6" style="color:var(--muted);">Aucune donnée pour le moment.</td></tr>';
}

// ---- Récompense quotidienne ----
async function refreshDailyReward() {
  const { token } = getSession();
  if (!token) return;
  const data = await API.get('/api/daily-status', token);
  const text = document.getElementById('dailyRewardText');
  const btn = document.getElementById('btnClaimDaily');
  if (data.canClaim) {
    text.textContent = data.streak > 0
      ? `Série de ${data.streak} jour(s) — récupère ta récompense pour la continuer !`
      : 'Disponible maintenant !';
    btn.disabled = false;
  } else {
    const h = Math.floor(data.nextInMs / 3600000);
    const m = Math.floor((data.nextInMs % 3600000) / 60000);
    text.textContent = `Déjà récupérée. Prochaine dans ${h}h${String(m).padStart(2, '0')} (série : ${data.streak} jour(s)).`;
    btn.disabled = true;
  }
}
document.getElementById('btnClaimDaily').addEventListener('click', async () => {
  const { token } = getSession();
  const data = await API.post('/api/daily-claim', {}, token);
  if (data.error) { showToast(data.error, 'error'); return; }
  saveSession(token, data.user);
  document.getElementById('userBadge').textContent = `${data.user.username} · Niv. ${data.user.level} · 💎 ${data.user.currency}`;
  showToast(`+${data.reward} 💎 (série : ${data.streak} jour${data.streak > 1 ? 's' : ''})`, 'success');
  refreshDailyReward();
});

// ---- Stats en ligne (onglet Jouer) ----
async function refreshOnlineStats() {
  try {
    const data = await API.get('/api/stats/online');
    document.getElementById('statOnlinePlayers').textContent = data.playersOnline;
    document.getElementById('statActiveRooms').textContent = data.activeRooms;
  } catch { /* le serveur redémarre peut-être */ }
}

// ---- Réglages (sensibilité souris, volume vocal, effets) ----
window.SOD_SETTINGS = (function () {
  const KEY = 'sod_settings';
  const DEFAULTS = { sensitivity: 1, voiceVolume: 1, reducedFx: false };
  function get() {
    try { return { ...DEFAULTS, ...JSON.parse(SafeStorage.get(KEY) || '{}') }; }
    catch { return { ...DEFAULTS }; }
  }
  function set(patch) {
    const next = { ...get(), ...patch };
    SafeStorage.set(KEY, JSON.stringify(next));
    return next;
  }
  return { get, set };
})();

function initSettingsUI() {
  const s = SOD_SETTINGS.get();
  const sensInput = document.getElementById('settingSensitivity');
  const volInput = document.getElementById('settingVoiceVolume');
  const fxInput = document.getElementById('settingReducedFx');
  sensInput.value = s.sensitivity;
  volInput.value = Math.round(s.voiceVolume * 100);
  fxInput.checked = !!s.reducedFx;
  document.getElementById('sensitivityVal').textContent = Number(s.sensitivity).toFixed(1);
  document.getElementById('voiceVolVal').textContent = Math.round(s.voiceVolume * 100);

  sensInput.addEventListener('input', () => {
    SOD_SETTINGS.set({ sensitivity: Number(sensInput.value) });
    document.getElementById('sensitivityVal').textContent = Number(sensInput.value).toFixed(1);
  });
  volInput.addEventListener('input', () => {
    const vol = Number(volInput.value) / 100;
    SOD_SETTINGS.set({ voiceVolume: vol });
    document.getElementById('voiceVolVal').textContent = Number(volInput.value).toFixed(0);
    document.querySelectorAll('audio[id^="voice_"]').forEach(a => { a.volume = vol; });
  });
  fxInput.addEventListener('change', () => SOD_SETTINGS.set({ reducedFx: fxInput.checked }));
}
initSettingsUI();

// ---- Personnalisation du skin (peinture) ----
const paintCanvas = document.getElementById('paintCanvas');
const paintCtx = paintCanvas.getContext('2d');
let painting = false, brushColor = '#3a2a1a';
const PALETTE = ['#3a2a1a', '#000000', '#ffffff', '#ff5b6a', '#4da3ff', '#7be0c0', '#ffd24d', '#c62828', '#5b2e8f', '#e9d3b0'];

// Aperçu 3D en direct dans la modale de peinture : montre la tête peinte
// posée sur le corps + traînée réellement équipés, pour styliser en connaissance de cause.
let paintPreviewEngine = null;
function getPaintPreviewEngine() {
  if (!paintPreviewEngine) paintPreviewEngine = createCharacterPreview(document.getElementById('paintPreviewCanvas'));
  return paintPreviewEngine;
}
let paintPreviewDirty = false;
function schedulePaintPreviewUpdate() {
  if (paintPreviewDirty) return;
  paintPreviewDirty = true;
  requestAnimationFrame(() => {
    paintPreviewDirty = false;
    if (!document.getElementById('painterModal').classList.contains('hidden')) {
      getPaintPreviewEngine().setCustomHead(paintCanvas.toDataURL('image/png'));
    }
  });
}

function initPalette() {
  const pal = document.getElementById('palette');
  pal.innerHTML = '';
  PALETTE.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'swatch-btn' + (i === 0 ? ' active' : '');
    b.style.background = c;
    b.addEventListener('click', () => {
      brushColor = c;
      pal.querySelectorAll('.swatch-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
    pal.appendChild(b);
  });
}
initPalette();

function clearPaintCanvas() {
  paintCtx.fillStyle = '#e9d3b0';
  paintCtx.fillRect(0, 0, paintCanvas.width, paintCanvas.height);
  schedulePaintPreviewUpdate();
}
clearPaintCanvas();

// Recharge le skin peint déjà enregistré (s'il y en a un) dans le canevas de dessin,
// pour pouvoir le retoucher au lieu de repartir d'une tête vierge à chaque ouverture.
function loadExistingPaintIntoCanvas(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) { clearPaintCanvas(); resolve(); return; }
    const img = new Image();
    img.onload = () => {
      paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
      paintCtx.drawImage(img, 0, 0, paintCanvas.width, paintCanvas.height);
      schedulePaintPreviewUpdate();
      resolve();
    };
    img.onerror = () => { clearPaintCanvas(); resolve(); };
    img.src = dataUrl;
  });
}

function canvasPos(e) {
  const rect = paintCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (clientX - rect.left) * (paintCanvas.width / rect.width), y: (clientY - rect.top) * (paintCanvas.height / rect.height) };
}
function paintAt(e) {
  const { x, y } = canvasPos(e);
  const size = Number(document.getElementById('brushSize').value);
  paintCtx.fillStyle = brushColor;
  paintCtx.beginPath();
  paintCtx.arc(x, y, size / 2, 0, Math.PI * 2);
  paintCtx.fill();
  schedulePaintPreviewUpdate();
}
paintCanvas.addEventListener('mousedown', (e) => { painting = true; paintAt(e); });
paintCanvas.addEventListener('mousemove', (e) => { if (painting) paintAt(e); });
window.addEventListener('mouseup', () => { painting = false; });
paintCanvas.addEventListener('touchstart', (e) => { painting = true; paintAt(e); e.preventDefault(); });
paintCanvas.addEventListener('touchmove', (e) => { if (painting) paintAt(e); e.preventDefault(); });
paintCanvas.addEventListener('touchend', () => { painting = false; });

document.getElementById('btnClearPaint').addEventListener('click', clearPaintCanvas);
document.getElementById('btnOpenPainter').addEventListener('click', async () => {
  const { user } = getSession();
  await loadExistingPaintIntoCanvas(user && user.customSkinData);
  const equippedSkin = SHOP_CACHE.find(i => i.id === (user && user.equippedSkin)) || { color: '#4da3ff', pattern: 'plain' };
  const equippedTrail = SHOP_CACHE.find(i => i.id === (user && user.equippedTrail));
  const engine = getPaintPreviewEngine();
  engine.setSkin(equippedSkin.color, equippedSkin.pattern);
  engine.setTrail(equippedTrail ? equippedTrail.color : null);
  engine.setCustomHead(paintCanvas.toDataURL('image/png'));
  document.getElementById('painterModal').classList.remove('hidden');
});
document.getElementById('btnClosePainter').addEventListener('click', () => {
  document.getElementById('painterModal').classList.add('hidden');
});
document.getElementById('painterModal').addEventListener('click', (e) => {
  if (e.target.id === 'painterModal') e.currentTarget.classList.add('hidden');
});
document.getElementById('btnSavePaint').addEventListener('click', async () => {
  const { token } = getSession();
  const dataUrl = paintCanvas.toDataURL('image/png');
  const data = await API.post('/api/profile/skin', { dataUrl }, token);
  if (data.error) { showToast(data.error, 'error'); return; }
  document.getElementById('painterModal').classList.add('hidden');
  const fresh = await refreshMe();
  if (fresh) renderProfile(fresh);
  showToast('Skin peint enregistré ! Il apparaîtra sur ta tête en jeu.', 'success');
});
document.getElementById('btnResetPaint').addEventListener('click', async () => {
  const { token } = getSession();
  const data = await API.post('/api/profile/skin/reset', {}, token);
  if (data && data.error) { showToast(data.error, 'error'); return; }
  const fresh = await refreshMe();
  if (fresh) renderProfile(fresh);
  showToast('Skin peint retiré.', 'info', 2600);
});

// ---- Fond animé du menu (particules discrètes) ----
(function initBackground() {
  const canvas = document.getElementById('bgCanvas');
  const ctx = canvas.getContext('2d');
  let particles = [];
  function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
  resize();
  window.addEventListener('resize', resize);
  if (window.SOD_SETTINGS && window.SOD_SETTINGS.get().reducedFx) {
    ctx.fillStyle = '#0b0f16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return; // effets visuels réduits : pas de particules animées
  }
  for (let i = 0; i < 60; i++) {
    particles.push({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, r: 1 + Math.random() * 2, vy: 0.15 + Math.random() * 0.3, a: 0.1 + Math.random() * 0.3 });
  }
  function frame() {
    ctx.fillStyle = '#0b0f16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const grad = ctx.createRadialGradient(canvas.width * 0.2, -canvas.height * 0.1, 0, canvas.width * 0.2, -canvas.height * 0.1, canvas.width);
    grad.addColorStop(0, 'rgba(22,35,61,0.9)');
    grad.addColorStop(1, 'rgba(11,15,22,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      p.y -= p.vy;
      if (p.y < -10) { p.y = canvas.height + 10; p.x = Math.random() * canvas.width; }
      ctx.beginPath();
      ctx.fillStyle = `rgba(125,180,255,${p.a})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(frame);
  }
  frame();
})();

// ---- Accès caché au panneau admin (Konami Code) ----
(function initHiddenAdminAccess() {
  const sequence = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','KeyB','KeyA'];
  let progress = 0;
  document.addEventListener('keydown', (e) => {
    if (e.code === sequence[progress]) {
      progress++;
      if (progress === sequence.length) {
        progress = 0;
        const { user } = getSession();
        if (user && user.isAdmin) { location.href = 'admin.html'; }
        // Si ce n'est pas un admin, on ne révèle rien (aucun message, aucun indice).
      }
    } else {
      progress = (e.code === sequence[0]) ? 1 : 0;
    }
  });
})();

// ---- Boot ----
(async () => {
  const { token, user } = getSession();
  if (token && user) {
    showApp(user);
    const fresh = await refreshMe();
    if (fresh) showApp(fresh);
  } else {
    showAuth();
  }
})();
