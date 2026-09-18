// server.js — Swap or Die : serveur de jeu complet (API REST + temps réel Socket.io)
// ----------------------------------------------------------------------------
// Le concept : chaque joueur contrôle un "corps". Périodiquement, un SWAP
// GLOBAL réassigne aléatoirement les corps entre les joueurs. Tu gardes tes
// vies, ton scoreboard... mais un autre corps. Dernier survivant = victoire.
// ----------------------------------------------------------------------------

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// ============================== PERSISTANCE =================================

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

let db = loadJSON(DB_FILE, null) || { users: {}, shop: null, battlepass: null, config: null, secret: null };
let saveTimer = null;
function saveDB() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) { console.error('saveDB', e.message); }
  }, 500);
}
if (!db.secret) { db.secret = crypto.randomBytes(32).toString('hex'); saveDB(); }
if (!db.users) db.users = {};

// ============================== CONTENU DU JEU ==============================

const DEFAULT_CONFIG = {
  baseSwapMinSeconds: 25,
  baseSwapMaxSeconds: 45,
  swapImmunityBase: 1500,
  swapImmunityHighPing: 2500,
  highPingThresholdMs: 180,
  dailyRewardBase: 50,
  dailyRewardStep: 25,
  dailyRewardMaxStreak: 7,
  monetizationEnabled: false
};
if (!db.config) db.config = { ...DEFAULT_CONFIG };

const DEFAULT_SHOP = [
  // --- Skins ---
  { id: 'skin_default', name: 'Combinaison classique', type: 'skin', color: '#4da3ff', pattern: 'plain', price: 0, rarity: 'commun', available: true, passExclusive: false },
  { id: 'skin_rouge', name: 'Rouge danger', type: 'skin', color: '#c62828', pattern: 'plain', price: 150, rarity: 'commun', available: true, passExclusive: false },
  { id: 'skin_menthe', name: 'Menthe givrée', type: 'skin', color: '#7be0c0', pattern: 'plain', price: 200, rarity: 'commun', available: true, passExclusive: false },
  { id: 'skin_zebre', name: 'Zèbre urbain', type: 'skin', color: '#e9d3b0', pattern: 'stripes', price: 350, rarity: 'rare', available: true, passExclusive: false },
  { id: 'skin_camouflage', name: 'Camouflage jungle', type: 'skin', color: '#3f7a3f', pattern: 'camo', price: 450, rarity: 'rare', available: true, passExclusive: false },
  { id: 'skin_ecailles', name: 'Écailles de dragon', type: 'skin', color: '#5b2e8f', pattern: 'scales', price: 600, rarity: 'rare', available: true, passExclusive: false },
  { id: 'skin_or', name: 'Doré éternel', type: 'skin', color: '#ffd24d', pattern: 'plain', price: 900, rarity: 'légendaire', available: true, passExclusive: false },
  { id: 'skin_onyx', name: 'Onyx Brutal', type: 'skin', color: '#1a1a1a', pattern: 'stripes', price: 1200, rarity: 'légendaire', available: true, passExclusive: false },
  // --- Traînées ---
  { id: 'trail_bleu', name: 'Traînée azur', type: 'trail', color: '#4da3ff', pattern: 'plain', price: 250, rarity: 'commun', available: true, passExclusive: false },
  { id: 'trail_rose', name: 'Traînée bonbon', type: 'trail', color: '#ff5b6a', pattern: 'plain', price: 300, rarity: 'commun', available: true, passExclusive: false },
  { id: 'trail_vert', name: 'Traînée toxique', type: 'trail', color: '#4dff5b', pattern: 'plain', price: 400, rarity: 'rare', available: true, passExclusive: false },
  { id: 'trail_or', name: 'Traînée royale', type: 'trail', color: '#ffd24d', pattern: 'plain', price: 800, rarity: 'légendaire', available: true, passExclusive: false },
  { id: 'trail_arcenciel', name: 'Arc-en-ciel', type: 'trail', color: '#ff7be0', pattern: 'plain', price: 1000, rarity: 'légendaire', available: true, passExclusive: false },
  // --- Emotes ---
  { id: 'emote_wave', name: 'Salut militaire', type: 'emote', color: '#4da3ff', pattern: 'plain', price: 100, rarity: 'commun', available: true, passExclusive: false },
  { id: 'emote_dance', name: 'Danse du swap', type: 'emote', color: '#ff5b6a', pattern: 'plain', price: 250, rarity: 'commun', available: true, passExclusive: false },
  // --- Packs ---
  { id: 'bundle_starter', name: 'Pack du survivant', type: 'bundle', color: '#7be0c0', pattern: 'plain', price: 700, rarity: 'rare', available: true, passExclusive: false, contents: ['skin_menthe', 'trail_bleu', 'emote_wave'] },
  { id: 'bundle_predator', name: 'Pack du prédateur', type: 'bundle', color: '#c62828', pattern: 'plain', price: 1500, rarity: 'légendaire', available: true, passExclusive: false, contents: ['skin_onyx', 'trail_arcenciel', 'emote_dance'] },
  // --- Exclusivités du Pass de combat (paliers 10/20/30/40/50) ---
  { id: 'pass_skin_10', name: 'Tenue du Swap', type: 'skin', color: '#b478ff', pattern: 'scales', price: 0, rarity: 'exclusif', available: true, passExclusive: true },
  { id: 'pass_trail_20', name: 'Traînée spectrale', type: 'trail', color: '#b478ff', pattern: 'plain', price: 0, rarity: 'exclusif', available: true, passExclusive: true },
  { id: 'pass_skin_30', name: 'Armure du Mois', type: 'skin', color: '#ff9f5b', pattern: 'camo', price: 0, rarity: 'exclusif', available: true, passExclusive: true },
  { id: 'pass_trail_40', name: 'Traînée solaire', type: 'trail', color: '#ffaa44', pattern: 'plain', price: 0, rarity: 'exclusif', available: true, passExclusive: true },
  { id: 'pass_skin_50', name: 'Couronne du Swap', type: 'skin', color: '#ffd24d', pattern: 'stripes', price: 0, rarity: 'exclusif', available: true, passExclusive: true }
];
if (!db.shop) db.shop = DEFAULT_SHOP;

function defaultTiers() {
  const tiers = [];
  const milestoneItems = { 10: 'pass_skin_10', 20: 'pass_trail_20', 30: 'pass_skin_30', 40: 'pass_trail_40', 50: 'pass_skin_50' };
  for (let t = 1; t <= 50; t++) {
    if (milestoneItems[t]) {
      tiers.push({ tier: t, reward: { type: 'item', itemId: milestoneItems[t] }, xpRequired: t * 100 });
    } else {
      tiers.push({ tier: t, reward: { type: 'currency', amount: 40 + t * 4 }, xpRequired: t * 100 });
    }
  }
  return tiers;
}
if (!db.battlepass) db.battlepass = defaultTiers();

const RECIPES = {
  epee: { label: 'Épée', cost: { bois: 3, pierre: 2 } },
  arc: { label: 'Arc', cost: { bois: 3, pierre: 1 } },
  hache: { label: 'Hache de guerre', cost: { bois: 4, pierre: 3 } }
};

const WEAPONS = ['poings', 'épée', 'arc', 'hache de guerre', 'arc renforcé'];
const WEAPON_DAMAGE = { poings: 12, 'épée': 22, arc: 18, 'hache de guerre': 28, 'arc renforcé': 25 };
const WEAPON_RANK = { poings: 0, arc: 1, 'épée': 2, 'arc renforcé': 3, 'hache de guerre': 4 };

saveDB();

// ============================== AUTH ========================================

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}
function makeToken(username) {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  const payload = `${username}|${exp}`;
  const sig = crypto.createHmac('sha256', db.secret).update(payload).digest('hex').slice(0, 24);
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  let payload;
  try { payload = Buffer.from(b64, 'base64url').toString('utf8'); } catch (e) { return null; }
  const expected = crypto.createHmac('sha256', db.secret).update(payload).digest('hex').slice(0, 24);
  if (sig !== expected) return null;
  const [username, exp] = payload.split('|');
  if (!username || !exp || Number(exp) < Date.now()) return null;
  return username;
}

function newUser(username, password) {
  const salt = crypto.randomBytes(12).toString('hex');
  const u = {
    username,
    salt,
    passHash: hashPassword(password, salt),
    level: 1,
    xp: 0,
    currency: 300,
    isAdmin: Object.keys(db.users).length === 0, // le premier compte créé devient administrateur
    banned: false,
    muted: false,
    ownedCosmetics: ['skin_default', 'trail_bleu', 'emote_wave'],
    equippedSkin: 'skin_default',
    equippedTrail: 'trail_bleu',
    customSkinData: null,
    skinReportCount: 0,
    skinApproved: false,
    stats: { matchesPlayed: 0, wins: 0, kills: 0, chestsOpened: 0 },
    matchHistory: [],
    friends: [],
    friendRequests: [],
    passClaimed: [],
    dailyLastClaim: 0,
    dailyStreak: 0,
    createdAt: Date.now()
  };
  db.users[username.toLowerCase()] = u;
  saveDB();
  return u;
}

function xpNeeded(level) { return Math.round(100 * Math.pow(level, 1.5)); }

function addXP(u, amount) {
  u.xp = Math.max(0, (u.xp || 0) + amount);
  let leveled = 0;
  while (u.xp >= xpNeeded(u.level) && u.level < 100) { u.xp -= xpNeeded(u.level); u.level++; leveled++; }
  return leveled;
}

function userPublic(u) {
  return {
    username: u.username, level: u.level, xp: u.xp, currency: u.currency,
    isAdmin: u.isAdmin, banned: u.banned, muted: u.muted,
    ownedCosmetics: u.ownedCosmetics, equippedSkin: u.equippedSkin, equippedTrail: u.equippedTrail,
    customSkinData: u.customSkinData, stats: u.stats, matchHistory: u.matchHistory,
    friends: u.friends, passClaimed: u.passClaimed
  };
}

function getUser(token) {
  const username = verifyToken(token);
  if (!username) return null;
  return db.users[username.toLowerCase()] || null;
}

// Skin peint masqué automatiquement après trop de signalements, sauf approbation admin
function effectiveCustomSkin(u) {
  if (!u.customSkinData) return null;
  if (u.skinReportCount >= 3 && !u.skinApproved) return null;
  return u.customSkinData;
}

// ============================== API REST ====================================

const api = express.Router();
api.use(express.json({ limit: '2mb' }));

// --- middleware auth ---
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const u = getUser(h.startsWith('Bearer ') ? h.slice(7) : null);
  if (!u) return res.status(401).json({ error: 'Session invalide ou expirée.' });
  if (u.banned) return res.status(403).json({ error: 'Ce compte est banni.' });
  req.user = u;
  next();
}
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
    next();
  });
}

// --- Auth ---
api.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.users[String(username || '').trim().toLowerCase()];
  if (!u || u.passHash !== hashPassword(password || '', u.salt)) {
    return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect.' });
  }
  if (u.banned) return res.status(403).json({ error: 'Ce compte est banni.' });
  res.json({ token: makeToken(u.username), user: userPublic(u) });
});

api.post('/register', (req, res) => {
  const username = String((req.body || {}).username || '').trim();
  const password = String((req.body || {}).password || '');
  if (!/^[a-zA-Z0-9_À-ÿ-]{3,16}$/.test(username)) {
    return res.status(400).json({ error: 'Pseudo invalide : 3 à 16 caractères (lettres, chiffres, - et _).' });
  }
  if (password.length < 4) return res.status(400).json({ error: 'Mot de passe trop court (4 caractères minimum).' });
  if (db.users[username.toLowerCase()]) {
    return res.status(409).json({ error: 'Ce pseudo est déjà pris.' });
  }
  const u = newUser(username, password);
  res.json({ token: makeToken(u.username), user: userPublic(u) });
});

api.get('/me', requireAuth, (req, res) => res.json({ user: userPublic(req.user) }));

// --- Boutique ---
api.get('/shop', requireAuth, (req, res) => {
  res.json({ shop: db.shop.filter(i => i.available !== false) });
});

api.post('/shop/buy', requireAuth, (req, res) => {
  const item = db.shop.find(i => i.id === (req.body || {}).itemId);
  if (!item || item.available === false) return res.status(404).json({ error: 'Article introuvable.' });
  if (item.passExclusive) return res.status(403).json({ error: 'Cet objet s\'obtient via le Pass de combat.' });
  if (req.user.ownedCosmetics.includes(item.id)) return res.status(400).json({ error: 'Tu possèdes déjà cet article.' });
  if (req.user.currency < item.price) return res.status(400).json({ error: 'Pas assez de Cristaux 💎.' });
  req.user.currency -= item.price;
  const granted = [item.id];
  if (item.type === 'bundle' && Array.isArray(item.contents)) {
    for (const cid of item.contents) {
      const sub = db.shop.find(i => i.id === cid);
      if (sub && !req.user.ownedCosmetics.includes(cid)) granted.push(cid);
    }
  }
  req.user.ownedCosmetics.push(...granted);
  saveDB();
  res.json({ user: userPublic(req.user) });
});

api.post('/shop/equip', requireAuth, (req, res) => {
  const { itemId, slot } = req.body || {};
  const item = db.shop.find(i => i.id === itemId);
  if (!item) return res.status(404).json({ error: 'Article introuvable.' });
  if (!['skin', 'trail'].includes(slot)) return res.status(400).json({ error: 'Emplacement invalide.' });
  if (item.type !== slot) return res.status(400).json({ error: 'Cet article ne va pas dans cet emplacement.' });
  if (!req.user.ownedCosmetics.includes(item.id)) return res.status(403).json({ error: 'Tu ne possèdes pas cet article.' });
  if (slot === 'skin') req.user.equippedSkin = item.id; else req.user.equippedTrail = item.id;
  saveDB();
  res.json({ user: userPublic(req.user) });
});

// --- Pass de combat ---
api.get('/battlepass', requireAuth, (req, res) => {
  res.json({ level: req.user.level, claimed: req.user.passClaimed, tiers: db.battlepass });
});

function claimTier(u, tier) {
  const t = db.battlepass.find(x => x.tier === tier);
  if (!t) return { error: 'Palier introuvable.' };
  if (u.level < t.tier) return { error: `Palier ${t.tier} pas encore atteint.` };
  if (u.passClaimed.includes(tier)) return { error: 'Palier déjà récupéré.' };
  u.passClaimed.push(tier);
  let currency = 0; const items = [];
  if (t.reward && t.reward.type === 'currency' && t.reward.amount > 0) {
    u.currency += t.reward.amount; currency += t.reward.amount;
  } else if (t.reward && t.reward.type === 'item' && t.reward.itemId) {
    const item = db.shop.find(i => i.id === t.reward.itemId);
    if (item) {
      if (!u.ownedCosmetics.includes(item.id)) u.ownedCosmetics.push(item.id);
      items.push(item.name);
    }
  }
  if (t.premiumReward && t.premiumReward.type === 'currency' && t.premiumReward.amount > 0) {
    u.currency += t.premiumReward.amount; currency += t.premiumReward.amount;
  } else if (t.premiumReward && t.premiumReward.type === 'item' && t.premiumReward.itemId) {
    const item = db.shop.find(i => i.id === t.premiumReward.itemId);
    if (item) {
      if (!u.ownedCosmetics.includes(item.id)) u.ownedCosmetics.push(item.id);
      items.push(item.name);
    }
  }
  return { currency, items };
}

api.post('/battlepass/claim', requireAuth, (req, res) => {
  const r = claimTier(req.user, Number((req.body || {}).tier));
  if (r.error) return res.status(400).json(r);
  saveDB();
  res.json({ user: userPublic(req.user) });
});

api.post('/battlepass/claim-all', requireAuth, (req, res) => {
  let currencyGain = 0; const itemsGained = [];
  for (const t of db.battlepass) {
    if (req.user.level >= t.tier && !req.user.passClaimed.includes(t.tier)) {
      const r = claimTier(req.user, t.tier);
      currencyGain += r.currency || 0;
      itemsGained.push(...(r.items || []));
    }
  }
  saveDB();
  res.json({ user: userPublic(req.user), currencyGain, itemsGained });
});

// --- Amis ---
api.get('/friends', requireAuth, (req, res) => {
  const friends = (req.user.friends || [])
    .map(name => db.users[name.toLowerCase()])
    .filter(Boolean)
    .map(u => ({ username: u.username, level: u.level, online: onlineUsers.has(u.username) }));
  res.json({ friends, requests: req.user.friendRequests || [] });
});

api.post('/friends/request', requireAuth, (req, res) => {
  const name = String((req.body || {}).username || '').trim();
  const target = db.users[name.toLowerCase()];
  if (!target) return res.status(404).json({ error: 'Cet utilisateur n\'existe pas.' });
  if (target.username === req.user.username) return res.status(400).json({ error: 'Tu ne peux pas t\'ajouter toi-même.' });
  if (req.user.friends.includes(target.username)) return res.status(400).json({ error: 'Vous êtes déjà amis.' });
  if (target.friendRequests.includes(req.user.username)) return res.status(400).json({ error: 'Demande déjà envoyée.' });
  if (req.user.friendRequests.includes(target.username)) {
    // acceptation croisée immédiate
    req.user.friendRequests = req.user.friendRequests.filter(n => n !== target.username);
    req.user.friends.push(target.username);
    target.friends.push(req.user.username);
    saveDB();
    return res.json({ ok: true, mutual: true });
  }
  target.friendRequests.push(req.user.username);
  saveDB();
  res.json({ ok: true });
});

api.post('/friends/accept', requireAuth, (req, res) => {
  const name = String((req.body || {}).username || '').trim();
  if (!req.user.friendRequests.includes(name)) return res.status(400).json({ error: 'Aucune demande de cet utilisateur.' });
  const target = db.users[name.toLowerCase()];
  if (!target) return res.status(404).json({ error: 'Cet utilisateur n\'existe plus.' });
  req.user.friendRequests = req.user.friendRequests.filter(n => n !== name);
  if (!req.user.friends.includes(name)) req.user.friends.push(name);
  if (!target.friends.includes(req.user.username)) target.friends.push(req.user.username);
  saveDB();
  res.json({ ok: true });
});

api.post('/friends/decline', requireAuth, (req, res) => {
  const name = String((req.body || {}).username || '').trim();
  req.user.friendRequests = req.user.friendRequests.filter(n => n !== name);
  saveDB();
  res.json({ ok: true });
});

api.post('/friends/remove', requireAuth, (req, res) => {
  const name = String((req.body || {}).username || '').trim();
  req.user.friends = req.user.friends.filter(n => n !== name);
  const target = db.users[name.toLowerCase()];
  if (target) target.friends = target.friends.filter(n => n !== req.user.username);
  saveDB();
  res.json({ ok: true });
});

// --- Classement / stats / quotidien / recettes ---
api.get('/leaderboard', (req, res) => {
  const rows = Object.values(db.users).map(u => ({
    username: u.username, level: u.level, wins: u.stats.wins, kills: u.stats.kills, matchesPlayed: u.stats.matchesPlayed
  })).sort((a, b) => (b.wins - a.wins) || (b.level - a.level) || (b.kills - a.kills)).slice(0, 25);
  res.json({ leaderboard: rows });
});

api.get('/stats/online', (req, res) => {
  res.json({ playersOnline: onlineUsers.size, activeRooms: [...rooms.values()].filter(r => r.phase !== 'ended').length });
});

api.get('/recipes', (req, res) => res.json({ recipes: RECIPES }));

function dailyStatusFor(u) {
  const cfg = db.config;
  const now = Date.now();
  const cooldown = 20 * 3600 * 1000; // 20h entre deux récompenses
  const since = now - (u.dailyLastClaim || 0);
  const canClaim = since >= cooldown;
  const streak = u.dailyStreak || 0;
  const reward = cfg.dailyRewardBase + Math.min(streak, cfg.dailyRewardMaxStreak - 1) * cfg.dailyRewardStep;
  return { canClaim, streak, reward, nextInMs: Math.max(0, cooldown - since) };
}

api.get('/daily-status', requireAuth, (req, res) => {
  const s = dailyStatusFor(req.user);
  res.json({ canClaim: s.canClaim, streak: s.streak, nextInMs: s.nextInMs });
});

api.post('/daily-claim', requireAuth, (req, res) => {
  const u = req.user;
  const s = dailyStatusFor(u);
  if (!s.canClaim) return res.status(400).json({ error: 'Récompense déjà récupérée aujourd\'hui.' });
  // la série continue si la dernière récupération date de moins de 48h
  const hours = (Date.now() - (u.dailyLastClaim || 0)) / 3600000;
  u.dailyStreak = (u.dailyLastClaim && hours < 48) ? (u.dailyStreak || 0) + 1 : 1;
  u.dailyLastClaim = Date.now();
  u.currency += s.reward;
  saveDB();
  res.json({ user: userPublic(u), reward: s.reward, streak: u.dailyStreak });
});

// --- Profil : skin peint ---
api.post('/profile/skin', requireAuth, (req, res) => {
  const dataUrl = (req.body || {}).dataUrl;
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
    return res.status(400).json({ error: 'Image invalide.' });
  }
  if (dataUrl.length > 400 * 1024) return res.status(400).json({ error: 'Image trop lourde (400 Ko max).' });
  req.user.customSkinData = dataUrl;
  req.user.skinReportCount = 0;
  req.user.skinApproved = false;
  saveDB();
  res.json({ ok: true });
});

api.post('/profile/skin/reset', requireAuth, (req, res) => {
  req.user.customSkinData = null;
  req.user.skinReportCount = 0;
  saveDB();
  res.json({ ok: true });
});

api.post('/profile/skin/report', requireAuth, (req, res) => {
  const name = String((req.body || {}).username || '').trim().toLowerCase();
  const target = db.users[name];
  if (!target) return res.status(404).json({ error: 'Joueur introuvable.' });
  if (target.username === req.user.username) return res.status(400).json({ error: 'Tu ne peux pas te signaler toi-même.' });
  target.skinReportCount = (target.skinReportCount || 0) + 1;
  saveDB();
  res.json({ ok: true, count: target.skinReportCount });
});

// ============================== ADMIN (REST) ================================

api.get('/admin/users', requireAdmin, (req, res) => {
  res.json({ users: Object.values(db.users).map(u => ({
    username: u.username, level: u.level, xp: u.xp, currency: u.currency,
    isAdmin: u.isAdmin, banned: u.banned, muted: u.muted
  })) });
});

api.post('/admin/users/:username/currency', requireAdmin, (req, res) => {
  const u = db.users[req.params.username.toLowerCase()];
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  const amt = Number((req.body || {}).amount);
  if (!Number.isFinite(amt)) return res.status(400).json({ error: 'Montant invalide.' });
  u.currency = Math.max(0, u.currency + amt);
  saveDB();
  res.json({ ok: true, newBalance: u.currency });
});

api.post('/admin/users/:username/xp', requireAdmin, (req, res) => {
  const u = db.users[req.params.username.toLowerCase()];
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  const amt = Number((req.body || {}).amount);
  if (!Number.isFinite(amt)) return res.status(400).json({ error: 'Montant invalide.' });
  addXP(u, amt);
  saveDB();
  res.json({ ok: true, newLevel: u.level, newXP: u.xp });
});

api.post('/admin/users/:username/level', requireAdmin, (req, res) => {
  const u = db.users[req.params.username.toLowerCase()];
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  const lvl = Math.min(100, Math.max(1, Number((req.body || {}).level) || 1));
  u.level = lvl; u.xp = 0;
  saveDB();
  res.json({ ok: true, newLevel: u.level });
});

api.post('/admin/users/:username/grant-cosmetic', requireAdmin, (req, res) => {
  const u = db.users[req.params.username.toLowerCase()];
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  const item = db.shop.find(i => i.id === (req.body || {}).cosmeticId);
  if (!item) return res.status(404).json({ error: 'Objet introuvable.' });
  if (!u.ownedCosmetics.includes(item.id)) u.ownedCosmetics.push(item.id);
  saveDB();
  res.json({ ok: true });
});

api.post('/admin/users/:username/grant-all-cosmetics', requireAdmin, (req, res) => {
  const u = db.users[req.params.username.toLowerCase()];
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  let count = 0;
  for (const item of db.shop) {
    if (!u.ownedCosmetics.includes(item.id)) { u.ownedCosmetics.push(item.id); count++; }
  }
  saveDB();
  res.json({ ok: true, count });
});

api.post('/admin/users/:username/admin', requireAdmin, (req, res) => {
  const u = db.users[req.params.username.toLowerCase()];
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  if (u.username === req.user.username && !(req.body || {}).value) {
    return res.status(400).json({ error: 'Tu ne peux pas te retirer tes propres droits admin.' });
  }
  u.isAdmin = !!(req.body || {}).value;
  saveDB();
  res.json({ ok: true });
});

api.post('/admin/users/:username/ban', requireAdmin, (req, res) => {
  const u = db.users[req.params.username.toLowerCase()];
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  u.banned = !!(req.body || {}).value;
  saveDB();
  if (u.banned) kickUser(u.username, 'Vous avez été banni par un administrateur.');
  res.json({ ok: true });
});

api.post('/admin/users/:username/mute', requireAdmin, (req, res) => {
  const u = db.users[req.params.username.toLowerCase()];
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  u.muted = !!(req.body || {}).value;
  saveDB();
  res.json({ ok: true });
});

api.post('/admin/users/:username/reset-password', requireAdmin, (req, res) => {
  const u = db.users[req.params.username.toLowerCase()];
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  const pw = String((req.body || {}).newPassword || '');
  if (pw.length < 4) return res.status(400).json({ error: 'Mot de passe trop court (4 min).' });
  u.salt = crypto.randomBytes(12).toString('hex');
  u.passHash = hashPassword(pw, u.salt);
  saveDB();
  res.json({ ok: true });
});

api.get('/admin/shop', requireAdmin, (req, res) => res.json({ shop: db.shop }));

api.post('/admin/shop', requireAdmin, (req, res) => {
  const item = req.body || {};
  if (!item.id || !item.name) return res.status(400).json({ error: 'ID et nom requis.' });
  const existing = db.shop.find(i => i.id === item.id);
  const clean = {
    id: item.id, name: item.name, type: ['skin', 'trail', 'emote', 'bundle'].includes(item.type) ? item.type : 'skin',
    color: item.color || '#4da3ff', pattern: item.pattern || 'plain',
    price: Math.max(0, Number(item.price) || 0),
    rarity: ['commun', 'rare', 'légendaire', 'exclusif'].includes(item.rarity) ? item.rarity : 'commun',
    available: item.available !== false, passExclusive: !!item.passExclusive, premiumOnly: !!item.premiumOnly,
    contents: existing ? existing.contents : (item.contents || undefined)
  };
  const idx = db.shop.findIndex(i => i.id === item.id);
  if (idx >= 0) db.shop[idx] = { ...db.shop[idx], ...clean };
  else db.shop.push(clean);
  saveDB();
  res.json({ ok: true });
});

api.delete('/admin/shop/:id', requireAdmin, (req, res) => {
  db.shop = db.shop.filter(i => i.id !== req.params.id);
  saveDB();
  res.json({ ok: true });
});

api.get('/admin/battlepass', requireAdmin, (req, res) => res.json({ tiers: db.battlepass }));

api.post('/admin/battlepass/reset', requireAdmin, (req, res) => {
  db.battlepass = defaultTiers();
  saveDB();
  res.json({ ok: true });
});

api.post('/admin/battlepass/:tier/add', requireAdmin, (req, res) => {
  const tier = Number(req.params.tier);
  if (!Number.isFinite(tier) || tier < 1) return res.status(400).json({ error: 'Numéro de palier invalide.' });
  if (db.battlepass.some(t => t.tier === tier)) return res.status(400).json({ error: 'Ce palier existe déjà.' });
  db.battlepass.push({ tier, reward: { type: 'currency', amount: 50 }, xpRequired: tier * 100 });
  db.battlepass.sort((a, b) => a.tier - b.tier);
  saveDB();
  res.json({ ok: true });
});

api.post('/admin/battlepass/:tier', requireAdmin, (req, res) => {
  const tier = Number(req.params.tier);
  const t = db.battlepass.find(x => x.tier === tier);
  if (!t) return res.status(404).json({ error: 'Palier introuvable.' });
  const patch = req.body || {};
  if (patch.reward) t.reward = patch.reward;
  if ('premiumReward' in patch) t.premiumReward = patch.premiumReward || null;
  if (patch.xpRequired !== undefined) t.xpRequired = Number(patch.xpRequired) || tier * 100;
  saveDB();
  res.json({ ok: true });
});

api.delete('/admin/battlepass/:tier', requireAdmin, (req, res) => {
  db.battlepass = db.battlepass.filter(t => t.tier !== Number(req.params.tier));
  saveDB();
  res.json({ ok: true });
});

api.get('/admin/rooms', requireAdmin, (req, res) => {
  res.json({ rooms: [...rooms.values()].map(r => ({
    code: r.code, mode: r.mode, map: r.map, phase: r.phase,
    players: Object.keys(r.meta).length, maxPlayers: r.maxPlayers
  })) });
});

api.post('/admin/rooms/:code/close', requireAdmin, (req, res) => {
  const room = [...rooms.values()].find(r => r.code === req.params.code || r.id === req.params.code);
  if (!room) return res.status(404).json({ error: 'Salon introuvable.' });
  closeRoom(room, 'fermé par un administrateur');
  res.json({ ok: true });
});

api.get('/admin/reported-skins', requireAdmin, (req, res) => {
  res.json({ users: Object.values(db.users).filter(u => u.skinReportCount > 0).map(u => ({
    username: u.username, skinReportCount: u.skinReportCount
  })) });
});

api.post('/admin/users/:username/skin/approve', requireAdmin, (req, res) => {
  const u = db.users[req.params.username.toLowerCase()];
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  u.skinApproved = true; u.skinReportCount = 0;
  saveDB();
  res.json({ ok: true });
});

api.post('/admin/users/:username/skin/clear', requireAdmin, (req, res) => {
  const u = db.users[req.params.username.toLowerCase()];
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  u.customSkinData = null; u.skinReportCount = 0; u.skinApproved = false;
  saveDB();
  res.json({ ok: true });
});

api.get('/admin/config', requireAdmin, (req, res) => res.json({ config: db.config }));

api.post('/admin/config', requireAdmin, (req, res) => {
  const patch = req.body || {};
  for (const k of Object.keys(DEFAULT_CONFIG)) {
    if (patch[k] !== undefined) {
      db.config[k] = (typeof DEFAULT_CONFIG[k] === 'boolean') ? !!patch[k] : Number(patch[k]) || 0;
    }
  }
  saveDB();
  res.json({ ok: true });
});

api.post('/admin/announce', requireAdmin, (req, res) => {
  const text = String((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: 'Annonce vide.' });
  io.emit('globalAnnouncement', { text });
  res.json({ ok: true });
});

// ============================== SERVEUR HTTP =================================

const app = express();
app.disable('x-powered-by');
// Alias local : permet d'ouvrir le jeu directement sur http://localhost:3000/
app.get('/port/3000/socket.io/socket.io.js', (req, res) => res.redirect('/socket.io/socket.io.js'));
app.use('/port/3000/api', api);
app.use('/api', api);
app.use(express.static(ROOT, { extensions: ['html'] }));
app.use('/port/3000', (req, res) => res.status(404).json({ error: 'Introuvable' }));

const server = http.createServer(app);
const io = new Server(server, {
  path: '/socket.io/',
  cors: { origin: true, credentials: false },
  maxHttpBufferSize: 1e6,
  pingInterval: 25000,
  pingTimeout: 60000
});

// ============================== LOGIQUE DE JEU ==============================

const rooms = new Map();
const onlineUsers = new Set();
const socketRoom = new Map();
const socketUser = new Map();

const MAPS = ['jungle', 'arctic', 'desert'];
const PLAY_RADIUS = 58;
const MAX_HP = 100;
const START_LIVES = 3;
const MAX_PLAYERS = 15;
const BOT_NAMES = ['Alpha', 'Bravo', 'Céleste', 'Delta', 'Echo', 'Fox', 'Gamma'];

let roomSeq = 1;
let bodySeq = 1;

function rand(min, max) { return min + Math.random() * (max - min); }
function dist2d(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function spawnPoint() {
  const a = Math.random() * Math.PI * 2;
  const d = rand(5, 45);
  return { x: Math.cos(a) * d, z: Math.sin(a) * d };
}

// [FIX] Ajout d'une limite de bots par salon (botLimit)
function makeRoom({ mode, map, hostSocketId }) {
  const id = 'r' + (roomSeq++);
  const code = mode === 'public' ? id.toUpperCase() : crypto.randomBytes(3).toString('hex').toUpperCase();
  const room = {
    id, code, mode, map: MAPS.includes(map) ? map : MAPS[Math.floor(Math.random() * 3)],
    phase: 'lobby', minPlayers: mode === 'public' ? 2 : 2, maxPlayers: MAX_PLAYERS,
    bodies: [], controllerOf: {}, meta: {}, chests: [], resources: [], traps: [],
    hostSocketId, countdown: null, timerSeconds: null, swapAt: null,
    tick: null, botTick: null, createdAt: Date.now(), botCounter: 0, ended: false,
    botLimit: mode === 'solo-test' ? 4 : 2  // [FIX] limite configurable
  };
  // coffres
  for (let i = 0; i < 14; i++) {
    const p = spawnPoint();
    room.chests.push({ id: 'ch' + i, x: p.x, z: p.z, opened: false });
  }
  // ressources
  for (let i = 0; i < 14; i++) {
    const p = spawnPoint();
    room.resources.push({ id: 'n' + i, x: p.x, z: p.z, type: i % 2 ? 'bois' : 'pierre', available: true, respawnAt: 0 });
  }
  rooms.set(id, room);
  room.tick = setInterval(() => roomTick(room), 1000);
  room.botTick = setInterval(() => botTick(room), 400);
  return room;
}

function roomSockets(room) {
  return Object.keys(room.meta).filter(sid => io.sockets.sockets.has(sid));
}

function publicRoom(room) {
  return {
    id: room.id, code: room.code, mode: room.mode, map: room.map,
    phase: room.phase, minPlayers: room.minPlayers, maxPlayers: room.maxPlayers,
    countdown: room.countdown, timerSeconds: room.timerSeconds,
    hostSocketId: room.hostSocketId,
    bodies: room.bodies, controllerOf: room.controllerOf, meta: room.meta,
    chests: room.chests, resources: room.resources, traps: room.traps
  };
}

function broadcastState(room) {
  for (const sid of roomSockets(room)) {
    io.to(sid).emit('roomState', publicRoom(room));
  }
}

function addBody(room, sid, meta) {
  const p = spawnPoint();
  const body = {
    id: 'b' + (bodySeq++), x: p.x, y: 0, z: p.z, ry: 0,
    hp: MAX_HP, maxHp: MAX_HP, lives: START_LIVES, alive: true,
    weapon: 'poings', resources: { bois: 0, pierre: 0 }, totems: 0,
    isBot: false, lastAttackAt: 0
  };
  room.bodies.push(body);
  room.controllerOf[body.id] = sid;
  room.meta[sid] = { ...meta, kills: 0, deaths: 0 };
  return body;
}

// [FIX] Ajout d'une limite de bots proportionnelle aux humains
function addBot(room) {
  if (room.bodies.length >= room.maxPlayers) return null;
  const botCount = room.bodies.filter(b => b.isBot).length;
  const humanCount = room.bodies.filter(b => !b.isBot).length;
  // Limite : botLimit du salon, et pas plus de bots que d'humains + 1
  const maxBots = Math.min(room.botLimit || 2, Math.max(2, humanCount + 1));
  if (botCount >= maxBots) return null;

  const p = spawnPoint();
  const bid = 'bot' + (++room.botCounter);
  const body = {
    id: 'b' + (bodySeq++), x: p.x, y: 0, z: p.z, ry: 0,
    hp: MAX_HP, maxHp: MAX_HP, lives: START_LIVES, alive: true,
    weapon: Math.random() < 0.4 ? 'épée' : 'poings', resources: { bois: 0, pierre: 0 }, totems: 0,
    isBot: true, lastAttackAt: 0, targetId: null
  };
  room.bodies.push(body);
  room.controllerOf[body.id] = bid;
  const colors = ['#ff5b6a', '#ffd24d', '#7be0c0', '#b478ff', '#ff9f5b', '#4dd6ff'];
  room.meta[bid] = {
    username: '🤖 Bot ' + (BOT_NAMES[(room.botCounter - 1) % BOT_NAMES.length]),
    skin: colors[Math.floor(Math.random() * colors.length)],
    pattern: 'plain', customSkin: null, kills: 0, deaths: 0
  };
  return body;
}

function bodyOf(room, sid) {
  for (const b of room.bodies) {
    if (room.controllerOf[b.id] === sid && b.alive) return b;
  }
  return null;
}

function startCountdown(room) {
  if (room.phase !== 'lobby') return;
  room.phase = 'countdown';
  room.countdown = 5;
  broadcastState(room);
}

function startPlaying(room) {
  room.phase = 'playing';
  room.countdown = null;
  scheduleSwap(room);
  broadcastState(room);
  for (const sid of roomSockets(room)) {
    io.to(sid).emit('chatMessage', { system: true, text: '⚡ La partie commence ! Toutes les 25-45s, les corps sont échangés. Survis !' });
  }
}

function scheduleSwap(room) {
  const { baseSwapMinSeconds, baseSwapMaxSeconds } = db.config;
  const seconds = Math.round(rand(baseSwapMinSeconds, baseSwapMaxSeconds));
  room.timerSeconds = seconds;
}

// [FIX] Sécurisation : on filtre bien les bots et on protège contre < 2 humains
function executeSwap(room) {
  const humanBodies = room.bodies.filter(b =>
    b.alive &&
    room.controllerOf[b.id] &&
    !String(room.controllerOf[b.id]).startsWith('bot')
  );
  if (humanBodies.length < 2) { scheduleSwap(room); return; }
  const controllers = humanBodies.map(b => room.controllerOf[b.id]);
  // mélange de Fisher-Yates avec dérangement garanti
  let shuffled;
  let attempts = 0;
  do {
    shuffled = [...controllers];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    attempts++;
  } while (shuffled.some((c, i) => c === controllers[i]) && attempts < 20);
  const mapping = [];
  humanBodies.forEach((b, i) => {
    room.controllerOf[b.id] = shuffled[i];
    mapping.push({ socketId: shuffled[i], bodyId: b.id });
  });
  for (const sid of roomSockets(room)) {
    io.to(sid).emit('globalSwapExecuted', {
      message: '⚡ SWAP GLOBAL ! Tu contrôles maintenant un autre corps.',
      mapping
    });
  }
  scheduleSwap(room);
  broadcastState(room);
}

function roomTick(room) {
  if (room.phase === 'countdown') {
    room.countdown--;
    if (room.countdown <= 0) startPlaying(room);
    else broadcastState(room);
    return;
  }
  if (room.phase !== 'playing') {
    // nettoyage des salons abandonnés
    if (room.phase === 'ended' && Date.now() - (room.endedAt || 0) > 60000) closeRoom(room, 'inactivité');
    else if (Object.keys(room.meta).length === 0 && Date.now() - room.createdAt > 60000) closeRoom(room, 'salon vide');
    return;
  }
  // timer du swap
  if (room.timerSeconds !== null) {
    room.timerSeconds--;
    if (room.timerSeconds <= 0) executeSwap(room);
  }
  // réapparition des ressources
  const now = Date.now();
  for (const n of room.resources) {
    if (!n.available && n.respawnAt && now >= n.respawnAt) {
      n.available = true; n.respawnAt = 0;
    }
  }
  // pièges : déclenchement sur ennemi proche
  for (const trap of [...room.traps]) {
    for (const b of room.bodies) {
      if (!b.alive) continue;
      if (room.controllerOf[b.id] === trap.ownerId) continue;
      if (Math.hypot(b.x - trap.x, b.z - trap.z) < 1.6) {
        room.traps = room.traps.filter(t => t.id !== trap.id);
        for (const sid of roomSockets(room)) io.to(sid).emit('trapTriggered', { trapId: trap.id });
        applyDamage(room, b, 25, trap.ownerId, 'un piège');
        break;
      }
    }
  }
  for (const sid of roomSockets(room)) {
    io.to(sid).emit('tick', { phase: room.phase, countdown: room.countdown, timerSeconds: room.timerSeconds });
  }
}

function botTick(room) {
  if (room.phase !== 'playing') return;
  const dt = 0.4;
  for (const bot of room.bodies) {
    if (!bot.isBot || !bot.alive) continue;
    // cible : le corps vivant le plus proche (hors lui-même)
    let target = null, best = Infinity;
    for (const b of room.bodies) {
      if (b === bot || !b.alive) continue;
      const d = dist2d(bot, b);
      if (d < best) { best = d; target = b; }
    }
    if (!target) continue;
    const dx = target.x - bot.x, dz = target.z - bot.z;
    bot.ry = Math.atan2(dx, dz);
    if (best > 3.2) {
      const speed = 4.2 * dt;
      bot.x += (dx / best) * speed;
      bot.z += (dz / best) * speed;
      const r = Math.hypot(bot.x, bot.z);
      if (r > PLAY_RADIUS) { bot.x *= PLAY_RADIUS / r; bot.z *= PLAY_RADIUS / r; }
      for (const sid of roomSockets(room)) io.to(sid).emit('bodyMoved', { bodyId: bot.id, x: bot.x, y: 0, z: bot.z, ry: bot.ry });
    } else if (best <= 4.2 && Date.now() - bot.lastAttackAt > 1300) {
      bot.lastAttackAt = Date.now();
      applyDamage(room, target, WEAPON_DAMAGE[bot.weapon] || 12, room.controllerOf[bot.id], '🤖 un bot');
    }
  }
}

function applyDamage(room, body, dmg, attackerSid, attackerLabel) {
  if (!body.alive || room.phase !== 'playing') return;
  body.hp = Math.max(0, body.hp - dmg);
  for (const sid of roomSockets(room)) io.to(sid).emit('bodyDamaged', { bodyId: body.id, hp: body.hp, maxHp: body.maxHp });
  if (body.hp > 0) return;

  const victimSid = room.controllerOf[body.id];
  const victimMeta = victimSid ? room.meta[victimSid] : null;
  if (victimMeta) victimMeta.deaths = (victimMeta.deaths || 0) + 1;
  const attackerMeta = attackerSid ? room.meta[attackerSid] : null;
  if (attackerMeta && attackerSid !== victimSid) attackerMeta.kills = (attackerMeta.kills || 0) + 1;

  body.lives--;
  if (body.lives > 0) {
    body.hp = body.maxHp;
    const p = spawnPoint();
    body.x = p.x; body.z = p.z; body.y = 0;
    for (const sid of roomSockets(room)) io.to(sid).emit('bodyDied', { bodyId: body.id, livesLeft: body.lives });
    if (victimSid && io.sockets.sockets.has(victimSid)) {
      io.to(victimSid).emit('youDied', {
        attackerName: attackerMeta ? attackerMeta.username : attackerLabel,
        livesLeft: body.lives
      });
    }
    broadcastState(room);
    return;
  }
  // élimination définitive
  body.alive = false;
  delete room.controllerOf[body.id];
  for (const sid of roomSockets(room)) {
    io.to(sid).emit('bodyEliminated', {
      bodyId: body.id,
      victimName: victimMeta ? victimMeta.username : '???',
      attackerName: attackerMeta ? attackerMeta.username : attackerLabel
    });
  }
  if (victimSid && io.sockets.sockets.has(victimSid)) {
    io.to(victimSid).emit('youAreEliminated', { attackerName: attackerMeta ? attackerMeta.username : attackerLabel });
  }
  checkMatchEnd(room);
}

// [FIX] Sécurisation : vérifie bien que la partie est en cours
function checkMatchEnd(room) {
  if (room.phase !== 'playing') return;
  const alive = room.bodies.filter(b => b.alive && room.controllerOf[b.id]);
  if (alive.length > 1) return;
  endMatch(room, alive.length === 1 ? alive[0] : null);
}

function endMatch(room, winnerBody) {
  room.phase = 'ended';
  room.endedAt = Date.now();
  room.timerSeconds = null;
  const winnerSid = winnerBody ? room.controllerOf[winnerBody.id] : null;

  const finalStats = Object.entries(room.meta).map(([sid, m]) => ({
    username: m.username, kills: m.kills || 0, deaths: m.deaths || 0,
    winner: sid === winnerSid
  })).sort((a, b) => b.kills - a.kills);

  // récompenses pour les joueurs humains
  for (const [sid, m] of Object.entries(room.meta)) {
    if (String(sid).startsWith('bot')) continue;
    const sock = io.sockets.sockets.get(sid);
    const user = sock ? socketUser.get(sid) : null;
    if (user) {
      const u = user.user;
      const won = sid === winnerSid;
      u.stats.matchesPlayed++;
      u.stats.kills += (m.kills || 0);
      u.stats.deaths = (m.deaths || 0);
      if (won) u.stats.wins++;
      const xpGain = 30 + (m.kills || 0) * 10 + (won ? 50 : 0);
      const crGain = 25 + (m.kills || 0) * 5 + (won ? 100 : 0);
      const levels = addXP(u, xpGain);
      u.currency += crGain;
      u.matchHistory.unshift({ map: room.map, result: won ? 'victoire' : 'défaite', kills: m.kills || 0, deaths: m.deaths || 0 });
      u.matchHistory = u.matchHistory.slice(0, 10);
      if (sock) {
        sock.emit('notification', { type: 'good', text: `+${xpGain} XP · +${crGain} 💎${won ? ' · VICTOIRE !' : ''}${levels > 0 ? ` · Niveau ${u.level} !` : ''}` });
      }
    }
  }
  saveDB();
  for (const sid of roomSockets(room)) {
    io.to(sid).emit('matchEnded', {
      winner: winnerSid && room.meta[winnerSid] ? { socketId: winnerSid, username: room.meta[winnerSid].username } : null,
      finalStats
    });
  }
  // fin du salon après un délai pour laisser voir l'écran de fin
  setTimeout(() => { if (rooms.has(room.id)) closeRoom(room, 'partie terminée'); }, 30000);
}

function closeRoom(room, reason) {
  if (!rooms.has(room.id)) return;
  rooms.delete(room.id);
  if (room.tick) clearInterval(room.tick);
  if (room.botTick) clearInterval(room.botTick);
  for (const sid of roomSockets(room)) {
    const sock = io.sockets.sockets.get(sid);
    if (sock) { sock.emit('roomClosed', { reason }); sock.leave(room.id); }
    socketRoom.delete(sid);
  }
}

function kickUser(username, reason) {
  for (const [sid, su] of socketUser) {
    if (su.username === username) {
      const sock = io.sockets.sockets.get(sid);
      if (sock) { sock.emit('notification', { type: 'bad', text: reason }); sock.disconnect(true); }
      socketUser.delete(sid);
    }
  }
  onlineUsers.delete(username);
}

// [FIX] Suppression de la ligne inutile "delete room.trapsOwned"
function leaveRoom(sid) {
  const roomId = socketRoom.get(sid);
  if (!roomId) return;
  const room = rooms.get(roomId);
  socketRoom.delete(sid);
  if (!room) return;
  const body = room.bodies.find(b => room.controllerOf[b.id] === sid);
  if (body) {
    delete room.controllerOf[body.id];
    body.alive = false;
    room.bodies = room.bodies.filter(b => b.id !== body.id);
  }
  const name = room.meta[sid] ? room.meta[sid].username : null;
  delete room.meta[sid];
  room.traps = room.traps.filter(t => t.ownerId !== sid);
  if (name) {
    for (const s of roomSockets(room)) io.to(s).emit('chatMessage', { system: true, text: `${name} a quitté le salon.` });
  }
  if (Object.keys(room.meta).length === 0) { closeRoom(room, 'salon vide'); return; }
  if (room.hostSocketId === sid) {
    const next = roomSockets(room)[0];
    room.hostSocketId = next;
    if (next) io.to(next).emit('notification', { type: 'good', text: 'Tu es maintenant l\'hôte du salon.' });
  }
  if (room.phase === 'playing') checkMatchEnd(room);
  broadcastState(room);
}

// ============================== SOCKET.IO ====================================

io.on('connection', (socket) => {
  socket.data.user = null;
  socket.data.room = null;

  socket.on('authenticate', (token, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const user = getUser(token);
    if (!user) return cb({ error: 'Session invalide.' });
    if (user.banned) return cb({ error: 'Ce compte est banni.' });
    socketUser.set(socket.id, { username: user.username, user });
    onlineUsers.add(user.username);
    socket.data.user = user;
    cb({ ok: true });
  });

  // ---- entrée dans les salons ----
  socket.on('joinPublic', (data, cb) => handleJoin(socket, data, cb, { mode: 'public' }));
  socket.on('joinPrivate', (data, cb) => handleJoin(socket, data, cb, { mode: 'private' }));
  socket.on('createPrivate', (data, cb) => handleJoin(socket, data, cb, { mode: 'create-private' }));
  socket.on('adminSoloTest', (data, cb) => handleJoin(socket, data, cb, { mode: 'solo-admin' }));

  function handleJoin(socket, data, cb, opts) {
    if (typeof cb !== 'function') cb = () => {};
    data = data || {};
    const su = socketUser.get(socket.id);
    if (!su) return cb({ error: 'Non authentifié — recharge la page.' });
    if (socketRoom.has(socket.id)) leaveRoom(socket.id);

    let room = null;
    if (opts.mode === 'public') {
      room = [...rooms.values()].find(r => r.mode === 'public' && r.phase !== 'ended'
        && Object.keys(r.meta).length < r.maxPlayers && (r.phase === 'lobby' || r.phase === 'countdown'));
      if (!room) room = makeRoom({ mode: 'public', map: MAPS[Math.floor(Math.random() * 3)], hostSocketId: socket.id });
    } else if (opts.mode === 'private') {
      const code = String(data.code || '').trim().toUpperCase();
      room = [...rooms.values()].find(r => r.code === code);
      if (!room) return cb({ error: 'Salon introuvable. Vérifie le code.' });
      if (Object.keys(room.meta).length >= room.maxPlayers) return cb({ error: 'Salon complet.' });
    } else if (opts.mode === 'create-private') {
      room = makeRoom({ mode: 'private', map: data.map, hostSocketId: socket.id });
      const bots = Math.min(2, Math.max(0, parseInt(data.bots) || 0)); // [FIX] limité à 2 en privé
      for (let i = 0; i < bots; i++) addBot(room);
    } else if (opts.mode === 'solo-admin') {
      if (!su.user.isAdmin) return cb({ error: 'Réservé aux administrateurs.' });
      room = makeRoom({ mode: 'solo-test', map: data.map, hostSocketId: socket.id });
      const bots = Math.min(4, Math.max(0, parseInt(data.bots) || 0)); // [FIX] jusqu'à 4 en solo
      for (let i = 0; i < bots; i++) addBot(room);
    }

    const skinItem = db.shop.find(i => i.id === su.user.equippedSkin) || { color: '#4da3ff', pattern: 'plain' };
    const trailItem = db.shop.find(i => i.id === su.user.equippedTrail);
    const meta = {
      username: su.user.username,
      skin: skinItem.color, pattern: skinItem.pattern || 'plain',
      trail: trailItem ? trailItem.color : null,
      customSkin: effectiveCustomSkin(su.user)
    };
    addBody(room, socket.id, meta);
    socket.join(room.id);
    socketRoom.set(socket.id, room.id);
    if (room.mode === 'public' && room.phase === 'lobby' && Object.keys(room.meta).length >= room.minPlayers) {
      startCountdown(room);
    } else if (room.mode === 'solo-test') {
      startPlaying(room);
    } else {
      broadcastState(room);
    }
    for (const s of roomSockets(room)) {
      if (s !== socket.id) io.to(s).emit('chatMessage', { system: true, text: `${su.user.username} a rejoint le salon.` });
    }
    cb({ ok: true, room: publicRoom(room) });
  }

  // [FIX] Vérifie qu'il y a au moins 1 joueur et que la phase est 'lobby'
  socket.on('startPrivateMatch', (data, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room) return cb({ error: 'Aucun salon.' });
    if (room.hostSocketId !== socket.id) return cb({ error: 'Seul l\'hôte peut lancer la partie.' });
    if (room.phase !== 'lobby') return cb({ error: 'Partie déjà lancée.' });
    if (Object.keys(room.meta).length < 1) return cb({ error: 'Il faut au moins 1 joueur.' });
    startCountdown(room);
    cb({ ok: true });
  });

  socket.on('addBots', (data, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room) return cb({ error: 'Aucun salon.' });
    if (room.hostSocketId !== socket.id) return cb({ error: 'Seul l\'hôte peut ajouter des bots.' });
    const count = Math.min(3, Math.max(1, parseInt((data || {}).count) || 1));
    let added = 0;
    for (let i = 0; i < count && room.bodies.length < room.maxPlayers; i++) {
      if (addBot(room)) added++;
    }
    if (!added) return cb({ error: 'Salon complet ou limite de bots atteinte.' });
    broadcastState(room);
    cb({ ok: true, count: added });
  });

  socket.on('leaveRoom', () => leaveRoom(socket.id));

  // ---- mouvement ----
  socket.on('playerMove', (pos) => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room || room.phase !== 'playing' || !pos) return;
    const b = bodyOf(room, socket.id);
    if (!b) return;
    let { x, y, z, ry } = pos;
    x = Number(x); y = Number(y); z = Number(z); ry = Number(ry);
    if (![x, y, z, ry].every(Number.isFinite)) return;
    const r = Math.hypot(x, z);
    if (r > PLAY_RADIUS + 2) { x *= PLAY_RADIUS / r; z *= PLAY_RADIUS / r; }
    b.x = x; b.z = z; b.y = Math.max(0, Math.min(6, y)); b.ry = ry;
    socket.to(room.id).emit('bodyMoved', { bodyId: b.id, x: b.x, y: b.y, z: b.z, ry: b.ry });
  });

  // ---- combat ----
  socket.on('attack', (data) => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room || room.phase !== 'playing') return;
    const attacker = bodyOf(room, socket.id);
    const target = room.bodies.find(b => b.id === (data || {}).targetBodyId);
    if (!attacker || !target || !target.alive || target.id === attacker.id) return;
    if (Date.now() - (attacker.lastAttackAt || 0) < 400) return;
    if (dist2d(attacker, target) > 6) return;
    attacker.lastAttackAt = Date.now();
    const dmg = WEAPON_DAMAGE[attacker.weapon] || 12; // dégâts autoritaires côté serveur
    applyDamage(room, target, dmg, socket.id);
  });

  // ---- coffres / ressources / pièges / craft ----
  socket.on('openChest', (chestId) => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room || room.phase !== 'playing') return;
    const b = bodyOf(room, socket.id);
    const chest = room.chests.find(c => c.id === chestId && !c.opened);
    if (!b || !chest || dist2d(b, chest) > 3.5) return;
    chest.opened = true;
    const roll = Math.random();
    let loot;
    if (roll < 0.14 && WEAPON_RANK[b.weapon] < 4) {
      b.weapon = 'hache de guerre'; loot = { label: '🪓 Hache de guerre !' };
    } else if (roll < 0.34 && WEAPON_RANK[b.weapon] < 2) {
      b.weapon = 'épée'; loot = { label: '⚔️ Épée trouvée !' };
    } else if (roll < 0.44) {
      b.weapon = 'arc renforcé'; loot = { label: '🏹 Arc renforcé !' };
    } else if (roll < 0.69) {
      b.hp = Math.min(b.maxHp, b.hp + 40); loot = { label: '❤️ +40 PV' };
      for (const s of roomSockets(room)) io.to(s).emit('bodyDamaged', { bodyId: b.id, hp: b.hp, maxHp: b.maxHp });
    } else if (roll < 0.84) {
      b.resources.bois += 3; b.resources.pierre += 2; loot = { label: '🪵🪨 Ressources (+3 bois, +2 pierres)' };
    } else if (roll < 0.94) {
      loot = { label: '⚡ Boost de vitesse !' };
      socket.emit('speedBoost', { durationMs: 6000, factor: 1.5 });
    } else {
      const su = socketUser.get(socket.id);
      if (su) { su.user.currency += 15; saveDB(); }
      loot = { label: '💎 +15 Cristaux !' };
    }
    const su = socketUser.get(socket.id);
    if (su) { su.user.stats.chestsOpened++; saveDB(); }
    for (const s of roomSockets(room)) io.to(s).emit('chestOpened', { chestId: chest.id, by: socket.id, loot });
    broadcastState(room);
  });

  socket.on('gatherResource', (nodeId) => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room || room.phase !== 'playing') return;
    const b = bodyOf(room, socket.id);
    const node = room.resources.find(n => n.id === nodeId && n.available);
    if (!b || !node || dist2d(b, node) > 3.5) return;
    node.available = false;
    node.respawnAt = Date.now() + 30000;
    const amount = 2 + Math.floor(Math.random() * 2);
    b.resources[node.type] = (b.resources[node.type] || 0) + amount;
    for (const s of roomSockets(room)) io.to(s).emit('resourceGathered', { nodeId: node.id, by: socket.id });
    socket.emit('notification', { type: 'good', text: `+${amount} ${node.type === 'bois' ? '🪵 bois' : '🪨 pierre'}` });
    broadcastState(room);
  });

  socket.on('placeTrap', (pos, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room || room.phase !== 'playing') return cb({ error: 'Aucune partie en cours.' });
    const b = bodyOf(room, socket.id);
    if (!b) return cb({ error: 'Tu n\'as pas de corps actif.' });
    if ((b.resources.bois || 0) < 3 || (b.resources.pierre || 0) < 2) {
      return cb({ error: 'Il faut 3 🪵 et 2 🪨 pour poser un piège.' });
    }
    if (room.traps.filter(t => t.ownerId === socket.id).length >= 4) {
      return cb({ error: 'Maximum 4 pièges simultanés.' });
    }
    b.resources.bois -= 3; b.resources.pierre -= 2;
    const trap = { id: 't' + Date.now() + Math.floor(Math.random() * 999), x: Number(pos.x) || b.x, z: Number(pos.z) || b.z, ownerId: socket.id };
    room.traps.push(trap);
    for (const s of roomSockets(room)) io.to(s).emit('trapPlaced', trap);
    broadcastState(room);
    cb({ ok: true });
  });

  socket.on('craftItem', (recipeId, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room || room.phase !== 'playing') return cb({ error: 'Aucune partie en cours.' });
    const b = bodyOf(room, socket.id);
    const recipe = RECIPES[recipeId];
    if (!b || !recipe) return cb({ error: 'Recette inconnue.' });
    if ((b.resources.bois || 0) < recipe.cost.bois || (b.resources.pierre || 0) < recipe.cost.pierre) {
      return cb({ error: 'Ressources insuffisantes.' });
    }
    b.resources.bois -= recipe.cost.bois;
    b.resources.pierre -= recipe.cost.pierre;
    b.weapon = recipe.label;
    broadcastState(room);
    cb({ ok: true, crafted: recipe.label });
  });

  // ---- divers ----
  socket.on('emote', (emoteId) => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room) return;
    const b = room.bodies.find(x => room.controllerOf[x.id] === socket.id);
    if (!b) return;
    const su = socketUser.get(socket.id);
    if (su && su.user.ownedCosmetics.includes('emote_' + emoteId) === false && !['wave', 'dance'].includes(emoteId)) return;
    socket.to(room.id).emit('playerEmote', { bodyId: b.id, emoteId });
  });

  // [FIX] Anti-spam chat : 5 messages max / 10 secondes
  socket.on('chatMessage', (text) => {
    const su = socketUser.get(socket.id);
    const room = rooms.get(socketRoom.get(socket.id));
    if (!su || !room) return;
    if (su.user.muted) { socket.emit('notification', { type: 'bad', text: 'Tu es muet (muté par un modérateur).' }); return; }
    const now = Date.now();
    const chatTimes = (socket.data.chatTimes || []).filter(t => now - t < 10000);
    if (chatTimes.length >= 5) {
      socket.emit('notification', { type: 'bad', text: 'Trop de messages, ralentis !' });
      return;
    }
    chatTimes.push(now);
    socket.data.chatTimes = chatTimes;
    const clean = String(text).slice(0, 200).trim();
    if (!clean) return;
    io.to(room.id).emit('chatMessage', { username: su.user.username, text: clean });
  });

  // ---- chat vocal (signalisation WebRTC uniquement) ----
  socket.on('voice:join', () => {
    const roomId = socketRoom.get(socket.id);
    if (!roomId) return;
    socket.data.voiceRoom = roomId;
    socket.to(roomId).emit('voice:peer-joined', { socketId: socket.id });
  });
  socket.on('voice:signal', ({ to, data } = {}) => {
    if (!to || !io.sockets.sockets.has(to)) return;
    if (socket.data.voiceRoom !== socketRoom.get(to)) return;
    io.to(to).emit('voice:signal', { from: socket.id, data });
  });
  socket.on('voice:leave', () => {
    const roomId = socket.data.voiceRoom;
    if (roomId) socket.to(roomId).emit('voice:peer-left', { socketId: socket.id });
    socket.data.voiceRoom = null;
  });

  socket.on('disconnect', () => {
    const su = socketUser.get(socket.id);
    if (su) {
      onlineUsers.delete(su.username);
      socketUser.delete(socket.id);
    }
    leaveRoom(socket.id);
  });
});

// ============================== DEMARRAGE ===================================

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Swap or Die — serveur démarré sur le port ${PORT}`);
  console.log(`Joueurs enregistrés : ${Object.keys(db.users).length}`);
});
