(function() {
  let tooltipIdCounter = 0;

  function initTooltips() {
    const targets = document.querySelectorAll('[data-tooltip]');
    targets.forEach(target => {
      if (target.dataset.tooltipInitialized) return;
      target.dataset.tooltipInitialized = "true";

      // Ensure focusable
      const nativelyFocusableTags = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'];
      const hasTabindex = target.hasAttribute('tabindex');
      const isNativelyFocusable = nativelyFocusableTags.includes(target.tagName);
      if (!hasTabindex && !isNativelyFocusable) {
        target.setAttribute('tabindex', '0');
      }

      let tooltipEl = null;
      let hideTimeout = null;
      let isHovered = false;
      let isFocused = false;

      function show(event) {
        if (event) {
          if (event.type === 'mouseenter') isHovered = true;
          if (event.type === 'focus') isFocused = true;
        }

        if (tooltipEl) {
          if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
            tooltipEl.classList.add('visible');
            
            // Re-apply accessibility attribute in case it was removed during hide transition
            const id = tooltipEl.id;
            const existingAria = target.getAttribute('aria-describedby');
            if (!existingAria || !existingAria.includes(id)) {
              if (existingAria) {
                target.dataset.originalAriaDescribedby = existingAria;
                target.setAttribute('aria-describedby', `${existingAria} ${id}`);
              } else {
                target.setAttribute('aria-describedby', id);
              }
            }
          }
          return;
        }

        tooltipEl = document.createElement('div');
        tooltipEl.className = 'tooltip-bubble';
        const id = `r2a-tooltip-${++tooltipIdCounter}`;
        tooltipEl.id = id;

        const textKey = target.getAttribute('data-tooltip');
        const translated = (typeof chrome !== 'undefined' && chrome.i18n)
          ? chrome.i18n.getMessage(textKey)
          : null;
        tooltipEl.innerText = translated || textKey;

        document.body.appendChild(tooltipEl);

        // Position
        const rect = target.getBoundingClientRect();
        const scrollY = window.scrollY;
        const scrollX = window.scrollX;

        const margin = 8;
        const viewportWidth = window.innerWidth;
        const tooltipWidth = tooltipEl.offsetWidth;

        const targetCenter = rect.left + scrollX + rect.width / 2;
        let left = targetCenter - tooltipWidth / 2;

        const minLeft = scrollX + margin;
        const maxLeft = scrollX + viewportWidth - tooltipWidth - margin;

        left = Math.max(minLeft, Math.min(maxLeft, left));
        const top = rect.top + scrollY - tooltipEl.offsetHeight - 8;

        tooltipEl.style.left = `${left}px`;
        tooltipEl.style.top = `${Math.max(scrollY + 4, top)}px`;

        // Arrow
        const arrow = document.createElement('div');
        arrow.className = 'tooltip-arrow';

        // Position the arrow relative to the tooltip bubble to point to targetCenter
        const arrowCenterInTooltip = targetCenter - left;
        let arrowLeft = arrowCenterInTooltip - 3; // 3px is half of 6px (arrow width)

        // Clamp the arrow within the tooltip's horizontal boundary (preserving border radius spacing)
        const minArrowLeft = 8;
        const maxArrowLeft = tooltipWidth - 8 - 6;
        arrowLeft = Math.max(minArrowLeft, Math.min(maxArrowLeft, arrowLeft));

        arrow.style.left = `${arrowLeft}px`;
        arrow.style.bottom = '-4px';
        tooltipEl.appendChild(arrow);

        // Accessibility wiring
        const existingAria = target.getAttribute('aria-describedby');
        if (existingAria) {
          target.dataset.originalAriaDescribedby = existingAria;
          target.setAttribute('aria-describedby', `${existingAria} ${id}`);
        } else {
          target.setAttribute('aria-describedby', id);
        }

        // Force reflow
        tooltipEl.offsetHeight;
        tooltipEl.classList.add('visible');
      }

      function hide(event) {
        if (event) {
          if (event.type === 'mouseleave') isHovered = false;
          if (event.type === 'blur') isFocused = false;
        }

        if (isHovered || isFocused) return;

        if (!tooltipEl) return;
        if (hideTimeout) return;

        // Restore/remove accessibility attribute immediately
        if (target.dataset.originalAriaDescribedby) {
          target.setAttribute('aria-describedby', target.dataset.originalAriaDescribedby);
          delete target.dataset.originalAriaDescribedby;
        } else {
          target.removeAttribute('aria-describedby');
        }

        tooltipEl.classList.remove('visible');
        hideTimeout = setTimeout(() => {
          if (tooltipEl) {
            tooltipEl.remove();
            tooltipEl = null;
          }
          hideTimeout = null;
        }, 150);
      }

      target.addEventListener('mouseenter', show);
      target.addEventListener('mouseleave', hide);
      target.addEventListener('focus', show);
      target.addEventListener('blur', hide);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTooltips);
  } else {
    initTooltips();
  }
  window.initR2ATooltips = initTooltips;
})();
