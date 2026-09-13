/* Shared loading states. Initial placeholders also ship in HTML for first paint. */
(function () {
  'use strict';
  const buttons = new WeakMap();
  const bar = (kind = '') => `<span class="skeleton-pulse loading-bar ${kind}"></span>`;
  const lines = () => `<div class="loading-lines">${bar('loading-bar-title')}${bar()}${bar('loading-bar-short')}</div>`;
  const card = () => `<div class="loading-card"><div class="loading-card-top">${bar('loading-chip')}${bar('loading-bar-short')}</div>${lines()}<div class="loading-card-footer">${bar('loading-chip')}${bar('loading-chip')}</div></div>`;
  function cards(count = 3, kind = '') {
    return `<div class="loading-placeholder" role="status"><span class="loading-sr">Loading content…</span><div class="loading-cards ${kind}" aria-hidden="true">${Array.from({ length: count }, card).join('')}</div></div>`;
  }
  function header() {
    return `<div class="header-inner loading-header" aria-hidden="true"><div class="header-brand">${bar('loading-avatar')}<div class="brand-text loading-lines">${bar('loading-brand-title')}${bar('loading-brand-sub')}</div></div><div class="header-right"><div class="header-clock loading-lines">${bar()}${bar()}</div>${bar('loading-header-button')}</div></div>`;
  }
  function nav() {
    return `<div aria-hidden="true">${Array.from({ length: 5 }, () => `<span class="nav-item loading-nav-item">${bar('loading-nav-icon')}${bar('loading-nav-label')}</span>`).join('')}</div>`;
  }
  function finish(group) {
    document.querySelectorAll(`[data-loading-region="${group}"], [data-loading-cover="${group}"]`).forEach(element => {
      element.querySelectorAll('.loading-placeholder, .loading-cover, .loading-lines, .skel-week-day').forEach(placeholder => placeholder.remove());
      if (element.hasAttribute('data-loading-cover')) element.removeAttribute('inert');
      element.removeAttribute('data-loading-region');
      element.removeAttribute('data-loading-cover');
      element.removeAttribute('aria-busy');
    });
  }
  function button(element, busy) {
    if (!element) return;
    if (busy) {
      if (buttons.has(element)) return;
      buttons.set(element, {
        disabled: element.disabled,
        busy: element.getAttribute('aria-busy'),
        label: element.getAttribute('aria-label')
      });
      element.disabled = true;
      element.setAttribute('aria-busy', 'true');
      element.setAttribute('aria-label', `${element.getAttribute('aria-label') || element.textContent.trim()}. Please wait.`);
      element.classList.add('btn-spinner');
    } else {
      const previous = buttons.get(element);
      if (!previous) return;
      element.classList.remove('btn-spinner');
      element.disabled = previous.disabled;
      for (const [name, value] of [['aria-busy', previous.busy], ['aria-label', previous.label]]) {
        if (value === null) element.removeAttribute(name);
        else element.setAttribute(name, value);
      }
      buttons.delete(element);
    }
  }
  async function action(element, work) {
    if (element?.disabled || buttons.has(element)) return;
    button(element, true);
    try { return await work(); }
    finally { button(element, false); }
  }
  // Navigation may restore the document from the back/forward cache.
  window.addEventListener('pageshow', event => {
    if (event.persisted) document.querySelectorAll('.btn-spinner').forEach(element => button(element, false));
  });
  window.QCULoading = Object.freeze({ bar, lines, cards, header, nav, finish, button, action });
})();
