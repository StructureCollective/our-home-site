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

    function getSubmitError() {
      let el = document.getElementById('applicationSubmitError');
      if (!el) {
        el = document.createElement('div');
        el.id = 'applicationSubmitError';
        el.className = 'field-error';
        el.style.display = 'none';
        el.style.marginBottom = '16px';
        el.style.fontSize = '14px';
        form.prepend(el);
      }
      return el;
    }

    function showSubmitError(message) {
      const el = getSubmitError();
      if (message) {
        el.textContent = message;
        el.style.display = 'block';
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        el.style.display = 'none';
      }
    }

    // Builds the JSON payload the /api/apply endpoint expects, handling
    // grouped checkboxes (daysAvailable, shiftPreference) as arrays and
    // single checkboxes (certifyAccurate, certifyVerify) as booleans.
    function buildPayload() {
      const data = new FormData(form);
      const payload = {};
      const multiFields = new Set(['daysAvailable', 'shiftPreference']);
      const checkboxFields = ['certifyAccurate', 'certifyVerify'];

      for (const key of new Set(data.keys())) {
        if (multiFields.has(key)) {
          payload[key] = data.getAll(key);
        } else {
          payload[key] = data.get(key);
        }
      }
      checkboxFields.forEach((key) => {
        const el = form.querySelector(`[name="${key}"]`);
        payload[key] = !!(el && el.checked);
      });
      return payload;
    }

    form.addEventListener('submit', async (e) => {
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

      showSubmitError('');
      const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      try {
        const res = await fetch('/api/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload()),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Something went wrong submitting your application. Please try again.');
        }

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
      } catch (err) {
        showSubmitError(err.message || 'Something went wrong submitting your application. Please try again.');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
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
