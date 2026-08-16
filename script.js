// ===========================================================
// Our Home — shared site behavior
// ===========================================================

document.addEventListener('DOMContentLoaded', () => {
  // Footer year
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = new Date().getFullYear();
  });

  // Mobile nav toggle
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.main-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
  }

  // ---------------- Application form ----------------
  const form = document.getElementById('applicationForm');
  if (form) {
    const successPanel = document.getElementById('applicationSuccess');

    const validators = {
      required(field) {
        return field.value.trim().length > 0;
      },
      email(field) {
        if (!field.value.trim()) return true; // optional unless also required
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value.trim());
      },
      tel(field) {
        if (!field.value.trim()) return true;
        return field.value.replace(/\D/g, '').length >= 7;
      },
    };

    function fieldWrap(el) {
      return el.closest('.field');
    }

    function setError(el, show) {
      const wrap = fieldWrap(el);
      if (!wrap) return;
      wrap.classList.toggle('has-error', show);
    }

    function validateField(el) {
      let ok = true;
      if (el.hasAttribute('required') && !validators.required(el)) ok = false;
      if (ok && el.type === 'email' && !validators.email(el)) ok = false;
      if (ok && el.type === 'tel' && !validators.tel(el)) ok = false;
      if (ok && el.type === 'checkbox' && el.hasAttribute('required') && !el.checked) ok = false;
      setError(el, !ok);
      return ok;
    }

    form.querySelectorAll('input, select, textarea').forEach((el) => {
      el.addEventListener('blur', () => validateField(el));
      el.addEventListener('input', () => {
        if (fieldWrap(el) && fieldWrap(el).classList.contains('has-error')) {
          validateField(el);
        }
      });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fields = Array.from(form.querySelectorAll('input, select, textarea'));
      let allValid = true;
      let firstInvalid = null;

      fields.forEach((el) => {
        const valid = validateField(el);
        if (!valid) {
          allValid = false;
          if (!firstInvalid) firstInvalid = el;
        }
      });

      if (!allValid) {
        if (firstInvalid) {
          firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
          firstInvalid.focus({ preventScroll: true });
        }
        return;
      }

      // Preview-mode "submission" — no backend is connected yet.
      // Fill in the applicant's name on the success screen for a nice touch.
      const nameField = form.querySelector('#app-full-name');
      const nameSpan = document.getElementById('successApplicantName');
      if (nameField && nameSpan) {
        const first = nameField.value.trim().split(/\s+/)[0] || '';
        nameSpan.textContent = first ? `, ${first}` : '';
      }

      form.style.display = 'none';
      if (successPanel) {
        successPanel.classList.add('visible');
        successPanel.setAttribute('tabindex', '-1');
        successPanel.focus();
        successPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    const startOverBtn = document.getElementById('applyAnother');
    if (startOverBtn) {
      startOverBtn.addEventListener('click', () => {
        form.reset();
        form.style.display = '';
        if (successPanel) successPanel.classList.remove('visible');
        form.querySelectorAll('.has-error').forEach((el) => el.classList.remove('has-error'));
        window.scrollTo({ top: form.getBoundingClientRect().top + window.scrollY - 120, behavior: 'smooth' });
      });
    }
  }
});
