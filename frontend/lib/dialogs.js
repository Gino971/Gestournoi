// Centralized dialog helpers used by the renderer.
// These wrappers prefer Electron APIs when available and fall back
// to the custom HTML dialog components in index.html.

function getDialogNodes () {
  const overlay = document.getElementById('custom-dialog-overlay')
  const msgEl = document.getElementById('custom-dialog-message')
  const btnContainer = document.getElementById('custom-dialog-buttons')
  return { overlay, msgEl, btnContainer }
}

export function _showCustomDialog (message, buttons = [{ label: 'OK', cls: 'custom-dialog-btn-primary' }]) {
  return new Promise((resolve) => {
    try {
      const { overlay, msgEl, btnContainer } = getDialogNodes()
      if (!overlay || !msgEl || !btnContainer) {
        // Last-resort fallback to native alert/confirm semantics.
        if (buttons.length === 2) {
          const ok = window.confirm(String(message || ''))
          resolve(ok ? 0 : 1)
          return
        }
        window.alert(String(message || ''))
        resolve(0)
        return
      }

      msgEl.textContent = String(message || '')
      btnContainer.innerHTML = ''
      btnContainer.className = 'custom-dialog-buttons'

      const cleanupListeners = []

      const close = (index) => {
        try {
          cleanupListeners.forEach((fn) => fn())
          overlay.classList.add('hidden')
        } catch (_e) {}
        resolve(index)
      }

      buttons.forEach((b, i) => {
        const btn = document.createElement('button')
        btn.textContent = b && b.label ? String(b.label) : `Option ${i + 1}`
        btn.className = (b && b.cls) ? String(b.cls) : 'custom-dialog-btn-primary'
        btn.addEventListener('click', () => close(i))
        btnContainer.appendChild(btn)
      })

      const onKey = (e) => {
        if (e.key === 'Escape') {
          // Prefer a cancel-style button when available, fallback to last button.
          close(Math.max(0, buttons.length - 1))
        }
      }
      document.addEventListener('keydown', onKey)
      cleanupListeners.push(() => document.removeEventListener('keydown', onKey))

      overlay.classList.remove('hidden')
      const first = btnContainer.querySelector('button')
      if (first) first.focus()
    } catch (_e) {
      try {
        if (buttons.length === 2) {
          const ok = window.confirm(String(message || ''))
          resolve(ok ? 0 : 1)
          return
        }
        window.alert(String(message || ''))
      } catch (_ignored) {}
      resolve(0)
    }
  })
}

export async function askConfirm (message, options = {}) {
  try {
    if (window.electronAPI && typeof window.electronAPI.confirm === 'function') {
      return !!(await window.electronAPI.confirm(String(message || '')))
    }
  } catch (_e) {}

  const yesLabel = options && options.yesLabel ? String(options.yesLabel) : 'Oui'
  const noLabel = options && options.noLabel ? String(options.noLabel) : 'Non'
  const idx = await _showCustomDialog(String(message || ''), [
    { label: yesLabel, cls: 'custom-dialog-btn-primary' },
    { label: noLabel, cls: 'custom-dialog-btn-secondary' }
  ])
  return idx === 0
}

export async function askTextInput (message, initialValue = '', options = {}) {
  return new Promise((resolve) => {
    try {
      const { overlay, msgEl, btnContainer } = getDialogNodes()
      if (!overlay || !msgEl || !btnContainer) {
        const value = window.prompt(String(message || ''), String(initialValue || ''))
        resolve(value)
        return
      }

      const input = document.createElement('input')
      input.type = options.type || 'text'
      input.value = String(initialValue || '')
      input.placeholder = options.placeholder || ''
      input.className = 'custom-dialog-input'

      const confirmBtn = document.createElement('button')
      confirmBtn.className = 'custom-dialog-btn-primary'
      confirmBtn.textContent = options.confirmLabel || 'Valider'

      const cancelBtn = document.createElement('button')
      cancelBtn.className = 'custom-dialog-btn-secondary'
      cancelBtn.textContent = options.cancelLabel || 'Annuler'

      msgEl.textContent = String(message || '')
      msgEl.appendChild(input)
      btnContainer.innerHTML = ''
      btnContainer.className = 'custom-dialog-buttons'
      btnContainer.appendChild(cancelBtn)
      btnContainer.appendChild(confirmBtn)

      const onKey = (e) => {
        if (e.key === 'Escape') close(null)
        if (e.key === 'Enter') close(input.value)
      }

      const close = (value) => {
        document.removeEventListener('keydown', onKey)
        try { overlay.classList.add('hidden') } catch (_e) {}
        resolve(value)
      }

      cancelBtn.addEventListener('click', () => close(null))
      confirmBtn.addEventListener('click', () => close(input.value))
      document.addEventListener('keydown', onKey)

      overlay.classList.remove('hidden')
      requestAnimationFrame(() => {
        input.focus()
        input.select()
      })
    } catch (_e) {
      resolve(null)
    }
  })
}
