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
    compositionPreviewBackup = null
    if (!compOverlay) return
    let avail = (api.getListeTournoi() || []).filter(n => n && String(n).trim() !== '')
    let exclSet = new Set()
    try {
      const exclusArr = (await api.getExclusTournoi()) || []
      exclSet = new Set((exclusArr || []).filter(Boolean))
      try { if (typeof api.renderSaisie === 'function') await api.renderSaisie() } catch (_e) {}
      try { if (typeof api.renderFeuilleSoiree === 'function') await api.renderFeuilleSoiree() } catch (_e) {}
    } catch (_e) {
      console.warn('composition: failed to reset on open', _e)
    }
    if (compAvailableList) {
      const availForPlacement = avail.filter(n => {
        if (!n) return false
        if (String(n).toUpperCase().startsWith('MORT')) return false
        if (typeof exclSet !== 'undefined' && exclSet.has(n)) return false
        return true
      })
      compAvailableList.innerHTML = availForPlacement.map((n) => {
        const cls = 'comp-item'
        return `<div class="${cls}" data-nom="${encodeURIComponent(n)}">${n}</div>`
      }).join('')
    }
    if (compArrangedList) compArrangedList.innerHTML = ''
    compOverlay.classList.remove('hidden')
    try { compOverlay.focus() } catch (_e) {}
    try { await syncCompositionToPlan() } catch (_e) {}
  }

  // Retourne un tableau des tailles de table (4 ou 5) pour `totalPlayers`.
  // Cherche une combinaison exacte 4*n4 + 5*n5 == totalPlayers en minimisant
  // le nombre total de tables, puis réduit le nombre de tables de 5.
  function computeTableSizes (totalPlayers) {
    if (typeof totalPlayers !== 'number' || totalPlayers <= 0) return [4]
    const solutions = []
    const max5 = Math.floor(totalPlayers / 5)
    for (let n5 = 0; n5 <= max5; n5++) {
      const rem = totalPlayers - 5 * n5
      if (rem % 4 === 0) {
        const n4 = rem / 4
        if (n4 >= 0) solutions.push({ n4: Number(n4), n5: Number(n5), total: Number(n4 + n5) })
      }
    }
    if (solutions.length > 0) {
      // Choisir la solution avec le moins de tables, puis la moins de tables de 5
      solutions.sort((a, b) => (a.total - b.total) || (a.n5 - b.n5))
      const best = solutions[0]
      const sizes = []
      for (let i = 0; i < best.n4; i++) sizes.push(4)
      for (let i = 0; i < best.n5; i++) sizes.push(5)
      return sizes
    }

    // Aucun solution exacte trouvée (petits nombres), fallback: remplir
    // autant de tables de 4 que possible et mettre le reste dans la dernière
    // table (peut être 1-3 joueurs).
    const nbTables = Math.max(1, Math.ceil(totalPlayers / 4))
    const base = new Array(nbTables).fill(4)
    let seats = nbTables * 4
    let i = nbTables - 1
    while (seats > totalPlayers && i >= 0) {
      // réduire la dernière table si nous avons trop de places
      const overflow = seats - totalPlayers
      const reduceBy = Math.min(overflow, base[i] - 1) // keep at least 1
      base[i] = base[i] - reduceBy
      seats = seats - reduceBy
      i--
    }
    return base
  }

  // Force Morts at North of last tables (idempotent)
  function enforceMortsAtNorth (fullArr) {
    if (!Array.isArray(fullArr)) return fullArr
    const names = fullArr.map(p => (p && p.nom) || p)
    const mortNames = names.filter(n => String(n || '').toUpperCase().startsWith('MORT'))
    if (mortNames.length === 0) return fullArr
    const pool = names.filter(n => !String(n || '').toUpperCase().startsWith('MORT'))
    const totalPlayers = pool.length + mortNames.length
    // For Morts mode use only 4-seat tables (nbTables = ceil(total/4))
    let tableSizes
    if (mortNames.length > 0) {
      const nbTables = Math.max(1, Math.ceil(totalPlayers / 4))
      tableSizes = new Array(nbTables).fill(4)
      const last = totalPlayers - 4 * (nbTables - 1)
      tableSizes[nbTables - 1] = last
    } else {
      tableSizes = computeTableSizes(totalPlayers)
    }
    const nbTables = tableSizes.length
    const totalSeats = tableSizes.reduce((a, b) => a + b, 0)
    const tableStarts = []
    let off = 0
    for (let i = 0; i < tableSizes.length; i++) { tableStarts.push(off); off += tableSizes[i] }
    const seats = new Array(totalSeats).fill(null)
    for (let i = 0; i < mortNames.length; i++) {
      const tableIdx = Math.max(0, nbTables - mortNames.length + i)
      const seatIndex = tableStarts[tableIdx]
      if (typeof seatIndex === 'number' && seatIndex < totalSeats) seats[seatIndex] = mortNames[i]
    }
    // Fill remaining seats table by table in N,S,E,O order, skipping North if occupied by Mort.
    let p = 0
    for (let t = 0; t < tableSizes.length; t++) {
      const size = tableSizes[t]
      const start = tableStarts[t]
      const positions = []
      for (let pos = 0; pos < size; pos++) positions.push(pos)
      if (seats[start]) {
        const idx0 = positions.indexOf(0)
        if (idx0 >= 0) positions.splice(idx0, 1)
      }
      for (const pos of positions) {
        const idx = start + pos
        if (!seats[idx]) seats[idx] = pool[p++] || null
      }
    }
    return seats.map((nom, idx) => ({ nom: nom, numero: idx + 1 }))
  }

  // Place morts at North of last tables (Mort N -> last table north),
  // then fill remaining seats table by table in N,S,E,O order with provided players.
  function placeMortsAndFill (namesList) {
    if (!Array.isArray(namesList)) return []
    const names = namesList.slice()
    const mortNames = names.filter(n => String(n || '').toUpperCase().includes('MORT'))
    const pool = names.filter(n => !String(n || '').toUpperCase().includes('MORT'))
    const totalPlayers = pool.length + mortNames.length
    // For Morts mode use only 4-seat tables (nbTables = ceil(total/4))
    let tableSizes
    if (mortNames.length > 0) {
      const nbTables = Math.max(1, Math.ceil(totalPlayers / 4))
      tableSizes = new Array(nbTables).fill(4)
      const last = totalPlayers - 4 * (nbTables - 1)
      tableSizes[nbTables - 1] = last
    } else {
      tableSizes = computeTableSizes(totalPlayers)
    }
    const nbTables = tableSizes.length
    const totalSeats = tableSizes.reduce((a, b) => a + b, 0)

    const tableStarts = []
    let off = 0
    for (let i = 0; i < tableSizes.length; i++) { tableStarts.push(off); off += tableSizes[i] }

    const seats = new Array(totalSeats).fill(null)

    if (mortNames.length > 0) {
      // Try to sort morts by trailing number if present (Mort 1, Mort 2...)
      const mortObjs = mortNames.map(n => {
        const m = String(n).match(/(\d+)\s*$/)
        return { name: n, num: m ? Number(m[1]) : null }
      })
      mortObjs.sort((a, b) => {
        if (a.num === null && b.num === null) return 0
        if (a.num === null) return -1
        if (b.num === null) return 1
        return a.num - b.num
      })

      // Assign Mort 1..N to tables: Mort1 -> earlier of the last tables, MortN -> last table
      for (let i = 0; i < mortObjs.length; i++) {
        const tableIdx = Math.max(0, nbTables - mortObjs.length + i)
        const seatIndex = tableStarts[tableIdx]
        if (typeof seatIndex === 'number' && seatIndex < totalSeats) seats[seatIndex] = mortObjs[i].name
      }
    }

    // Fill remaining seats table by table in seat order N(0),S(1),E(2),O(3),(...)
    // If the north seat is occupied by a Mort, skip it (fill SEO).
    let p = 0
    for (let t = 0; t < nbTables; t++) {
      const size = tableSizes[t]
      const start = tableStarts[t]
      // build positions order for this table
      const positions = []
      for (let pos = 0; pos < size; pos++) positions.push(pos)
      // if north occupied, remove position 0 so order becomes [1,2,3,...]
      if (seats[start]) {
        const idx0 = positions.indexOf(0)
        if (idx0 >= 0) positions.splice(idx0, 1)
      }
      for (const pos of positions) {
        const idx = start + pos
        if (!seats[idx]) seats[idx] = pool[p++] || null
      }
    }

    return seats.map((nom, idx) => ({ nom: nom, numero: idx + 1 }))
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
      // fetch excluded players first so they are not offered/added to the composition
      const exclusArr = await api.getExclusTournoi().catch(() => [])
      const exclSet = new Set((exclusArr || []).filter(Boolean))
      // Remove excluded players from remaining so fullOrder contains only placeable players
      let remaining = (api.getListeTournoi() || []).filter(n => n && !arranged.includes(n) && !exclSet.has(n))
      const fullOrder = [...arranged, ...remaining]

      const baseOrder = (Array.isArray(api.getDernierFullTirage()) && api.getDernierFullTirage().length)
        ? api.getDernierFullTirage().map(p => p.nom)
        : (api.getListeTournoi() || [])

      let previewFullTirage = []
      const ordered = fullOrder.slice()
      const mortNames = ordered.filter(n => String(n || '').toUpperCase().startsWith('MORT'))

      if (exclSet && exclSet.size > 0) {
        // In exclu mode: include exclu at the end of previewFullTirage and set
        // seatIndex so buildDictRotationsWithExclus removes the right player each manche.
        let idx = 0
        previewFullTirage = (fullOrder || []).map(nm => ({ nom: nm, numero: ++idx }))
        Array.from(exclSet).forEach(nm => { previewFullTirage.push({ nom: nm, numero: ++idx }) })
        try {
          if (typeof api.setExcluSeatIndex === 'function') {
            const exclNorm = new Set(Array.from(exclSet).map(n => String(n || '').trim().toLowerCase()).filter(Boolean))
            const excluIdx = previewFullTirage.findIndex(p => exclNorm.has(String((p && p.nom) || '').trim().toLowerCase()))
            if (excluIdx >= 0) api.setExcluSeatIndex(excluIdx)
          }
        } catch (_e) {}
      } else if (mortNames.length > 0) {
          // Place Morts first (Mort N -> last table north), then fill remaining
          // seats per table in N,S,E,O order from the arranged+remaining list.
          previewFullTirage = placeMortsAndFill(ordered)
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
        // Filtre direct par manche : on retire l'exclu de previewFullTirage sans dépendre du seatIndex.
        const getNom = p => String((p && typeof p === 'object' ? (p.nom || '') : (p || ''))).trim().toLowerCase()
        let dict
        if (exclSet && exclSet.size > 0 && typeof api.calculRotationsRainbow === 'function') {
          const fbDict = {}
          let fbOk = true
          for (let r = 0; r < nbPartiesToPlan; r++) {
            const exNom = (exclus || [])[r] || null
            const exLow = exNom ? String(exNom).trim().toLowerCase() : null
            const active = exLow
              ? previewFullTirage.filter(p => getNom(p) !== exLow)
              : previewFullTirage
            if (!active.length) { fbOk = false; break }
            const sub = api.calculRotationsRainbow(active, 1)
            if (!sub || !sub['Manche 1']) { fbOk = false; break }
            fbDict[`Manche ${r + 1}`] = sub['Manche 1']
          }
          dict = (fbOk && Object.keys(fbDict).length === nbPartiesToPlan)
            ? fbDict
            : api.buildDictRotationsWithExclus(previewFullTirage, exclus, nbPartiesToPlan)
        } else {
          dict = api.buildDictRotationsWithExclus(previewFullTirage, exclus, nbPartiesToPlan)
        }
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

    // Effacer les données stales de l'ancien tirage avant d'écrire les nouvelles.
    // Cela évite qu'un ancien tirage (avec l'exclu) persiste dans localStorage
    // et interfère avec le redémarrage de l'application.
    try {
      localStorage.removeItem('tarot_tirage')
      localStorage.removeItem('tarot_full_tirage')
      if (typeof api.clearExcluSeatIndex === 'function') api.clearExcluSeatIndex()
    } catch (_eClear) {}

    // fetch exclusions and remove them from remaining so user-placed list
    // contains only the active placeable players for the manche
    const exclusArr = await api.getExclusTournoi().catch(() => [])
    const exclSet = new Set((exclusArr || []).filter(Boolean))
    let remaining = (api.getListeTournoi() || []).filter(n => n && !arranged.includes(n) && !exclSet.has(n))
    const fullOrder = [...arranged, ...remaining]
    const baseOrder = (Array.isArray(api.getDernierFullTirage()) && api.getDernierFullTirage().length) ? api.getDernierFullTirage().map(p => p.nom) : (api.getListeTournoi() || [])

    const composed = [...fullOrder]
    const mortNamesFinal = composed.filter(n => String(n || '').toUpperCase().startsWith('MORT'))

    let full = []
    if (exclSet && exclSet.size > 0) {
      // Aligner avec la prévisualisation: joueurs actifs dans l'ordre composé,
      // puis exclu(s) à la fin. Évite les décalages entre preview et validation.
      let idx = 0
      full = (fullOrder || []).map(nm => ({ nom: nm, numero: ++idx }))
      Array.from(exclSet).forEach(nm => { full.push({ nom: nm, numero: ++idx }) })
    } else if (mortNamesFinal.length > 0) {
      // Final composition: place morts then fill remaining seats N,S,E,O
      full = placeMortsAndFill(composed)
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

    try {
      localStorage.setItem('dbg_comp_pre', JSON.stringify({ arranged, remaining, fullOrder, baseOrder, exclusArr }))
    } catch (_e) {}

    // Ensure excluded players are present in the persisted `full` list
    try {
      const missingExcl = Array.from(exclSet).filter(n => n && !full.some(p => String(p && p.nom) === String(n)))
      if (missingExcl.length) {
        missingExcl.forEach((nm) => { full.push({ nom: nm, numero: full.length + 1 }) })
        // normalize numbering
        full = full.map((p, idx) => ({ nom: p.nom, numero: idx + 1 }))
      }
    } catch (_e) { /* ignore debug augmentation errors */ }

    api.setDernierFullTirage(full)
    try {
      // store what we persisted and current exclus for debugging
      const dbgPost = {
        persistedFull: api.getDernierFullTirage ? api.getDernierFullTirage() : full,
        persistedListe: (full || []).map(p => p.nom)
      }
      try { localStorage.setItem('dbg_comp_post', JSON.stringify(dbgPost)) } catch (_e) {}
    } catch (_e) {}
    try { localStorage.setItem('tarot_full_tirage', JSON.stringify(api.getDernierFullTirage())) } catch (_e) {}

    try {
      api.setListeTournoi(full.map(p => p.nom))
      api.renderListeTournoi()
      await api.renderListeGenerale()
      api.scheduleSaveListeTournoi()
    } catch (e) { console.warn('Failed to update listeTournoi from manual composition', e) }

    try {
      const initScores = api.getListeTournoi().map(nom => [nom, 0])
      // Invalider EN PREMIER (synchrone) pour bloquer tout timer d'autosave
      // qui se déclencherait pendant les awaits IPC suivants.
      try { if (typeof api.invalidateScoresParTable === 'function') api.invalidateScoresParTable() } catch (_e) {}
      await api.setScoresTournoi(initScores)
      try { await api.setScoresParTable([]) } catch (_e) {}
      try { api.clearAllValidatedMancheSnapshots() } catch (_e) {}
      try { localStorage.removeItem('scores_par_table') } catch (_e) {}
    } catch (e) { console.warn('Failed to set initial scores from composition', e) }

    // In exclu mode, persist the exclu's seat position before building rotations
    // so buildDictRotationsWithExclus removes the correct player (by name) each manche.
    try {
      if (exclSet.size > 0 && typeof api.setExcluSeatIndex === 'function') {
        const exclNorm = new Set(Array.from(exclSet).map(n => String(n || '').trim().toLowerCase()).filter(Boolean))
        const excluIdx = full.findIndex(p => exclNorm.has(String((p && p.nom) || '').trim().toLowerCase()))
        if (excluIdx >= 0) api.setExcluSeatIndex(excluIdx)
      }
    } catch (_e) {}

    try {
      const excluArr = await api.getExclusTournoi()
      const nbPartiesToPlan = (document.getElementById('cb-serpentin') && document.getElementById('cb-serpentin').checked && Number(document.getElementById('nb-parties').value || 1) > 1) ? Number(document.getElementById('nb-parties').value || 1) - 1 : Number(document.getElementById('nb-parties').value || 1)
      api.setDernierDictRotations(api.buildDictRotationsWithExclus(api.getDernierFullTirage(), excluArr, nbPartiesToPlan))
      try { await api.applyExclusToRotations(excluArr) } catch (_e) {}
    } catch (e) { console.warn('Failed to build rotations from manual composition', e) }

    try {
      // Persister le tirage actif (sans l'exclu de la manche 1 uniquement).
      // On utilise exclusArr[0] (déjà chargé) et non exclSet qui contient TOUS
      // les exclus de toutes les manches — filtrer tous les exclus retrancherait
      // à tort les joueurs exclus des manches 2, 3, etc.
      const exclu0 = (exclusArr && exclusArr.length > 0 && exclusArr[0]) ? String(exclusArr[0]).trim() : ''
      const activeToSave = exclu0
        ? (full || []).filter(p => String((p && p.nom) || p).trim() !== exclu0)
        : (full || []).slice()
      await api.saveTirage(activeToSave)
    } catch (_e) {}
    try { await api.updateRotationsDisplay() } catch (_e) {}

    try { api.clearAllLucky() } catch (_e) {}
    try { await api.renderFeuilleSoiree() } catch (_e) {}
    // Re-render Saisie avec les nouvelles rotations et les scores réinitialisés.
    // Garantit que les anciens scores de la partie précédente ne restent pas affichés.
    try { if (typeof api.renderSaisie === 'function') await api.renderSaisie() } catch (_e) {}
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
