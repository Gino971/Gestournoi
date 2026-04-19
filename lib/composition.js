// Composition module for manual first-round composition.
// Init with an API object providing access to app state and helpers.
export function initComposition (api) {
  const compOverlay = document.getElementById('composition-overlay')
  const compAvailableList = document.getElementById('comp-available-list')
  const compArrangedList = document.getElementById('comp-arranged-list')
  const compValidateBtn = document.getElementById('comp-validate')
  const compCancelBtn = document.getElementById('comp-cancel')

  let compositionPreviewBackup = null

  async function openCompositionModal () {
    if (!compOverlay) return
    let avail = (api.getListeTournoi() || []).filter(n => n && String(n).trim() !== '')
    try {
      if (typeof api.getMode === 'function' && api.getMode() === 'exclu') {
        const exclusArr = (await api.getExclusTournoi()) || []
        const exclSet = new Set((exclusArr || []).filter(Boolean))
        avail = avail.filter(n => !exclSet.has(n))
        // In 'exclu' mode we want to ensure scores are reset to a clean
        // initial state so the Saisie/Feuille UI reflects zeroed values.
        try {
          const initScores = (api.getListeTournoi() || []).map(n => [n, 0])
          await api.setScoresTournoi(initScores)
          try { if (typeof api.renderFeuilleSoiree === 'function') await api.renderFeuilleSoiree() } catch (_e) {}
          try { if (typeof api.updateRotationsDisplay === 'function') await api.updateRotationsDisplay() } catch (_e) {}
        } catch (_e) {
          // Do not block composition if score reset fails; log silently.
          console.warn('composition: failed to reset scores on open (exclu)', _e)
        }
      }
    } catch (_e) {}
    if (compAvailableList) compAvailableList.innerHTML = avail.map((n) => {
      const isMort = String(n).toUpperCase().startsWith('MORT')
      const cls = isMort ? 'comp-item mort' : 'comp-item'
      return `<div class="${cls}" data-nom="${encodeURIComponent(n)}">${n}</div>`
    }).join('')
    if (compArrangedList) compArrangedList.innerHTML = ''
    compOverlay.classList.remove('hidden')
    try { compOverlay.focus() } catch (_e) {}
    try { await syncCompositionToPlan() } catch (_e) {}
  }

  function closeCompositionModal () {
    if (!compOverlay) return
    compOverlay.classList.add('hidden')
    try {
      if (compositionPreviewBackup) {
        api.setDernierFullTirage(compositionPreviewBackup.dernierFullTirage)
        api.setDernierDictRotations(compositionPreviewBackup.dernierDictRotations)
        compositionPreviewBackup = null
      }
    } catch (_e) {}
    try { api.updateRotationsDisplay() } catch (_e) {}
  }

  async function syncCompositionToPlan () {
    try {
      if (!compArrangedList) return
      const arranged = Array.from(compArrangedList.querySelectorAll('.comp-item')).map(el => decodeURIComponent(el.dataset.nom || ''))
      let remaining = (api.getListeTournoi() || []).filter(n => n && !arranged.includes(n))
      try {
        if (typeof api.getMode === 'function' && api.getMode() === 'exclu') {
          const exclusArr = (await api.getExclusTournoi()) || []
          const exclSet = new Set((exclusArr || []).filter(Boolean))
          remaining = remaining.filter(n => !exclSet.has(n))
        }
      } catch (_e) {}
      const fullOrder = [...arranged, ...remaining]

      const exclusArr = await api.getExclusTournoi().catch(() => [])
      const exclSet = new Set((exclusArr || []).filter(Boolean))
      const baseOrder = (Array.isArray(api.getDernierFullTirage()) && api.getDernierFullTirage().length)
        ? api.getDernierFullTirage().map(p => p.nom)
        : (api.getListeTournoi() || [])

      let previewFullTirage = []
      const ordered = fullOrder.slice()
      const mortNames = ordered.filter(n => String(n || '').toUpperCase().startsWith('MORT'))

      if (exclSet && exclSet.size > 0) {
        let ptr = 0
        for (let i = 0; i < baseOrder.length; i++) {
          const name = baseOrder[i]
          if (exclSet.has(name)) {
            previewFullTirage.push({ nom: name, numero: previewFullTirage.length + 1 })
          } else {
            const nm = fullOrder[ptr++] || name
            previewFullTirage.push({ nom: nm, numero: previewFullTirage.length + 1 })
          }
        }
        while (ptr < fullOrder.length) previewFullTirage.push({ nom: fullOrder[ptr++], numero: previewFullTirage.length + 1 })
      } else if (mortNames.length > 0) {
        const pool = ordered.filter(n => !String(n || '').toUpperCase().startsWith('MORT'))
        const totalPlayers = ordered.length
        const nbTables = Math.max(1, Math.ceil(totalPlayers / 4))
        const totalSeats = nbTables * 4

        const seats = new Array(totalSeats).fill(null)
        for (let i = 0; i < mortNames.length; i++) {
          const tableIdx = nbTables - mortNames.length + i
          const seatIndex = Math.max(0, tableIdx) * 4
          if (seatIndex < totalSeats) seats[seatIndex] = mortNames[i]
        }
        let p = 0
        for (let s = 0; s < totalSeats; s++) {
          if (seats[s]) continue
          seats[s] = pool[p++] || null
        }
        previewFullTirage = seats.map((nom, idx) => ({ nom: nom, numero: idx + 1 }))
      } else {
        let ptr = 0
        for (let i = 0; i < baseOrder.length; i++) {
          const name = baseOrder[i]
          const nm = fullOrder[ptr++] || name
          previewFullTirage.push({ nom: nm, numero: previewFullTirage.length + 1 })
        }
        while (ptr < fullOrder.length) previewFullTirage.push({ nom: fullOrder[ptr++], numero: previewFullTirage.length + 1 })
      }

      if (!compositionPreviewBackup) {
        compositionPreviewBackup = { dernierFullTirage: api.getDernierFullTirage(), dernierDictRotations: api.getDernierDictRotations() }
      }

      try {
        const exclus = await api.getExclusTournoi()
        const nbPartiesToPlan = (document.getElementById('cb-serpentin') && document.getElementById('cb-serpentin').checked && Number(document.getElementById('nb-parties').value || 1) > 1) ? Number(document.getElementById('nb-parties').value || 1) - 1 : Number(document.getElementById('nb-parties').value || 1)
        const dict = api.buildDictRotationsWithExclus(previewFullTirage, exclus, nbPartiesToPlan)
        api.setDernierFullTirage(previewFullTirage)
        api.setDernierDictRotations(dict)
        await api.updateRotationsDisplay()
        try { if (typeof api.mettreAJourSelectRotationsEtTables === 'function') await api.mettreAJourSelectRotationsEtTables() } catch (_e) {}
      } catch (e) {
        console.warn('syncCompositionToPlan failed', e)
      }
    } catch (e) {
      console.warn('syncCompositionToPlan outer failed', e)
    }
  }

  if (compAvailableList && compArrangedList) {
    compAvailableList.addEventListener('click', (ev) => {
      const it = ev.target.closest('.comp-item')
      if (!it) return
      const name = decodeURIComponent(it.dataset.nom || '')
      const placed = document.createElement('div')
      placed.className = 'comp-item placed'
      placed.dataset.nom = encodeURIComponent(name)
      placed.textContent = name
      compArrangedList.appendChild(placed)
      it.remove()
      try { syncCompositionToPlan() } catch (_e) {}
    })

    compArrangedList.addEventListener('click', (ev) => {
      const it = ev.target.closest('.comp-item')
      if (!it) return
      const name = decodeURIComponent(it.dataset.nom || '')
      const back = document.createElement('div')
      back.className = 'comp-item'
      back.dataset.nom = encodeURIComponent(name)
      back.textContent = name
      compAvailableList.appendChild(back)
      it.remove()
      try { syncCompositionToPlan() } catch (_e) {}
    })
  }

  if (compCancelBtn) compCancelBtn.addEventListener('click', closeCompositionModal)

  if (compValidateBtn) compValidateBtn.addEventListener('click', async () => {
    const arranged = Array.from(compArrangedList.querySelectorAll('.comp-item')).map(el => decodeURIComponent(el.dataset.nom || ''))
    if (!arranged.length) {
      api.showAlert('Aucune composition fournie — annulation')
      closeCompositionModal()
      return
    }

    let remaining = (api.getListeTournoi() || []).filter(n => n && !arranged.includes(n))
    try {
      if (typeof api.getMode === 'function' && api.getMode() === 'exclu') {
        const exclusArr = (await api.getExclusTournoi()) || []
        const exclSet = new Set((exclusArr || []).filter(Boolean))
        remaining = remaining.filter(n => !exclSet.has(n))
      }
    } catch (_e) {}
    const fullOrder = [...arranged, ...remaining]

    const exclusArr = await api.getExclusTournoi().catch(() => [])
    const exclSet = new Set((exclusArr || []).filter(Boolean))
    const baseOrder = (Array.isArray(api.getDernierFullTirage()) && api.getDernierFullTirage().length) ? api.getDernierFullTirage().map(p => p.nom) : (api.getListeTournoi() || [])

    const composed = [...fullOrder]
    const mortNamesFinal = composed.filter(n => String(n || '').toUpperCase().startsWith('MORT'))

    let full = []
    if (exclSet && exclSet.size > 0) {
      const finalOrder = []
      let ptr = 0
      for (let i = 0; i < baseOrder.length; i++) {
        const name = baseOrder[i]
        if (exclSet.has(name)) finalOrder.push(name)
        else finalOrder.push(fullOrder[ptr++] || name)
      }
      while (ptr < fullOrder.length) finalOrder.push(fullOrder[ptr++])
      full = finalOrder.map((nm, idx) => ({ nom: nm, numero: idx + 1 }))
    } else if (mortNamesFinal.length > 0) {
      const pool = composed.filter(n => !String(n || '').toUpperCase().startsWith('MORT'))
      const totalPlayers = composed.length
      const nbTables = Math.max(1, Math.ceil(totalPlayers / 4))
      const totalSeats = nbTables * 4
      const seats = new Array(totalSeats).fill(null)
      for (let i = 0; i < mortNamesFinal.length; i++) {
        const tableIdx = nbTables - mortNamesFinal.length + i
        const seatIndex = Math.max(0, tableIdx) * 4
        if (seatIndex < totalSeats) seats[seatIndex] = mortNamesFinal[i]
      }
      let p = 0
      for (let s = 0; s < totalSeats; s++) {
        if (seats[s]) continue
        seats[s] = pool[p++] || null
      }
      full = seats.map((nom, idx) => ({ nom: nom, numero: idx + 1 }))
    } else {
      const finalOrder = []
      let ptr = 0
      for (let i = 0; i < baseOrder.length; i++) {
        const name = baseOrder[i]
        if (exclSet.has(name)) finalOrder.push(name)
        else finalOrder.push(fullOrder[ptr++] || name)
      }
      while (ptr < fullOrder.length) finalOrder.push(fullOrder[ptr++])
      full = finalOrder.map((nm, idx) => ({ nom: nm, numero: idx + 1 }))
    }

    api.setDernierFullTirage(full)
    try { localStorage.setItem('tarot_full_tirage', JSON.stringify(api.getDernierFullTirage())) } catch (_e) {}

    try {
      api.setListeTournoi(full.map(p => p.nom))
      api.renderListeTournoi()
      await api.renderListeGenerale()
      api.scheduleSaveListeTournoi()
    } catch (e) { console.warn('Failed to update listeTournoi from manual composition', e) }

    try {
      const initScores = api.getListeTournoi().map(nom => [nom, 0])
      await api.setScoresTournoi(initScores)
    } catch (e) { console.warn('Failed to set initial scores from composition', e) }

    try {
      const excluArr = await api.getExclusTournoi()
      const nbPartiesToPlan = (document.getElementById('cb-serpentin') && document.getElementById('cb-serpentin').checked && Number(document.getElementById('nb-parties').value || 1) > 1) ? Number(document.getElementById('nb-parties').value || 1) - 1 : Number(document.getElementById('nb-parties').value || 1)
      api.setDernierDictRotations(api.buildDictRotationsWithExclus(api.getDernierFullTirage(), excluArr, nbPartiesToPlan))
      try { await api.applyExclusToRotations(excluArr) } catch (_e) {}
    } catch (e) { console.warn('Failed to build rotations from manual composition', e) }

    try { await api.saveTirage(full) } catch (_e) {}
    try { await api.updateRotationsDisplay() } catch (_e) {}

    try { api.clearAllLucky() } catch (_e) {}
    try { await api.renderFeuilleSoiree() } catch (_e) {}
    try { await api.updateLuckyButtonState() } catch (_e) {}

    compositionPreviewBackup = null
    closeCompositionModal()
  })

  return { openCompositionModal, closeCompositionModal, syncCompositionToPlan }
}

export default { initComposition }

// Diagnostic helper: expose a simple check to the page for quick debugging
try {
  if (typeof window !== 'undefined') {
    window.__compSelfTest = async function () {
      try {
        const res = {
          nodes: {
            compositionOverlay: !!document.getElementById('composition-overlay'),
            compAvailableList: !!document.getElementById('comp-available-list'),
            compArrangedList: !!document.getElementById('comp-arranged-list')
          },
          functions: {}
        }
        // Probe api if available via initComposition (it won't be if module not initialized)
        const hasApi = typeof window.initCompositionApi !== 'undefined'
        res.functions.hasApi = hasApi
        if (hasApi) {
          const api = window.initCompositionApi
          res.functions.getMode = typeof api.getMode === 'function'
          res.functions.getExclusTournoi = typeof api.getExclusTournoi === 'function'
          res.functions.getScoresTournoi = typeof api.getScoresTournoi === 'function'
          try {
            const excl = await api.getExclusTournoi().catch(() => null)
            res.exclus = excl
            const scores = await api.getScoresTournoi().catch(() => null)
            res.scoresSample = Array.isArray(scores) ? (scores.slice(0,5)) : scores
          } catch (_e) { /* ignore */ }
        }
        return res
      } catch (e) {
        return { error: String(e) }
      }
    }
  }
} catch (_e) {}
