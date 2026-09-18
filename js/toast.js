// public/js/toast.js — système de notifications ("toasts") léger, sans dépendance.
// Remplace les alert() natifs pour un feedback qui colle au thème du jeu.
// Usage : showToast('Message', 'success' | 'error' | 'warning' | 'info', dureeMs?)

(function () {
  const ICONS = { success: '✅', error: '⚠️', warning: '⏳', info: 'ℹ️' };
  const DEFAULT_DURATION = 4200;

  function getContainer() {
    let c = document.getElementById('toastContainer');
    if (!c) {
      c = document.createElement('div');
      c.id = 'toastContainer';
      c.setAttribute('aria-live', 'polite');
      document.body.appendChild(c);
    }
    return c;
  }

  function showToast(message, type, duration) {
    type = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
    duration = typeof duration === 'number' ? duration : DEFAULT_DURATION;

    const container = getContainer();
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML =
      '<span class="toast-icon">' + (ICONS[type] || ICONS.info) + '</span>' +
      '<span class="toast-msg"></span>' +
      '<button type="button" class="toast-close" aria-label="Fermer">✕</button>';
    el.querySelector('.toast-msg').textContent = message; // évite toute injection HTML
    container.appendChild(el);

    let dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 220);
    }

    el.querySelector('.toast-close').addEventListener('click', dismiss);
    if (duration > 0) setTimeout(dismiss, duration);
    return dismiss;
  }

  window.showToast = showToast;
})();
