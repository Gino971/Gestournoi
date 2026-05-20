// Dialogs shim for the frontend server (mirrors ../lib/dialogs.js)
export async function _showCustomDialog (message, buttons) {
  return new Promise((resolve) => {
    try {
      const overlay = document.getElementById('custom-dialog-overlay')
      const msgEl = document.getElementById('custom-dialog-message')
      const btnContainer = document.getElementById('custom-dialog-buttons')
      if (!overlay || !msgEl || !btnContainer) {
        resolve(0)
        return
      }
      msgEl.textContent = message
      btnContainer.innerHTML = ''
      btnContainer.className = 'custom-dialog-buttons'

      buttons.forEach((b, i) => {
        const btn = document.createElement('button')
        btn.textContent = b.label || b
        btn.className = b.cls || 'custom-dialog-btn-primary'
        btn.addEventListener('click', () => { close(i) })
        btnContainer.appendChild(btn)
      })

      overlay.classList.remove('hidden')
      const first = btnContainer.querySelector('button')
      if (first) first.focus()

      function onKey (e) { if (e.key === 'Escape') close(buttons.length - 1) }
      document.addEventListener('keydown', onKey)

      function close (idx) { document.removeEventListener('keydown', onKey); overlay.classList.add('hidden'); resolve(idx) }
    } catch (err) {
      try {
        if (Array.isArray(buttons) && buttons.length >= 2) {
          const ok = window.confirm(message)
          resolve(ok ? 1 : 0)
        } else {
          window.alert(message)
          resolve(0)
        }
      } catch (_e) { resolve(0) }
    }
  })
}

export async function askConfirm (message) {
  try {
    if (window && window.electronAPI && typeof window.electronAPI.confirm === 'function') {
      const res = await window.electronAPI.confirm(message)
      return !!res
    }
  } catch (_e) {}

  const dialogBtns = [
    { label: 'Non', cls: 'custom-dialog-btn-secondary' },
    { label: 'Oui', cls: 'custom-dialog-btn-primary' }
  ]
  const idx = await _showCustomDialog(message, dialogBtns)
  return idx === 1
}

export async function askTextInput (message, initialValue = '', options = {}) {
  return new Promise((resolve) => {
    try {
      const overlay = document.getElementById('custom-dialog-overlay')
      const msgEl = document.getElementById('custom-dialog-message')
      const btnContainer = document.getElementById('custom-dialog-buttons')
      if (!overlay || !msgEl || !btnContainer) {
        resolve(null)
        return
      }

      const input = document.createElement('input')
      input.type = options.type || 'text'
      input.value = initialValue || ''
      input.placeholder = options.placeholder || ''
      input.className = 'custom-dialog-input'

      const cancelBtn = document.createElement('button')
      cancelBtn.textContent = options.cancelLabel || 'Annuler'
      cancelBtn.className = 'custom-dialog-btn-secondary'

      const confirmBtn = document.createElement('button')
      confirmBtn.textContent = options.confirmLabel || 'Valider'
      confirmBtn.className = 'custom-dialog-btn-primary'

      msgEl.textContent = message
      msgEl.appendChild(input)
      btnContainer.innerHTML = ''
      btnContainer.className = 'custom-dialog-buttons'
      btnContainer.appendChild(cancelBtn)
      btnContainer.appendChild(confirmBtn)

      overlay.classList.remove('hidden')

      const onKey = (e) => {
        if (e.key === 'Escape') close(null)
        if (e.key === 'Enter') close(input.value)
      }

      const close = (value) => {
        document.removeEventListener('keydown', onKey)
        overlay.classList.add('hidden')
        resolve(value)
      }

      cancelBtn.addEventListener('click', () => close(null))
      confirmBtn.addEventListener('click', () => close(input.value))
      document.addEventListener('keydown', onKey)

      requestAnimationFrame(() => {
        input.focus()
        input.select()
      })
    } catch (_err) {
      resolve(null)
    }
  })
}

export default { _showCustomDialog, askConfirm, askTextInput }
