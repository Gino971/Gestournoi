// app.js
import {
  loadListeJoueurs,
  saveListeJoueurs,
  loadJoueursTournoi,
  saveJoueursTournoi,
  saveTirage,
  loadTirage,
  getScoresTournoi,
  setScoresTournoi,
  getScoresParTable,
  setScoresParTable,
  getClassement,
  setClassement,
  getRecap,
  setRecap,
  getExclusTournoi,
  setExclusTournoi
} from './api.js'

import { getPlacesFromDefaults, countActivePlayersFromNames } from './redistrib-helper.js'
import { computeEligible } from './lucky-utils.js'
import {
  tirageAuSort,
  transfertTotauxTable,
  determinerExcluSuivantGlobal,
  computeNextExclu,
  distributeAttackerScore,
  validateAttackerDivisibility,
  placeAttackerAtIndex
} from './coreTournoi.js'
import { calculRotationsRainbow, computeActiveFromBase, getMovementInfo } from './rotations.js'
import { generateSerpentinTables } from './serpentin.js'
import { applyFeuilleToScoresSoiree, applyValidatedManche, mergeRotationWithStoredTables } from './lib/saisie-simple.js'
import { buildClassementFromRecap } from './lib/classement-utils.js'

// Temporary build identifier for manual served-file verification (do not commit)
const FRONTEND_BUILD_ID = 'frontend-build-2026-04-17T23:30:00Z'

// Use existing `showToast` if present, otherwise provide a local `showBuildToast`
function showBuildToast (msg, ms = 4000) {
  // Debug toasts disabled — no-op to avoid showing instrumentation to users.
  return
}

// Local confirmation (thumb) used by frontend flows. Kept minimal and resilient
// so it works even when a global `showConfirmation` isn't present.
function showConfirmation () {
  try {
    const overlay = document.getElementById('confirmation-overlay')
    if (!overlay) return
    overlay.classList.remove('hidden')
    // Keep visible slightly longer so user notices it
    setTimeout(() => {
      try { overlay.classList.add('hidden') } catch (_e) {}
    }, 1200)
  } catch (e) { /* ignore */ }
}

// build id toast removed (debug toasts disabled)

// User request: disable all console output in the UI (silence logs/warns/errors)
try {
  if (typeof console !== 'undefined') {
    console.log = console.info = console.warn = console.error = function () { /* silenced per user */ }
  }
} catch (_e) { /* ignore */ }

// Default preference: utiliser X2 si non défini
try {
  if (typeof localStorage !== 'undefined' && !localStorage.getItem('tarot_morts_divisor')) {
    localStorage.setItem('tarot_morts_divisor', '2')
  }
} catch (_e) {}

// --- Helpers : snapshots des manches validées (pour relecture) ---
function saveValidatedMancheSnapshot (rotationName, tablesData) {
  try {
    const all = JSON.parse(localStorage.getItem('validated_manches_data') || '{}')
    all[rotationName] = JSON.parse(JSON.stringify(tablesData))
    localStorage.setItem('validated_manches_data', JSON.stringify(all))
  } catch (_e) { /* ignore */ }
}

// Charger une snapshot validée pour une rotation (ou null si absent)
function loadValidatedMancheSnapshot (rotationName) {
  try {
    const all = JSON.parse(localStorage.getItem('validated_manches_data') || '{}')
    if (!all || !Object.prototype.hasOwnProperty.call(all, rotationName)) return null
    // Return a deep copy so callers may modify without mutating storage
    return JSON.parse(JSON.stringify(all[rotationName]))
  } catch (_e) { return null }
}

// Supprime toutes les snapshots validées (utilisé par certaines actions de reset)
function clearAllValidatedMancheSnapshots () {
  try { localStorage.removeItem('validated_manches_data') } catch (_e) { /* ignore */ }
}

// Helper Choix multiples
async function askChoice (message, buttons) {
  if (window.electronAPI && window.electronAPI.choice) {
    return await window.electronAPI.choice(message, buttons)
  }
  const dialogBtns = buttons.map((b, i) => ({
    label: b,
    cls: i === buttons.length - 1 ? 'custom-dialog-btn-secondary' : 'custom-dialog-btn-primary'
  }))
  return _showCustomDialog(message, dialogBtns)
}

// Choix vertical scrollable (utilisé pour sélection longue)
async function askChoiceVertical (message, buttons) {
  return new Promise((resolve) => {
    try {
      const overlay = document.createElement('div')
      overlay.id = 'choice-vertical-overlay'
      overlay.className = 'choice-vertical-overlay'

      const dialog = document.createElement('div')
      dialog.className = 'choice-vertical-dialog'

      const header = document.createElement('div')
      header.className = 'choice-vertical-header'
      header.textContent = message

      const list = document.createElement('div')
      list.className = 'choice-vertical-list'

      buttons.forEach((b, i) => {
        const item = document.createElement('button')
        item.className = 'choice-vertical-item'
        item.textContent = b
        item.addEventListener('click', () => { cleanup(); resolve(i) })
        list.appendChild(item)
      })

      const actions = document.createElement('div')
      actions.className = 'choice-vertical-actions'
      const cancelBtn = document.createElement('button')
      cancelBtn.className = 'btn-secondary'
      cancelBtn.textContent = 'Annuler'
      cancelBtn.addEventListener('click', () => { cleanup(); resolve(-1) })
      actions.appendChild(cancelBtn)

      dialog.appendChild(header)
      dialog.appendChild(list)
      dialog.appendChild(actions)
      overlay.appendChild(dialog)
      document.body.appendChild(overlay)

      function onKey (e) { if (e.key === 'Escape') { cleanup(); resolve(-1) } }
      document.addEventListener('keydown', onKey)

      function cleanup () {
        document.removeEventListener('keydown', onKey)
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay)
      }

      const first = list.querySelector('button')
      if (first) first.focus()
    } catch (e) {
      console.error('askChoiceVertical error', e)
      resolve(-1)
    }
  })
}

// Variant: uses existing custom-dialog overlay but forces vertical buttons
async function askChoiceButtonsVertical (message, buttons) {
  if (window.electronAPI && window.electronAPI.choice) {
    return await window.electronAPI.choice(message, buttons)
  }
  return new Promise((resolve) => {
    const overlay = document.getElementById('custom-dialog-overlay')
    const msgEl = document.getElementById('custom-dialog-message')
    const btnContainer = document.getElementById('custom-dialog-buttons')
    if (!overlay || !msgEl || !btnContainer) { resolve(0); return }
    msgEl.textContent = message
    btnContainer.innerHTML = ''
    btnContainer.className = 'custom-dialog-buttons vertical'

    buttons.forEach((b, i) => {
      const btn = document.createElement('button')
      btn.textContent = b
      btn.className = i === buttons.length - 1 ? 'custom-dialog-btn-secondary' : 'custom-dialog-btn-primary'
      btn.addEventListener('click', () => { close(i) })
      btnContainer.appendChild(btn)
    })

    overlay.classList.remove('hidden')
    const first = btnContainer.querySelector('button')
    if (first) first.focus()

    function onKey (e) { if (e.key === 'Escape') close(buttons.length - 1) }
    document.addEventListener('keydown', onKey)
    function close (idx) { document.removeEventListener('keydown', onKey); overlay.classList.add('hidden'); resolve(idx) }
  })
}

// Small ephemeral validation bubble near an input
function getRequiredDivisor (playersOrSize) {
  try {
    if (Array.isArray(playersOrSize)) {
      const players = playersOrSize
      const mortCount = players.filter(p => String(p || '').toUpperCase().startsWith('MORT')).length
      if (mortCount === 1) {
        try {
          const pref = (typeof localStorage !== 'undefined') ? localStorage.getItem('tarot_morts_divisor') : null
          const val = pref ? parseInt(pref, 10) : 2
          return (val === 2 || val === 3) ? val : 2
        } catch (e) {
          return 2
        }
      }
      return 3
    }
    if (typeof playersOrSize === 'number') return 3
  } catch (e) {}
  return 3
}

    // Lucky draw handler (attached to btn-lucky-draw)
    async function handleLuckyDrawClick (ev) {
      let lockToken = null
      // expose dateIso and btn to the outer finally block so we can always
      // release the lock and re-enable the button even if the try-block
      // returns early or throws. Declared here (not inside try) on purpose.
      let dateIso = undefined
      let btn = null
      try {
        btn = (ev && ev.target) ? ev.target.closest('#btn-lucky-draw') : document.getElementById('btn-lucky-draw')
        dateIso = (inputDateTournoi && inputDateTournoi.value) ? inputDateTournoi.value : getTodayIso()
        // Acquire lock immediately to prevent concurrent runs
        lockToken = acquireLuckyLock(dateIso)
        if (!lockToken) return
        try { if (btn) btn.disabled = true } catch (_e) {}
        try { showBuildToast('LD: lock acquired', 2500) } catch (_e) {}
        const scores = await getScoresTournoi()
        try { showBuildToast(`LD: scores=${(scores||[]).length}`, 2000) } catch (_e) {}
        if (!scores.length) {
          // Visual feedback so user knows the handler ran but there's no data to act on
          try {
            btn.classList.add('lucky-no-data')
            const note = document.getElementById('manual-entry-note')
            if (note) {
              note.textContent = 'Aucun joueur actif pour cette date — composez la liste ou changez la date.'
              note.classList.remove('hidden')
              setTimeout(() => { try { note.classList.add('hidden'); note.textContent = '' } catch (_e) {} }, 2000)
            }
            setTimeout(() => { try { btn.classList.remove('lucky-no-data') } catch (_e) {} }, 900)
          } catch (_e) {}
          return
        }
        if (!rewardedPlayersByDate[dateIso]) rewardedPlayersByDate[dateIso] = new Set()
        const rewarded = rewardedPlayersByDate[dateIso]
        // Ensure any previous lucky label is removed so the UI shows a fresh draw
        try {
          const tbody = document.getElementById('tbody-soiree') || tbodySoiree
          if (tbody && tbody.querySelectorAll) {
            Array.from(tbody.querySelectorAll('.col-gain .gain-lucky')).forEach(el => el.remove())
          }
        } catch (_e) {}

        let placesForDate = []
        try { placesForDate = await computeRedistribPlacesFor(dateIso, scores.length) } catch (e) { placesForDate = [] }
        try { showBuildToast(`LD: placesForDate=${(placesForDate||[]).length}`, 2000) } catch (_e) {}

    const sortedByTotal = [...scores].sort((a, b) => {
      const aVals = a.slice(1).map(Number); const aTotal = aVals.length ? aVals[aVals.length - 1] : 0
      const bVals = b.slice(1).map(Number); const bTotal = bVals.length ? bVals[bVals.length - 1] : 0
      return bTotal - aTotal
    })

    const playersWithGain = new Set()
    if (Array.isArray(placesForDate) && placesForDate.length > 0) {
      sortedByTotal.forEach((r, i) => {
        const rank = i + 1
        const val = placesForDate[rank - 1]
        if (val !== undefined && val !== null && val !== '') playersWithGain.add(r[0])
      })
    }

    // Normalized set for robust name comparisons (covers accent/case/whitespace differences)
    const playersWithGainNormalized = new Set(Array.from(playersWithGain).map(n => normalizeNom(n)))

    // Compute initial eligible set (exclude only redistribution/manual-prize winners)
    const allNames = scores.map(r => r[0])
    let eligible = allNames.filter(n => !playersWithGainNormalized.has(normalizeNom(n)))

    // If the redistribution logic excluded *everyone*, try a safer approach:
    // 1) prefer using the DOM-displayed gains to determine exclusions (displayedGainSet)
    // 2) if that still excludes everyone, fall back to allowing all active players
    if (!eligible.length && allNames.length) {

      // Build displayedGainSet from current DOM (do not trust playersWithGainNormalized alone)
      const currRows = Array.from((document.getElementById('tbody-soiree') || tbodySoiree).querySelectorAll('tr'))
      const tmpDisplayed = new Set()
      currRows.forEach(tr => {
        const gainCell = tr.querySelector('.col-gain')
        const nameCell = tr.querySelector('.col-joueur')
        if (!nameCell) return
        const raw = String(nameCell.textContent || '').trim()
        const key = normalizeNom(raw)
        const hasRegularClass = gainCell && gainCell.querySelector && gainCell.querySelector('.gain-regular')
        if (hasRegularClass) tmpDisplayed.add(key)
      })

      const eligibleFromDisplayed = allNames.filter(n => !tmpDisplayed.has(normalizeNom(n)))
      if (eligibleFromDisplayed.length) {
        eligible = eligibleFromDisplayed
      } else {
        // Last-resort: allow all active players (so Tirage chanceux never becomes a no-op)
        eligible = allNames.slice()
      }
    }


    // Refresh tbody rows (use up-to-date DOM) and build name -> row map using both display text and dataset.nom
    const tbodyRows = Array.from((document.getElementById('tbody-soiree') || tbodySoiree).querySelectorAll('tr'))
    const nameToRow = new Map()
    tbodyRows.forEach(tr => {
      const nameCell = tr.querySelector('.col-joueur')
      if (!nameCell) return
      const raw = String(nameCell.textContent || '').trim()
      const key = normalizeNom(raw)
      nameToRow.set(key, tr)
      // also map by encoded dataset.nom if present (covers programmatic composition entries)
      try {
        const ds = tr.dataset && tr.dataset.nom ? decodeURIComponent(tr.dataset.nom) : ''
        if (ds) nameToRow.set(normalizeNom(ds), tr)
      } catch (_e) {}
    })

    const displayedGainSet = new Set()
    tbodyRows.forEach(tr => {
      const nameCell = tr.querySelector('.col-joueur')
      const gainCell = tr.querySelector('.col-gain')
      if (!nameCell) return
      const raw = String(nameCell.textContent || '').trim()
      const key = normalizeNom(raw)
      const hasRegularClass = gainCell && gainCell.querySelector && gainCell.querySelector('.gain-regular')
      // use normalized comparison against playersWithGainNormalized
      if (hasRegularClass || playersWithGainNormalized.has(normalizeNom(raw))) {
        displayedGainSet.add(key)
      }
    })

    const unmapped = eligible.filter(n => !nameToRow.get(normalizeNom(n)))

    const eligibleFiltered = eligible.filter(n => !displayedGainSet.has(normalizeNom(n)))
    const eligibleRows = eligibleFiltered.map(n => nameToRow.get(normalizeNom(n))).filter(Boolean)

    if (!eligibleRows.length && eligibleFiltered.length > 0) {
      // Fallback: if DOM mapping failed, still award a random eligibleFiltered player so the feature remains usable.
      const fallbackNames = eligibleFiltered.slice()
      const winnerName = fallbackNames[Math.floor(Math.random() * fallbackNames.length)]

      // Record reward and force re-render so Gain column shows (same end-state as normal flow)
      try {
        rewarded.add(winnerName)
        luckyWinnerByDate[dateIso] = winnerName
        justFinishedTournamentDate = dateIso
        await renderFeuilleSoiree()
        justFinishedTournamentDate = null
      } catch (ee) {
        console.error('Fallback lucky draw render failed', ee)
      }

      return
    }

    // pick a random winner index and align the animation so it stops on it
    const L = eligibleRows.length
    const winnerIdx = Math.floor(Math.random() * L)
    const baseCycles = 48
    let totalCycles = baseCycles
    while ((totalCycles - 1) % L !== winnerIdx) totalCycles++

    btn.disabled = true
    // Precompute per-step durations (ms) so we can schedule audio+visuals precisely
    const stepDurations = []
    let d = 80
    for (let s = 0; s < totalCycles; s++) {
      stepDurations.push(d)
      if (s > totalCycles * 0.6) d += 40
    }

    const seq = buildHighlightSequence(L, totalCycles, winnerIdx)
    try { showBuildToast('LD: start animation', 2000) } catch (_e) {}

    // Schedule visuals and audio using the AudioContext clock when available.
    // Use a RAF-driven loop to sync visuals to the AudioContext time so visuals can
    // immediately catch up if the main thread was delayed.
    const ctx = getAudioCtx()
    if (ctx) {
      // compute step start times (seconds, AudioContext timebase)
      const startSec = ctx.currentTime + 0.03
      const stepStartSecs = []
      let acc = 0
      for (let i = 0; i < totalCycles; i++) {
        stepStartSecs.push(startSec + acc / 1000)
        acc += stepDurations[i]
      }

      // schedule audio precisely on AudioContext
      for (let i = 0; i < totalCycles; i++) {
        try { playTickAt(stepStartSecs[i]) } catch (_e) {}
      }
      try { playGongAt(stepStartSecs[totalCycles - 1] + 0.02) } catch (_e) {}

      // RAF-driven visual sync (reads ctx.currentTime)
      await new Promise((resolve) => {
        let lastStep = -1
        let rafId = null
        function frame () {
          try {
            const now = ctx.currentTime
            // find the highest step whose start time <= now
            let idx = lastStep
            while (idx + 1 < stepStartSecs.length && stepStartSecs[idx + 1] <= now) idx++
            if (idx !== lastStep) {
              // render idx (clamp)
              const renderIdx = Math.max(0, Math.min(totalCycles - 1, idx))
              try { eligibleRows.forEach(r => r.classList.remove('lucky-highlight')) } catch (_e) {}
              const el = eligibleRows[seq[renderIdx]]
              if (el) { el.classList.add('lucky-highlight'); try { tickPulse(el) } catch (_e) {} }

              // If visuals are late (audio already passed the step by threshold), play a fallback tick
              try {
                const lateMs = (now - stepStartSecs[renderIdx]) * 1000
                const LATE_THRESHOLD_MS = 60
                if (lateMs > LATE_THRESHOLD_MS) {
                  try { playTickSound() } catch (_e) {}
                  console.warn(`Lucky draw visual lag: step ${renderIdx} late by ${Math.round(lateMs)}ms`)
                }
                // If it's the final step and we missed the scheduled gong, play it now
                if (renderIdx === totalCycles - 1 && (now - stepStartSecs[renderIdx]) > (LATE_THRESHOLD_MS / 1000)) {
                  try { playGongSound() } catch (_e) {}
                }
              } catch (_e) { /* ignore timing fallback errors */ }

              lastStep = idx
            }
            if (now >= stepStartSecs[stepStartSecs.length - 1] + 0.02) {
              cancelAnimationFrame(rafId)
              resolve()
              return
            }
          } catch (_e) {
            // bail out on error
            cancelAnimationFrame(rafId)
            resolve()
            return
          }
          rafId = requestAnimationFrame(frame)
        }
        rafId = requestAnimationFrame(frame)
      })
    } else {
      // Fallback: legacy timer scheduling when AudioContext not available
      const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
      const leadMs = 30
      let cumulativeMs = nowMs + leadMs
      const timers = []
      for (let step = 0; step < totalCycles; step++) {
        const idxForStep = seq[step]
        const startMs = cumulativeMs
        const domDelay = Math.max(0, Math.round(startMs - (performance.now ? performance.now() : Date.now())))
        timers.push(setTimeout(() => {
          try { eligibleRows.forEach(r => r.classList.remove('lucky-highlight')) } catch (_e) {}
          const current = eligibleRows[idxForStep]
          if (current) { current.classList.add('lucky-highlight'); try { tickPulse(current) } catch (_e) {} }
        }, domDelay))
        timers.push(setTimeout(() => { try { playTickSound() } catch (_e) {} }, domDelay))
        if (step === totalCycles - 1) timers.push(setTimeout(() => { try { playGongSound() } catch (_e) {} }, domDelay + 20))
        cumulativeMs += stepDurations[step]
      }
      const totalMs = cumulativeMs - nowMs
      await new Promise(res => setTimeout(res, totalMs + 20))
      try { timers.forEach(t => clearTimeout(t)) } catch (_e) {}
    }

    const winnerRow = eligibleRows[winnerIdx]
    const winnerName = winnerRow ? (winnerRow.querySelector('.col-joueur')?.textContent || '').trim() : eligible[0]
    try { showBuildToast(`LD: winner=${winnerName}`, 4000) } catch (_e) {}

    eligibleRows.forEach(r => r.classList.remove('lucky-highlight'))
    if (winnerRow) {
      winnerRow.classList.add('lucky-highlight', 'lucky-winner-pulse')
      try { playGongSound() } catch (_e) {}
      setTimeout(() => { winnerRow.classList.remove('lucky-winner-pulse') }, 3600)
    }

    rewarded.add(winnerName)
    luckyWinnerByDate[dateIso] = winnerName

    justFinishedTournamentDate = dateIso
    await renderFeuilleSoiree()
    justFinishedTournamentDate = null
  } catch (e) {
    console.error('Lucky draw failed', e)
    try { showBuildToast('LD: error - ' + (e && e.message ? e.message : String(e)), 6000) } catch (_e) {}
    } finally {
    try {
      // release in-progress lock for the original dateIso (only if we own it)
      try { if (typeof dateIso !== 'undefined') { showBuildToast('LD: releasing lock', 1500); releaseLuckyLock(dateIso, lockToken) } } catch (_e) {}
      await updateLuckyButtonState()
      // ensure button is re-enabled even if updateLuckyButtonState returned early
      try { const __btn = document.getElementById('btn-lucky-draw'); if (__btn) __btn.disabled = false } catch (_e) {}
    } catch (_e) {}
  }
}

const screens = document.querySelectorAll('.screen')
document.querySelectorAll('nav button').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const target = btn.dataset.screen
    // If button has no data-screen (ex: Sauvegarde / Restauration), ignore navigation behavior
    if (!target) return

    // Update active class on nav buttons (onglets)
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'))
    // Ne jamais surligner Sauvegarde/Restauration
    const btnSauvegarde = document.getElementById('btn-sauvegarde')
    const btnRestauration = document.getElementById('btn-restauration')
    if (btn !== btnSauvegarde && btn !== btnRestauration) {
      try { btn.classList.add('active') } catch (_) {}
    }
    if (btnSauvegarde) btnSauvegarde.classList.remove('active')
    if (btnRestauration) btnRestauration.classList.remove('active')

    screens.forEach((s) => s.classList.add('hidden'))
    const screenEl = document.getElementById(`screen-${target}`)
    if (screenEl) screenEl.classList.remove('hidden')

    // Refresh contextuel
    if (target === 'soiree') {
      try {
        const btnLD = document.getElementById('btn-lucky-draw')
        const tbodyCount = (typeof tbodySoiree !== 'undefined' && tbodySoiree && tbodySoiree.querySelectorAll) ? tbodySoiree.querySelectorAll('tr').length : 0

        // Check what's on top of the button (could be an invisible overlay)
        try {
          if (btnLD && typeof btnLD.getBoundingClientRect === 'function') {
            const r = btnLD.getBoundingClientRect()
            const midX = Math.round(r.left + r.width / 2)
            const midY = Math.round(r.top + r.height / 2)
            const topEl = document.elementFromPoint(midX, midY)
            const topId = topEl ? (topEl.id || topEl.className || topEl.tagName) : 'NONE'
          }
        } catch (_e) { /* ignore elementFromPoint errors */ }

        // Attach a one-time capture listener directly on the button to detect clicks that
        // might be stopped in bubble phase elsewhere. It will auto-remove after first run
        try {
          if (btnLD && !btnLD.__debugCaptureAttached) {
            const cap = (ev) => {
              btnLD.removeEventListener('click', cap, true)
              btnLD.__debugCaptureAttached = false
            }
            btnLD.addEventListener('click', cap, true)
            btnLD.__debugCaptureAttached = true
            // remove after 8s as safety
            setTimeout(() => { try { if (btnLD && btnLD.__debugCaptureAttached) { btnLD.removeEventListener('click', cap, true); btnLD.__debugCaptureAttached = false } } catch (_e) {} }, 8000)
          }
        } catch (_e) {}

        // Ensure a direct click handler is attached to the real button element as a
        // fallback (some flows seem to prevent delegated document clicks). This is
        // idempotent and re-attaches on navigation to the Scores screen.
        try {
          if (btnLD && !btnLD.__directLuckyAttached) {
            const directLucky = (ev) => {
              try {
                const maybePromise = handleLuckyDrawClick(ev)
                if (maybePromise && typeof maybePromise.then === 'function') {
                  maybePromise.then(() => {}).catch(err => {
                    console.error('handleLuckyDrawClick rejected', err)
                  })
                }
              } catch (err) {
                console.error('direct handler error', err)
              }
            }
            btnLD.addEventListener('click', directLucky)
            btnLD.__directLuckyAttached = true
          }
        } catch (_e) {}

      } catch (_e) { /* ignore */ }
      // ensure state is refreshed
      try { updateLuckyButtonState() } catch (_e) {}
      // rebuild feuille view to clear any stale inputs
      try { renderFeuilleSoiree() } catch (_e) {}
    }

    if (target === 'feuille') {
      // Lorsqu'on arrive sur l'écran "Saisie scores", on rafraîchit les rotations
      if (typeof mettreAJourSelectRotationsEtTables === 'function') {
        mettreAJourSelectRotationsEtTables()
      }
    }

    if (target === 'plan') {
      // Mettre à jour l'affichage du plan (même si pas de rotations calculées)
      try { await updateRotationsDisplay() } catch (e) { console.warn('updateRotationsDisplay failed on nav to plan', e) }
      try { const exclus = await getExclusTournoi(); markExcluInList((exclus && exclus.length) ? exclus[0] : null) } catch (_e) { /* ignore */ }
    }
  })
})

// Helper: detect if a tirage (full tirage) has been run. It checks localStorage first, then falls back to loadTirage().
async function tirageHasRun () {
  try {
    if (localStorage.getItem('tarot_full_tirage')) return true
    const t = await loadTirage()
    return Array.isArray(t) && t.length > 0
  } catch (e) {
    return false
  }
}

// --- Redistrib banner helpers (only banner; calculations/columns remain removed) ---
async function fetchRedistribDefaults () {
  // Preferred: ask main process (works for packaged app and dev)
  try {
    if (window && window.electronAPI && typeof window.electronAPI.readData === 'function') {
      try {
        const ipcData = await window.electronAPI.readData('redistributions')
        if (ipcData && Object.keys(ipcData).length > 0) return ipcData
      } catch (e) {
        console.warn('ipc readData(redistributions) failed', e)
      }
    }
  } catch (_e) { /* ignore */ }

  // Fallback: API backend (mode web / tablette)
  try {
    const res = await fetch('/api/redistributions')
    if (res.ok) return await res.json()
  } catch (_e) { /* ignore */ }

  // Fallback: static fetch (useful for dev server / non-electron web mode)
  try {
    const res = await fetch('./build/defaults/redistributions.json')
    if (res.ok) return await res.json()
  } catch (e) {
    try {
      const r2 = await fetch('/build/defaults/redistributions.json')
      if (r2.ok) return await r2.json()
    } catch (_e) {
      /* ignore */
    }
  }

  return {}
}

async function computeRedistribPlacesFor (isoDate, nbJoueurs) {
  try {
    const data = await fetchRedistribDefaults()
    if (!data || Object.keys(data).length === 0) return []
    return getPlacesFromDefaults(data, isoDate, nbJoueurs)
  } catch (e) {
    console.warn('computeRedistribPlacesFor failed', e)
    return []
  }
}

function showSmallRedistribBanner (places, nbJoueurs, isoDate) {
  try {
    const heading = document.querySelector('#screen-joueurs h2')
    if (!heading) return

    let miniHtml
    const todayLabel = isoDate ? formatDateFr(isoDate) : formatDateFr(getTodayIso())

    // Determine Jeudi vs NonJeudi for label
    const [yy, mm, dd] = (isoDate || getTodayIso()).split('-').map(Number)
    const isJeudi = new Date(yy, mm - 1, dd).getDay() === 4

    if (!places || places.length === 0) {
      miniHtml = 'Redistribution Impossible'
    } else {
      if (isJeudi) {
        const joueursLabel = nbJoueurs === 1 ? '1 joueur' : `${nbJoueurs} joueurs`
        miniHtml = `${todayLabel} — ${joueursLabel} — ${places.map(p => `${p}€`).join(', ')}`
      } else {
        const nbTables = Math.ceil(nbJoueurs / 4)
        const tablesLabel = nbTables === 1 ? '1 table' : `${nbTables} tables`
        miniHtml = `${todayLabel} — ${tablesLabel} — ${places.map(p => `${p}€`).join(', ')}`
      }
    }

    let small = document.getElementById('feuille-redistrib-banner-joueurs')
    if (small) {
      small.innerHTML = miniHtml
      small.classList.remove('hidden')
    } else {
      small = document.createElement('span')
      small.id = 'feuille-redistrib-banner-joueurs'
      small.className = 'feuille-redistrib-banner-small'
      small.innerHTML = miniHtml
      heading.appendChild(small)
    }
  } catch (e) {
    console.warn('showSmallRedistribBanner failed', e)
  }
}

function hideSmallRedistribBanner () {
  try {
    const el = document.getElementById('feuille-redistrib-banner-joueurs')
    if (el) el.remove()
  } catch (e) { /* ignore */ }
}

// Redistributions UI removed — banner functionality deleted (keep JSON only).

// Lock/Unlock UI when in manual mode (<12 players)
function lockManualModeUI () {
  try {
    const feuilleBtn = document.querySelector('nav button[data-screen="feuille"]')
    // we only disable/lock the score-entry tab; plan doit rester sélectionnable
    if (feuilleBtn) { feuilleBtn.disabled = true; feuilleBtn.classList.add('locked') }

    // Disable serpentin while in manual entry mode (remember previous state)
    try {
      if (cbSerpentin) {
        try { serpentinPrevState = !!cbSerpentin.checked } catch (_e) { serpentinPrevState = null }
        // ensure serpentin is off while in manual mode
        if (cbSerpentin.checked) {
          cbSerpentin.checked = false
          try { localStorage.setItem('tarot_serpentin', '') } catch (_e) {}
        }
        cbSerpentin.disabled = true
      }
    } catch (_e) { /* ignore */ }
  } catch (e) { console.warn('lockManualModeUI failed', e) }
}

function unlockManualModeUI () {
  try {
    const feuilleBtn = document.querySelector('nav button[data-screen="feuille"]')
    if (feuilleBtn) { feuilleBtn.disabled = false; feuilleBtn.classList.remove('locked') }

    // When leaving manual mode, restore serpentin to its previous state (do not force enable)
    try {
      if (cbSerpentin) {
        cbSerpentin.disabled = false
        if (serpentinPrevState !== null) {
          cbSerpentin.checked = !!serpentinPrevState
        }
        try { localStorage.setItem('tarot_serpentin', cbSerpentin.checked ? '1' : '') } catch (_e) {}
        serpentinPrevState = null
      }
    } catch (_e) { /* ignore */ }
  } catch (e) { console.warn('unlockManualModeUI failed', e) }
}

// ------------------ Sélecteurs DOM ------------------

// Joueurs / tirage
const divListeJoueurs = document.getElementById('liste-joueurs')
const divListeJoueursTournoi = document.getElementById('liste-joueurs-tournoi')
// Index of last clicked player in `renderListeGenerale` (used for Shift+click range selection)
let lastClickedGeneralIndex = null

const btnClearJoueursTournoi = document.getElementById(
  'btn-clear-joueurs-tournoi'
)

// Bouton d'ajout : relier au helper `ajouterJoueur`
const _btnAjouterJoueurClub = document.getElementById('btn-ajouter-joueur-club')
const _formAjoutJoueur = document.getElementById('form-ajout-joueur')
if (_btnAjouterJoueurClub) {
  const input = document.getElementById('saisie-joueur-express')

  // Soumission du formulaire (fonctionne avec Entrée du clavier Android et le bouton +)
  async function handleAjoutJoueur () {
    if (input && input.value && input.value.trim()) {
      await ajouterJoueur(input.value, false)
      input.value = ''
    }
  }

  // Le formulaire capture à la fois le bouton submit ET la touche Entrée
  if (_formAjoutJoueur) {
    _formAjoutJoueur.addEventListener('submit', async (e) => {
      e.preventDefault()
      await handleAjoutJoueur()
    })
  }

  // Fallback : clic direct sur le bouton
  _btnAjouterJoueurClub.addEventListener('click', async () => {
    await handleAjoutJoueur()
  })
} const btnTirage = document.getElementById('btn-tirage')
const inputBackupFile = document.getElementById('input-backup-file') // DÉPLACÉ ICI (Global)

// Plan de table / rotations
const nbPartiesInput = document.getElementById('nb-parties')

// Nombre de parties par manche (dynamique)
const nbPartiesParMancheInput = document.getElementById('nb-parties-par-manche')
function getNbPartiesParManche () {
  return Math.max(1, Number((nbPartiesParMancheInput && nbPartiesParMancheInput.value) || 5))
}
// Expose globally for lib modules
try { window.getNbPartiesParManche = getNbPartiesParManche } catch (_) {}

async function rebuildRotationsAfterNbChange () {
  try {
    if (!dernierFullTirage) return
    const exclusArr = await getExclusTournoi()
    const nbParties = Number(nbPartiesInput.value || 1)
    // serpentin mode previously subtracted one manche; that removed the final
    // rotation from the selector. keep full nbParties and generate the special
    // last rotation separately.
    const nbPartiesToPlan = nbParties
    dernierDictRotations = buildDictRotationsWithExclus(dernierFullTirage, exclusArr, nbPartiesToPlan)
    // Do not compute serpentin rotation yet during initial rebuild; it will
    // be generated only after the penultimate manche has been validated.
    // (see performGlobalValidateManche for conditional computation)
    await mettreAJourSelectRotationsEtTables()
    await updateRotationsDisplay()
  } catch (e) {
    console.warn('rebuildRotationsAfterNbChange failed', e)
  }
}

if (nbPartiesInput) {
  nbPartiesInput.addEventListener('change', async () => {
    const min = Number(nbPartiesInput.min) || 1
    const maxAttr = nbPartiesInput.getAttribute('max')
    const max = maxAttr ? Number(maxAttr) : null
    let cur = Number(nbPartiesInput.value || min)
    if (isNaN(cur) || cur < min) cur = min
    if (max !== null && cur > max) {
      showToast(`Nombre de manches limité à ${max}`)
      cur = max
    }
    nbPartiesInput.value = String(cur)

    // Rebuild rotations with new value
    await rebuildRotationsAfterNbChange()
    // Update the small +/- controls state
    updateNbPartiesControls()
  })

  // Helper: get min/max
  function getNbPartiesLimits () {
    const min = Number(nbPartiesInput.min) || 1
    const maxAttr = nbPartiesInput.getAttribute('max')
    const max = maxAttr ? Number(maxAttr) : null
    return { min, max }
  }

  // Helper: Enable/disable +/- buttons according to current value
  function updateNbPartiesControls () {
    const { min, max } = getNbPartiesLimits()
    const cur = Number(nbPartiesInput.value || min)
    const btnInc = document.getElementById('btn-incr-manche')
    const btnDec = document.getElementById('btn-decr-manche')
    if (btnDec) btnDec.disabled = cur <= min
    if (btnInc) btnInc.disabled = (max !== null && cur >= max)
  }

  // Attach handlers to the +/- buttons
  const btnIncr = document.getElementById('btn-incr-manche')
  const btnDecr = document.getElementById('btn-decr-manche')

  if (btnIncr) {
    btnIncr.addEventListener('click', async () => {
      const { min, max } = getNbPartiesLimits()
      const cur = Number(nbPartiesInput.value || min)
      if (max !== null && cur >= max) {
        showToast(`Nombre de manches limité à ${max}`)
        return
      }
      nbPartiesInput.value = String(cur + 1)
      await rebuildRotationsAfterNbChange()
      updateNbPartiesControls()
    })
  }

  if (btnDecr) {
    btnDecr.addEventListener('click', async () => {
      const { min } = getNbPartiesLimits()
      const cur = Number(nbPartiesInput.value || min)
      if (cur <= min) return
      nbPartiesInput.value = String(cur - 1)
      await rebuildRotationsAfterNbChange()
      updateNbPartiesControls()
    })
  }

  // Initialize controls state on load
  updateNbPartiesControls()
}

// --- Contrôle du nombre de parties par manche ---
if (nbPartiesParMancheInput) {
  function updateNbPartiesParMancheControls () {
    const min = Number(nbPartiesParMancheInput.min) || 1
    const max = Number(nbPartiesParMancheInput.max) || 10
    const cur = Number(nbPartiesParMancheInput.value || 5)
    const btnInc = document.getElementById('btn-incr-parties')
    const btnDec = document.getElementById('btn-decr-parties')
    if (btnDec) btnDec.disabled = cur <= min
    if (btnInc) btnInc.disabled = cur >= max
  }

  const btnIncrParties = document.getElementById('btn-incr-parties')
  const btnDecrParties = document.getElementById('btn-decr-parties')

  if (btnIncrParties) {
    btnIncrParties.addEventListener('click', () => {
      const max = Number(nbPartiesParMancheInput.max) || 10
      const cur = Number(nbPartiesParMancheInput.value || 5)
      if (cur >= max) return
      nbPartiesParMancheInput.value = String(cur + 1)
      try { window.getNbPartiesParManche = getNbPartiesParManche } catch (_) {}
      updateNbPartiesParMancheControls()
      renderSaisie()
    })
  }

  if (btnDecrParties) {
    btnDecrParties.addEventListener('click', () => {
      const min = Number(nbPartiesParMancheInput.min) || 1
      const cur = Number(nbPartiesParMancheInput.value || 5)
      if (cur <= min) return
      nbPartiesParMancheInput.value = String(cur - 1)
      try { window.getNbPartiesParManche = getNbPartiesParManche } catch (_) {}
      updateNbPartiesParMancheControls()
      renderSaisie()
    })
  }

  updateNbPartiesParMancheControls()
}

const rotationsResultDiv = document.getElementById('rotations-result')
const btnQuitter = document.getElementById('btn-quitter')

// Always present a Quit button in the header. In Electron it calls the
// native quit handler; in a browser it attempts to close the window or
// shows a fallback message if that isn't permitted.
if (btnQuitter) {
  btnQuitter.title = 'Quitter'
  btnQuitter.textContent = '❌'
  btnQuitter.addEventListener('click', () => {
    try {
      if (window.electronAPI && window.electronAPI.quitApp) {
        window.electronAPI.quitApp()
        return
      }
    } catch (_e) { /* ignore */ }

    // 1) Try direct close()
    try { window.close() } catch (_e) {}

    // 2) If not closed, try open self then close (works in some browsers)
    setTimeout(() => {
      try {
        const w = window.open('', '_self')
        if (w) { try { w.close() } catch (_e) {} ; return }
      } catch (_e) {}

      // 3) As a last resort navigate to a blank page to at least leave the app UI
      try { window.location.href = 'about:blank' } catch (_e) {}

      // 4) Final fallback: inform the user they must close manually
      setTimeout(() => {
        try { showAlert("Impossible de quitter depuis le navigateur. Fermez l'onglet ou la fenêtre manuellement.") } catch (_e) {}
      }, 300)
    }, 200)
  })
}

// Boutons Navbar ajoutés
const btnSauvegardeNav = document.getElementById('btn-sauvegarde')
const btnRestaurationNav = document.getElementById('btn-restauration')

/* --- LOGIQUE MODAL SAUVEGARDE & RESTAURATION --- */
const modalBackup = document.getElementById('modal-backup')
const listBackupsContainer = document.getElementById('list-backups-container')
const btnCloseModalBackup = document.getElementById('btn-close-modal-backup')

async function openRestoreModal () {
  let backups = []

  // Récupérer la liste des sauvegardes (Electron ou API web)
  if (window.electronAPI && window.electronAPI.listBackups) {
    backups = await window.electronAPI.listBackups() || []
  } else {
    try {
      const res = await fetch('/api/backups')
      backups = await res.json() || []
    } catch (_e) { backups = [] }
  }

  if (backups && backups.length > 0) {
    listBackupsContainer.innerHTML = ''
    backups.forEach(backup => {
      const li = document.createElement('li')
      const dateStr = new Date(backup.date).toLocaleString('fr-FR')
      const escapedName = backup.name.replace(/</g, '&lt;').replace(/>/g, '&gt;')
      li.innerHTML = `
          <div class="backup-info" style="flex:1; cursor:pointer;">
            <span class="backup-name">${escapedName}</span>
            <br>
            <span class="backup-date" style="font-size:0.8em; color:#aaa;">${dateStr}</span>
          </div>
          <button class="btn-trash btn-delete-backup" title="Supprimer cette sauvegarde" style="margin-left:10px;">🗑︎</button>
        `

      // Clic sur text => Restore
      li.querySelector('.backup-info').onclick = () => performRestoreFromFile(backup.name)

      // Clic sur Button => Delete
      li.querySelector('.btn-delete-backup').onclick = async (e) => {
        e.stopPropagation()
        if (await askConfirm(`Supprimer définitivement la sauvegarde "${backup.name}" ?`)) {
          let res
          if (window.electronAPI && window.electronAPI.deleteBackup) {
            res = await window.electronAPI.deleteBackup(backup.name)
          } else {
            try {
              const r = await fetch(`/api/backups/${encodeURIComponent(backup.name)}`, { method: 'DELETE' })
              res = await r.json()
            } catch (_e) { res = { success: false, error: 'Erreur réseau' } }
          }
          if (res.success) {
            openRestoreModal() // Refresh list
          } else {
            showAlert('Erreur suppression: ' + (res.error || 'inconnue'))
          }
        }
      }

      listBackupsContainer.appendChild(li)
    })
    modalBackup.classList.remove('hidden')
    return
  }

  // Fallback: file input
  inputBackupFile.value = ''
  inputBackupFile.click()
}

async function performRestoreFromFile (filename) {
  if (!await askConfirm(`Restaurer la sauvegarde "${filename}" ?\n\nCela REMPLACERA les données actuelles.`)) return

  try {
    let json
    if (window.electronAPI && window.electronAPI.readBackup) {
      json = await window.electronAPI.readBackup(filename)
    } else {
      const res = await fetch(`/api/backups/${encodeURIComponent(filename)}`)
      json = await res.json()
    }
    await applyRestore(json)
    modalBackup.classList.add('hidden')
  } catch (e) {
    console.error(e)
    showAlert('Erreur restauration: ' + e.message)
  }
}

if (btnCloseModalBackup) {
  btnCloseModalBackup.addEventListener('click', () => {
    modalBackup.classList.add('hidden')
  })
}

if (btnSauvegardeNav) {
  btnSauvegardeNav.addEventListener('click', async () => {
    await exportBackupJSON()
  })
}

if (btnRestaurationNav) {
  btnRestaurationNav.addEventListener('click', () => {
    openRestoreModal()
  })
}

const planHeadingEl = document.getElementById('plan-heading')

// Minuteur
import initTimer from './timer.js'
try { initTimer() } catch (_e) { /* ignore if timer DOM not ready */ }


// Feuille de table
const selectRotation = document.getElementById('select-rotation')
// selectTable removed – not needed for simplified saisie UI
const cbSerpentin = document.getElementById('cb-serpentin')
const containerSaisie = document.getElementById('container-saisie')

// Preserve previous serpentin state when entering manual mode so we can restore it on exit
let serpentinPrevState = null
// Initialize serpentin from localStorage
try { if (cbSerpentin) cbSerpentin.checked = !!localStorage.getItem('tarot_serpentin') } catch (_e) {}
if (cbSerpentin) cbSerpentin.addEventListener('change', () => { try { localStorage.setItem('tarot_serpentin', cbSerpentin.checked ? '1' : '') } catch (_e) {} })
// Normal table-based "feuille" mode removed — use the Saisie UI (renderSaisie) and #container-saisie

// (Removed) previous check for missing players before allowing rotation selection.

// Listeners pour les selects
if (selectRotation) selectRotation.addEventListener('change', async () => {
  if (!dernierDictRotations) return

  // Sécurité anti-triche via UI + Feedback
  const index = selectRotation.selectedIndex
  const option = selectRotation.options[index]

  // Removed check that required all players to have scores before allowing rotation change.
  if (option && option.disabled) {
    // still bail out if somehow disabled (shouldn't happen normally)
    return
  }

  const nomRot = selectRotation.value
  const tables = dernierDictRotations[nomRot] || []

  // Mettre à jour l'affichage de l'exclu à côté du sélecteur de manche
  try { await updateSelectRotationExcluDisplay() } catch (_e) { /* ignore */ }

  // Only Saisie mode supported — render the tables
  try { await renderSaisie() } catch (e) { console.warn('renderSaisie init failed', e) }
})


// Ensure the global "Valider manche" checkmark is visible in the Feuille header
try {
  const feuilleActions = document.querySelector('#screen-feuille .actions')
  if (feuilleActions && !document.getElementById('btn-validate-manche-header')) {
    const headerBtn = document.createElement('button')
    headerBtn.id = 'btn-validate-manche-header'
    headerBtn.className = 'btn-validate-check'
    headerBtn.textContent = '\u2714'
    headerBtn.title = 'Valider manche (synchroniser toutes les tables)'
    headerBtn.onclick = performGlobalValidateManche
      // Prefer to insert the button before the exclu label if present
      const selectRot = feuilleActions.querySelector('#select-rotation')
      const excluSpan = document.getElementById('select-rotation-exclu')
      if (selectRot && selectRot.parentElement === feuilleActions) {
        // insert headerBtn right after the select
        feuilleActions.insertBefore(headerBtn, selectRot.nextSibling)
      } else if (selectRot && selectRot.nextSibling) {
        // fallback: insert right after the select
        feuilleActions.insertBefore(headerBtn, selectRot.nextSibling)
      } else {
        feuilleActions.insertBefore(headerBtn, feuilleActions.firstChild)
      }

      // If the exclu span exists elsewhere, move it to immediately after the button
      try {
        const existingExclu = document.getElementById('select-rotation-exclu')
        if (existingExclu && existingExclu.parentElement === feuilleActions) {
          feuilleActions.insertBefore(existingExclu, headerBtn.nextSibling)
        }
      } catch (_e) { /* ignore */ }
    }
  } catch (_e) { /* ignore */ }

// Feuille de soirée
const theadSoiree = document.getElementById('thead-soiree')
const tbodySoiree = document.getElementById('tbody-soiree')
const btnEffacerSoiree = document.getElementById('btn-effacer-soiree')
// Manual entry checkbox (now available quel que soit the number of players)
const cbManualEntry = document.getElementById('cb-manual-entry') || null

// helper returns whether manual mode is currently active (checkbox only)
function isManualModeActive() {
  try {
    return !!(cbManualEntry && cbManualEntry.checked)
  } catch (_e) {
    return false
  }
}

// centralised unlock logic used after tirage/init
function maybeUnlockUIForNormalFlow() {
  try {
    if (!isManualModeActive()) {
      unlockManualModeUI()
    }
  } catch (e) { console.warn('maybeUnlockUIForNormalFlow failed', e) }
}

// Wire checkbox: toggles manual entry mode (affects Feuille & tab locking)
if (cbManualEntry) {
  cbManualEntry.addEventListener('change', async () => {
    try {
      if (cbManualEntry.checked) lockManualModeUI()
      else unlockManualModeUI()
      await renderFeuilleSoiree()
    } catch (e) { console.warn('cbManualEntry change handler failed', e) }
  })
  // Ensure UI matches initial state
  try { if (cbManualEntry.checked) lockManualModeUI(); else unlockManualModeUI() } catch (e) { /* ignore */ }
}

// Classement annuel (2 tableaux)
const btnEffacerClassement = document.getElementById('btn-effacer-classement')

const btnExportPdfClassement = document.getElementById('btn-export-pdf-classement')
const tableClassementFixe = document.getElementById('table-classement-fixe')
const tableClassementDates = document.getElementById('table-classement-dates')
const tableCogninFixe = document.getElementById('table-cognin-fixe')
const tableCogninDates = document.getElementById('table-cognin-dates')

// Récap
const tbodyRecap = document.querySelector('#table-recap tbody')

// Fin de tournoi
const inputDateTournoi = document.getElementById('date-tournoi')
const btnFinTournoi = document.getElementById('btn-fin-tournoi')
// Correction : définition de inputBackupFile déplacée plus haut si nécessaire,
// mais ici on s'assure qu'il n'est pas redéfini avec const s'il l'est déjà
// const inputBackupFile = document.getElementById("input-backup-file"); // DEJA FAIT DANS LES SELECTEURS DOM (L105 env)

// ------------------ État en mémoire ------------------
// Temporary runtime toggles (useful during development / testing)
// NOTE: __saisieSkipAdvanceCheck may be set by tests when they need to bypass
// the 'previous rotation complete' gate.  It should **not** default to true in
// normal usage, otherwise all manches become accessible immediately.


let listeGenerale = []
let listeTournoi = []

// Sauvegarde dé-bounced de la liste du tournoi (évite trop d'écritures disque)
let _saveListeTimer = null
function scheduleSaveListeTournoi (delay = 500) {
  try {
    if (_saveListeTimer) clearTimeout(_saveListeTimer)
    _saveListeTimer = setTimeout(async () => {
      try {
        await saveJoueursTournoi(listeTournoi)
      } catch (e) {
        console.error('Erreur sauvegarde listeTournoi (scheduled)', e)
      }
    }, delay)
  } catch (e) {
    console.error('Erreur scheduleSaveListeTournoi', e)
  }
}

async function saveListeTournoiNow () {
  if (_saveListeTimer) { clearTimeout(_saveListeTimer); _saveListeTimer = null }
  try { await saveJoueursTournoi(listeTournoi) } catch (e) { console.error('Erreur saveListeTournoiNow', e) }
}
export let dernierDictRotations = null

// utility for tests: allow resetting rotation data
export function setDernierDictRotations(val) { dernierDictRotations = val; }

// Toggle to allow editing of a validated manche snapshot (disabled by default)
// Enable editing of validated manches by default (no banner/button shown)
let validatedEditMode = true

// Guard for concurrent Saisie renders
let _renderingSaisieLock = false
// remember the last rotation key rendered so we can detect manual switches
let _lastRenderedRotation = null
// Redistribution feature removed — no runtime state kept
// Date of the tournament that was just finished via 'Fin de tournoi' — used to force display of gains immediately
let justFinishedTournamentDate = null

// Lucky draw state (in-memory only)
const luckyWinnerByDate = {}          // { 'YYYY-MM-DD': 'Player Name' }
const rewardedPlayersByDate = {}      // { 'YYYY-MM-DD': Set([...names]) }
// Guards to prevent double / re-entrant lucky-draw execution for the same date
// Use a Map(dateIso -> token) so only the owner that acquired the lock can release it.
const luckyDrawInProgressMap = new Map()

function acquireLuckyLock (isoDate) {
  try {
    if (!isoDate) return null
    if (luckyDrawInProgressMap.has(isoDate)) return null
    const token = Symbol()
    luckyDrawInProgressMap.set(isoDate, token)
    return token
  } catch (e) { return null }
}

function releaseLuckyLock (isoDate, token) {
  try {
    if (!isoDate) return
    const cur = luckyDrawInProgressMap.get(isoDate)
    if (cur && token && cur === token) luckyDrawInProgressMap.delete(isoDate)
  } catch (e) { /* ignore */ }
}

// Helpers to manage/clear lucky state
function clearLuckyForDate (isoDate) {
  try {
    if (!isoDate) return
    delete luckyWinnerByDate[isoDate]
    delete rewardedPlayersByDate[isoDate]
  } catch (e) { /* ignore */ }
}

function clearAllLucky () {
  try {
    Object.keys(luckyWinnerByDate).forEach(k => delete luckyWinnerByDate[k])
    Object.keys(rewardedPlayersByDate).forEach(k => delete rewardedPlayersByDate[k])
  } catch (e) { /* ignore */ }
}

/* persistLuckyToRecap removed — recap must be updated only on "Fin de tournoi" */

// Update button state by checking both memory and persisted recap
    async function updateLuckyButtonState () {
  try {
    const btn = document.getElementById('btn-lucky-draw')
    if (!btn) return
    const dateIso = (inputDateTournoi && inputDateTournoi.value) ? inputDateTournoi.value : getTodayIso()
    // Guard against concurrent/re-entrant execution for the same date
    if (luckyDrawInProgressMap.has(dateIso)) return
    // Do NOT acquire the in-progress lock here — locks are added/removed by the
    // actual draw handler to avoid blocking the button permanently.
    // If a lucky winner already exists for this date, clear previous 'chanceux' state
    try { clearLuckyForDate(dateIso) } catch (_e) {}
    // Keep the lucky-draw enabled while the tournament is ongoing.
    // Disable the button only if the tournament is finalized (an entry exists in recap).
    try {
      const recap = await getRecap()
      const entry = recap.find(r => r.date === dateIso)
      if (entry) { btn.disabled = true; return }
    } catch (_e) {
      // ignore errors reading recap
    }
    btn.disabled = false

    // Succès : afficher brièvement puis proposer de fermer
    msgEl.textContent = '✅ PDF téléchargé !'
    btnContainer.innerHTML = ''
    const btnClose = document.createElement('button')
    btnClose.textContent = 'OK'
    btnClose.className = 'custom-dialog-btn-primary'
    btnClose.addEventListener('click', () => {
      URL.revokeObjectURL(url)
      overlay.classList.add('hidden')
      if (onDone) onDone()
    })
    btnContainer.appendChild(btnClose)
    btnClose.focus()
  } catch (err) {
    console.error('Erreur PDF:', err)
    msgEl.textContent = 'Erreur : ' + (err.message || err)
    btnContainer.innerHTML = ''
    const btnClose = document.createElement('button')
    btnClose.textContent = 'Fermer'
    btnClose.className = 'custom-dialog-btn-secondary'
    btnClose.addEventListener('click', () => {
      overlay.classList.add('hidden')
      if (onDone) onDone()
    })
    btnContainer.appendChild(btnClose)
  }
}

/* Génère un PDF blob à partir des tables du print-container via jsPDF + autoTable */
async function _generatePDF (container) {
  if (!window.jspdf) throw new Error('jsPDF non chargé')
  const { jsPDF } = window.jspdf
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  // Rendre le container visible temporairement pour lire les tables
  const prevDisplay = container.style.display
  container.style.display = 'block'

  try {
    const tables = container.querySelectorAll('table')
    if (tables.length === 0) throw new Error('Aucune table trouvée dans le document')

    // Chercher un titre (h2, h3, h4) avant la première table
    const heading = container.querySelector('h2, h3, h4')
    if (heading) {
      pdf.setFontSize(16)
      pdf.text(heading.textContent.trim(), 14, 15)
    }

    let startY = heading ? 22 : 10

    tables.forEach((table, idx) => {
      if (idx > 0) {
        pdf.addPage()
        startY = 10
      }
      // Extraire les en-têtes
      const headers = []
      const headerRow = table.querySelector('thead tr') || table.querySelector('tr')
      if (headerRow) {
        headerRow.querySelectorAll('th, td').forEach(cell => {
          headers.push(cell.textContent.trim())
        })
      }
      // Extraire les données
      const body = []
      const rows = table.querySelectorAll('tbody tr')
      const allRows = rows.length > 0 ? rows : table.querySelectorAll('tr')
      allRows.forEach((row, rowIdx) => {
        // Ignorer la première ligne si elle a servi de headers
        if (rows.length === 0 && rowIdx === 0) return
        const rowData = []
        row.querySelectorAll('td, th').forEach(cell => {
          rowData.push(cell.textContent.trim())
        })
        if (rowData.length > 0) body.push(rowData)
      })

      // Détecter la colonne nom (pour alignement gauche)
      const nomColIdx = headers.findIndex(h =>
        /nom|joueur/i.test(h)
      )

      const colStyles = {}
      if (nomColIdx >= 0) {
        colStyles[nomColIdx] = { halign: 'left', fontStyle: 'bold', cellWidth: 40 }
      }

      pdf.autoTable({
        head: headers.length > 0 ? [headers] : undefined,
        body: body,
        startY: startY,
        theme: 'grid',
        styles: {
          fontSize: 8,
          cellPadding: 1.5,
          halign: 'center',
          lineWidth: 0.2,
          lineColor: [0, 0, 0]
        },
        headStyles: {
          fillColor: [220, 220, 220],
          textColor: [0, 0, 0],
          fontStyle: 'bold'
        },
        columnStyles: colStyles,
        margin: { top: 10, left: 5, right: 5 }
      })
    })

    return pdf.output('blob')
  } finally {
    container.style.display = prevDisplay
  }
}

function showAlert (message) {
  // if test harness or other code replaced window.showAlert with a custom handler,
  // prefer calling that (avoids unhandled ReferenceError in JSDOM if alert is missing).
  try {
    if (typeof window !== 'undefined' && typeof window.showAlert === 'function' && window.showAlert !== showAlert) {
      return window.showAlert(message)
    }
  } catch (_e) {    // ignore
  }

  // Use custom HTML dialog (works on all platforms)
  _showCustomDialog(message, [{ label: 'OK', cls: 'custom-dialog-btn-primary' }])
}

// Temporary UI debug panel removed — keep `addDebug` as a no-op so instrumentation sites remain available
function addDebug (_msg, _level = 'info') {
  // no-op in normal operation
}

// Audio helpers — use AudioContext when available to schedule precise sounds
function getAudioCtx () {
  try {
    if (typeof window === 'undefined') return null
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    if (!window.__luckyAudioCtx) window.__luckyAudioCtx = new AC()
    return window.__luckyAudioCtx
  } catch (_e) {
    return null
  }
}

function playTickSound () {
  // backward-compatible immediate tick (uses audio ctx if available)
  const ctx = getAudioCtx()
  if (ctx) return playTickAt(ctx.currentTime)
  // otherwise do nothing; browsers without AudioContext will skip sound
}

function playTickAt (when) {
  try {
    const ctx = getAudioCtx()
    if (!ctx) return
    if (window.__disableLuckySound) return
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = 900 + Math.random() * 300
    o.connect(g); g.connect(ctx.destination)
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(0.08, when + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06)
    o.start(when); o.stop(when + 0.07)
    o.onended = () => { try { o.disconnect(); g.disconnect() } catch (_e) {} }
  } catch (_e) { /* ignore */ }
}

// Per-step visual pulse to ensure motion is perceptible even when the highlighted
// row doesn't change. Adds/removes `lucky-tick` class and forces reflow to restart CSS animation.
function tickPulse (el, duration = 120) {
  try {
    if (!el) return
    el.classList.remove('lucky-tick')
    // force reflow so adding the class retriggers animation
    // eslint-disable-next-line no-unused-expressions
    void el.offsetWidth
    el.classList.add('lucky-tick')
    setTimeout(() => { try { el.classList.remove('lucky-tick') } catch (_e) {} }, duration)
  } catch (_e) { /* ignore */ }
}

// Play a bright "sound of chance" for the final winner (bell + shimmer + sparkle).
// Louder and more piercing so it's clearly audible.
function playGongSound () {
  const ctx = getAudioCtx()
  if (ctx) return playGongAt(ctx.currentTime)
}

function playGongAt (when) {
  try {
    const ctx = getAudioCtx()
    if (!ctx) return
    if (window.__disableLuckySound) return

    const now = when
    const master = ctx.createGain()
    const vol = (typeof window.__luckySoundVolume === 'number') ? Math.max(0, Math.min(2, window.__luckySoundVolume)) : 1.0
    master.gain.setValueAtTime(0.0001, now)
    master.gain.linearRampToValueAtTime(0.95 * vol, now + 0.01)
    master.gain.exponentialRampToValueAtTime(0.0001, now + 2.0)
    master.connect(ctx.destination)

    // Main bright bell (short attack, mid decay)
    const bell = ctx.createOscillator()
    const bellGain = ctx.createGain()
    bell.type = 'sine'
    bell.frequency.setValueAtTime(1200, now) // bright initial pitch
    bell.frequency.exponentialRampToValueAtTime(440, now + 1.2) // gentle fall
    bell.connect(bellGain); bellGain.connect(master)
    bellGain.gain.setValueAtTime(0.0001, now)
    bellGain.gain.exponentialRampToValueAtTime(0.75 * vol, now + 0.012)
    bellGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.4)

    // Metallic shimmer for 'luck' character
    const shimmer = ctx.createOscillator()
    const shimmerGain = ctx.createGain()
    shimmer.type = 'triangle'
    shimmer.frequency.setValueAtTime(2400, now)
    shimmer.connect(shimmerGain); shimmerGain.connect(master)
    shimmerGain.gain.setValueAtTime(0.0001, now)
    shimmerGain.gain.exponentialRampToValueAtTime(0.28 * vol, now + 0.02)
    shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0)

    // Short sparkling noise (bandpass) to add 'chance' sparkle
    const bufferSize = Math.floor(ctx.sampleRate * 0.12)
    const noiseBuf = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = noiseBuf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
    const noiseSrc = ctx.createBufferSource(); noiseSrc.buffer = noiseBuf
    const noiseFilter = ctx.createBiquadFilter(); noiseFilter.type = 'bandpass'; noiseFilter.frequency.value = 3000; noiseFilter.Q.value = 1
    const noiseGain = ctx.createGain(); noiseGain.gain.setValueAtTime(0.35 * vol, now)
    noiseSrc.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(master)

    // Start / stop
    bell.start(now); shimmer.start(now + 0.01); noiseSrc.start(now + 0.02)
    bell.stop(now + 1.6); shimmer.stop(now + 1.0); noiseSrc.stop(now + 0.14)

    // cleanup after sound finishes
    setTimeout(() => {
      try {
        bell.disconnect(); shimmer.disconnect(); noiseSrc.disconnect();
        bellGain.disconnect(); shimmerGain.disconnect(); noiseFilter.disconnect(); noiseGain.disconnect(); master.disconnect()
      } catch (_e) {}
    }, 2100)
  } catch (_e) {
    /* ignore audio errors */
  }
}

// Build a highlight sequence that looks random early and converges to winnerIdx at the end.
function buildHighlightSequence (count, totalCycles, winnerIdx) {
  const seq = []
  if (!count || totalCycles <= 0) return seq
  if (totalCycles === 1) return [winnerIdx % count]

  const early = Math.min(totalCycles - 1, Math.max(1, Math.floor(totalCycles * 0.6)))
  // early-phase: avoid immediate consecutive repeats for livelier randomness
  let prev = -1
  for (let i = 0; i < early; i++) {
    let pick = Math.floor(Math.random() * count)
    if (pick === prev) pick = (pick + 1) % count
    seq.push(pick)
    prev = pick
  }

  const last = seq[seq.length - 1]
  let dist = (winnerIdx - last + count) % count
  if (dist === 0) dist = count // force movement to avoid static final segment
  const remaining = totalCycles - early
  for (let k = 0; k < remaining; k++) {
    const progress = (k + 1) / remaining
    seq.push((last + Math.round(dist * progress)) % count)
  }

  // Post-process: avoid long runs of the same index (user perceives this as a freeze).
  // Ensure no immediate consecutive duplicates and guarantee final element is the winner.
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === seq[i - 1]) {
      seq[i] = (seq[i] + 1) % count
    }
  }

  // Force the last element to be the winner (ensures correct end-state)
  if (seq.length) seq[seq.length - 1] = winnerIdx % count

  return seq
}

// Normalisation des noms pour comparer robustement
function normalizeNom (n) {
  return (n || '').toString().trim().toLowerCase()
}
function findRowByName (scores, name) {
  if (!Array.isArray(scores)) return null
  const target = normalizeNom(name)
  return scores.find(r => normalizeNom(r[0]) === target)
}

// Adjust scrolling mode for player lists: switch to vertical single-column
// layout (with overflow-y) when the current layout would produce more than 4 columns.
function detectColumnsFromLayout (container) {
  try {
    const children = Array.from(container.children).filter(c => c.offsetParent !== null)
    if (!children.length) return 0
    const firstTop = children[0].offsetTop
    let cols = 0
    for (const c of children) if (c.offsetTop === firstTop) cols++
    return Math.max(1, cols)
  } catch (e) {
    return 1
  }
}

function updatePlayerListScrollMode () {
  try {
    // Preference: always use vertical scrolling for player lists (single-column)
    // — this implements the user's request to prefer vertical scroll for the zones joueurs.
    const containers = [divListeJoueurs, divListeJoueursTournoi]
    containers.forEach(container => {
      if (!container) return
      container.classList.add('force-vertical-scroll')
    })
  } catch (e) { /* ignore */ }
}

// Update on resize so layout mode adapts responsively
window.addEventListener('resize', () => { try { updatePlayerListScrollMode() } catch (_e) {} })


// Mode de jeu : 'normal' (par défaut), 'morts', 'exclu', 'tables56'
function setMode (m) {
  try {
    if (!m) { localStorage.removeItem('tarot_mode');
      _lastRenderedRotation = null
      try { renderSaisie() } catch (_e) {}
      return }
    localStorage.setItem('tarot_mode', String(m))
  } catch (_e) { /* ignore */ }
  // ensure next render treats rotation as changed so we wipe all scores
  _lastRenderedRotation = null
  try { renderSaisie() } catch (_e) {}
}
function getMode () {
  try {
    return localStorage.getItem('tarot_mode') || 'normal'
  } catch (_e) { return 'normal' }
}

// Helper: read mortal divisor preference (2 or 3) from localStorage
function getMortsDivisor () {
  try {
    const v = Number(localStorage.getItem('morts_divisor'))
    return (v === 2 || v === 3) ? v : null
  } catch (_e) { return null }
}

// Toast non-bloquant (top-right)
function showToast (message, timeout = 2500) {
  try {
    let container = document.getElementById('toast-container')
    if (!container) {
      container = document.createElement('div')
      container.id = 'toast-container'
      document.body.appendChild(container)
    }
    const el = document.createElement('div')
    el.className = 'toast'
    el.textContent = message
    container.appendChild(el)
    // Force reflow
    el.getBoundingClientRect()
    el.classList.add('show')
    setTimeout(() => {
      el.classList.remove('show')
      setTimeout(() => container.removeChild(el), 220)
    }, timeout)
  } catch (e) {
    console.warn('showToast failed', e)
  }
}

// ------------------ Utilitaires date ------------------

// Central helper: source of "today" (allows tests to override via window or localStorage)
function getTodayDate () {
  try {
    if (typeof window !== 'undefined' && window.__TODAY_OVERRIDE__) {
      return new Date(window.__TODAY_OVERRIDE__)
    }
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem('tarot_today_override') : null
    if (raw) return new Date(raw)
  } catch (e) {
    /* ignore and fall back to system date */
  }
  return new Date()
}

function getTodayIso () {
  const d = getTodayDate()
  return (d && typeof d.toISOString === 'function') ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
}

function setTodayOverride (isoDateOrNull) {
  try {
    if (typeof window !== 'undefined') window.__TODAY_OVERRIDE__ = isoDateOrNull || null
    if (typeof localStorage !== 'undefined') {
      if (isoDateOrNull) localStorage.setItem('tarot_today_override', isoDateOrNull)
      else localStorage.removeItem('tarot_today_override')
    }
  } catch (e) { /* ignore */ }
}

try { if (typeof window !== 'undefined') { window.setTodayOverride = setTodayOverride; window.getTodayDate = getTodayDate; window.getTodayIso = getTodayIso } } catch (_e) {}

function setTodayForTournoi () {
  const today = getTodayIso()
  inputDateTournoi.value = today
}

const joursFr = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

function formatDateFr (iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  const dateObj = new Date(Number(y), Number(m) - 1, Number(d))
  const jour = joursFr[dateObj.getDay()]
  return `${jour} ${d}/${m}/${y}`
}

function formatDateShort (iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  const dateObj = new Date(Number(y), Number(m) - 1, Number(d))
  const jour = joursFr[dateObj.getDay()]
  return `${jour} ${d}/${m}/${y.slice(2)}`
}

function getTypeMouvementLabelFromTirage (tirage) {
  const nbTables = tirage.length / 4
  if (nbTables === 3) return 'Mouvement Howell FFT – 3 tables'
  if (nbTables === 4) return 'Mouvement Howell FFT – 4 tables'

  // If movement rules include exceptions for this number of tables,
  // show 'Mouvement avec variations' instead of 'Mouvement normal FFT'.
  try {
    const info = getMovementInfo(Math.floor(nbTables))
    if (info && typeof info.comment === 'string' && info.comment.includes('Exceptions')) {
      return 'Mouvement spécial FFT'
    }
  } catch (e) {
    console.warn('getMovementInfo failed:', e)
  }

  return 'Mouvement normal FFT'
}

function trierTournoiMortsFin () {
  listeTournoi.sort((a, b) => {
    const aMort = a.toUpperCase().includes('MORT')
    const bMort = b.toUpperCase().includes('MORT')
    if (aMort && !bMort) return 1
    if (!aMort && bMort) return -1

    // Si ce sont deux Morts, on les trie entre eux (Mort 1 < Mort 2)
    if (aMort && bMort) {
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    }

    return 0
  })
}

async function updateRotationsDisplay () {
  // Si pas de rotations calculées, on met quand même à jour le header du plan
  // pour afficher un éventuel exclu initial (cas: choix d'exclu avant tirage complet).
  // De plus : tenter d'inférer et d'afficher le libellé du mouvement dès l'accès au plan
  // (par ex. quand on clique sur "Composer 1ère manche").
  if (!dernierDictRotations) {
    const _rawExclus = await getExclusTournoi()
    let exclus = Array.isArray(_rawExclus) ? _rawExclus : []

    // Si le nombre de joueurs est un multiple de 4 (ex: 12), il ne doit pas y avoir d'exclu.
    try {
      if (Array.isArray(listeTournoi) && listeTournoi.length % 4 === 0 && exclus.length) {
        try { await setExclusTournoi([]); clearExcluSeatIndex() } catch (ee) { console.warn('clear exclus failed', ee) }
        exclus = []
      }
    } catch (_e) { /* ignore */ }

    const exclu0 = exclus && exclus.length ? exclus[0] : null

    // : tenter d'inférer un tirage / nb de tables pour afficher le libellé de mouvement
    try {
      let tirageActif = null
      try { tirageActif = loadTirage() } catch (_e) { tirageActif = null }

      let tiragePourLabel = null
      if (Array.isArray(tirageActif) && tirageActif.length > 0) {
        tiragePourLabel = tirageActif
      } else if (Array.isArray(dernierFullTirage) && dernierFullTirage.length > 0) {
        tiragePourLabel = dernierFullTirage.map(p => p.nom).filter(n => n && !String(n).toUpperCase().startsWith('MORT'))
      } else if (Array.isArray(listeTournoi) && listeTournoi.length > 0) {
        const nbPlayers = listeTournoi.filter(n => n && !String(n).toUpperCase().startsWith('MORT')).length
        const nbTables = Math.floor(nbPlayers / 4) || 0
        if (nbTables > 0) {
          tiragePourLabel = new Array(nbTables * 4).fill(null)
        }
      }

      if (planHeadingEl) {
        if (tiragePourLabel && Array.isArray(tiragePourLabel) && tiragePourLabel.length > 0) {
          try {
            const nbTablesForMv = Math.floor((tiragePourLabel.length || 0) / 4) || null
            const mvInfo = nbTablesForMv ? getMovementInfo(nbTablesForMv) : null
            const labelText = (mvInfo && mvInfo.label) ? mvInfo.label : getTypeMouvementLabelFromTirage(tiragePourLabel)
            const commentHtml = (mvInfo && mvInfo.comment) ? `<span class="movement-comment">${mvInfo.comment}</span>` : ''
            planHeadingEl.innerHTML = `Plan de table : <span class="movement-label" title="${labelText}">${labelText}</span> ${commentHtml}`
          } catch (_e) {
            planHeadingEl.textContent = 'Plan de table / Manches'
          }
        } else {
          if (exclu0) {
            planHeadingEl.innerHTML = `Plan de table / Manches <span class="rotation-exclu-inline">Exclu: <strong>${exclu0}</strong></span>`
          } else {
            planHeadingEl.textContent = 'Plan de table / Manches'
          }
        }
      }

      // Marquer dans la liste le joueur exclu s'il y en a un
      try { markExcluInList(exclu0) } catch (_e) { /* ignore */ }
    } catch (e) {
      console.warn('updateRotationsDisplay (no rotations) error', e)
    }
    return
  }

  // Utiliser les exclus persistés lorsque disponibles. Ne dépendons plus seulement du modulo
  // (cas où listeTournoi aurait été momentanément modifiée) — si un exclu est configuré,
  // on l'affichera. Toutefois, si le nombre de joueurs est un multiple de 4, on supprime
  // tout exclu persistant car il n'y a pas d'exclusion à appliquer.
  const _rawExclus = await getExclusTournoi()
  let exclus = Array.isArray(_rawExclus) ? _rawExclus : []
  try {
    if (Array.isArray(listeTournoi) && listeTournoi.length % 4 === 0 && exclus.length) {
      try { await setExclusTournoi([]); clearExcluSeatIndex() } catch (ee) { console.warn('clear exclus failed', ee) }
      exclus = []
    }
  } catch (_e) { /* ignore */ }

  const rotationsKeys = Object.keys(dernierDictRotations)

  rotationsResultDiv.innerHTML = rotationsKeys
    .map((nomRot, mancheIndex) => {
      const tables = dernierDictRotations[nomRot] || []
      let excluPourManche = exclus[mancheIndex] || null

      const blocTables = tables
        .map((t, tableIdx) => {
          const [n, s, e, o, x, y] = t.joueurs
          let exemptHtml = ''
          if (x) {
            exemptHtml += `<div class="table-seat table-seat-exemption"><span>${x.nom || '?'}</span></div>`
          }
          if (y) {
            exemptHtml += `<div class="table-seat table-seat-exemption-2"><span>${y.nom || '?'}</span></div>`
          }

          const nNom = (n?.nom || '').trim()
          const sNom = (s?.nom || '').trim()
          const eNom = (e?.nom || '').trim()
          const oNom = (o?.nom || '').trim()
          const excluTrim = (excluPourManche || '').trim()
          const isMort = excluTrim && String(excluTrim).toUpperCase().includes('MORT')
          const excluLabel = isMort ? 'Mort' : 'Exclu'

          const highlightClass = ''

          return `
            <div class="table-card${highlightClass}">
              <div class="table-card-center-label">Table ${t.table}</div>
              <div class="table-seat table-seat-north">
                <span>${nNom === excluTrim ? (isMort ? `<span class="seat-mort">${excluLabel}</span>` : `<span class="exclu-inline">${excluLabel}</span>`) : (nNom || '?')}</span>
              </div>
              <div class="table-seat table-seat-south">
                <span>${sNom === excluTrim ? (isMort ? `<span class="seat-mort">${excluLabel}</span>` : `<span class="exclu-inline">${excluLabel}</span>`) : (sNom || '?')}</span>
              </div>
              <div class="table-seat table-seat-east">
                <span>${eNom === excluTrim ? (isMort ? `<span class="seat-mort">${excluLabel}</span>` : `<span class="exclu-inline">${excluLabel}</span>`) : (eNom || '?')}</span>
              </div>
              <div class="table-seat table-seat-west">
                <span>${oNom === excluTrim ? (isMort ? `<span class="seat-mort">${excluLabel}</span>` : `<span class="exclu-inline">${excluLabel}</span>`) : (oNom || '?')}</span>
              </div>
              ${exemptHtml}
            </div>
          `
        })
        .join('')

      // Header inline : afficher l'exclu juste à côté du numéro de manche
      // En serpentin, la dernière manche n'a pas d'exclu
      const totalNbManches = Number(nbPartiesInput && nbPartiesInput.value || 0)
      const isLastSerpentinManche = getSerpentinEnabled() && totalNbManches >= 2 && mancheIndex === totalNbManches - 1
      const isMort = excluPourManche && String(excluPourManche).toUpperCase().includes('MORT')
      // Seat label: preserve 'Mort' for Mort placeholders, otherwise 'Exclu'
      const seatLabel = isMort ? 'Mort' : 'Exclu'
      // Header label: if it's a real Mort placeholder keep 'Mort', otherwise
      // use a more explicit phrase for clarity next to the manche number.
      const headerLabel = isMort ? 'Mort' : 'Exclu pour cette manche'
      const headerHtml = (excluPourManche && !isLastSerpentinManche)
        ? `<h3>Manche ${mancheIndex + 1} <span class="rotation-exclu-inline">${headerLabel}: <strong>${excluPourManche}</strong></span></h3>`
        : `<h3>Manche ${mancheIndex + 1}</h3>`

      return `
        <section class="rotation-block">
          ${headerHtml}
          <div class="rotation-tables">
            ${blocTables}
          </div>
        </section>
      `
    })
    .join('')

  // Marquer visuellement dans la liste le joueur exclu de la rotation sélectionnée (si applicable)
  try {
    const selIdx = (selectRotation && typeof selectRotation.selectedIndex === 'number') ? selectRotation.selectedIndex : 0
    markExcluInList(exclus[selIdx] || null)
  } catch (_e) { /* ignore */ }

  // Assurer que l'en-tête du plan affiche le même libellé de mouvement que lors du "Tirage au sort".
  try {
    // Preferer `dernierFullTirage` (prévisualisation ou tirage validé) avant le tirage persisté.
    // Cela garantit que la prévisualisation mise par `syncCompositionToPlan()` s'affiche immédiatement.
    let tiragePourLabel = null
    if (Array.isArray(dernierFullTirage) && dernierFullTirage.length > 0) {
      tiragePourLabel = dernierFullTirage.map(p => p.nom).filter(n => n && !String(n).toUpperCase().startsWith('MORT'))
    } else {
      let tirageActif = null
      try { tirageActif = loadTirage() } catch (_e) { tirageActif = null }
      if (Array.isArray(tirageActif) && tirageActif.length > 0) {
        tiragePourLabel = tirageActif
      } else {
        // fallback: infer from rotations (nombre de tables)
        const keys = Object.keys(dernierDictRotations || {})
        if (keys.length > 0) {
          const nbTables = (dernierDictRotations[keys[0]] || []).length
          if (nbTables > 0) {
            // build a fake tirage array with nbTables * 4 entries so getTypeMouvementLabelFromTirage works
            tiragePourLabel = new Array(nbTables * 4).fill(null)
          }
        }
      }
    }

    if (planHeadingEl) {
      if (tiragePourLabel && Array.isArray(tiragePourLabel) && tiragePourLabel.length > 0) {
        try {
          const nbTablesForMv = Math.floor((tiragePourLabel.length || 0) / 4) || null
          const mvInfo = nbTablesForMv ? getMovementInfo(nbTablesForMv) : null
          const labelText = (mvInfo && mvInfo.label) ? mvInfo.label : getTypeMouvementLabelFromTirage(tiragePourLabel)
          const commentHtml = (mvInfo && mvInfo.comment) ? `<span class="movement-comment">${mvInfo.comment}</span>` : ''
          planHeadingEl.innerHTML = `Plan de table : <span class="movement-label" title="${labelText}">${labelText}</span> ${commentHtml}`
        } catch (_e) {
          planHeadingEl.textContent = 'Plan de table'
        }
      } else {
        // no tirage => keep the generic header (matches earlier behavior)
        planHeadingEl.textContent = 'Plan de table / Manches'
      }
    }
  } catch (e) {
    console.warn('updateRotationsDisplay (header movement) failed', e)
  }
}

// Dernier full tirage (incluant tous les joueurs) pour pouvoir reconstruire la liste
let dernierFullTirage = null

/**
 * buildDictRotationsWithExclus
 * Pour chaque manche, on reconstruit la liste active en retirant l'exclu de la fullTirage
 * et on calcule la rotation correspondante pour cette manche uniquement.
 */
function setExcluSeatIndex (idx) {
  if (typeof idx !== 'number' || Number.isNaN(idx)) return
  localStorage.setItem('tarot_exclu_seat_index', String(idx))
}
function getExcluSeatIndex () {
  const raw = localStorage.getItem('tarot_exclu_seat_index')
  if (raw === null) return null
  const n = Number(raw)
  return Number.isNaN(n) ? null : n
}
function clearExcluSeatIndex () {
  localStorage.removeItem('tarot_exclu_seat_index')
}

function buildDictRotationsWithExclus (fullTirage, exclusArr, nbParties) {
  const dict = {}
  if (!Array.isArray(fullTirage)) return dict
  // Copie mutable de fullTirage qui subira les swaps successifs
  const base = fullTirage.map((p) => ({ ...p }))
  const seatIndex = getExcluSeatIndex()

  // Si le seatIndex n'est pas défini, on calcule une seule fois TOUS les mouvements
  // avec le tirage courant (modeExclu=true) et on réutilise les manches.
  if (seatIndex === null) {
    try {
      // If no seatIndex is configured, decide whether to use exclu mode based on persisted exclus array
      const modeExcluAuto = (Array.isArray(exclusArr) && exclusArr.length > 0 && exclusArr[0]) && getMode() !== 'tables56'
      const all = calculRotationsRainbow(base, nbParties, modeExcluAuto)
      for (let r = 0; r < nbParties; r++) {
        dict[`Manche ${r + 1}`] = all[`Manche ${r + 1}`] || []
      }
    } catch (e) {
      console.warn('Erreur calcul rotations (sans seatIndex):', e)
      for (let r = 0; r < nbParties; r++) dict[`Manche ${r + 1}`] = []
    }
    // Persister l'état (même si aucun swap n'a eu lieu)
    try {
      dernierFullTirage = base.map(p => ({ ...p }))
      localStorage.setItem('tarot_full_tirage', JSON.stringify(dernierFullTirage))
    } catch (e) {
      console.warn('Impossible de persister dernierFullTirage (sans seatIndex)', e)
    }
    return dict
  }

  for (let r = 0; r < nbParties; r++) {
    const exclu = exclusArr && exclusArr[r] ? exclusArr[r] : null
    // compute active array for this manche (may swap the excluded player to seatIndex if needed)
    const active = computeActiveFromBase(base, seatIndex, exclu)

    // calculer une rotation d'une seule manche pour cet ensemble
    try {
      const modeExcluForManche = (getMode() === 'tables56') ? false : !!exclu
      const sub = calculRotationsRainbow(active, 1, modeExcluForManche)
      dict[`Manche ${r + 1}`] = sub['Manche 1']
    } catch (e) {
      console.warn('Erreur calcul rotations pour manche', r + 1, e)
      dict[`Manche ${r + 1}`] = []
    }
  }

  // Persister le nouveau fullTirage modifié suite aux swaps (utile pour manches suivantes)
  try {
    dernierFullTirage = base.map(p => ({ ...p }))
    localStorage.setItem('tarot_full_tirage', JSON.stringify(dernierFullTirage))
  } catch (e) {
    console.warn('Impossible de persister dernierFullTirage après swaps', e)
  }

  return dict
}

/**
 * Applique l'exclusion dans les rotations et met à jour l'UI
 */
async function applyExclusToRotations (exclusArr) {
  try {
    const nbParties = Number(nbPartiesInput.value || 1)
    const nbPartiesToPlan = (cbSerpentin && cbSerpentin.checked && nbParties > 1) ? nbParties - 1 : nbParties
    if (!dernierFullTirage) {
      console.warn('applyExclusToRotations: pas de fullTirage disponible')
      // Même sans fullTirage, on met à jour l'UI minimale pour refléter l'exclu
      try { await updateSelectRotationExcluDisplay() } catch (_e) { /* ignore */ }
      return
    }
    // Sauvegarder la rotation serpentin (dernière manche) si elle existe déjà,
    // car buildDictRotationsWithExclus la recréerait sans le classement serpentin.
    const serpentinKey = (cbSerpentin && cbSerpentin.checked && nbParties > 1) ? `Rotation ${nbParties}` : null
    const savedSerpentinRot = serpentinKey && dernierDictRotations && dernierDictRotations[serpentinKey]
      ? JSON.parse(JSON.stringify(dernierDictRotations[serpentinKey]))
      : null
    dernierDictRotations = buildDictRotationsWithExclus(dernierFullTirage, exclusArr, nbPartiesToPlan)
    // Restaurer la rotation serpentin si elle avait été calculée
    if (savedSerpentinRot && serpentinKey) {
      dernierDictRotations[serpentinKey] = savedSerpentinRot
    }
    await mettreAJourSelectRotationsEtTables()
    await updateRotationsDisplay()
    try { await updateSelectRotationExcluDisplay() } catch (_e) { /* ignore */ }
  } catch (e) {
    console.error('applyExclusToRotations error', e)
  }
}

// ------------------ Joueurs / tirage ------------------

// --- Manual composition (first round) UI state ---
const compOverlay = document.getElementById('composition-overlay')
const compAvailableList = document.getElementById('comp-available-list')
const compArrangedList = document.getElementById('comp-arranged-list')
const btnManualComposition = document.getElementById('btn-manual-composition')
const compValidateBtn = document.getElementById('comp-validate')
const compCancelBtn = document.getElementById('comp-cancel')

async function openCompositionModal () {
  if (!compOverlay) return
  // Build available list — include any `Mort` placeholders so they can be placed
  // but in mode 'exclu' remove the excluded player(s) from the available set
  let avail = (listeTournoi || []).filter(n => n && String(n).trim() !== '')
  try {
    if (typeof getMode === 'function' && getMode() === 'exclu') {
      const exclusArr = (await getExclusTournoi()) || []
      const exclSet = new Set((exclusArr || []).filter(Boolean))
      avail = avail.filter(n => !exclSet.has(n))
    }
  } catch (_e) { /* ignore */ }
  compAvailableList.innerHTML = avail.map((n) => {
    const isMort = String(n).toUpperCase().startsWith('MORT')
    const cls = isMort ? 'comp-item mort' : 'comp-item'
    return `<div class="${cls}" data-nom="${encodeURIComponent(n)}">${n}</div>`
  }).join('')
  compArrangedList.innerHTML = ''
  compOverlay.classList.remove('hidden')
  // focus the overlay for accessibility so it becomes visible immediately
  try { compOverlay.focus() } catch (_e) {}

  // show a live preview on the plan while composing
  try { syncCompositionToPlan() } catch (_e) {}
} 

function closeCompositionModal () {
  if (!compOverlay) return
  compOverlay.classList.add('hidden')
  // If we were previewing a composition, restore previous rotations state
  try {
    if (compositionPreviewBackup) {
      dernierFullTirage = compositionPreviewBackup.dernierFullTirage
      dernierDictRotations = compositionPreviewBackup.dernierDictRotations
      compositionPreviewBackup = null
    }
  } catch (_e) {}
  try { updateRotationsDisplay() } catch (_e) {}
}

// click handlers for composition modal (event delegation)
let compositionPreviewBackup = null

async function syncCompositionToPlan () {
  try {
    const arranged = Array.from(compArrangedList.querySelectorAll('.comp-item')).map(el => decodeURIComponent(el.dataset.nom || ''))
    // fill remaining players (preserve order of listeTournoi excluding already arranged)
    // Exclude the current exclu when in 'exclu' mode so they are not placed.
    let remaining = (listeTournoi || []).filter(n => n && !arranged.includes(n))
    try {
      if (typeof getMode === 'function' && getMode() === 'exclu') {
        const exclusArr = (await getExclusTournoi()) || []
        const exclSet = new Set((exclusArr || []).filter(Boolean))
        remaining = remaining.filter(n => !exclSet.has(n))
      }
    } catch (_e) { /* ignore */ }
    const fullOrder = [...arranged, ...remaining]

    // Reinsert excluded players into the preview ordering so the Plan and
    // Saisie UIs still display exclusion labels. We preserve the original
    // `listeTournoi` ordering for excluded player positions when available.
    const exclusArr = await getExclusTournoi().catch(() => [])
    const exclSet = new Set((exclusArr || []).filter(Boolean))
    const baseOrder = (Array.isArray(dernierFullTirage) && dernierFullTirage.length)
      ? dernierFullTirage.map(p => p.nom)
      : (listeTournoi || [])

    const previewFullTirage = []
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
    // Append any leftover composed names (defensive)
    while (ptr < fullOrder.length) {
      previewFullTirage.push({ nom: fullOrder[ptr++], numero: previewFullTirage.length + 1 })
    }

    // backup current rotations only once when starting preview
    if (!compositionPreviewBackup) {
      compositionPreviewBackup = { dernierFullTirage: dernierFullTirage, dernierDictRotations: dernierDictRotations }
    }

    // compute rotations for preview and render
    try {
      const exclusArr = await getExclusTournoi()
      const nbPartiesToPlan = (cbSerpentin && cbSerpentin.checked && Number(nbPartiesInput.value || 1) > 1) ? Number(nbPartiesInput.value || 1) - 1 : Number(nbPartiesInput.value || 1)
      const dict = buildDictRotationsWithExclus(previewFullTirage, exclusArr, nbPartiesToPlan)
      // temporarily apply for display
      dernierFullTirage = previewFullTirage
      dernierDictRotations = dict
      await updateRotationsDisplay()
      // Also refresh selects / accessibility state so other screens (Feuille) reflect the preview
      try {
        if (typeof mettreAJourSelectRotationsEtTables === 'function') await mettreAJourSelectRotationsEtTables()
      } catch (_e) { /* ignore */ }
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
    // move to arranged (append at end)
    const placed = document.createElement('div')
    placed.className = 'comp-item placed'
    placed.dataset.nom = encodeURIComponent(name)
    placed.textContent = name
    compArrangedList.appendChild(placed)
    it.remove()
    // sync live preview
    try { syncCompositionToPlan() } catch (_e) {}
  })

  compArrangedList.addEventListener('click', (ev) => {
    const it = ev.target.closest('.comp-item')
    if (!it) return
    const name = decodeURIComponent(it.dataset.nom || '')
    // move back to available (append)
    const back = document.createElement('div')
    back.className = 'comp-item'
    back.dataset.nom = encodeURIComponent(name)
    back.textContent = name
    compAvailableList.appendChild(back)
    it.remove()
    // sync live preview
    try { syncCompositionToPlan() } catch (_e) {}
  })
}

if (btnManualComposition) btnManualComposition.addEventListener('click', openCompositionModal)
// also expose a quick access button in 'Joueurs / Tirage' if present
const btnManualCompositionJoueurs = document.getElementById('btn-manual-composition-joueurs')
if (btnManualCompositionJoueurs) btnManualCompositionJoueurs.addEventListener('click', async () => {
  // If player count is not a multiple of 4, follow the same flow as `Tirage au sort`:
  // - prompt user to add "Mort(s)" / use tables 5/6 / mode exclu / cancel
  // - apply the chosen mode before computing the composition preview
  try {
    const reste = (Array.isArray(listeTournoi) ? listeTournoi.length : 0) % 4
    if (reste !== 0 && Array.isArray(listeTournoi) && listeTournoi.length >= 5) {
      let aAjouter = 4 - reste

      // Respecter la règle: au maximum 3 Morts au total
      const existingMortCount = (listeTournoi || []).filter(n => n && String(n).toUpperCase().startsWith('MORT')).length
      const maxAllowed = Math.max(0, 3 - existingMortCount)
      if (maxAllowed === 0) {
        showAlert('Impossible : nombre maximum de 3 Mort(s) déjà atteint.')
        return
      }
      if (aAjouter > maxAllowed) {
        aAjouter = maxAllowed
        try { showToast(`Ajout limité à ${aAjouter} Mort(s) (max 3)`) } catch (_e) {}
      }

      const message = `Le nombre de joueurs (${listeTournoi.length}) n'est pas un multiple de 4.\n\nChoisissez une option :`
      const buttons = []
      buttons.push(`Ajouter ${aAjouter} "Mort(s)" (X3)`)
      buttons.push(`Ajouter ${aAjouter} "Mort(s)" (X2)`)
      buttons.push('Créer des tables de 5 ou 6 joueurs')
      if (reste === 1) buttons.push('Mode joueur exclu')

      // Use vertical choice list so options are stacked and left-aligned
      const choice = await askChoiceVertical(message, buttons)
      if (choice === -1) return // cancelled via overlay
      const selected = buttons[choice]

      if (selected && selected.startsWith('Ajouter')) {
        for (let i = 0; i < aAjouter; i++) {
          let k = 1
          while (listeTournoi.some((n) => n && String(n).toUpperCase() === `MORT ${k}`)) {
            k++
          }
          listeTournoi.push(`Mort ${k}`)
        }
        // Persist chosen morts divisor mode: (X3 -> divisor '3', X2 -> divisor '2')
        try { if (selected.includes('(X3)')) localStorage.setItem('tarot_morts_divisor', '3') } catch (_e) {}
        try { if (selected.includes('(X2)')) localStorage.setItem('tarot_morts_divisor', '2') } catch (_e) {}
        setMode('morts')
        renderListeTournoi()
        await renderListeGenerale()
        scheduleSaveListeTournoi()
      } else if (selected === 'Créer des tables de 5 ou 6 joueurs') {
        setMode('tables56')
      } else if (selected === 'Mode joueur exclu') {
        setMode('exclu')
        const buttonsExclu = [...listeTournoi]
        const messageExclu = 'Choisissez le premier joueur exclu :'
        const choiceExclu = await askChoiceVertical(messageExclu, buttonsExclu)
        if (choiceExclu === -1) {
          showAlert('Aucun exclu sélectionné. Annulation du tirage.')
          renderListeTournoi()
          await renderListeGenerale()
          scheduleSaveListeTournoi()
          return
        }
        if (choiceExclu < listeTournoi.length) {
          const exclu = listeTournoi[choiceExclu]
          await setExclusTournoi([exclu])
          try { await applyExclusToRotations([exclu]) } catch (e) { console.warn('applyExclusToRotations initial failed', e) }
          try { markExcluInList(exclu) } catch (_e) { /* ignore */ }
          try { setFeuilleExcluInfo(exclu, 0) } catch (_e) { /* ignore */ }
          try { await updateRotationsDisplay() } catch (_e) { /* ignore */ }
          renderListeTournoi()
          scheduleSaveListeTournoi()
        } else {
          return
        }
      }
    }
  } catch (e) {
    console.warn('Error preparing composition for non-multiple-of-4:', e)
  }

  // compute preview & rotations first so Plan header shows the composition movement immediately
  try { await syncCompositionToPlan() } catch (_e) { /* ignore */ }
  try { const planBtn = document.querySelector('nav button[data-screen="plan"]'); if (planBtn) planBtn.click() } catch (_e) {}
  openCompositionModal()
})

// Plan screen composer button removed (composition is available via Joueurs/Tirage quick-access) // no-op

// Delegated fallback: open modal when either button is clicked even if earlier listeners failed
// Ensure preview/heading updated when this fallback is used.
document.addEventListener('click', async (ev) => {
  const btn = ev.target.closest && ev.target.closest('#btn-manual-composition, #btn-manual-composition-joueurs')
  if (btn) {
    try { await syncCompositionToPlan() } catch (_e) { /* ignore */ }
    try { const planBtn = document.querySelector('nav button[data-screen="plan"]'); if (planBtn) planBtn.click() } catch (_e) { /* ignore */ }
    try { openCompositionModal() } catch (e) { console.warn('openCompositionModal failed (delegated):', e) }
  }
})
if (compCancelBtn) compCancelBtn.addEventListener('click', closeCompositionModal)
if (compValidateBtn) compValidateBtn.addEventListener('click', async () => {
  // build arranged list
  const arranged = Array.from(compArrangedList.querySelectorAll('.comp-item')).map(el => decodeURIComponent(el.dataset.nom || ''))
  if (!arranged.length) {
    showAlert('Aucune composition fournie — annulation')
    closeCompositionModal()
    return
  }

  // complete the ordering with remaining players (preserve listeTournoi order)
  let remaining = (listeTournoi || []).filter(n => n && !String(n).toUpperCase().startsWith('MORT') && !arranged.includes(n))
  try {
    if (typeof getMode === 'function' && getMode() === 'exclu') {
      const exclusArr = (await getExclusTournoi()) || []
      const exclSet = new Set((exclusArr || []).filter(Boolean))
      remaining = remaining.filter(n => !exclSet.has(n))
    }
  } catch (_e) { /* ignore */ }
  const fullOrder = [...arranged, ...remaining]

  // Reinsert excluded players into the final ordering so they remain present
  // in `listeTournoi` (and are labeled in the Plan / Saisie). Preserve
  // relative positions from the previous `listeTournoi` when possible.
  const exclusArr = await getExclusTournoi().catch(() => [])
  const exclSet = new Set((exclusArr || []).filter(Boolean))
  const baseOrder = (Array.isArray(dernierFullTirage) && dernierFullTirage.length)
    ? dernierFullTirage.map(p => p.nom)
    : (listeTournoi || [])

  const finalOrder = []
  let ptr = 0
  for (let i = 0; i < baseOrder.length; i++) {
    const name = baseOrder[i]
    if (exclSet.has(name)) {
      finalOrder.push(name)
    } else {
      finalOrder.push(fullOrder[ptr++] || name)
    }
  }
  // Append leftovers defensively
  while (ptr < fullOrder.length) finalOrder.push(fullOrder[ptr++])

  const full = finalOrder.map((nm, idx) => ({ nom: nm, numero: idx + 1 }))

  // Persist and apply as the canonical full tirage
  dernierFullTirage = full
  try { localStorage.setItem('tarot_full_tirage', JSON.stringify(dernierFullTirage)) } catch (_e) {}

  // Update listeTournoi & initial scores (same behaviour as tirage au sort)
  try {
    listeTournoi = full.map(p => p.nom)
    renderListeTournoi()
    await renderListeGenerale()
    scheduleSaveListeTournoi()
  } catch (e) { console.warn('Failed to update listeTournoi from manual composition', e) }

  // Initialize scores tournoi (Nom, Total=0)
  try {
    const initScores = listeTournoi.map(nom => [nom, 0])
    await setScoresTournoi(initScores)
  } catch (e) { console.warn('Failed to set initial scores from composition', e) }

  // Rebuild rotations based on this full tirage
  try {
    const excluArr = await getExclusTournoi()
    const nbPartiesToPlan = (cbSerpentin && cbSerpentin.checked && Number(nbPartiesInput.value || 1) > 1) ? Number(nbPartiesInput.value || 1) - 1 : Number(nbPartiesInput.value || 1)
    dernierDictRotations = buildDictRotationsWithExclus(dernierFullTirage, excluArr, nbPartiesToPlan)
    try { await applyExclusToRotations(excluArr) } catch (_e) { /* ignore */ }
  } catch (e) {
    console.warn('Failed to build rotations from manual composition', e)
  }

  // Persist tirage and UI updates
  try { saveTirage(full) } catch (_e) {}
  try { await updateRotationsDisplay() } catch (_e) {}

  // Reset any in-memory lucky/reward state and refresh feuille
  try { clearAllLucky() } catch (_e) {}
  try { await renderFeuilleSoiree() } catch (_e) {}
  try {
    await updateLuckyButtonState()
  } catch (_e) {}

  // Diagnostics to help compare manual composition vs tirage au sort
  try {
    const dateIsoDiag = (inputDateTournoi && inputDateTournoi.value) ? inputDateTournoi.value : getTodayIso()
    const scoresNow = await getScoresTournoi()
    let placesDiag = []
    try { placesDiag = await computeRedistribPlacesFor(dateIsoDiag, (scoresNow || []).length) } catch (_e) { placesDiag = [] }

    const tbodyRowsDiag = Array.from((document.getElementById('tbody-soiree') || tbodySoiree).querySelectorAll('tr'))
    const tbodyMap = tbodyRowsDiag.map(tr => {
      const ds = tr.dataset && tr.dataset.nom ? (decodeURIComponent(tr.dataset.nom) || '') : ''
      const disp = String((tr.querySelector('.col-joueur') || {}).textContent || '').trim()
      const gain = tr.querySelector('.col-gain') ? (tr.querySelector('.col-gain').textContent || '').trim() : ''
      return { ds, disp, key: normalizeNom(ds || disp), gain }
    })

    const displayedGainKeys = tbodyMap.filter(r => r.gain && r.gain !== '').map(r => r.key)
  } catch (_e) { /* ignore diag errors */ }



  // clear preview backup (we accepted it)
  compositionPreviewBackup = null

  closeCompositionModal()
})


function renderListeTournoi () {
  // On s'assure que les morts sont à la fin avant d'afficher
  trierTournoiMortsFin()

  divListeJoueursTournoi.innerHTML = listeTournoi
    .map(
      (nom, index) => `
      <div class="joueur-tournoi-row" data-nom="${nom}">
        <button type="button" class="btn-trash" data-index="${index}" title="Retirer ce joueur">🗑︎</button>
        <span class="joueur-tournoi-num">${index + 1}</span>
        <span class="joueur-tournoi-nom">${nom}</span>
      </div>
    `
    )
    .join('')

  divListeJoueursTournoi.querySelectorAll('.btn-trash').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.dataset.index)
      listeTournoi.splice(idx, 1)
      renderListeTournoi()
      await renderListeGenerale()
      try {
        scheduleSaveListeTournoi()
      } catch (e) {
        showAlert('Erreur en sauvegardant la liste du tournoi : ' + e.message)
      }
    })
  })

  // Adjust scroll mode after rendering
  try { updatePlayerListScrollMode() } catch (_e) {}
}

function markExcluInList (nomExclu) {
  // Retire d'abord toutes marques existantes
  divListeJoueursTournoi.querySelectorAll('.label-exclu').forEach(el => el.remove())
  if (!nomExclu) return
  const rows = divListeJoueursTournoi.querySelectorAll('.joueur-tournoi-row')
  rows.forEach(r => {
    const name = r.querySelector('.joueur-tournoi-nom').textContent.trim()
    if (name.toLowerCase() === (nomExclu || '').toLowerCase()) {
      const span = document.createElement('span')
      span.className = 'label-exclu'
      span.textContent = ' (exclu)'
      // append as a sibling so it participates in the row's flex layout
      r.appendChild(span)
    }
  })
}

async function renderListeGenerale () {
  try {
    listeGenerale = await loadListeJoueurs()
    listeGenerale.sort((a, b) =>
      a.localeCompare(b, 'fr', { sensitivity: 'base' })
    )

    divListeJoueurs.innerHTML = listeGenerale
      .map(
        (nom) => `
          <div class="joueur-general-row">
            <button type="button" class="btn-trash btn-trash-general" data-nom="${nom}" title="Retirer ce joueur de la liste générale">🗑︎</button>
            <div class="joueur-item ${listeTournoi.includes(nom) ? 'selected' : ''}" data-nom="${nom}">${nom}</div>
          </div>
        `
      )
      .join('')

    divListeJoueurs.querySelectorAll('.joueur-item').forEach((el) => {
      el.addEventListener('click', async (e) => {
        const valeur = el.dataset.nom
        const idx = listeGenerale.indexOf(valeur)
        const changedNames = []

        // Shift+click: select/deselect a contiguous range between lastClickedGeneralIndex and current
        if (e.shiftKey && lastClickedGeneralIndex !== null && idx !== -1) {
          const start = Math.min(lastClickedGeneralIndex, idx)
          const end = Math.max(lastClickedGeneralIndex, idx)
          const shouldSelect = !listeTournoi.includes(valeur)
          for (let i = start; i <= end; i++) {
            const name = listeGenerale[i]
            if (shouldSelect) {
              if (!listeTournoi.includes(name)) { listeTournoi.push(name); changedNames.push(name) }
            } else {
              if (listeTournoi.includes(name)) { listeTournoi = listeTournoi.filter(n => n !== name); changedNames.push(name) }
            }
          }
        } else {
          // Single toggle (normal click)
          if (listeTournoi.includes(valeur)) { listeTournoi = listeTournoi.filter(n => n !== valeur); changedNames.push(valeur) }
          else { listeTournoi.push(valeur); changedNames.push(valeur) }
        }

        // remember this click for potential next Shift+click
        lastClickedGeneralIndex = idx

        // Re-render the tournoi list (right panel) as before
        renderListeTournoi()

        // Update selection classes in-place on the general list to avoid full re-render flicker
        try {
          if (changedNames.length > 0) {
            const setChanged = new Set(changedNames)
            Array.from(divListeJoueurs.querySelectorAll('.joueur-item')).forEach(it => {
              if (!setChanged.has(it.dataset.nom)) return
              if (listeTournoi.includes(it.dataset.nom)) it.classList.add('selected')
              else it.classList.remove('selected')
            })
          } else {
            // Fallback: toggle the clicked element only
            if (listeTournoi.includes(valeur)) el.classList.add('selected')
            else el.classList.remove('selected')
          }
        } catch (_e) { /* ignore UI update errors */ }

        try { scheduleSaveListeTournoi() } catch (e) { showAlert('Erreur en sauvegardant la liste du tournoi : ' + e.message) }
      })
    })

    divListeJoueurs.querySelectorAll('.btn-trash-general').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const nom = btn.dataset.nom

        // Suppression sans confirmation
        listeGenerale = listeGenerale.filter((n) => n !== nom)
        listeGenerale.sort((a, b) =>
          a.localeCompare(b, 'fr', { sensitivity: 'base' })
        )
        await saveListeJoueurs(listeGenerale)

        listeTournoi = listeTournoi.filter((n) => n !== nom)
        renderListeTournoi()
        try {
          scheduleSaveListeTournoi()
        } catch (e2) {
          showAlert('Erreur en sauvegardant la liste du tournoi : ' + e2.message)
        }

        await renderListeGenerale()

        // Adjust scroll mode after rendering
        try { updatePlayerListScrollMode() } catch (_e) {}
      })
    })
  } catch (e) {
    console.error('renderListeGenerale ERREUR', e)
  }
}

async function initJoueursTournoi () {
  try {
    const joueursTournoi = await loadJoueursTournoi()
    // If no saved list exists (null/undefined), fall back to the general list.
    // If the saved list is explicitly an empty array, keep it (user cleared it).
    if (joueursTournoi == null) {
      const general = await loadListeJoueurs()
      listeTournoi = [...general]
      scheduleSaveListeTournoi()
    } else {
      listeTournoi = joueursTournoi
    }

    renderListeTournoi()
    await renderListeGenerale()
  } catch (e) {
    console.error('initJoueursTournoi ERREUR', e)
  }
}

async function ajouterJoueur (nomInput, addToTournoi = false) {
  if (!nomInput) return
  // Nettoyage + Formatage "Initiale En Majuscule" (Title Case)
  // Ex: "jean-pierre" -> "Jean-Pierre", "toto" -> "Toto"
  const clean = nomInput
    .trim()
    .toLowerCase()
    .replace(/(?:^|[\s-])\w/g, (match) => match.toUpperCase())

  if (!clean) return

  let changedGenerale = false
  if (!listeGenerale.includes(clean)) {
    listeGenerale.push(clean)
    listeGenerale.sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
    await saveListeJoueurs(listeGenerale)
    changedGenerale = true
  }

  // Si demandé (paramètre addToTournoi), ajouter aussi dans la liste du tournoi
  if (addToTournoi) {
    if (!listeTournoi.includes(clean)) {
      listeTournoi.push(clean)
      scheduleSaveListeTournoi()
    }
  }

  // Rafraîchir l'affichage
  if (changedGenerale) await renderListeGenerale()
  if (addToTournoi) {
    renderListeTournoi()
    await renderListeGenerale()
  }
}
// Gestion des Morts (boutons fixes) - SUPPRIMÉ
// document.querySelectorAll(".btn-add-mort").forEach((btn) => {...});

document
  .getElementById('btn-vider-liste-generale')
  .addEventListener('click', async () => {
    if (
      await askConfirm(
        'Êtes-vous SÛR de vouloir vider TOUTE la liste générale des joueurs ?\nCette action est irréversible.'
      )
    ) {
      try {
        await saveListeJoueurs([])
        await renderListeGenerale()
      } catch (e) {
        showAlert('Erreur lors de la suppression : ' + e.message)
      }
    }
  })

if (btnClearJoueursTournoi) btnClearJoueursTournoi.addEventListener('click', async () => {
  if (
    !await askConfirm(
      'Effacer tous les joueurs du tournoi ?\nCela effacera aussi le tirage, le plan de table et les scores de la soirée.'
    )
  ) { return }
  // Réinitialiser le mode de jeu
  try { setMode('normal') } catch (_e) { /* ignore */ }
  // 1. Joueurs
  listeTournoi = []
  renderListeTournoi()
  await renderListeGenerale()

  try {
    // Save immediately (annule toute sauvegarde différée en cours) pour éviter une écriture différée
    if (_saveListeTimer) { clearTimeout(_saveListeTimer); _saveListeTimer = null }
    await saveJoueursTournoi(listeTournoi)
  } catch (e) {
    showAlert('Erreur en sauvegardant la liste du tournoi : ' + e.message)
  }

  // 2. Tirage & Plan de table
  saveTirage([])
  dernierDictRotations = null
  rotationsResultDiv.innerHTML = ''
  if (planHeadingEl) planHeadingEl.textContent = 'Plan de table / Manches'

  // Reset selects & Feuille table
  selectRotation.innerHTML = ''
  // selectTable removed

  // Effacer scores persistants lorsque l'on vide la liste du tournoi
  try {
    await setScoresTournoi([])
  } catch (e) { console.warn('Failed clearing scores after btnClearJoueursTournoi', e) }
  try { clearAllValidatedMancheSnapshots() } catch (_e) { /* ignore */ }

  // Ensure only the Saisie mode is active
  try {
    if (containerSaisie) containerSaisie.classList.remove('hidden')
    try { renderSaisie() } catch (_e) {}
  } catch (e) {
    // ignore si éléments non présents
  }

  // Nettoyage des données liées au tirage/exclusion
  try {
    await setExclusTournoi([])
  } catch (_e) { /* ignore */ }
  try { clearExcluSeatIndex() } catch (_e) { /* ignore */ }
  try { localStorage.removeItem('tarot_full_tirage'); dernierFullTirage = null } catch (_e) { /* ignore */ }
  try { setFeuilleExcluInfo(null, 0) } catch (_e) { /* ignore */ }

  // 3. Scores de soirée
  try {
    await setScoresTournoi([])
    await renderFeuilleSoiree()
  } catch (e) {
    showAlert('Erreur en effaçant les scores de la soirée : ' + e.message)
  }
})

// ------------------ Rotations ------------------

async function mettreAJourSelectRotationsEtTables () {
  if (!dernierDictRotations) return
  const nomsRotations = Object.keys(dernierDictRotations)
  if (!nomsRotations.length) return

  // previous gating removed - all rotations selectable immediately.
  const scores = await getScoresTournoi()
  // In exclu mode we will disable selection of already-validated manches.
  const inExcluMode = (typeof getMode === 'function' && getMode() === 'exclu')
  let lockedIndices = new Set()
  if (inExcluMode) {
    try {
      const persistedTables = await getScoresParTable() || []
      persistedTables.forEach(t => {
        if (t && Array.isArray(t.parties)) {
          t.parties.forEach((p, idx) => { if (p && p.locked) lockedIndices.add(idx) })
        }
      })
    } catch (_e) { lockedIndices = new Set() }
  }
  // Also consider validated snapshots stored in localStorage (`validated_manches_data`).
  // Some validation flows mark locks in the saved snapshot rather than in scores_par_table.
  try {
    const allSnaps = JSON.parse(localStorage.getItem('validated_manches_data') || '{}')
    Object.keys(allSnaps || {}).forEach((rot) => {
      const snapTables = allSnaps[rot] || []
      snapTables.forEach(t => {
        if (t && Array.isArray(t.parties)) {
          t.parties.forEach((p, idx) => { if (p && p.locked) lockedIndices.add(idx) })
        }
      })
    })
  } catch (_e) { /* ignore snapshot read errors */ }
  let indexASelectionner = 0
  let foundFirstIncomplete = false
  const optionsHtml = nomsRotations.map((nom, index) => {
    // By default selectable, but if in exclu mode and this manche index
    // is locked somewhere, mark option inaccessible.
    const accessible = !(inExcluMode && lockedIndices.has(index))
    const missing = []

    if (!foundFirstIncomplete) {
      // purely to decide which option to preselect by default
      const couranteComplete = listeTournoi.every(nomJoueur => {
        const row = findRowByName(scores, nomJoueur)
        return row && row.length >= index + 3
      })
      if (!couranteComplete) {
        indexASelectionner = index
        foundFirstIncomplete = true
      } else {
        indexASelectionner = index
      }
    }


    const disabledAttr = accessible ? '' : 'disabled'
    const styleAttr = accessible ? '' : "style='color: #888; font-style: italic;'"
    const label = accessible ? nom : `${nom} (Verrouillée)`

    // On stocke les manquants dans un attribut data (échappé basiquement pour noms simples)
    const missingStr = missing.slice(0, 5).join(', ') + (missing.length > 5 ? '...' : '')
    const dataMissing = accessible ? '' : `data-missing="${missingStr}"`

    return `<option value="${nom}" ${disabledAttr} ${styleAttr} ${dataMissing}>${label}</option>`
  }).join('')

  selectRotation.innerHTML = optionsHtml

  if (selectRotation.options.length > indexASelectionner) {
    selectRotation.selectedIndex = indexASelectionner
  }

  // use window.Event when available (JSDOM compatibility)
  const event = (typeof window !== 'undefined' && window.Event) ? new window.Event('change') : new Event('change')
  selectRotation.dispatchEvent(event)
}

// Render per‑table matrix (7 parties) — new UI
// Module-level helper: validate & persist one table from its DOM table element
// Validate and persist a single table card; optionally transfer scores of the
// specified mancheIndex. Returns true if transfer occurred (all cells non-empty).
async function validateAndPersistTable (tData, tblEl, mancheIndex = -1) {
  try {
    const partiesEls = Array.from(tblEl.querySelectorAll('tbody tr')).slice(0, 7)
    const tableSize = (tData && Array.isArray(tData.players)) ? tData.players.length : 0
    const newParties = []
    const newTotals = new Array(tableSize).fill(0)

    let transferForThisTable = false
    // compute filled status for the manche we care about (if provided)
    let mancheAllFilled = true

    for (let r = 0; r < partiesEls.length; r++) {
      const rowEl = partiesEls[r]
      const inputs = Array.from(rowEl.querySelectorAll('input'))
      const filled = inputs.filter(i => i.value !== '')

      if (mancheIndex === r) {
        // diagnostics
        try { if (typeof process !== 'undefined' && process.stdout && process.stdout.write) process.stdout.write(`[validateTable] mancheIndex=${mancheIndex} row=${r} inputVals=${inputs.map(i=>i.value).join('|')}\n`) } catch(_e){}
        // check that every player in this manche has a non-empty entry
        mancheAllFilled = inputs.every(i => i.value !== '')
        try { if (typeof process !== 'undefined' && process.stdout && process.stdout.write) process.stdout.write(`[validateTable] mancheAllFilled=${mancheAllFilled}\n`) } catch(_e){}
      }

      let rowScores = new Array(tableSize).fill(0)
      if (filled.length === 0) {
        // Preserve previous behavior for 5-player tables (pre-filled zeros).
        // For other table sizes, keep values as `null` so inputs stay empty
        // instead of showing spurious "0" entries when nothing was entered.
        if (tableSize === 5) rowScores = new Array(tableSize).fill(0)
        else rowScores = new Array(tableSize).fill(null)
      } else if (filled.length === 1) {
        const attackerInput = filled[0]
        const attackerVal = Number(attackerInput.value)
        const attackerCol = Number(attackerInput.dataset.colIdx || 0)
        const validationArg = (Array.isArray(tData.players) && tData.players.some(p => String(p || '').toUpperCase().startsWith('MORT'))) ? tData.players : tableSize
        const mortDiv = (getMode && getMode() === 'morts') ? getMortsDivisor() : null
        if (!validateAttackerDivisibility(attackerVal, validationArg, mortDiv)) {
          // Show explanatory bubble and skip persisting this table for now
          const div = (mortDiv && (mortDiv === 2 || mortDiv === 3)) ? mortDiv : getRequiredDivisor(validationArg)
          try { showValidationBubble(attackerInput, `Valeur invalide — multiple de ${div} requis`) } catch (_e) {}
          try { attackerInput.focus(); attackerInput.select() } catch (_e) {}
          // mark as not fully filled so persistence won't transfer
          mancheAllFilled = false
          return false
        }
        // figure out any exempt (donneur) positions by checking disabled inputs
        const exemptIndices = new Set()
        inputs.forEach((inp, idx) => {
          if (inp.disabled) exemptIndices.add(idx)
        })
        rowScores = placeAttackerAtIndex(attackerVal, validationArg, attackerCol, exemptIndices, mortDiv)
      } else {
        for (let c = 0; c < tableSize; c++) rowScores[c] = (inputs[c] && inputs[c].value !== '') ? Number(inputs[c].value) : null
      }

      // Zero out Morts
      for (let c = 0; c < tableSize; c++) {
        const pname = (tData.players && tData.players[c]) || ''
        if (String(pname).toUpperCase().startsWith('MORT')) rowScores[c] = 0
      }

      // Update visible inputs so user sees final row values. Do not
      // overwrite disabled cells (donneur/mort) – they should remain blank.
      // Skip zero values to avoid flashing "0" before the next manche re-renders.
      for (let c = 0; c < inputs.length; c++) {
        const inp = inputs[c]
        if (!inp || inp.disabled) continue
        const v = rowScores[c]
        inp.value = (v === null || v === undefined) ? '' : String(v)
      }

      // accumulate totals
      for (let c = 0; c < tableSize; c++) newTotals[c] = Number(newTotals[c] || 0) + Number(rowScores[c] || 0)
      newParties.push({ partie: r + 1, scores: rowScores })
    }

    // Upsert persisted table
    let tablesData = []
    try { tablesData = await getScoresParTable() || [] } catch (_e) { tablesData = [] }
    const entry = { table: tData.table, players: tData.players.slice(), parties: newParties, totals: newTotals }
    const idx = (tablesData || []).findIndex(x => Number(x.table) === Number(tData.table))
    if (idx >= 0) tablesData[idx] = entry
    else tablesData.push(entry)
    await setScoresParTable(tablesData)
    try { window.__lastPersistedTableEntry = entry; window.__validateAndPersistCalls = window.__validateAndPersistCalls || []; window.__validateAndPersistCalls.push({ ts: Date.now(), table: entry.table, totals: (entry.totals || []).slice() }) } catch (_e) {}

    // Persist totals into scores_tournoi (allow validation even when some
    // inputs are empty — do not block per-manche except existing serpentin logic)
    try {
      const feuille = entry.players.map((nom, i) => [nom, entry.totals[i], entry.totals[i]])
      const scoresSoiree = await getScoresTournoi()
      const nbPartiesMax = Number(nbPartiesInput.value || 4)
      const newScores = applyFeuilleToScoresSoiree(scoresSoiree, feuille, nbPartiesMax, selectRotation.selectedIndex)
      await setScoresTournoi(newScores)
      transferForThisTable = true
    } catch (e) {
      console.warn('Erreur synchronisation totaux vers scores_tournoi', e)
    }

    if (transferForThisTable && mancheIndex !== -1 && partiesEls[mancheIndex]) {
      tData.parties = tData.parties || []
      if (!tData.parties[mancheIndex]) tData.parties[mancheIndex] = {}
      // intentionally do NOT set `locked` here; inputs should remain editable
    }

    try { await renderFeuilleSoiree() } catch (_e) {}
    try { await updateRotationsDisplay() } catch (_e) {}

    return transferForThisTable
  } catch (e) {
    console.error('validateAndPersistTable failed', e)
    throw e
  }
}

// Module-level: perform the global "Valider manche" flow (reusable by header + UI)
async function performGlobalValidateManche () {
  try {
    // If in 'exclu' mode, prevent validating a manche that's already locked
    try {
      const inExcluMode = (typeof getMode === 'function' && getMode() === 'exclu')
      if (inExcluMode) {
        const currentIdx = (selectRotation && typeof selectRotation.selectedIndex === 'number') ? selectRotation.selectedIndex : 0
        try {
          const persisted = await getScoresParTable() || []
          const anyLocked = (persisted || []).some(t => Array.isArray(t.parties) && t.parties[currentIdx] && t.parties[currentIdx].locked)
          if (anyLocked) {
            showAlert("En mode 'exclu', vous ne pouvez pas re-valider une manche déjà validée.")
            return
          }
        } catch (_e) { /* ignore persistence errors and continue */ }
      }
    } catch (_e) { /* ignore */ }
    // Vérifier que tous les joueurs ont un total non nul (au moins un score saisi ou calculé)
    const allCards = Array.from((containerSaisie || document).querySelectorAll('.fast-table-card'))
    const joueursManquants = []
    for (const card of allCards) {
      const tableNum = card.dataset.table || '?'
      const totalCells = card.querySelectorAll('td[data-total-idx]')
      const headers = card.querySelectorAll('thead th')
      totalCells.forEach(cell => {
        const txt = (cell.textContent || '').trim()
        if (txt === '') {
          const idx = Number(cell.dataset.totalIdx || 0)
          const playerName = (headers[idx + 1] && headers[idx + 1].textContent) || `Joueur ${idx + 1}`
          joueursManquants.push(`${playerName} (table ${tableNum})`)
        }
      })
    }
    if (joueursManquants.length > 0) {
      showAlert(`Validation impossible : certains joueurs n'ont aucun score saisi.\n\n${joueursManquants.join('\n')}`)
      return
    }

    const snapshotSafe = async (fn) => { try { return JSON.parse(JSON.stringify(await fn())) } catch (_e) { return null } }

    const beforeTables = await snapshotSafe(getScoresParTable) || []
    const beforeScores = await snapshotSafe(getScoresTournoi) || []
    const beforeRot = (typeof dernierDictRotations !== 'undefined') ? JSON.parse(JSON.stringify(dernierDictRotations || {})) : {}

    window.__saisieActionLogs = window.__saisieActionLogs || []
    window.__saisieActionLogs.push({ type: 'validateManche.before', ts: Date.now(), rotation: beforeRot, tables: beforeTables, scoresTournoi: beforeScores })
    window.__lastTablesData = beforeTables
    window.__lastScoresTournoiWrite = beforeScores

    // capture the index up‑front in case it changes during the validation loop
    const currentIdx = (selectRotation && typeof selectRotation.selectedIndex === 'number') ? selectRotation.selectedIndex : 0
    const tableCards = Array.from((containerSaisie || document).querySelectorAll('.fast-table-card'))
    let anyTransfer = false
    for (const card of tableCards) {
      try {
        const tableNum = Number(card.dataset.table)
        const tblEl = card.querySelector('table')
        // Derive players from current rotation if possible, otherwise attempt persisted fallback
        const nomRot = selectRotation && selectRotation.value
        const rotTables = (dernierDictRotations && dernierDictRotations[nomRot]) || []
        const tableInfo = rotTables.find(t => Number(t.table) === tableNum)
        const players = tableInfo ? (tableInfo.joueurs || []).map(j => (j && j.nom) || '') : []
        const tData = { table: tableNum, players }
        if (tData && tblEl) {
          const transferred = await validateAndPersistTable(tData, tblEl, currentIdx)
          if (transferred) {
            anyTransfer = true
          } else {
            // immediate fallback: perhaps validateAndPersistTable didn't transfer
            // because it saw an outdated selectRotation.selectedIndex or because
            // persistence lagged. look at the last entry that was written; if it
            // contains a fully-filled manche at currentIdx, we can force the
            // tournament transfer now, avoiding reliance on later persistence.
            try {
              const entry = window.__lastPersistedTableEntry || null
              if (entry && Array.isArray(entry.parties) && entry.parties[currentIdx]) {
                const sc = entry.parties[currentIdx].scores || []
                if (sc.length && sc.every(v => v !== null && v !== undefined)) {
                  // compute feuille and do transfer (same as fallback later)
                  const feuille = (entry.players || []).map((nom, i) => [nom, entry.totals[i], entry.totals[i]])
                  const scoresSoiree = await getScoresTournoi()
                  const nbPartiesMax = Number(nbPartiesInput.value || 4)
                  const newScores = applyFeuilleToScoresSoiree(scoresSoiree, feuille, nbPartiesMax, currentIdx)
                  await setScoresTournoi(newScores)
                  anyTransfer = true
                }
              }
            } catch (_e) { /* ignore fallback errors per-table */ }
          }
        }
      } catch (e) { console.warn('global validate: per-table programmatic validate failed', e) }
    }

    // allow persistence to settle
    await new Promise(r => setTimeout(r, 100))

    // Save validated manche snapshot for future review. Mark the current
    // manche as `locked` in the snapshot so renderSaisie can detect it.
    try {
      const nomRotSnap = selectRotation && selectRotation.value
      const snapshotTables = await getScoresParTable() || []
      if (nomRotSnap) {
        try {
          // mark locked only when the manche contains fully-filled scores
          snapshotTables.forEach((t) => {
            if (t && Array.isArray(t.parties) && t.parties[currentIdx]) {
              const sc = t.parties[currentIdx].scores || []
              if (sc.length && sc.every(v => v !== null && v !== undefined)) {
                // snapshot contains fully-filled scores; do not mark as locked
              }
            }
          })
        } catch (_e) { /* ignore */ }
        saveValidatedMancheSnapshot(nomRotSnap, snapshotTables)
      }
    } catch (_e) { /* ignore */ }

    // Clear the next manche for all tables
    try {
      const idx = selectRotation.selectedIndex || 0
      const nextIdx = idx + 1
      const persistedNow = await getScoresParTable() || []
      const cleared = clearNextManche(persistedNow, nextIdx)
      await setScoresParTable(cleared)
    } catch (e) { console.warn('clear next manche (legacy UI) failed', e) }

    // fallback: if no transfer occurred but persisted tables show the current
    // manche fully filled, perform the tournament score transfer ourselves.
    if (!anyTransfer) {
      try {
        const persistedAfterLoop = await getScoresParTable() || []
        const nbPartiesMax = Number(nbPartiesInput.value || 4)
        for (const t of persistedAfterLoop) {
          if (t && Array.isArray(t.parties) && t.parties[currentIdx]) {
            const sc = t.parties[currentIdx].scores || []
            if (sc.length && sc.every(v => v !== null && v !== undefined)) {
              // compute feuille from totals, same as in validateAndPersistTable
              const feuille = (t.players || []).map((nom, i) => [nom, t.totals[i], t.totals[i]])
              try {
                let scoresSoiree = await getScoresTournoi()
                const newScores = applyFeuilleToScoresSoiree(scoresSoiree, feuille, nbPartiesMax, currentIdx)
                await setScoresTournoi(newScores)
                anyTransfer = true
                // once we've transferred one table, additional tables can also
                // be merged but we simply continue the loop so each will be applied
              } catch (e) {
                console.warn('fallback transfer to scoresTournoi failed', e)
              }
            }
          }
        }
      } catch (_e) { /* ignore fallback errors */ }
    }

    // Snapshot AFTER
    let afterTables = await snapshotSafe(getScoresParTable) || []
    const afterScores = await snapshotSafe(getScoresTournoi) || []
    const afterRot = (typeof dernierDictRotations !== 'undefined') ? JSON.parse(JSON.stringify(dernierDictRotations || {})) : {}

    // IMPORTANT: ne PAS écraser les données persistées (`scores_par_table`) ici.
    // Les manches validées ont déjà été upsertées par `validateAndPersistTable` —
    // nous conservons l'historique des parties (parties/totaux) pour audit et reprise.
    // Pour rafraîchir l'UI on se repose sur la selection/dispatch ci‑dessous (renderSaisie).
    try {
      // no-op persistence; keep `afterTables` equal au snapshot retourné par getScoresParTable
      // (laisser `scores_par_table` intact)
      afterTables = afterTables || []
    } catch (e) {
      console.warn('Skipping persisted tables clear after validateManche:', e)
    }

    // Select next manche (if available) – always advance one step even if no
    // tables reported a transfer. this keeps the UI moving predictably when the
    // user clicks the global "Valider manche" button.

    // si mode 'exclu', calculer l'exclu pour la manche suivante et persister.
    // IMPORTANT: doit s'exécuter AVANT le calcul serpentin car applyExclusToRotations
    // reconstruit dernierDictRotations (avec N-1 rotations) et écraserait la rotation
    // serpentin si elle était déjà présente.
    try {
      if (getMode && getMode() === 'exclu') {
        try { await ensureExcluHasScoreForManche(currentIdx) } catch (_e) { /* ignore */ }
        const exclusArr = (await getExclusTournoi()) || []
        // Ne pas calculer d'exclu pour la prochaine manche si le mode serpentin
        // est activé ET que la prochaine manche est la dernière (serpentin).
        const totalNb = Number((nbPartiesInput && nbPartiesInput.value) ? nbPartiesInput.value : ((selectRotation && selectRotation.options && selectRotation.options.length) || 0))
        const nextIdx = (typeof currentIdx === 'number') ? currentIdx + 1 : null
        const skipNextExcluForSerpentin = nextIdx !== null && getSerpentinEnabled() && totalNb >= 2 && nextIdx === totalNb - 1

        let newExclus
        if (skipNextExcluForSerpentin) {
          // Ensure there is no exclusion for the last serpentin manche
          const arrCopy = Array.isArray(exclusArr) ? [...exclusArr] : []
          while (arrCopy.length < nextIdx + 1) arrCopy.push(null)
          arrCopy[nextIdx] = null
          newExclus = arrCopy
        } else {
          newExclus = computeNextExclu(afterScores || [], exclusArr, currentIdx)
        }

        if (JSON.stringify(newExclus) !== JSON.stringify(exclusArr)) {
          await setExclusTournoi(newExclus)
          try { await applyExclusToRotations(newExclus) } catch (_e) { /* ignore */ }
        }
      }
    } catch (e) {
      console.warn('auto compute next exclu failed', e)
    }

    // Recompute serpentin last rotation since standings have changed but
    // only when we've just validated the penultimate manche.
    // Runs AFTER exclu so applyExclusToRotations cannot erase the serpentin entry.
    try {
      const totalNb = Number(nbPartiesInput.value || selectRotation.options.length || 0)
      if (getSerpentinEnabled() && typeof currentIdx === 'number' && totalNb >= 2 && currentIdx === totalNb - 2) {
        await computeSerpentinLastRotation(totalNb)
      }
    } catch (_e) {}
    try {
      const nextIdx = Math.min((selectRotation.options.length - 1), (currentIdx || 0) + 1)
      if (typeof selectRotation.selectedIndex === 'number' && nextIdx !== selectRotation.selectedIndex) {
        try { if (typeof process !== 'undefined' && process.stdout && process.stdout.write) process.stdout.write(`[validateManche] advancing index from ${selectRotation.selectedIndex} to ${nextIdx} (anyTransfer=${anyTransfer})\n`) } catch (_e) {}
        selectRotation.selectedIndex = nextIdx
        selectRotation.dispatchEvent(new Event('change'))
      } else {
        try { if (typeof process !== 'undefined' && process.stdout && process.stdout.write) process.stdout.write(`[validateManche] not advancing index, current=${selectRotation.selectedIndex} nextIdx=${nextIdx} anyTransfer=${anyTransfer}\n`) } catch (_e) {}
        try { renderSaisie() } catch (_e) {}
      }
    } catch (_e) { /* ignore */ }

    window.__saisieActionLogs.push({ type: 'validateManche.after', ts: Date.now(), rotation: afterRot, tables: afterTables, scoresTournoi: afterScores })
    window.__lastTablesData = afterTables
    window.__lastScoresTournoiWrite = afterScores
    console.info('Valider manche — AFTER snapshot', { rotation: afterRot, tables: afterTables, scoresTournoi: afterScores })
  } catch (e) {
    console.warn('Global validate manche failed', e)
  }
}

async function renderSaisieParTable () {
  // debug entry
  try { if (typeof process !== 'undefined' && process.stdout && process.stdout.write) process.stdout.write('ENTER renderSaisieParTable\n') } catch (_e) {}
  if (!containerSaisie) return
  // Prevent concurrent renders which caused duplicate UI
  if (typeof _renderingSaisieLock === 'undefined') _renderingSaisieLock = false
  if (_renderingSaisieLock) {
    console.warn('renderSaisieParTable: detected rendering lock — clearing stale lock and continuing')
    _renderingSaisieLock = false
  }
  _renderingSaisieLock = true
  try {
    containerSaisie.innerHTML = ''
    if (!dernierDictRotations) {
      // No rotations available -> show helpful hint + actionable buttons so users can create a plan
      containerSaisie.innerHTML = `
        <div style="padding:20px;color:#ddd;">
          <div style="margin-bottom:8px">Aucune composition trouvée — générez le plan de table pour commencer la saisie.</div>
          <div style="display:flex;gap:8px;">
            <button id="saisie-fallback-compose" class="btn-primary">Composer 1ère manche</button>
            <button id="saisie-fallback-tirage" class="btn-secondary">Tirage au sort</button>
          </div>
        </div>
      `

      // Wire fallback buttons to existing handlers (best‑effort)
      try {
        const bCompose = document.getElementById('saisie-fallback-compose')
        const bTirage = document.getElementById('saisie-fallback-tirage')
        if (bCompose) bCompose.onclick = () => { const btn = document.getElementById('btn-manual-composition-joueurs'); if (btn) btn.click(); else openCompositionModal() }
        if (bTirage) bTirage.onclick = () => { const bt = document.getElementById('btn-tirage'); if (bt) bt.click(); else try { btnTirage && btnTirage.click() } catch (_e) {} }
      } catch (_e) {}

      return
    }

    // Ensure we use a valid rotation key (fallback to first available)
    let nomRot = (selectRotation && selectRotation.value) ? selectRotation.value : ''
    if (!nomRot || !Object.prototype.hasOwnProperty.call(dernierDictRotations, nomRot)) {
      const keys = Object.keys(dernierDictRotations || {})
      nomRot = keys.length ? keys[0] : ''
      if (selectRotation && nomRot) {
        try { selectRotation.value = nomRot; selectRotation.selectedIndex = 0 } catch (_e) {}
      }
    }

    const tables = (nomRot && dernierDictRotations[nomRot]) ? dernierDictRotations[nomRot] : []
    if (!tables || tables.length === 0) {
      containerSaisie.innerHTML = `<div style="padding:20px;color:#ddd;">Aucune table disponible pour la rotation sélectionnée.</div>`
      return
    }

    // Load persisted per-table matrices (fallback to defaults)
    let tablesData = []
    try { tablesData = await getScoresParTable() || [] } catch (_e) { tablesData = [] }
    // use global object for debug storage (JSDOM may replace window)
    const dbgRoot = (typeof global !== 'undefined') ? global : window
    if (dbgRoot && dbgRoot.__debugDumpTables) {
      dbgRoot.__debugDumpCount = (dbgRoot.__debugDumpCount || 0) + 1
      const msg = `DEBUG[#${dbgRoot.__debugDumpCount}]: fetched tablesData ` + JSON.stringify(tablesData, null, 2) + '\n'
      try { if (typeof process !== 'undefined' && process.stdout && process.stdout.write) process.stdout.write(msg) } catch (_e) { }
    }

    // NOTE: per-table validation implementation moved to module-level `validateAndPersistTable`
    // to make the global validation accessible from header buttons and other UI paths.


    // merge rotation specification with any persisted table data,
    // resetting entries whose player list no longer matches.
    let normalizedTables = mergeRotationWithStoredTables(tables, tablesData || [])

    // Check if this rotation has a validated snapshot (past manche review)
    const validatedSnapshot = loadValidatedMancheSnapshot(nomRot)
    const isValidatedManche = !!validatedSnapshot
    // If a validated snapshot exists, use it as the display base. When
    // `validatedEditMode` is false the view will be read-only; when true the
    // same snapshot is used but inputs are editable so users can adjust values.
    if (isValidatedManche) {
      try { normalizedTables = JSON.parse(JSON.stringify(validatedSnapshot)) } catch (_e) { normalizedTables = validatedSnapshot }
    }
    const isValidatedMancheView = isValidatedManche && !validatedEditMode

    // Récupérer les exclus (liste par manche) pour cette rotation
    let exclusArr = []
    try { exclusArr = (await getExclusTournoi()) || [] } catch (_e) { exclusArr = [] }

    // Afficher un bandeau informatif si on est en mode 'exclu' et qu'il existe
    // au moins une manche validée (repérée par `part.locked`). On ignore la
    // manche courante (`selIdxTop`) pour ne pas bloquer l'édition en cours.
    try {
      const inExcluModeTop = (typeof getMode === 'function' && getMode() === 'exclu')
      const selIdxTop = (selectRotation && typeof selectRotation.selectedIndex === 'number') ? selectRotation.selectedIndex : 0
      // réutiliser `exclusArr` défini plus haut
      const exclusArrTop = exclusArr || []
      if (inExcluModeTop) {
        let hasValidated = false
        try {
          const persisted = tablesData || []
          for (const t of persisted) {
            if (t && Array.isArray(t.parties)) {
              for (let idx = 0; idx < t.parties.length; idx++) {
                if (idx === selIdxTop) continue
                const p = t.parties[idx]
                if (p && p.locked) { hasValidated = true; break }
              }
            }
            if (hasValidated) break
          }
        } catch (_e) { /* ignore */ }
        if (!hasValidated && validatedSnapshot) {
          try {
            for (const t of (validatedSnapshot || [])) {
              if (t && Array.isArray(t.parties)) {
                for (let idx = 0; idx < t.parties.length; idx++) {
                  if (idx === selIdxTop) continue
                  const p = t.parties[idx]
                  if (p && p.locked) { hasValidated = true; break }
                }
              }
              if (hasValidated) break
            }
          } catch (_e) { /* ignore */ }
        }
        if (hasValidated) {
          const banner = document.createElement('div')
          banner.className = 'exclu-validated-banner'
          banner.textContent = "Modification de manche validée impossible en mode exclu"
          banner.style.padding = '8px 12px'
          banner.style.background = '#8b0000'
          banner.style.color = '#fff'
          banner.style.marginBottom = '8px'
          banner.style.borderRadius = '4px'
          try { containerSaisie.appendChild(banner) } catch (_e) {}
        }
      }
    } catch (_e) { /* ignore */ }

    // if the rotation key changed since last render, wipe every table completely
    // (similar to clicking the trash icon) so old scores cannot leak into a
    // different composition. this handles mode switches and manual rotation
    // changes uniformly for all game modes.
    const currentRotKey = nomRot || ''
    if (!isValidatedManche && typeof _lastRenderedRotation !== 'undefined' && _lastRenderedRotation !== currentRotKey) {
      normalizedTables = (normalizedTables || []).map(t => {
        const size = (t.players || []).length
        t.parties = (t.parties || []).map(p => ({ partie: p.partie, scores: new Array(size).fill(null) }))
        t.totals = new Array(size).fill(0)
        return t
      })
      try { await setScoresParTable(normalizedTables) } catch (_e) {}
    }
    _lastRenderedRotation = currentRotKey

    // Clear any pre‑existing scores for the currently selected manche.  When
    // the user switches rotations manually (en particulier en mode exclu) the
    // persisted tablesData may still contain values written during a previous
    // session.  Those old values leaked into the newly rendered inputs; the UI
    // should always present a fresh row for the active manche unless the user
    // has explicitly transferred scores via "Valider manche".  We therefore
    // zero out the corresponding slot in the model before building the DOM.
    if (!isValidatedManche) {
      try {
        const selIdx = (selectRotation && typeof selectRotation.selectedIndex === 'number')
          ? selectRotation.selectedIndex : 0
        normalizedTables = (normalizedTables || []).map((t) => {
          t.parties = t.parties || []
          const size = (t.players || []).length
          // ensure the array is long enough
          while (t.parties.length <= selIdx) {
            t.parties.push({ partie: t.parties.length + 1, scores: new Array(size).fill(null) })
          }
          // clear the scores for the active manche
          t.parties[selIdx].scores = new Array(size).fill(null)
          return t
        })
      } catch (_e) {
        // if something goes wrong we swallow the error; it's noncritical
      }
    }

    // Normalise le nombre de parties par table selon le réglage dynamique
    const _nbPPM = getNbPartiesParManche()
    normalizedTables = (normalizedTables || []).map(t => {
      const size = (t.players || []).length
      t.parties = t.parties || []
      // pad if too short
      while (t.parties.length < _nbPPM) t.parties.push({ partie: t.parties.length + 1, scores: new Array(size).fill(null) })
      // trim if too long (keep only the first _nbPPM)
      if (t.parties.length > _nbPPM) t.parties = t.parties.slice(0, _nbPPM)
      return t
    })

    const dbgRoot2 = (typeof global !== 'undefined') ? global : window
    if (dbgRoot2 && dbgRoot2.__debugDumpTables) {
      const msg = `DEBUG[#${dbgRoot2.__debugDumpCount}]: normalizedTables ` + JSON.stringify(normalizedTables, null, 2) + '\n'
      try { if (typeof process !== 'undefined' && process.stdout && process.stdout.write) process.stdout.write(msg) } catch (_e) { }
    }

    // Diagnostic: expose a compact summary so devtools can quickly show why inputs
    // might not appear (useful when users report 'cells not visible').
    try {
      window.__lastRenderedSaisie = {
        rotation: nomRot || null,
        tablesCount: (normalizedTables || []).length,
        summary: (normalizedTables || []).map(t => ({ table: t.table, players: (t.players || []).length, parties: (t.parties || []).length })),
        tables: JSON.parse(JSON.stringify(normalizedTables || []))
      }
    } catch (_e) {}

    // (validated snapshot is used as base; editing is allowed directly)

    normalizedTables.forEach((tData) => {
      const divTable = document.createElement('div')
      divTable.className = 'fast-table-card saisie-card'
    // Ensure card carries the table id so performGlobalValidateManche can read it
    divTable.dataset.table = String(tData.table)
      divTable.style.padding = '1px'
      divTable.style.background = '#1e1e1e'
      divTable.style.display = 'inline-block'
      divTable.style.verticalAlign = 'top'

      const title = document.createElement('h4')
      title.textContent = `Table ${tData.table}`
      title.style.margin = '0 0 10px 0'
      title.style.textAlign = 'center'
      // add trash icon for clearing this table (replaces reset button)
      if (!isValidatedManche || validatedEditMode) {
      const trashIcon = document.createElement('span')
      trashIcon.className = 'btn-trash'
      trashIcon.textContent = '🗑︎'
      trashIcon.title = 'Réinitialiser cette table'
      trashIcon.style.cursor = 'pointer'
      trashIcon.style.marginLeft = '8px'
      trashIcon.addEventListener('click', async () => {
        // Reset table immediately without confirmation
        tData.parties = tData.parties.map(p => ({ partie: p.partie, scores: new Array(tData.players.length).fill(null) }))
        tData.totals = new Array(tData.players.length).fill(0)
        let tablesData = []
        try { tablesData = await getScoresParTable() || [] } catch (_e) { tablesData = [] }
        const idx = (tablesData || []).findIndex(x => Number(x.table) === Number(tData.table))
        if (idx >= 0) tablesData[idx] = tData
        else tablesData.push(tData)
        await setScoresParTable(tablesData)
        renderSaisie()
      })
      title.appendChild(trashIcon)
      }
      divTable.appendChild(title)

      const tbl = document.createElement('table')
      tbl.style.width = '100%'
      tbl.style.borderCollapse = 'collapse'
      tbl.style.marginBottom = '8px'

      const thead = document.createElement('thead')
      const hr = document.createElement('tr')
      const thPart = document.createElement('th')
      thPart.className = 'col-partie'
      thPart.textContent = '#'
      thPart.style.padding = '1px'
      thPart.style.textAlign = 'center'
      hr.appendChild(thPart)
      tData.players.forEach((pn) => {
        const th = document.createElement('th')
        // Highlight 'Mort' placeholders in the header for clarity
        try {
          if (pn && String(pn).toUpperCase().startsWith('MORT')) {
            const span = document.createElement('span')
            span.className = 'label-mort'
            span.textContent = pn
            th.appendChild(span)
          } else {
            th.textContent = pn || '-'
          }
        } catch (_e) {
          th.textContent = pn || '-'
        }
        th.style.padding = '1px'
        th.style.textAlign = 'center'
        hr.appendChild(th)
      })
      thead.appendChild(hr)
      tbl.appendChild(thead)

      const tbody = document.createElement('tbody')
      // Keep track of last focused row so when user moves to the next cell/partie
      // we can compute the defenders for the row they just left.
      let lastFocusedRow = null
      tData.parties.forEach((part, partIdx) => {
        const tr = document.createElement('tr')
        const tdP = document.createElement('td')
        tdP.className = 'col-partie'
        tdP.textContent = String(part.partie)
        tdP.style.padding = '1px'
        tdP.style.borderTop = '1px solid #333'
        tdP.style.textAlign = 'center'
        tr.appendChild(tdP)

        const tableSize = tData.players.length

        // Determine whether this particular partie (manche) is considered
        // validated. We treat a manche as validated when any of the following
        // holds:
        // - the model already contains `part.locked` (legacy)
        // - the validated snapshot for this rotation contains fully-filled scores
        // - the persisted `scores_par_table` entry for this table contains
        //   fully-filled scores for this manche
        const persistedTablesForRender = tablesData || []
        const snapshotTablesForRender = validatedSnapshot || []
        const findPersistedEntry = (tblId) => (persistedTablesForRender || []).find(x => Number(x.table) === Number(tblId))
        const findSnapshotEntry = (tblId) => (snapshotTablesForRender || []).find(x => Number(x.table) === Number(tblId))

        // Helper: recompute and refresh Totaux display from `tData.parties`
        const updateTotalsDisplay = () => {
          try {
            const totals = new Array(tData.players.length).fill(0)
            for (let p = 0; p < (tData.parties || []).length; p++) {
              const sc = Array.isArray(tData.parties[p] && tData.parties[p].scores) ? tData.parties[p].scores : new Array(tData.players.length).fill(null)
              for (let i = 0; i < tData.players.length; i++) totals[i] += Number(sc[i] || 0)
            }
            tData.totals = totals
            // Update DOM totals cells if present
            const totalCells = tbody.querySelectorAll('td[data-total-idx]')
            totalCells.forEach((cell) => {
              const idx = Number(cell.dataset.totalIdx || 0)
              cell.textContent = String(totals[idx])
            })
          } catch (e) { /* best-effort */ }
        }

        // Helper: compute distribution for a row when exactly one cell (attaquant)
        // is filled. Updates visible inputs *and* keeps `tData.parties` in sync
        // so Totaux can be displayed live. (Totals are still persisted on global
        // validation.)
        const computeRowAndFill = (rowEl) => {
          if (!rowEl) return
          const inputs = Array.from(rowEl.querySelectorAll('input'))
          // Consider any non-empty, enabled, non-dealer input as the attacker value
          const manualFilled = inputs.filter(i => i.value !== '' && !i.disabled && !i.classList.contains('dealer-input'))
          if ((typeof global !== 'undefined' ? global : window).__debugDumpTables) {
            try { process.stdout.write(`computeRowAndFill called partIdx=${partIdx} manualFilled=${manualFilled.length}\n`) } catch (_e) {}
          }
          if (manualFilled.length !== 1) return
          const attackerInput = manualFilled[0]
          const attackerVal = Number(attackerInput.value)
          const attackerCol = Number(attackerInput.dataset.colIdx || 0)

          const validationArg = (Array.isArray(tData.players) && tData.players.some(p => String(p || '').toUpperCase().startsWith('MORT'))) ? tData.players : tableSize
          const mortDiv = (getMode && getMode() === 'morts') ? getMortsDivisor() : null
          if (!validateAttackerDivisibility(attackerVal, validationArg, mortDiv)) {
            // invalid divisibility — show bubble and do not compute defenders
            const div = (mortDiv && (mortDiv === 2 || mortDiv === 3)) ? mortDiv : getRequiredDivisor(validationArg)
            try { showValidationBubble(attackerInput, `Valeur invalide — multiple de ${div} requis`) } catch (_e) {}
            try { attackerInput.focus(); attackerInput.select() } catch (_e) {}
            return
          }

          // Determine exempt indices (disabled or dealer-input cells, excluding Morts
          // which are already handled separately by distributeAttackerScore)
          const exemptIndices = new Set()
          inputs.forEach((inp, idx) => {
            if (inp.disabled || inp.classList.contains('dealer-input')) {
              const pname = tData.players[idx] || ''
              if (!String(pname).toUpperCase().startsWith('MORT')) {
                exemptIndices.add(idx)
              }
            }
          })
          const mortDivLocal = (getMode && getMode() === 'morts') ? getMortsDivisor() : null
          let rowScores = placeAttackerAtIndex(attackerVal, validationArg, attackerCol, exemptIndices, mortDivLocal)
          // Zero out Morts
          for (let c = 0; c < tableSize; c++) {
            const pname = tData.players[c] || ''
            if (String(pname).toUpperCase().startsWith('MORT')) rowScores[c] = 0
          }

          // Update visible inputs: mark generated defender cells so validation
          // ignores them and make them readOnly to avoid accidental edits.
          for (let c = 0; c < inputs.length; c++) {
            const inpEl = inputs[c]
            if (!inpEl || inpEl.disabled) continue
            if (c === attackerCol) {
              inpEl.value = String(attackerVal)
            } else {
              const v = rowScores[c]
              inpEl.value = (v === 0 || v === null || v === undefined) ? '' : String(v)
            }
          }

          // Keep the tData.parties model in sync with visible inputs so Totaux
          // are available immediately (and for later persistence).
          const firstInput = inputs[0]
          const partIdx = firstInput ? Number(firstInput.dataset.partIdx || 0) : null
          if (partIdx !== null && typeof partIdx === 'number') {
            tData.parties = tData.parties || []
            tData.parties[partIdx] = tData.parties[partIdx] || { partie: partIdx + 1, scores: new Array(tData.players.length).fill(null) }
            tData.parties[partIdx].scores = inputs.map(i => (i.value === '' || i.value === undefined) ? null : Number(i.value))
          }

          // Refresh Totaux immediately
          updateTotalsDisplay()
        }

        // keep tData.parties in sync while editing (no live Totaux updates)
        // (totaux updated when user clique sur le bouton de validation de table)
        // compute dealer index for 5-player tables: order N(0), O(3), S(1), E(2), 5th(4)
        const dealerOrder = [0,3,1,2,4]
        const isFive = tableSize === 5
        const dealerIdx = isFive ? dealerOrder[partIdx % 5] : -1
        // Selected manche index (used to restrict edits in 'exclu' mode)
        const selIdx = (selectRotation && typeof selectRotation.selectedIndex === 'number') ? selectRotation.selectedIndex : 0
        // Compute exclu mode once per table render
        const inExcluMode = (typeof getMode === 'function' && getMode() === 'exclu')

        part.scores.forEach((cellVal, colIdx) => {
          const snapshotEntry = findSnapshotEntry(tData.table)
          const persistedEntry = findPersistedEntry(tData.table)
          // A manche is considered validated only when the explicit `locked`
          // flag is present (set by the validation checkbox). Ignore the
          // currently edited manche (`selIdx`) so it stays editable.
          let partIsValidated = !!(part && part.locked) && partIdx !== selIdx
          const td = document.createElement('td')
          td.style.padding = '1px'
          td.style.textAlign = 'center'
          td.style.borderTop = '1px solid #333'
          // compact cell for input (class-driven)
          td.classList.add('input-cell')

          const inp = document.createElement('input')
          inp.type = 'number'
          inp.autocomplete = 'off'
          inp.name = `tbl-${tData.table}-p${partIdx}-c${colIdx}-${Date.now()}-${Math.random().toString(36).substr(2,5)}`
          if ((typeof global !== 'undefined' ? global : window).__debugDumpTables) {
            try { process.stdout.write(`CELL debug: partIdx=${partIdx} colIdx=${colIdx} cellVal=${cellVal}\n`) } catch (_e) {}
          }
          inp.value = (cellVal === null || cellVal === undefined) ? '' : String(cellVal)
          inp.classList.add('saisie-input')
          inp.dataset.colIdx = String(colIdx)
          inp.dataset.partIdx = String(partIdx)

          // dealer handling for 5-player tables
          if (isFive && colIdx === dealerIdx) {
            inp.disabled = true
            inp.readOnly = true
            inp.value = '0'
            inp.classList.add('dealer-input')
            td.classList.add('dealer-cell')
          }

            // locked flag indicates the manche has been validated; enforcement
            // is handled below with awareness of the excluded player.
          

          // Validated manche view: inputs read-only for review unless user
          // toggled edit mode (isValidatedMancheView === true => read-only)
          if (isValidatedManche && !validatedEditMode) {
            inp.readOnly = true
            inp.style.opacity = '0.85'
          }

          // If this seat is a Mort, make the input inactive
          try {
            const pname = (tData.players && tData.players[colIdx]) || ''
            if (String(pname).toUpperCase().startsWith('MORT')) {
              inp.readOnly = true
              inp.disabled = true
              inp.classList.add('mort-input')
            }
          } catch (_e) {}

          // Simplified exclu rule: in 'exclu' mode any already-validated
          // manche (`part.locked`) is not editable. Show an alert on focus.
          if (inExcluMode && partIsValidated) {
            // Allow the excluded player's seat for this manche to remain editable
            // (we may need to enter a score for the excluded player). Determine
            // the excluded name for this manche and compare against the player
            // at this seat.
            try {
              const excluNom = (exclusArr && exclusArr[partIdx]) || null
              const playerName = (tData.players && tData.players[colIdx]) || ''
              const isExcluSeat = excluNom && String(excluNom) === String(playerName)
              if (!isExcluSeat) {
                inp.readOnly = true
                inp.disabled = true
                inp.addEventListener('focus', () => {
                  showAlert("En mode 'exclu' vous ne pouvez pas corriger les manches déjà validées.")
                  try { inp.blur() } catch (_e) {}
                })
              } else {
                // ensure excluded seat remains editable
                inp.readOnly = false
                inp.disabled = false
              }
            } catch (_e) {
              inp.readOnly = true
              inp.disabled = true
            }
          }

          // When the value changes, clear other cells in the row then compute
          // allow changes when NOT in validated read-only view (i.e. either
          // normal mode or validatedEditMode === true)
          if (!(isValidatedManche && !validatedEditMode) && !(inExcluMode && partIsValidated)) {
          inp.onchange = async (ev) => {
            const rowInputs = Array.from(tr.querySelectorAll('input'))
            rowInputs.forEach((ri) => {
              if (ri === ev.target) return
              if (ri.disabled || ri.classList.contains('dealer-input')) return
              ri.value = ''
            })
            computeRowAndFill(tr)
            // autosave the current table state so it survives re-renders/navigation
            try {
              let tablesData = await getScoresParTable() || []
              const idx = tablesData.findIndex(x => Number(x.table) === Number(tData.table))
              if (idx >= 0) tablesData[idx] = tData
              else tablesData.push(tData)
              await setScoresParTable(tablesData)
            } catch (_e) {
              console.warn('autosave table failed', _e)
            }
          }

          // When focusing a cell, compute for the previously focused row (if any)
          // then compute for the newly focused row so defenders appear immediately.
          inp.onfocus = () => {
            if (lastFocusedRow && lastFocusedRow !== tr) computeRowAndFill(lastFocusedRow)
            lastFocusedRow = tr
            computeRowAndFill(tr)
          }

          // When leaving a cell/row, ensure the row is computed.
          inp.onblur = () => {
            // slight delay so focus transitions settle when user tabs/clicks next
            setTimeout(() => computeRowAndFill(tr), 0)
          }
          } // end if !isValidatedManche

          td.appendChild(inp)
          tr.appendChild(td)
        })
        tbody.appendChild(tr)
      })

      const trTotal = document.createElement('tr')
      const tdTotalLabel = document.createElement('td')
      // keep accessible label but do not display the word 'Totaux'
      tdTotalLabel.setAttribute('aria-label', 'Totaux')
      tdTotalLabel.textContent = ''
      tdTotalLabel.style.padding = '1px'
      tdTotalLabel.style.fontWeight = '600'
      tdTotalLabel.style.borderTop = '1px solid #555'
      trTotal.appendChild(tdTotalLabel)

      tData.totals = tData.totals || new Array(tData.players.length).fill(0)
      tData.players.forEach((p, idx) => {
        const td = document.createElement('td')
        td.style.padding = '1px'
        td.style.textAlign = 'center'
        td.style.borderTop = '1px solid #555'
        const totalVal = tData.totals[idx] || 0
        td.textContent = String(totalVal)
        td.dataset.totalIdx = String(idx)
        trTotal.appendChild(td)
      })
      tbody.appendChild(trTotal)

      tbl.appendChild(tbody)
      divTable.appendChild(tbl)

      // Totaux initialisés depuis `tData.totals` (pas de calcul live ici)


      containerSaisie.appendChild(divTable)
    })

    const firstInp = containerSaisie.querySelector('input[type=number]')
    if (firstInp) setTimeout(() => firstInp.focus(), 50)
  } finally {
    _renderingSaisieLock = false
  }
}

async function renderSaisie () {
  // Diagnostic: expose basic runtime state for troubleshooting
  try {
    window.__renderSaisieDiagnostics = window.__renderSaisieDiagnostics || {}
    window.__renderSaisieDiagnostics.lastCall = Date.now()
    window.__renderSaisieDiagnostics.containerSaisieExists = !!containerSaisie
    window.__renderSaisieDiagnostics.selectRotationValue = (selectRotation && selectRotation.value) || null
    window.__renderSaisieDiagnostics.selectRotationOptions = (selectRotation && selectRotation.options && selectRotation.options.length) ? selectRotation.options.length : 0
    window.__renderSaisieDiagnostics.dernierDictRotationsKeys = (dernierDictRotations && Object.keys(dernierDictRotations).length) || 0
    window.__renderSaisieDiagnostics._renderingSaisieLock = !!_renderingSaisieLock
  } catch (_e) {}

  if (!containerSaisie) return
  if (_renderingSaisieLock) return

  // Delegate exclusively to the per-table matrix renderer
  try {
    window.__renderSaisieDiagnostics.triedRenderSaisieParTable = Date.now()
    await renderSaisieParTable()
    window.__renderSaisieDiagnostics.renderSaisieParTableSucceeded = Date.now()
  } catch (e) {
    window.__renderSaisieDiagnostics.renderSaisieParTableFailed = (e && e.message) ? e.message : String(e)
    console.warn('renderSaisieParTable failed and legacy compact UI has been removed:', e)
    try { containerSaisie.innerHTML = `<div style="padding:20px;color:#ddd;">Erreur lors du rendu de la saisie : ${ (e && e.message) ? e.message : String(e) }</div>` } catch (_e) {}
  }
}

// export functions for unit tests
export function setListeTournoiForTests(arr) { try { listeTournoi = Array.isArray(arr) ? arr.slice() : [] } catch (_e) {} }
// also expose manual-mode helpers so tests can verify tab locking behavior
export { validateAndPersistTable, renderSaisieParTable, updateRotationsDisplay, mettreAJourSelectRotationsEtTables, performGlobalValidateManche, rebuildRotationsAfterNbChange, lockManualModeUI, unlockManualModeUI, isManualModeActive, maybeUnlockUIForNormalFlow }

// Helper: appliquer dynamiquement un thème pour les tables
/* Theme controls removed: theming is managed via CSS variables in `style.css`.
   The previous `applyTableTheme()` helper and the small theme-panel wiring
   have been intentionally removed to avoid runtime style mutations. */

// Helper pour effacer scores d'une table (mode correction)
async function effacerScoresTable (nomsJoueurs, indexRot) {
  const scores = await getScoresTournoi()
  let modified = false

  nomsJoueurs.forEach(nom => {
    const row = scores.find(r => r[0] === nom)
    // row attends : [Nom, S1, S2, ..., Total]
    // Si indexRot=0 (Manche 1), on a [Nom, S1, Total]. Length = 3.
    // Si indexRot=1 (Manche 2), on a [Nom, S1, S2, Total]. Length = 4.
    // Donc on cible length == indexRot + 3.
    if (row && row.length === indexRot + 3) {
      // On retire Total et le Score ciblé (qui est le dernier)
      row.pop() // Total
      row.pop() // Score

      // On recalcule le nouveau total avec ce qui reste
      // row est maintenant [Nom, S1...]
      const numericScores = row.slice(1).map(Number)
      const newTotal = numericScores.reduce((a, b) => a + b, 0)
      row.push(newTotal)
      modified = true
    }
  })

  if (modified) {
    await setScoresTournoi(scores)
    await renderFeuilleSoiree()
  } else {
    showAlert("Impossible d'effacer : soit la manche n'existe pas, soit la manche suivante est déjà saisie.")
  }
}

// Garantit qu'un joueur exclu pour la manche `indexRot` a bien un score 180 enregistré pour cette manche.
// Retourne true si une insertion a été réalisée, false sinon.
async function ensureExcluHasScoreForManche (indexRot) {
  try {
    // Si le mode de jeu est 'morts', on n'applique pas d'exclu
    if (getMode() === 'morts') return false

    // Si le serpentin est activé, la dernière manche n'a pas d'exclu
    // (on aura une table de 5). Ne pas attribuer 180 pour cette manche.
    try {
      const totalNb = Number((nbPartiesInput && nbPartiesInput.value) ? nbPartiesInput.value : ((selectRotation && selectRotation.options && selectRotation.options.length) || 0))
      if (getSerpentinEnabled() && typeof indexRot === 'number' && totalNb >= 2 && indexRot === totalNb - 1) {
        return false
      }
    } catch (_) { /* ignore */ }

    const exclusArr = await getExclusTournoi()
    if (!exclusArr || !exclusArr.length) return false
    const excluNom = exclusArr[indexRot] || null

    // Defensive: if serpentin is enabled, ensure we never honor an exclu
    // for the final serpentin manche even if present in storage.
    try {
      const totalNb = Number((nbPartiesInput && nbPartiesInput.value) ? nbPartiesInput.value : ((selectRotation && selectRotation.options && selectRotation.options.length) || 0))
      if (excluNom && getSerpentinEnabled() && totalNb >= 2 && typeof indexRot === 'number' && indexRot === totalNb - 1) {
        return false
      }
    } catch (_) { /* ignore */ }
    if (!excluNom) return false

    const scores = await getScoresTournoi()
    const row = scores.find(r => r[0] === excluNom)

    // Extraire manches existantes (row = [Nom, M1, M2, ..., Total])
    let manches = []
    if (row && row.length >= 3) {
      manches = row.slice(1, -1).map(Number)
    } else if (row && row.length === 2) {
      // [Nom, Total] -> aucune manche enregistrée
      manches = []
    } else if (!row) {
      manches = []
    }

    // If manche already exists and is exactly 180, nothing to change.
    // Otherwise we (re)assign 180 for the excluded player for this manche
    // so revalidation will always ensure the 180 points are present.
    while (manches.length < indexRot) manches.push(0)
    if (manches.length >= indexRot + 1 && Number(manches[indexRot]) === 180) {
      return false
    }
    // (re)assign 180 to the target manche
    manches[indexRot] = 180
    const total = manches.reduce((a, b) => a + b, 0)
    const nouvelleLigne = [excluNom, ...manches, total]

    if (row) {
      const idx = scores.findIndex(r => r[0] === excluNom)
      scores[idx] = nouvelleLigne
    } else {
      scores.push(nouvelleLigne)
    }

    await setScoresTournoi(scores)
    // toast supprimé
    return true
  } catch (e) {
    console.error('Erreur ensureExcluHasScoreForManche', e)
    return false
  }
}


btnTirage.addEventListener('click', async () => {
  try {
    // Removed 12-player guard — allow tirage for any number of players
    // (previous behavior forced manual mode when <12; we now accept all counts)

    // If there are existing "Mort" placeholders from a previous session,
    // remove them BEFORE we compute the remainder and prompt the user.
    try {
      const hadMorts = (listeTournoi || []).some(n => n && String(n).toUpperCase().startsWith('MORT'))
      if (hadMorts) {
        listeTournoi = (listeTournoi || []).filter(n => !(n && String(n).toUpperCase().startsWith('MORT')))
        try { renderListeTournoi(); await renderListeGenerale(); scheduleSaveListeTournoi() } catch (_e) {}
        // ensure mode is not left in 'morts' from a previous session
        try { setMode('normal') } catch (_e) {}
        try { showToast('Morts précédents retirés avant le nouveau tirage') } catch (_e) {}
      }
    } catch (_e) {
      console.warn('Impossible de nettoyer Morts avant tirage:', _e)
    }

    // Gestion Nombres de joueurs != Multiple de 4
    const reste = listeTournoi.length % 4

    if (reste !== 0 && listeTournoi.length >= 5) {
      let aAjouter = 4 - reste

      // Ne jamais dépasser 3 Morts au total
      const existingMortCount = (listeTournoi || []).filter(n => n && String(n).toUpperCase().startsWith('MORT')).length
      const maxAllowed = Math.max(0, 3 - existingMortCount)
      if (maxAllowed === 0) {
        showAlert('Impossible : nombre maximum de 3 Mort(s) déjà atteint.')
        return
      }
      if (aAjouter > maxAllowed) {
        aAjouter = maxAllowed
        try { showToast(`Ajout limité à ${aAjouter} Mort(s) (max 3)`) } catch (_e) {}
      }

      const message = `Le nombre de joueurs (${listeTournoi.length}) n'est pas un multiple de 4.\n\nChoisissez une option :`
      const buttons = []
      buttons.push(`Ajouter ${aAjouter} "Mort(s)" (X3)`)
      buttons.push(`Ajouter ${aAjouter} "Mort(s)" (X2)`)
      buttons.push('Créer des tables de 5 ou 6 joueurs')
      if (reste === 1) buttons.push('Mode joueur exclu')

      // stacked, left-aligned choices
      const choice = await askChoiceVertical(message, buttons)
      if (choice === -1) return // cancelled via overlay
      const selected = buttons[choice]

        if (selected && selected.startsWith('Ajouter')) { // Ajouter morts (avec choix X2/X3)
          // determine divisor from label and persist preference
          const divisor = selected.includes('X2') ? 2 : 3
          try { localStorage.setItem('tarot_morts_divisor', String(divisor)) } catch (_e) {}
          for (let i = 0; i < aAjouter; i++) {
            let k = 1
            while (listeTournoi.some((n) => n && String(n).toUpperCase() === `MORT ${k}`)) k++
            listeTournoi.push(`Mort ${k}`)
          }
          // Marquer le mode de jeu explicitement comme 'morts'
          setMode('morts')
          renderListeTournoi()
        await renderListeGenerale()
        scheduleSaveListeTournoi()
      } else if (selected === 'Créer des tables de 5 ou 6 joueurs') { // Tables 5/6
        // Mettre le mode à 'tables56'
        setMode('tables56')
        // Rien d'autre à changer
      } else if (selected === 'Mode joueur exclu') { // Mode exclu
        setMode('exclu')
        const buttonsExclu = [...listeTournoi]
        const messageExclu = 'Choisissez le premier joueur exclu :'
        // Afficher une liste verticale et scrollable pour un grand nombre de joueurs
        const choiceExclu = await askChoiceVertical(messageExclu, buttonsExclu)
        if (choiceExclu === -1) {
          showAlert('Aucun exclu sélectionné. Annulation du tirage.')
          renderListeTournoi()
          await renderListeGenerale()
          scheduleSaveListeTournoi()
          return
        }
        if (choiceExclu < listeTournoi.length) {
          const exclu = listeTournoi[choiceExclu]
          await setExclusTournoi([exclu])

          // Toujours tenter une mise à jour de l'UI immédiate (plan + liste + feuille)
          try {
          // applyExclusToRotations peut échouer si le fullTirage n'est pas encore généré
            await applyExclusToRotations([exclu])
          } catch (e) {
            console.warn('applyExclusToRotations initial failed', e)
          }

          try { markExcluInList(exclu) } catch (_e) { /* ignore */ }
          try { setFeuilleExcluInfo(exclu, 0) } catch (_e) { /* ignore */ }
          try { await updateRotationsDisplay() } catch (_e) { /* ignore */ }

          // Mettre à jour affichage et persistance
          renderListeTournoi()
          scheduleSaveListeTournoi()
          renderSaisie()
        } else {
          showAlert('Aucun exclu sélectionné. Annulation du tirage.')
          renderListeTournoi()
          await renderListeGenerale()
          scheduleSaveListeTournoi()
          return
        }
      } else { // Annuler
        return
      }
    }

    // Si c'est un tirage standard (multiple de 4), s'assurer qu'il n'y a pas
    // d'exclu persistant d'une précédente session qui voudrait filtrer le tirage actif.
    if (reste === 0) {
      try {
        await setExclusTournoi([])
        clearExcluSeatIndex()
      } catch (e) {
        console.warn('Impossible de réinitialiser exclus au tirage:', e)
      }
    }

    // For small tournaments we accept any player count — no minimum enforced

    // On génère un full tirage (tous les joueurs) puis on retire l'exclu choisi pour former l'actif
    const fullTirage = tirageAuSort([...listeTournoi])
    try {
      dernierFullTirage = fullTirage
      localStorage.setItem('tarot_full_tirage', JSON.stringify(fullTirage))
      // Si un exclu initial a été choisi manuellement au moment du tirage, enregistrer la seat index
      try {
        const exclusArrInit = await getExclusTournoi()
        if (Array.isArray(exclusArrInit) && exclusArrInit[0]) {
          const nomEx = exclusArrInit[0]
          const idx = fullTirage.findIndex(p => (p.nom || '').toLowerCase() === (nomEx || '').toLowerCase())
          if (idx >= 0 && getExcluSeatIndex() === null) {
            setExcluSeatIndex(idx)
          }
        }
      } catch (e2) { console.warn('Impossible de déterminer seatIndex initial:', e2) }
    } catch (e) { console.warn('Impossible de sauvegarder full tirage:', e) }

    const exclu = await getExclusTournoi()
    let activeTirage = fullTirage
    if (exclu && exclu.length > 0 && exclu[0]) {
      activeTirage = fullTirage.filter(p => p.nom !== exclu[0])
    }

    const res = activeTirage

    // --- Shuffle animation: randomly swap displayed players until stop (FLIP swaps) ---
    try {
      const container = document.getElementById('liste-joueurs-tournoi')
      if (container) {
        const rows = Array.from(container.querySelectorAll('.joueur-tournoi-row'))
        const nameToRow = new Map(rows.map(r => [String(r.querySelector('.joueur-tournoi-nom')?.textContent || '').trim(), r]))
        // orderedRows corresponds to fullTirage order (desired final order)
        const orderedRows = fullTirage.map(p => nameToRow.get(p.nom)).filter(Boolean)
        const pool = orderedRows.length ? orderedRows.slice() : rows.slice()

        // --- Drum roll sound via Web Audio API ---
        let drumRollStop = null
        try {
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
          // Noise buffer for the snare/drum texture
          const sampleRate = audioCtx.sampleRate
          const duration = 4 // max 4 seconds (will be stopped when animation ends)
          const bufferSize = sampleRate * duration
          const noiseBuffer = audioCtx.createBuffer(1, bufferSize, sampleRate)
          const data = noiseBuffer.getChannelData(0)
          for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1)

          const noiseSource = audioCtx.createBufferSource()
          noiseSource.buffer = noiseBuffer

          // Bandpass filter to shape noise into a drum-like tone
          const bandpass = audioCtx.createBiquadFilter()
          bandpass.type = 'bandpass'
          bandpass.frequency.value = 180
          bandpass.Q.value = 0.8

          // Tremolo oscillator for the "roll" effect (rapid repeated hits)
          const tremolo = audioCtx.createGain()
          const lfo = audioCtx.createOscillator()
          const lfoGain = audioCtx.createGain()
          lfo.frequency.value = 18 // 18 Hz = rapid roll
          lfo.frequency.linearRampToValueAtTime(25, audioCtx.currentTime + 2)
          lfoGain.gain.value = 0.5
          lfo.connect(lfoGain)
          lfoGain.connect(tremolo.gain)

          // Master gain with crescendo
          const masterGain = audioCtx.createGain()
          masterGain.gain.setValueAtTime(0.06, audioCtx.currentTime)
          masterGain.gain.linearRampToValueAtTime(0.25, audioCtx.currentTime + 2.5)

          noiseSource.connect(bandpass)
          bandpass.connect(tremolo)
          tremolo.connect(masterGain)
          masterGain.connect(audioCtx.destination)

          lfo.start()
          noiseSource.start()

          drumRollStop = () => {
            try {
              masterGain.gain.cancelScheduledValues(audioCtx.currentTime)
              masterGain.gain.setValueAtTime(masterGain.gain.value, audioCtx.currentTime)
              masterGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3)
              setTimeout(() => {
                try { noiseSource.stop(); lfo.stop(); audioCtx.close() } catch (_) {}
              }, 400)
            } catch (_) {}
          }
        } catch (_eAudio) { /* Web Audio not available — silent fallback */ }

        // Helper: swap two DOM rows with FLIP animation
        const swapDomRows = async (a, b, duration = 140) => {
          if (!a || !b || a === b) return
          const rectA = a.getBoundingClientRect()
          const rectB = b.getBoundingClientRect()
          const deltaY = rectB.top - rectA.top

          // apply transform to visually move them to each other's place
          a.style.transition = `transform ${duration}ms cubic-bezier(.22,.9,.3,1)`
          b.style.transition = `transform ${duration}ms cubic-bezier(.22,.9,.3,1)`
          a.style.transform = `translateY(${deltaY}px)`
          b.style.transform = `translateY(${-deltaY}px)`
          a.classList.add('shuffled-highlight')
          b.classList.add('shuffled-highlight')

          await new Promise(res => setTimeout(res, duration))

          // clear transforms then swap DOM nodes
          a.style.transition = ''
          b.style.transition = ''
          a.style.transform = ''
          b.style.transform = ''
          a.classList.remove('shuffled-highlight')
          b.classList.remove('shuffled-highlight')

          const parent = a.parentNode
          // robust swap
          const nextA = a.nextElementSibling === b ? a : a.nextSibling
          parent.insertBefore(b, a)
        }

        // Run a controlled sequence of random swaps to create shuffle effect.
        // For large pools we cap cycles and shorten swap durations so animation remains snappy.
        const MAX_CYCLES = 20
        const factor = Math.max(1, Math.min(2, pool.length / 6)) // scale factor based on size
        const cycles = Math.min(MAX_CYCLES, Math.max(4, Math.floor(pool.length * factor)))

        for (let i = 0; i < cycles; i++) {
          const i1 = Math.floor(Math.random() * pool.length)
          let i2 = Math.floor(Math.random() * pool.length)
          if (i2 === i1) i2 = (i1 + 1) % pool.length
          const r1 = pool[i1]
          const r2 = pool[i2]

          // Shorter durations for larger pools (keeps whole animation short)
          const baseDuration = Math.max(60, 180 - Math.floor(pool.length * 2))
          const variability = Math.min(80, Math.floor(120 / Math.max(1, Math.floor(pool.length / 4))))
          const dur = baseDuration + Math.floor(Math.random() * variability)

          try { await swapDomRows(r1, r2, dur) } catch (_e) {}
          pool[i1] = r2; pool[i2] = r1
        }

        // Final settle: reorder DOM to the exact fullTirage order (smoothly)
        try {
          orderedRows.forEach(rowEl => container.appendChild(rowEl))
        } catch (_e) { /* ignore */ }

        // Stop drum roll and play final cymbal hit
        if (drumRollStop) drumRollStop()
        try {
          const ctx2 = new (window.AudioContext || window.webkitAudioContext)()
          // Cymbal crash: short burst of filtered noise
          const crashLen = ctx2.sampleRate * 0.6
          const crashBuf = ctx2.createBuffer(1, crashLen, ctx2.sampleRate)
          const cd = crashBuf.getChannelData(0)
          for (let i = 0; i < crashLen; i++) cd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx2.sampleRate * 0.15))
          const crashSrc = ctx2.createBufferSource()
          crashSrc.buffer = crashBuf
          const hp = ctx2.createBiquadFilter()
          hp.type = 'highpass'
          hp.frequency.value = 4000
          const cGain = ctx2.createGain()
          cGain.gain.value = 0.18
          crashSrc.connect(hp)
          hp.connect(cGain)
          cGain.connect(ctx2.destination)
          crashSrc.start()
          setTimeout(() => { try { ctx2.close() } catch (_) {} }, 1000)
        } catch (_) { /* silent fallback */ }

        // Pulse the first element of fullTirage as visual winner (short pulse)
        const finalWinner = orderedRows[0] || container.querySelector('.joueur-tournoi-row')
        if (finalWinner) {
          finalWinner.classList.add('lucky-winner-pulse')
          setTimeout(() => finalWinner.classList.remove('lucky-winner-pulse'), 1200)
        }
      }
    } catch (eAnim) {
      console.warn('Player tirage shuffle animation failed', eAnim)
    }

    // Persist the tirage (active list) and update UI/state after animation
    try {
      saveTirage(res)
    } catch (_e) { /* ignore */ }

    // Mise à jour de la listeTournoi pour affichage selon l'ordre du fullTirage
    try {
      listeTournoi = fullTirage.map(p => p.nom)
      renderListeTournoi()
      await renderListeGenerale()
      scheduleSaveListeTournoi()
    } catch (e) {
      console.warn('Impossible de mettre à jour listeTournoi depuis fullTirage:', e)
      // Fallback
      renderListeTournoi()
      await renderListeGenerale()
    }

    // Initialisation automatique (SANS CONFIRMATION)
    const initScores = listeTournoi.map(nom => [nom, 0]) // [Nom, Total=0]
    await setScoresTournoi(initScores)

    // Remise à zéro des scores par table et retour à la 1ère manche
    try { await setScoresParTable([]) } catch (_e) {}
    try { clearAllValidatedMancheSnapshots() } catch (_e) {}
    try { if (selectRotation) { selectRotation.selectedIndex = 0 } } catch (_e) {}

    // Reset any previously applied redistributions when starting a new tirage
    // redistribution feature removed — but also clear any in-memory lucky/reward state
    clearAllLucky()

    // Ensure the tournament date used for "gains informatif" is the current day
    try { if (inputDateTournoi) inputDateTournoi.value = getTodayIso() } catch (_e) {}

    await renderFeuilleSoiree()
    updateLuckyButtonState()

    // Initialize redistrib banner (only banner; no column logic)
    try {
      const iso = (typeof getTodayIso === 'function') ? getTodayIso() : new Date().toISOString().slice(0,10)
      // Count active players for Jeudi (exclude 'Mort' placeholders). Prefer activeTirage when available.
      let nbPlayers = 0
      try {
        if (Array.isArray(activeTirage)) {
          nbPlayers = activeTirage.filter(p => !(String(p.nom || '').toUpperCase().startsWith('MORT'))).length
        } else if (Array.isArray(listeTournoi)) {
          nbPlayers = listeTournoi.filter(n => !String(n || '').toUpperCase().startsWith('MORT')).length
        }
      } catch (_e) {
        nbPlayers = Array.isArray(listeTournoi) ? listeTournoi.length : 0
      }

      const places = await computeRedistribPlacesFor(iso, nbPlayers)
      showSmallRedistribBanner(places, nbPlayers, iso)
    } catch (e) {
      console.warn('Init redistrib banner after tirage failed', e)
    }

    // After tirage update ensure UI is unlocked for normal flow (unless manual mode is active)
    maybeUnlockUIForNormalFlow()

    // duplicate check removed – handled by maybeUnlockUIForNormalFlow

    // Lucky draw button handler (Scores Tournoi) — single source of truth
    const btnLuckyDraw = document.getElementById('btn-lucky-draw')
    if (btnLuckyDraw && !btnLuckyDraw.__directLuckyAttached) {
      btnLuckyDraw.addEventListener('click', (ev) => { void handleLuckyDrawClick(ev) })
      btnLuckyDraw.__directLuckyAttached = true
    }

// duplicate handleLuckyDrawClick removed — primary definition is kept earlier in the file

// Global capture listeners to detect pointer/mouse events targeting the lucky button
// Defensive: if the click is intercepted/stopped before bubble phase, trigger the
// handler in capture phase (pointerdown). Lucky-draw logic itself guards against
// re-entrancy so this is safe.
if (!window.__luckyPointerDebugAttached) {
  try {
    document.addEventListener('pointerdown', (ev) => {
      try {
        if (ev && ev.target && ev.target.closest && ev.target.closest('#btn-lucky-draw')) {
          // Call the handler immediately in capture phase to survive stopped propagation
          try { void handleLuckyDrawClick(ev) } catch (_e) { /* ignore */ }
        }
      } catch (_e) {}
    }, true)

    // Keep mousedown capture for diagnostics (no-op) to avoid duplicate triggers.
    document.addEventListener('mousedown', (ev) => {
      try {
        if (ev && ev.target && ev.target.closest && ev.target.closest('#btn-lucky-draw')) {
          // intentionally no-op
        }
      } catch (_e) {}
    }, true)

    window.__luckyPointerDebugAttached = true
  } catch (_e) {}
}

// Delegated click handler (falls back to handleLuckyDrawClick)
// More robust: support text-node targets and clicks on inner elements that may not support closest.
document.addEventListener('click', (ev) => {
  try {
    const btnEl = document.getElementById('btn-lucky-draw')
    const targetIsWithinBtn = btnEl && (
      ev.target === btnEl ||
      (btnEl.contains && btnEl.contains(ev.target)) ||
      (ev.target && ev.target.closest && ev.target.closest('#btn-lucky-draw'))
    )
    if (targetIsWithinBtn) {
      void handleLuckyDrawClick(ev)
    }
  } catch (e) {
    console.error('Delegated lucky-draw click failed', e)
  }
})

// Ensure a direct handler exists at script load (defensive; navigation code re-attaches too)
try {
  const __btnInit = document.getElementById('btn-lucky-draw')
  if (__btnInit && !__btnInit.__directLuckyAttached) {
    __btnInit.addEventListener('click', (ev) => { void handleLuckyDrawClick(ev) })
    __btnInit.__directLuckyAttached = true
  }
} catch (_e) {}

// Ensure button state is synced after handler registration
try { updateLuckyButtonState() } catch (_e) {}

    const nbParties = Number(nbPartiesInput.value || 1)
    // S'assurer que le tableau d'exclus a au moins nbParties de longueur
    let excluArr = await getExclusTournoi()
    if (!Array.isArray(excluArr)) excluArr = []
    if (excluArr.length < nbParties) {
      excluArr = [...excluArr]
      for (let i = excluArr.length; i < nbParties; i++) excluArr[i] = null
      await setExclusTournoi(excluArr)
      excluArr = await getExclusTournoi()
    }

    // Si le mode est 'morts', il n'y a pas d'exclu -> s'assurer que le tableau est vide
    if (getMode() === 'morts' && excluArr.length > 0) {
      excluArr = []
      try { await setExclusTournoi([]) } catch (_e) { /* ignore */ }
    }

    // Si le mode est 'tables56', il n'y a pas d'exclu non plus (on construira des tables 4/5/6)
    if (getMode() === 'tables56' && excluArr.length > 0) {
      excluArr = []
      try { await setExclusTournoi([]); clearExcluSeatIndex() } catch (_e) { /* ignore */ }
    }

    // Construire les rotations par manche en utilisant le fullTirage (si présent)
    try {
      const nbPartiesToPlan = (cbSerpentin && cbSerpentin.checked && nbParties > 1) ? nbParties - 1 : nbParties

      if (dernierFullTirage && Array.isArray(dernierFullTirage)) {
        dernierDictRotations = buildDictRotationsWithExclus(dernierFullTirage, excluArr, nbPartiesToPlan)
        try {
          await applyExclusToRotations(excluArr)
        } catch (e) {
          console.warn('applyExclusToRotations at init failed', e)
        }
      } else {
        const modeExclu = (getMode() === 'tables56') ? false : (excluArr.length > 0 && excluArr[0])
        const dict = calculRotationsRainbow(res, nbPartiesToPlan, modeExclu)
        dernierDictRotations = dict
      }
    } catch (e) {
      console.warn('Erreur building rotations with exclus:', e)
      const modeExclu = excluArr.length > 0 && excluArr[0]
      const nbPartiesToPlan = (cbSerpentin && cbSerpentin.checked && nbParties > 1) ? nbParties - 1 : nbParties
      dernierDictRotations = calculRotationsRainbow(res, nbPartiesToPlan, modeExclu)
    }

    await mettreAJourSelectRotationsEtTables()

    // Mettre à jour l'affichage des rotations (affiche aussi qui est exclu par manche)
    await updateRotationsDisplay()

    // FEEDBACK POUCE
    showConfirmation()

    if (planHeadingEl) {
      const nbTables = res.length / 4
      const mvInfo = getMovementInfo(nbTables)
      // Show label and always-visible detailed comment (smaller font)
      const commentHtml = (mvInfo && mvInfo.comment) ? `<span class="movement-comment">${mvInfo.comment}</span>` : ''
      planHeadingEl.innerHTML = `Plan de table : <span class="movement-label" title="${mvInfo.label}">${mvInfo.label}</span> ${commentHtml}`

      // Update nb-parties max if applicable
      try {
        if (mvInfo.maxManches && nbPartiesInput) {
          nbPartiesInput.max = String(mvInfo.maxManches)
          // If current value is greater, clamp and inform
          const cur = Number(nbPartiesInput.value)
          if (cur > mvInfo.maxManches) {
            nbPartiesInput.value = String(mvInfo.maxManches)
            showToast(`Nombre de manches limité à ${mvInfo.maxManches} pour ${nbTables} tables`)
          }

          // Show a small note next to the input (create if needed)
          let note = document.getElementById('nb-parties-note')
          if (!note) {
            note = document.createElement('span')
            note.id = 'nb-parties-note'
            note.style.marginLeft = '8px'
            note.style.fontSize = '0.9rem'
            note.style.color = '#777'
            nbPartiesInput.parentElement.appendChild(note)
          }
          note.textContent = `max ${mvInfo.maxManches}`
        } else {
          if (nbPartiesInput) {
            nbPartiesInput.removeAttribute('max')
            const note = document.getElementById('nb-parties-note')
            if (note) note.textContent = ''
          }
        }
      } catch (e) {
        console.warn('update nb-parties max failed', e)
      }
    }

    const rotationsKeys = Object.keys(dernierDictRotations || {})
    rotationsResultDiv.innerHTML = rotationsKeys
      .map((nomRot, mancheIndex) => {
        const tables = (dernierDictRotations || {})[nomRot] || []
        const blocTables = tables
          .map((t) => {
            const [n, s, e, o, x, y] = t.joueurs
            let exemptHtml = ''
            if (x) {
              // Table de 5 (un seul exempt)
              exemptHtml += `<div class="table-seat table-seat-exemption"><span>${x.nom || '?'}</span></div>`
            }
            if (y) {
              // Table de 6 (deux exempts) -> on peut ajuster la CSS pour en afficher deux
              exemptHtml += `<div class="table-seat table-seat-exemption-2"><span>${y.nom || '?'}</span></div>`
            }

            const nNom = (n?.nom || '').trim()
            const sNom = (s?.nom || '').trim()
            const eNom = (e?.nom || '').trim()
            const oNom = (o?.nom || '').trim()

            return `
              <div class="table-card">
                <div class="table-card-center-label">Table ${t.table}</div>
                <div class="table-seat table-seat-north"><span>${nNom || '?'}</span></div>
                <div class="table-seat table-seat-south"><span>${sNom || '?'}</span></div>
                <div class="table-seat table-seat-east"><span>${eNom || '?'}</span></div>
                <div class="table-seat table-seat-west"><span>${oNom || '?'}</span></div>
                ${exemptHtml}
              </div>
            `
          })
          .join('')

        return `
          <section class="rotation-block">
            <h3>Manche ${mancheIndex + 1}</h3>
            <div class="rotation-tables">
              ${blocTables}
            </div>
          </section>
        `
      })
      .join('')
  } catch (e) {
    console.error('Erreur dans btnTirage:', e)
    console.error('Erreur: ' + e.message)
    // showAlert("Erreur: " + e.message);
  }
})

// ------------------ Feuille de table ------------------

// Met à jour l'affichage inline de l'exclu à côté du sélecteur de manche
async function updateSelectRotationExcluDisplay () {
  try {
    const spanId = 'select-rotation-exclu'
    let span = document.getElementById(spanId)
    // Créer le span si nécessaire (insérer après le selectRotation)
    if (!span) {
      span = document.createElement('span')
      span.id = spanId
      span.className = 'rotation-exclu-inline'
      // Positionner SOUS le select de rotation — preferer le placer APRES le bouton de validation s'il existe
      try {
        const headerBtn = document.getElementById('btn-validate-manche-header')
        if (headerBtn && headerBtn.parentElement === selectRotation.parentElement) {
          headerBtn.insertAdjacentElement('afterend', span)
          span.setAttribute('data-below', 'true')
        } else if (selectRotation && typeof selectRotation.insertAdjacentElement === 'function') {
          // Insert directly after the select so the banner appears on the next line
          selectRotation.insertAdjacentElement('afterend', span)
          // Mark as placed below for CSS styling
          span.setAttribute('data-below', 'true')
        } else if (selectRotation && selectRotation.parentElement) {
          // Fallback: append to parent
          selectRotation.parentElement.appendChild(span)
        } else {
          // Last-resort: append to document body
          document.body.appendChild(span)
        }
      } catch (e) {
        // very defensive fallback
        if (selectRotation && selectRotation.parentElement) selectRotation.parentElement.appendChild(span)
        else document.body.appendChild(span)
      }
    }

    const exclus = await getExclusTournoi()
    const idx = (selectRotation && typeof selectRotation.selectedIndex === 'number') ? selectRotation.selectedIndex : 0
    const excluActu = Array.isArray(exclus) ? (exclus[idx] || null) : null

    // En serpentin, la dernière manche n'a pas d'exclu
    const totalNb = Number(nbPartiesInput && nbPartiesInput.value || 0)
    const isLastSerpentin = getSerpentinEnabled() && totalNb >= 2 && idx === totalNb - 1

    if (excluActu && !isLastSerpentin) {
      span.innerHTML = `&nbsp;Exclu: <strong>${excluActu}</strong>`
      span.classList.remove('hidden')
    } else {
      span.innerHTML = ''
      span.classList.add('hidden')
    }
  } catch (e) {
    console.warn('updateSelectRotationExcluDisplay error', e)
  }
}

// Init simple avec N lignes (par défaut 4)
function setFeuilleExcluInfo (excluNom, indexRot) {
  // Top banner removed: we only show the inline exclu next to the rotation select.
  // Ensure any leftover top banner DOM element is removed to avoid duplicates.
  try {
    const old = document.getElementById('feuille-exclu-info')
    if (old && old.parentNode) old.parentNode.removeChild(old)
  } catch (_e) { /* ignore */ }

  // Update the inline display next to the rotation select (always used now)
  try { updateSelectRotationExcluDisplay().catch(() => {}) } catch (_e) { /* ignore */ }
}

// Returns true if serpentin is enabled via checkbox
function getSerpentinEnabled () {
  try { return !!(cbSerpentin && cbSerpentin.checked) } catch (_e) { return false }
}

// Compute the last rotation (serpentin) based on standings AFTER the penultimate manche
async function computeSerpentinLastRotation (nbParties) {
  if (!getSerpentinEnabled()) return
  try {
    const scores = await getScoresTournoi()
    // IMPORTANT: include 'Mort' entries in the serpentin ranking — they must take a seat like any player
    const activeRows = scores // do not filter out MORT entries here
    const classementLocal = activeRows.map((row) => {
      const nom = row[0]
      const vals = row.slice(1).map(Number)
      // Use current total (last available), which reflects scores up to current penultimate manche
      const total = vals.length ? vals[vals.length - 1] : 0
      return { nom, total }
    }).sort((a, b) => b.total - a.total)

    // Inclure les exclus (morts) dans les tables serpentin, ils prennent leur place
    const exclusArr = await getExclusTournoi()

    // En mode exclu + serpentin, la dernière manche fait jouer TOUT LE MONDE
    // (pas d'exclu). On fusionne le classement avec l'exclu manquant.
    const isExcluMode = (typeof getMode === 'function' && getMode() === 'exclu')
    const classementNoms = classementLocal.map(p => p.nom).filter(Boolean)
    const exclusArrFiltered = Array.isArray(exclusArr) ? exclusArr.filter(Boolean) : []

    // Ajouter les exclus absents du classement (ils n'ont pas participé à cette manche)
    const missingExclus = exclusArrFiltered.filter(n => !classementNoms.includes(n))
    const playersByRank = [...classementNoms, ...missingExclus]

    let playersToAssignSorted = playersByRank // already ordered by ranking

    // Determine table sizes: in exclu+serpentin mode, all N players play,
    // so we need to recompute sizes for N (not N-1).
    // In non-exclu mode, use the first rotation's structure as before.
    let tableSizes = null
    if (isExcluMode) {
      // All players play: compute table sizes for the full count
      const n = playersToAssignSorted.length
      const nbTables = Math.max(1, Math.ceil(n / 5))
      tableSizes = new Array(nbTables).fill(4)
      let remainder = n - nbTables * 4
      for (let t = nbTables - 1; t >= 0 && remainder > 0; t--) {
        tableSizes[t]++
        remainder--
      }
    } else {
      try {
        const firstRotKey = Object.keys(dernierDictRotations || {})[0]
        if (firstRotKey && dernierDictRotations[firstRotKey]) {
          tableSizes = dernierDictRotations[firstRotKey].map(t => (t.joueurs || []).length)
        }
      } catch (_e) { /* ignore */ }
    }

    // Fallback: compute sensible table sizes if we couldn't determine them
    if (!tableSizes || !tableSizes.length) {
      const n = playersToAssignSorted.length
      const nbTables = Math.max(1, Math.ceil(n / 5))
      tableSizes = new Array(nbTables).fill(4)
      let remainder = n - nbTables * 4
      for (let t = nbTables - 1; t >= 0 && remainder > 0; t--) {
        tableSizes[t]++
        remainder--
      }
    }

    // Move any 'Mort' entries to the end so they are assigned to the last tables
    try {
      const mortEntries = playersToAssignSorted.filter(n => String(n || '').toUpperCase().startsWith('MORT'))
      if (mortEntries.length > 0) {
        const others = playersToAssignSorted.filter(n => !String(n || '').toUpperCase().startsWith('MORT'))
        playersToAssignSorted = [...others, ...mortEntries]
      }
    } catch (_e) { /* ignore */ }

    // Build tables while reserving North seats of the last K tables for Mort
    const nbTablesFmt = tableSizes.length
    const allPlayersList = Array.isArray(playersToAssignSorted) ? playersToAssignSorted.slice() : []
    const mortEntries = allPlayersList.filter(n => String(n || '').toUpperCase().startsWith('MORT'))
    const others = allPlayersList.filter(n => !String(n || '').toUpperCase().startsWith('MORT'))
    const k = Math.min(mortEntries.length, nbTablesFmt)

    const tables = tableSizes.map(() => [])

    // Fill seats, skipping (reserving) North positions of last k tables
    let otherIdx = 0
    const firstReservedIndex = Math.max(0, nbTablesFmt - k)
    for (let t = 0; t < nbTablesFmt; t++) {
      for (let s = 0; s < tableSizes[t]; s++) {
        if (t >= firstReservedIndex && s === 0) {
          // reserve north seat for Mort
          tables[t].push(null)
        } else {
          const next = (otherIdx < others.length) ? others[otherIdx++] : null
          tables[t].push(next)
        }
      }
    }

    // Place Mort entries into reserved North seats of last k tables
    for (let i = 0; i < k; i++) {
      const targetIdx = nbTablesFmt - 1 - i
      if (targetIdx >= 0 && tables[targetIdx] && tables[targetIdx].length > 0) {
        tables[targetIdx][0] = mortEntries[i] || tables[targetIdx][0]
      }
    }
    // Convert to the format expected
    const formattedTables = tables.map((joueurs, idx) => ({
      table: idx + 1,
      joueurs: joueurs.map(nom => ({ nom }))
    }))

    // Ensure any Mort in a table is placed at North (index 0)
    try {
      for (const t of formattedTables) {
        const joueurs = t.joueurs || []
        const indexMort = joueurs.findIndex((j, idx) => idx > 0 && j && String(j.nom || '').toUpperCase().includes('MORT'))
        if (indexMort > 0) {
          const tmp = joueurs[0]
          joueurs[0] = joueurs[indexMort]
          joueurs[indexMort] = tmp
        }
      }
    } catch (_e) { /* ignore */ }

    // Insert last rotation
    const rotName = `Rotation ${nbParties}`
    dernierDictRotations = dernierDictRotations || {}
    dernierDictRotations[rotName] = formattedTables

    // Debug logs removed

    // Update select/options then UI so the new rotation appears and is selectable
    try { await mettreAJourSelectRotationsEtTables() } catch (_e) { /* ignore */ }
    // Debug logs removed
    await updateRotationsDisplay()
    try { renderSaisie() } catch (_e) {}
    // toast supprimé
  } catch (e) {
    console.warn('computeSerpentinLastRotation failed:', e)
  }
}

const soireeSortState = { col: 'total', order: 'desc' } // 'nom', 'total', ou index manche (1-based)

// ------------------ Feuille de soirée ------------------

async function renderFeuilleSoiree () {
  // S'assurer que l'exclu a un 0 pour la manche actuelle avant le rendu
  try {
    const nbJoueurs = listeTournoi.length
    if (nbJoueurs % 4 === 1) {
      await ensureExcluHasScoreForManche(selectRotation.selectedIndex)
    }
  } catch (e) {
    console.warn('Erreur assure exclu avant renderFeuilleSoiree', e)
  }

  let scores = await getScoresTournoi()

  // Filtrer les morts pour l'affichage
  scores = scores.filter(row => !row[0].toUpperCase().includes('MORT'))

  // Ajuster la largeur de la colonne "Joueur" selon le nom le plus long
  try {
    const longest = scores.reduce((m, r) => Math.max(m, String(r[0] || '').length), 0)
    const widthCh = Math.max(8, longest + 2) // largeur minimale
    const tbl = document.getElementById('table-soiree')
    if (tbl) tbl.style.setProperty('--soiree-name-col', `${widthCh}ch`)
    else document.documentElement.style.setProperty('--soiree-name-col', `${widthCh}ch`)
  } catch (e) {
    console.warn('adjustSoireeNameCol failed', e)
  }

  // Manual mode: activated only when the checkbox is checked
  const manualNoteEl = document.getElementById('manual-entry-note')
  const manualModeActive = !!(cbManualEntry && cbManualEntry.checked)
  if (manualModeActive) {
    if (manualNoteEl) {
      manualNoteEl.classList.remove('hidden')
      manualNoteEl.innerHTML = '<div class="manual-note">Mode saisie manuelle activé — saisie manuelle (les totaux sont calculés automatiquement).</div>'
    }

    // Redistribution/gain feature removed — banner and lookups disabled.

    // Number of manches to show is taken from nb-parties input
    const nbParties = Number(nbPartiesInput.value || 1)

    // Local helper for showing sort markers in the soiree headers (avoid using getSortMark before it's defined elsewhere)
    const getSortMarkLocal = (col) => (soireeSortState.column === col ? (soireeSortState.order === 'asc' ? ' ▲' : ' ▼') : '')

    // Build headers: Rang | Joueur | Total | Gain | M1..Mn (same layout as normal table)
    const headersManual = [`<div class="sort-header" data-sort="nom" style="cursor:pointer">Joueur${getSortMarkLocal('nom')}</div>`]
    // Ensure Rang is visually left-most by inserting before the name header in the final DOM
    headersManual.unshift('<div class="col-rang-header">Rang</div>')

    // Total (two-line header similar to normal table)
    headersManual.push(`<div class="header-date-cell sort-header" data-sort="total" style="cursor:pointer; color:#ffb300;"><span>Total</span><span>soirée${getSortMarkLocal('total')}</span></div>`)

    // Gain column (show same visuals as normal Feuille)
    headersManual.push('<div class="col-gain-header">Gain</div>')

    // Manche headers (no trash buttons in manual mode)
    for (let i = 1; i <= nbParties; i++) {
      headersManual.push(`
          <div class="header-date-cell">
            <span class="sort-header" data-sort="${i}" style="cursor:pointer">Manche ${i}${getSortMarkLocal(i)}</span>
          </div>
        `)
    }

    theadSoiree.innerHTML = '<tr>' + headersManual.map((h) => `<th>${h}</th>`).join('') + '</tr>'

    // Build rows data (collect existing scores) then sort so table shows highest totals first
    const allScores = scores // existing saved scores

    const rowsData = listeTournoi.map((nom, originalIndex) => {
      const row = findRowByName(allScores, nom) || [nom]
      const vals = row.slice(1).map(v => (v === '' ? '' : Number(v)))
      const manches = vals.slice(0, vals.length - 1)
      const totalSaved = vals.length ? vals[vals.length - 1] : ''
      const hasAny = vals.some(v => v !== '')
      // Gain feature disabled — return without gain
      return { nom, manches, totalSaved: hasAny ? Number(totalSaved || 0) : null, hasAny, originalIndex }
    })

    // Compute redistribution places (date-aware) so manual mode can also show gains
    let manualPlaces = []
    try {
      const dateIsoForManual = (inputDateTournoi && inputDateTournoi.value) ? inputDateTournoi.value : null
      if (dateIsoForManual) {
        const nbPlayersManual = listeTournoi ? listeTournoi.filter(n => !String(n || '').toUpperCase().startsWith('MORT')).length : rowsData.length
        manualPlaces = await computeRedistribPlacesFor(dateIsoForManual, nbPlayersManual)
      }
    } catch (_e) { manualPlaces = [] }

    // persist manualPlaces on the tbody so other helpers (applyPositionalRanks) can access synchronously
    try { tbodySoiree.dataset.manualPlaces = JSON.stringify(manualPlaces || []) } catch (_e) { tbodySoiree.dataset.manualPlaces = '[]' }

    // Sort: players with scores first (hasAny true), then by total desc, otherwise keep original order
    rowsData.sort((a, b) => {
      if (a.hasAny && !b.hasAny) return -1
      if (!a.hasAny && b.hasAny) return 1
      if (a.hasAny && b.hasAny) return b.totalSaved - a.totalSaved
      return a.originalIndex - b.originalIndex
    })

    // Set static ranks based on the original tournament order (1..N)
    rowsData.forEach((r) => {
      r.rank = (typeof r.originalIndex === 'number') ? (r.originalIndex + 1) : ''
    })

    const rowsHtml = rowsData.map((r, idx) => {
      const mancheInputs = Array.from({ length: nbParties }, (_, idxM) => {
        const raw = r.manches[idxM]
        const val = (typeof raw === 'number' && raw !== 0) ? raw : ''
        return `<td><input type="number" class="manual-manche-input" data-nom="${encodeURIComponent(r.nom)}" data-manche="${idxM}" value="${val}" /></td>`
      }).join('')

      const totalDisplay = (r.hasAny && r.totalSaved !== null) ? r.totalSaved : ''

      // Determine gain by the fixed `Rang` (original order), not by current sorted row index —
      // this keeps gains in the same places even after totals/sorting change.
      const rankForGain = Number(r.rank) || (idx + 1)
      const dateIsoForManual = (inputDateTournoi && inputDateTournoi.value) ? inputDateTournoi.value : getTodayIso()
      const luckyForDate = luckyWinnerByDate[dateIsoForManual]
      const rewardedSet = rewardedPlayersByDate[dateIsoForManual] || new Set()
      let gainVal = ''
      let gainClass = 'gain-regular'
      if (luckyForDate && String(r.nom).trim() === String(luckyForDate).trim()) {
        gainVal = 2.5
        gainClass = 'gain-lucky'
      } else if (rewardedSet.has(r.nom)) {
        gainVal = 2.5
        gainClass = 'gain-rewarded'
      } else if (Array.isArray(manualPlaces) && manualPlaces[rankForGain - 1] !== undefined) {
        gainVal = manualPlaces[rankForGain - 1]
      }
      const gainDisplay = gainVal !== '' ? `<span class="${gainClass}">${gainVal}€</span>` : ''

      return `<tr data-nom="${encodeURIComponent(r.nom)}"><td class="col-rang"><strong>${r.rank || ''}</strong></td><td class="col-joueur">${r.nom}</td><td class="col-total" style="color:#ffb300; font-weight:bold;">${totalDisplay}</td><td class="col-gain">${gainDisplay}</td>${mancheInputs}</tr>`
    }).join('')

    // clear first so existing <input> elements are destroyed (prevents reuse/autofill)
    tbodySoiree.innerHTML = ''
    tbodySoiree.insertAdjacentHTML('beforeend', rowsHtml)

    // Mark 'Mort' rows: color name and disable/strike inputs so user cannot enter scores
    try {
      Array.from(tbodySoiree.querySelectorAll('tr')).forEach(tr => {
        try {
          const name = String(decodeURIComponent(tr.dataset.nom || '') || '').trim()
          if (name && name.toUpperCase().includes('MORT')) {
            tr.classList.add('is-mort')
            Array.from(tr.querySelectorAll('.manual-manche-input')).forEach(inp => {
              inp.disabled = true
              inp.setAttribute('aria-disabled', 'true')
              inp.title = 'Champ désactivé pour un joueur Mort'
              inp.classList.add('input-mort-disabled')
            })
            try {
              const nameCell = tr.querySelector('.col-joueur')
              if (nameCell) nameCell.title = 'Joueur Mort — pas de saisie pour cette manche'
            } catch (_e) {}
          }
        } catch (_e) {}
      })
    } catch (_e) {}

    // After initial render, set positional ranks (1..N)
    try { applyPositionalRanks() } catch (e) { console.warn('applyPositionalRanks failed', e) }

    // Click listeners for sorting (match normal behavior)
    theadSoiree.querySelectorAll('.sort-header').forEach(el => {
      el.addEventListener('click', () => {
        const col = el.dataset.sort
        if (soireeSortState.column === col) {
          soireeSortState.order = soireeSortState.order === 'asc' ? 'desc' : 'asc'
        } else {
          soireeSortState.column = col
          soireeSortState.order = 'desc'
        }
        renderFeuilleSoiree()
      })
    })

    // After initial render, compute ranks and order
    updateManualRanks()

    // Attach listeners to inputs
    tbodySoiree.querySelectorAll('.manual-manche-input').forEach((input) => {
      input.addEventListener('input', async (e) => {
        const el = e.target
        const nom = decodeURIComponent(el.dataset.nom)
        const tr = el.closest('tr')

        // Read all manche inputs for this row and compute total
        const inputs = tr.querySelectorAll('.manual-manche-input')
        let total = 0
        let any = false
        inputs.forEach(inp => {
          const v = inp.value
          if (v !== '') { any = true; total += Number(v) }
        })

        const totalCell = tr.querySelector('.col-total')
        totalCell.textContent = any ? total : ''

        // Update scores in-memory and persist
        const all = await getScoresTournoi()
        const existing = findRowByName(all, nom)
        const newVals = []
        inputs.forEach(inp => {
          const v = inp.value
          newVals.push(v !== '' ? Number(v) : '')
        })
        // Append total as last element
        if (any) newVals.push(total)

        const newRow = [nom, ...newVals]
        if (existing) {
          // Replace existing row
          const idx = all.findIndex(r => normalizeNom(r[0]) === normalizeNom(nom))
          if (idx >= 0) all[idx] = newRow
        } else {
          all.push(newRow)
        }

        try { await setScoresTournoi(all) } catch (e) { console.warn('save manual scores failed', e) }

        // Update visible rank numbers for any rows that have scores (without reordering the rows)
      })

      // Move focus to next player same manche on Enter, then to first player of next manche
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          const tr = input.closest('tr')
          const rows = Array.from(tbodySoiree.querySelectorAll('tr'))
          const rowIndex = rows.indexOf(tr)
          const mancheIdx = Number(input.dataset.manche)
          let nextInput = null

          // 1) Try next player same manche
          if (rowIndex !== -1 && rowIndex < rows.length - 1) {
            const nextRow = rows[rowIndex + 1]
            nextInput = nextRow.querySelector(`.manual-manche-input[data-manche="${mancheIdx}"]`)
          }

          // 2) If none, go to first player of next manche
          if (!nextInput) {
            const nextManche = mancheIdx + 1
            const firstRow = rows[0]
            if (firstRow && nextManche < Number(nbPartiesInput.value || 1)) {
              nextInput = firstRow.querySelector(`.manual-manche-input[data-manche="${nextManche}"]`)
            }
          }

          // Before moving focus, if this manche is now complete (user pressed Enter to confirm), update ranks
          try {
            const mancheInputsNow = Array.from(tbodySoiree.querySelectorAll(`.manual-manche-input[data-manche="${mancheIdx}"]`))
            const allFilledNow = mancheInputsNow.length > 0 && mancheInputsNow.every(inp => inp.value !== '')
            if (allFilledNow) {
              try { updateManualRanks() } catch (e) { console.warn('updateManualRanks on Enter failed', e) }

              // If it's the first manche, then move focus to the first input of next manche (re-query after reordering)
              if (mancheIdx === 0) {
                const nextMancheIdx = mancheIdx + 1
                const firstNext = tbodySoiree.querySelector(`.manual-manche-input[data-manche="${nextMancheIdx}"]`)
                if (firstNext) {
                  firstNext.focus()
                  try { firstNext.select() } catch (_e) {}
                  return
                }
              }
            }
          } catch (e) { console.warn('updateManualRanks on Enter check failed', e) }

          if (nextInput) {
            nextInput.focus()
            try { nextInput.select() } catch (_e) {}
          } else {
            input.blur()
          }
        }
      })

      // Run updateManualRanks on blur if the manche is complete
      input.addEventListener('blur', () => {
        try {
          const currentMancheIdx = Number(input.dataset.manche)
          const mancheInputs = Array.from(tbodySoiree.querySelectorAll(`.manual-manche-input[data-manche="${currentMancheIdx}"]`))
          const allFilled = mancheInputs.length > 0 && mancheInputs.every(inp => inp.value !== '')
          if (allFilled) {
            updateManualRanks()

            // If the finished manche was the first, auto-focus the first input of next manche
            if (currentMancheIdx === 0) {
              const firstNext = tbodySoiree.querySelector(`.manual-manche-input[data-manche="${currentMancheIdx + 1}"]`)
              if (firstNext) {
                firstNext.focus()
                try { firstNext.select() } catch (_e) {}
              }
            }
          }
        } catch (e) {
          console.warn('updateManualRanks on blur failed', e)
        }
      })
    })

    // Focus the first empty manual field of the first manche on render
    try {
      const firstMancheInputs = Array.from(tbodySoiree.querySelectorAll('.manual-manche-input[data-manche="0"]'))
      const firstEmpty = firstMancheInputs.find(inp => (inp.value === '' || inp.value === null || inp.value === undefined))
      if (firstEmpty) {
        firstEmpty.focus()
        try { firstEmpty.select() } catch (_) {}
      } else {
        // fallback: focus the first input of the table
        const firstManual = tbodySoiree.querySelector('.manual-manche-input')
        if (firstManual) {
          firstManual.focus()
          try { firstManual.select() } catch (_) {}
        }
      }
    } catch (e) {
      console.warn('focus first manual input failed', e)
    }

    return
  } else {
    if (manualNoteEl) { manualNoteEl.classList.add('hidden'); manualNoteEl.innerHTML = '' }
  }

  if (!scores.length) {
    theadSoiree.innerHTML = ''
    tbodySoiree.innerHTML = ''
    return
  }

  const maxLen = scores.reduce((m, r) => Math.max(m, r.length), 0)
  const nbManchesMax = Math.max(0, maxLen - 2)

  // Precompute redistribution places for sorting/display (using date from input)
  let placesForSort = []
  try {
    const dateIso = (inputDateTournoi && inputDateTournoi.value) ? inputDateTournoi.value : null
    if (dateIso) {
      placesForSort = await computeRedistribPlacesFor(dateIso, scores.length)
    } else {
      placesForSort = []
    }
  } catch (_e) { placesForSort = [] }

  // Tri des scores selon soireeSortState
  scores.sort((rowA, rowB) => {
    const getVal = (row, col) => {
      const nom = row[0]
      if (col === 'nom') return nom
      const vals = row.slice(1).map(Number)

      if (col === 'total') {
        return vals.length ? vals[vals.length - 1] : 0
      }
      if (col === 'gain') {
        // Compute gain based on tournament rank (derived from total)
        const total = vals.length ? vals[vals.length - 1] : 0
        // Determine rank among scores (1-based)
        const totals = scores.map(r => {
          const v = r.slice(1).map(Number)
          return v.length ? v[v.length - 1] : 0
        })
        let higher = 0
        for (const t of totals) { if (t > total) higher++ }
        const rank = higher + 1
        // Check lucky/rewarded for the date
        const dateIso = (inputDateTournoi && inputDateTournoi.value) ? inputDateTournoi.value : getTodayIso()
        const luckyForDate = luckyWinnerByDate[dateIso]
        const rewardedSet = rewardedPlayersByDate[dateIso] || new Set()
        if ((luckyForDate && String(nom).trim() === String(luckyForDate).trim()) || rewardedSet.has(nom)) {
          return 2.5
        }
        const val = (Array.isArray(placesForSort) && placesForSort[rank - 1] !== undefined) ? placesForSort[rank - 1] : (soireeSortState.order === 'desc' ? -999999 : 999999)
        return val
      }
      // Manche number
      const idx = Number(col) // 1-based
      const arrIndex = idx - 1
      if (arrIndex >= 0 && arrIndex < vals.length - 1) {
        return vals[arrIndex]
      }
      return soireeSortState.order === 'desc' ? -999999 : 999999
    }

    const valA = getVal(rowA, soireeSortState.column || 'total')
    const valB = getVal(rowB, soireeSortState.column || 'total')

    if (soireeSortState.column === 'nom') {
      return soireeSortState.order === 'asc'
        ? valA.localeCompare(valB)
        : valB.localeCompare(valA)
    }

    // Numeric sort
    if (valA < valB) return soireeSortState.order === 'asc' ? -1 : 1
    if (valA > valB) return soireeSortState.order === 'asc' ? 1 : -1
    return 0
  })

  const getSortMark = (col) => {
    if (soireeSortState.column === col) {
      return soireeSortState.order === 'asc' ? ' ▲' : ' ▼'
    }
    return ''
  }

// Prepend static Rang header and player/name header
    const headers = ['<div class="col-rang-header">Rang</div>', `<div class="sort-header" data-sort="nom" style="cursor:pointer">Joueur${getSortMark('nom')}</div>`]

  // NOUVEAU : Total juste après le nom
  headers.push(`<div class="header-date-cell sort-header" data-sort="total" style="cursor:pointer; color:#ffb300;"><span>Total</span><span>soirée${getSortMark('total')}</span></div>`)

  // Insert Gain header (display-only) after Total
  headers.push(`<div class="header-date-cell sort-header" data-sort="gain" style="cursor:pointer">Gain</div>`)

  // Manche headers
  for (let i = 1; i <= nbManchesMax; i++) {
    headers.push(
      `<div class="header-date-cell">
        <span class="sort-header" data-sort="${i}" style="cursor:pointer">Manche ${i}${getSortMark(i)}</span>
        <button type="button" class="btn-trash btn-del-manche" data-manche="${i - 1}" title="Supprimer cette manche">🗑︎</button>
      </div>`
    )
  }

  theadSoiree.innerHTML =
    '<tr>' + headers.map((h) => `<th>${h}</th>`).join('') + '</tr>'

  // Click listeners for sorting
  theadSoiree.querySelectorAll('.sort-header').forEach(el => {
    el.addEventListener('click', () => {
      // Si on clique sur le trash button, on ne trie pas (propagation arrêtée dans btn-del-manche, mais ici on est sur le parent ou sibling)
      // La structure est <div> <span>Titre</span> <button>Trash</button> </div>
      // Le sort-header est sur le span ou le div parent ?
      // Cas Manche: <span class="sort-header">...</span> est sibling de button. Clic sur button ne touche pas span.
      // Cas Joueur: div.sort-header.
      // Cas Total: div.sort-header.

      const col = el.dataset.sort
      if (soireeSortState.column === col) {
        soireeSortState.order = soireeSortState.order === 'asc' ? 'desc' : 'asc'
      } else {
        soireeSortState.column = col
        soireeSortState.order = 'desc' // Default desc for new numeric col usually
      }
      renderFeuilleSoiree()
    })
  })

  const exclusArr = await getExclusTournoi()
  const excluActuel = exclusArr[selectRotation.selectedIndex] || null

  // Redistribution feature removed — no default places displayed
  let places = []

  // Do NOT show a large informational banner in the Soirée screen. Show only the small inline banner next to 'Joueurs' title when a tirage has been run.
  try {
    const existingBanner = document.getElementById('feuille-redistrib-banner')
    if (existingBanner) existingBanner.remove()
  } catch (e) { /* ignore */ }

// Redistrib banner removed — no action

  // Compute redistribution places for the date in the date field (display-only)
  try {
    const dateIso = (inputDateTournoi && inputDateTournoi.value) ? inputDateTournoi.value : null
    const nbPlayersActive = scores.length

    // NEW: Update gains based on the date field immediately when the date exists.
    // If no date selected, do not show gains in Feuille.
    if (dateIso) {
      places = await computeRedistribPlacesFor(dateIso, nbPlayersActive)
    } else {
      places = []
    }
  } catch (_e) { places = [] }

  tbodySoiree.innerHTML = scores
    .map((row, _idx) => {
      const nom = row[0]
      const valeurs = row.slice(1).map(Number)
      const nbManches = Math.max(0, valeurs.length - 1)
      const total = nbManches > 0 ? valeurs[valeurs.length - 1] : 0
      const manches = valeurs.slice(0, nbManches)

      // Determine gain by current rank (index after sorting)
      const rank = _idx + 1
      // If lucky draw produced a winner for this date, show 2.5€ for that player (or if player was manually rewarded)
      const dateIsoForRow = (inputDateTournoi && inputDateTournoi.value) ? inputDateTournoi.value : getTodayIso()
      const luckyForDate = luckyWinnerByDate[dateIsoForRow]
      const rewardedSet = rewardedPlayersByDate[dateIsoForRow] || new Set()
      let gainVal = ''
      let gainClass = 'gain-regular'
      if (luckyForDate && String(nom).trim() === String(luckyForDate).trim()) {
        gainVal = 2.5
        gainClass = 'gain-lucky'
      } else if (rewardedSet.has(nom)) {
        gainVal = 2.5
        gainClass = 'gain-rewarded'
      } else if (Array.isArray(places) && places[rank - 1] !== undefined) {
        gainVal = places[rank - 1]
      }
      const gainDisplay = gainVal !== '' ? `<span class="${gainClass}">${gainVal}€</span>` : ''

      const cellsArray = [
        `<td class="col-rang"><strong>${rank}</strong></td>`,
        `<td class="first-col col-joueur">${nom}</td>`,
        `<td class="col-total" style="color:#ffb300; font-weight:bold;">${total}</td>`,
        `<td class="col-gain">${gainDisplay}</td>`,
        ...Array.from({ length: nbManchesMax }, (_, i) =>
          `<td class="col-manche">${i < manches.length ? manches[i] : ''}</td>`
        )
      ]

      const cells = cellsArray.join('')

      const isExclu = excluActuel && normalizeNom(nom) === normalizeNom(excluActuel)
      const trClass = isExclu ? ' class="soiree-exclu"' : ''

      return `<tr${trClass}>${cells}</tr>`
    })
    .join('')

  // Ensure the lucky button state follows the currently selected date
  try { updateLuckyButtonState() } catch (e) { /* ignore */ }

  theadSoiree.querySelectorAll('.btn-del-manche').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const indexManche = Number(btn.dataset.manche)
      await supprimerMancheSoiree(indexManche)
    })
  })
}

async function supprimerMancheSoiree (indexManche) {
  const scores = await getScoresTournoi()
  const nouveauxScores = scores.map((row) => {
    const nom = row[0]
    const vals = row.slice(1).map(Number)

    if (vals.length === 0) return row

    const totalActuel = vals[vals.length - 1]
    const manches = vals.slice(0, vals.length - 1)

    if (indexManche < 0 || indexManche >= manches.length) {
      return row
    }

    const valeurSupprimee = manches[indexManche]
    const nouvellesManches = manches.filter((_, i) => i !== indexManche)
    const nouveauTotal = totalActuel - valeurSupprimee

    return [nom, ...nouvellesManches, nouveauTotal]
  })

  await setScoresTournoi(nouveauxScores)
  await renderFeuilleSoiree()
}

btnEffacerSoiree.addEventListener('click', async () => {
  if (await askConfirm('Effacer tous les scores de la soirée ?')) {
    await setScoresTournoi([])
    // also reset per-table matrices so saisie grid clears
    try { await setScoresParTable([]) } catch (_e) {}
    try { clearAllValidatedMancheSnapshots() } catch (_e) { /* ignore */ }
    try { renderSaisie() } catch (_e) {}

    // Clear any in-memory lucky/reward state when scores are wiped
    clearAllLucky()
    await renderFeuilleSoiree()
    updateLuckyButtonState()

    // keep rotation plan intact; do not clear dernierDictRotations or selects
  }
})

// Update Feuille when the date field changes so gains are recalculated live
if (inputDateTournoi) {
  inputDateTournoi.addEventListener('change', async () => {
    try {
      // Changing date resets any in-memory "chanceux" state and clears the Gain column
      clearAllLucky()
      await renderFeuilleSoiree()
      updateLuckyButtonState()
    } catch (e) { console.warn('date-tournoi change render failed', e) }
  })
}

// ------------------ Classement annuel ------------------

const classementSortState = { col: 'total', order: 'desc' } // 'rang', 'nom', 'total', 'prime', ou index date (string?) non, date string

async function renderClassement () {
  const recap = await getRecap()
  const dates = recap.map((t) => t.date).sort()
  // rebuild classement from recap+persistent to avoid stale/misaligned rows
  const persistedScores = await getClassement()
  const scores = buildClassementFromRecap(recap, persistedScores)
  // if the regenerated table differs from what we have stored, update storage
  try {
    if (JSON.stringify(scores) !== JSON.stringify(persistedScores)) {
      // do not await: non-critical
      setClassement(scores).catch(e => console.warn('auto-persist classement failed', e))
    }
  } catch (_e) { /* ignore serialization errors */ }

  const theadDates = tableClassementDates.querySelector('thead')
  const tbodyFixe = tableClassementFixe.querySelector('tbody')
  const tbodyDates = tableClassementDates.querySelector('tbody')
  const theadFixe = tableClassementFixe.querySelector('thead')

  // 1. Préparation des données
  let lignes = scores
    .filter(row => !row[0].toUpperCase().includes('MORT'))
    .map((row) => {
      const nom = row[0]
      const parDate = row.slice(1).map(Number)
      const nbTournoisJoues = parDate.filter((v) => v !== 0).length
      const somme = parDate.reduce((a, b) => a + b, 0)
      const prime = nbTournoisJoues * 50
      const totalAnnuel = somme + prime

      // Map dates to values for easier sorting if needed
      const datesMap = {}
      dates.forEach((d, i) => { datesMap[d] = parDate[i] || 0 })

      return { nom, prime, totalAnnuel, scoreJeu: somme, parDate, datesMap }
    })

  // 2. Calcul du Rang (basé sur Total Annuel DESC)
  lignes.sort((a, b) => b.totalAnnuel - a.totalAnnuel)
  lignes = lignes.map((l, i) => ({ ...l, rang: i + 1 }))

  // Build recapMap by aggregating displayed redistributions from recap (display-only)
  const recapMap = new Map()
  try {
    const defaultsData = await fetchRedistribDefaults()
    for (const t of recap) {
      try {
        const dateT = t.date
        const scoresT = (t.scores || []).filter(r => !String(r[0] || '').toUpperCase().startsWith('MORT'))
        const nbPlayersT = scoresT.length
        if (nbPlayersT === 0) continue
        const placesT = getPlacesFromDefaults(defaultsData, dateT, nbPlayersT)
        if (!placesT || placesT.length === 0) continue
        // determine rank ordering for that tournament
        const ranked = scoresT.map(r => ({ nom: r[0], total: Number(r[r.length - 1]) || 0 }))
        ranked.sort((a, b) => b.total - a.total)
        ranked.forEach((p, idx) => {
          const val = Number(placesT[idx] || 0)
          if (val) recapMap.set(p.nom, (recapMap.get(p.nom) || 0) + val)
        })
        // Include lucky/rewarded 2.5€ for this date if present — ensure each player is counted once
        try {
          const names = new Set()

          // 1) persisted rewards array (if any)
          if (t && Array.isArray(t.rewards)) {
            t.rewards.forEach(r => { if (r && r.name) names.add(r.name) })
          }

          // 3) in-memory lucky/rewarded state (recent, not yet persisted)
          const inMemLucky = luckyWinnerByDate[dateT]
          if (inMemLucky) names.add(inMemLucky)
          const inMemRewarded = rewardedPlayersByDate[dateT]
          if (inMemRewarded && inMemRewarded.size) inMemRewarded.forEach(n => names.add(n))

          // Add 2.5€ once per unique name
          names.forEach((name) => {
            if (name) recapMap.set(name, (recapMap.get(name) || 0) + 2.5)
          })
        } catch (_e) { /* ignore */ }
      } catch (_e) { /* ignore per-tournament errors */ }
    }
  } catch (e) {
    console.warn('Failed to build recapMap for gains display', e)
  }

  // 3. Tri pour l'affichage (selon classementSortState)
  lignes.sort((a, b) => {
    let valA, valB
    const col = classementSortState.col

    if (col === 'rang') { valA = a.rang; valB = b.rang } else if (col === 'nom') { valA = a.nom; valB = b.nom } else if (col === 'total') { valA = a.totalAnnuel; valB = b.totalAnnuel } else if (col === 'score') { valA = a.scoreJeu; valB = b.scoreJeu } else if (col === 'prime') { valA = a.prime; valB = b.prime } else if (col === 'gains') {
      const rA = recapMap.get(a.nom) || 0
      const rB = recapMap.get(b.nom) || 0
      valA = rA; valB = rB
    } else {
      // C'est une date ?
      valA = a.datesMap[col] || 0
      valB = b.datesMap[col] || 0
    }

    if (col === 'nom') {
      return classementSortState.order === 'asc'
        ? valA.localeCompare(valB)
        : valB.localeCompare(valA)
    }

    if (valA < valB) return classementSortState.order === 'asc' ? -1 : 1
    if (valA > valB) return classementSortState.order === 'asc' ? 1 : -1
    return 0
  })

  // Helper sort mark
  const getSortMark = (c) => (classementSortState.col === c ? (classementSortState.order === 'asc' ? ' ▲' : ' ▼') : '')

  // 4. Render Headers (Fixe)
  // 4. Render Headers (Fixe)
  theadFixe.innerHTML = `
    <tr>
      <th class="sort-header" data-sort="rang" style="cursor:pointer">Rang${getSortMark('rang')}</th>
      <th class="sort-header" data-sort="nom" style="cursor:pointer">Joueur${getSortMark('nom')}</th>
      <th class="sort-header" data-sort="score" style="cursor:pointer">Score<br>Tournoi${getSortMark('score')}</th>
      <th class="sort-header" data-sort="prime" style="cursor:pointer">Prime${getSortMark('prime')}</th>
      <th class="sort-header" data-sort="gains" style="cursor:pointer">Gains${getSortMark('gains')}</th>
      <th class="sort-header" data-sort="total" style="cursor:pointer; color:#ffb300;">Total${getSortMark('total')}</th>

    </tr>
  `

  // 5. Render Headers (Dates)
  theadDates.innerHTML = `<tr>${dates.map(
    (d) => `
      <th>
        <div class="header-date-cell">
          <span class="sort-header" data-sort="${d}" style="cursor:pointer">${formatDateShort(d).replace(' ', '<br>')}${getSortMark(d)}</span>
          <button class="btn-trash btn-del-date" data-date="${d}" title="Supprimer cette date">🗑︎</button>
        </div>
      </th>
    `
  ).join('')}</tr>`

  // 6. Render Body (Fixe)
  tbodyFixe.innerHTML = lignes.map((ligne) => `
      <tr>
        <td><strong>${ligne.rang}</strong></td>
        <td>${ligne.nom}</td>
        <td>${ligne.scoreJeu}</td>
        <td>${ligne.prime}</td>
        <td>${(recapMap.get(ligne.nom) || 0) ? recapMap.get(ligne.nom) + '€' : ''}</td>
        <td style="color:#ffb300; font-weight:bold;">${ligne.totalAnnuel}</td>
      </tr>
    `).join('')

  // 7. Render Body (Dates)
  tbodyDates.innerHTML = lignes.map((ligne) => `
      <tr>
        ${dates.map(d => `<td>${ligne.datesMap[d]}</td>`).join('')}
      </tr>
  `).join('')

  // 8. Attach Listeners (Sort & Delete)

  // Sort Headers (Fixe)
  theadFixe.querySelectorAll('.sort-header').forEach(el => {
    el.addEventListener('click', () => {
      const col = el.dataset.sort
      if (classementSortState.col === col) {
        classementSortState.order = classementSortState.order === 'asc' ? 'desc' : 'asc'
      } else {
        classementSortState.col = col
        classementSortState.order = 'desc' // Default desc usually better for numbers
        if (col === 'rang' || col === 'nom') classementSortState.order = 'asc'
      }
      renderClassement()
    })
  })

  // Sort Headers (Dates)
  theadDates.querySelectorAll('.sort-header').forEach(el => {
    el.addEventListener('click', () => {
      // e.stopPropagation(); // Pas besoin car le bouton trash est separé
      const col = el.dataset.sort
      if (classementSortState.col === col) {
        classementSortState.order = classementSortState.order === 'asc' ? 'desc' : 'asc'
      } else {
        classementSortState.col = col
        classementSortState.order = 'desc'
      }
      renderClassement()
    })
  })

  // Delete Date
  theadDates.querySelectorAll('.btn-del-date').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const date = btn.dataset.date
      if (await askConfirm(`Supprimer le tournoi du ${formatDateFr(date)} ?`)) {
        await supprimerDateClassement(date)
      }
    })
  })
}

const btnEffacerCognin = document.getElementById('btn-effacer-cognin')
const btnExportPdfCognin = document.getElementById('btn-export-pdf-cognin')

// === FONCTION SAUVEGARDE GLOBALE (Recap + Classement + Joueurs) ===
async function exportBackupJSON () {
  try {
    const recap = await getRecap()
    const classement = await getClassement()
    const joueurs = await loadListeJoueurs()
    const joueursTournoi = await loadJoueursTournoi()

    const backupData = {
      dateExport: new Date().toISOString(),
      recap,
      classement,
      joueurs,
      joueursTournoi
    }

    const now = new Date()
    const jj = String(now.getDate()).padStart(2, '0')
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const aaaa = now.getFullYear()
    const hh = String(now.getHours()).padStart(2, '0')
    const min = String(now.getMinutes()).padStart(2, '0')

    const jsonStr = JSON.stringify(backupData, null, 2)
    const filename = `sauvegarde_tarot_${jj}-${mm}-${aaaa}_${hh}h${min}.json`

    // Sauvegarde automatique via Electron
    if (window.electronAPI && window.electronAPI.saveBackup) {
      const res = await window.electronAPI.saveBackup(filename, jsonStr)
      if (res.success) {
        showAlert(`Sauvegarde réussie !\n\nDossier : Documents/Sauvegardes tournois de tarot\nFichier : ${filename}`)
        return
      } else {
        console.error(res.error)
      }
    }

    // Mode web : sauvegarder via l'API backend
    if (!window.electronAPI) {
      try {
        const res = await fetch('/api/backups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, content: jsonStr })
        })
        const data = await res.json()
        if (data.success) {
          showAlert(`Sauvegarde réussie !\n\nFichier : ${filename}`)
          return
        }
      } catch (_e) { /* fallback au téléchargement */ }
    }

    // Fallback : téléchargement direct
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename

    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    // Pause pour laisser le temps au téléchargement
    await new Promise(resolve => setTimeout(resolve, 1500))
  } catch (e) {
    console.error('Erreur sauvegarde', e)
    showAlert('Erreur lors de la tentative de sauvegarde.')
  }
}

async function effacerToutLesClassements () {
  // 1ère Confirmation
  if (!await askConfirm('Attention : Cela va effacer TOUT le classement annuel et le récapitulatif !\n\nÊtes-vous sûr de vouloir continuer ?')) return

  // Proposition de sauvegarde
  if (await askConfirm("Voulez-vous télécharger une copie de sauvegarde (JSON) avant l'effacement ?")) {
    await exportBackupJSON()
  }

  // 2ème Confirmation (Fatale)
  if (!await askConfirm("CONFIRMATION ULTIME :\n\nVous êtes sur le point de tout supprimer définitivement.\nConfirmez-vous l'effacement total ?")) return

  await setClassement([]) // Vide le classement annuel
  await setScoresTournoi([]) // Vide aussi les scores tournoi
  await setRecap([]) // Vide le récap (ce qui vide aussi Cognin)
  try { clearAllValidatedMancheSnapshots() } catch (_e) { /* ignore */ }

  // Clear any lucky/reward state when the classement is wiped
  clearAllLucky()

  await renderRecap()
  await renderClassement()
  await renderCognin()
  await renderFeuilleSoiree() // Rafraîchir l'écran scores tournoi
  updateLuckyButtonState()

  // Effacer aussi le plan de table
  rotationsResultDiv.innerHTML = ''
  if (planHeadingEl) planHeadingEl.textContent = 'Plan de table / Manches'
  dernierDictRotations = null
  // Supprimer le tirage sauvegardé et le full tirage
  try { localStorage.removeItem('tarot_full_tirage'); dernierFullTirage = null } catch (_e) {}

  // Réinitialiser l'exclu (s'il y en avait un)
  try { await setExclusTournoi([]); clearExcluSeatIndex() } catch (_e) { /* ignore */ }

  selectRotation.innerHTML = ''
  // selectTable removed

  // Effacer aussi la feuille de scores (table) et données persistantes
  // (déjà fait plus haut)

  // Reset redistributions when clearing classement
  // redistribution feature removed — nothing to clear

  // Vider le container Saisie et forcer un rerender pour éviter d'afficher d'anciennes tables
  try { if (containerSaisie) { containerSaisie.innerHTML = ''; renderSaisie() } } catch (e) { console.warn('clear Saisie container failed', e) }

  // Refresh rotations display/plan to ensure no stale cards remain
  try { await updateRotationsDisplay() } catch (_e) { /* ignore */ }

  /* Legacy table-based feuille data removed */
}

// Redistribution screen removed — functionality deleted (defaults JSON remains).

btnEffacerClassement.addEventListener('click', effacerToutLesClassements)

if (btnEffacerCognin) {
  btnEffacerCognin.addEventListener('click', effacerToutLesClassements)
}

// Gestion Restauration Sauvegarde
// Si btnRestoreBackup n'existe plus, on n'a plus besoin du listener qui lui était attaché.
// if (btnRestoreBackup && inputBackupFile) {
//   btnRestoreBackup.addEventListener("click", () => {
//     inputBackupFile.click();
//   });
// }

if (inputBackupFile) {
  inputBackupFile.addEventListener('change', (e) => {
    const file = e.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        const json = JSON.parse(evt.target.result)

        if (await askConfirm(`Restaurer les données depuis la sauvegarde du ${json.dateExport ? new Date(json.dateExport).toLocaleDateString() : '???'} ?\n\nCela REMPLACERA les données actuelles.`)) {
          await applyRestore(json)
        }
      } catch (err) {
        console.error(err)
        showAlert('Erreur lors de la lecture du fichier : ' + err.message)
      } finally {
        inputBackupFile.value = '' // Reset pour permettre de recharger le même fichier si besoin
      }
    }
    reader.readAsText(file)
  })
}

async function applyRestore (json) {
  // Validation basique (on assouplit pour accepter les autres formats de sauvegarde)
  if (!json.recap && !json.classement && !json.joueurs) {
    throw new Error('Format de fichier invalide (clés manquantes).')
  }

  // Import
  if (Array.isArray(json.recap)) await setRecap(json.recap)
  if (Array.isArray(json.classement)) {
    await setClassement(json.classement)
    // If the restored classement is empty, also clear tournament scores to avoid stale data
    if (Array.isArray(json.classement) && json.classement.length === 0) {
      try {
        await setScoresTournoi([])
        try { clearAllValidatedMancheSnapshots() } catch (_e) { /* ignore */ }
        try { await renderFeuilleSoiree() } catch (_e) { /* ignore */ }
      } catch (e) {
        console.warn('Failed to clear scores during restore of empty classement', e)
      }
    }
  }

  // Import Listes
  if (json.joueurs && Array.isArray(json.joueurs)) {
    await saveListeJoueurs(json.joueurs)
    await renderListeGenerale()
  }
  if (json.joueursTournoi && Array.isArray(json.joueursTournoi)) {
    // Cancel any pending scheduled save to avoid race where an old delayed save
    // might overwrite the restored list after we've written it.
    if (_saveListeTimer) { clearTimeout(_saveListeTimer); _saveListeTimer = null }

    // Apply restored list directly into memory and persist immediately
    listeTournoi = json.joueursTournoi
    try {
      await saveJoueursTournoi(listeTournoi)
    } catch (e) {
      console.error('Erreur sauvegarde listeTournoi (restore)', e)
      showAlert('Erreur en sauvegardant la liste du tournoi restaurée : ' + e.message)
    }
    renderListeTournoi()
    await renderListeGenerale()
  }

  // Update UI
  await renderRecap()
  await renderClassement()
  await renderCognin()

  showConfirmation()
}

// Fonction utilitaire d'export PDF avec découpage des colonnes
async function exportCurrentToPdf () {
  // Déterminer le contexte (Classement ou Cognin)
  const isCognin = !document.getElementById('screen-cognin').classList.contains('hidden')
  const isClassement = !document.getElementById('screen-classement').classList.contains('hidden')

  let pdfTitle = 'Classement'
  if (isCognin) pdfTitle = 'Classement-Cognin'
  if (isClassement) pdfTitle = 'Classement-Annuel'

  if (isClassement || isCognin) {
    await preparePrintView(isCognin ? 'cognin' : 'classement')
  }

  if (window.electronAPI && window.electronAPI.exportPDF) {
    try {
      const res = await window.electronAPI.exportPDF({ landscape: true, title: pdfTitle })
      if (res) showConfirmation()
    } catch (e) {
      console.error(e)
      showAlert("Erreur lors de l'export PDF.")
    }
    document.getElementById('print-container').innerHTML = ''
  } else {
    // Web / Tablette : le window.print() doit être déclenché par un vrai geste utilisateur.
    // Après un await, Chrome Android ignore silencieusement print().
    // On affiche donc un bouton que l'utilisateur touche pour lancer l'impression.
    const printContent = document.getElementById('print-container').innerHTML
    if (!printContent) {
      showAlert('Rien à exporter.')
      return
    }
    // triggerPrint affiche un bouton qui appelle window.print() directement
    // dans le handler click (vrai geste utilisateur pour Chrome Android)
    const d = new Date()
    const todayFr = `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`
    const pdfFilename = isCognin ? `Classement Cognin au ${todayFr}.pdf` : `Classement annuel au ${todayFr}.pdf`
    triggerPrint(() => {
      document.getElementById('print-container').innerHTML = ''
    }, pdfFilename)
  }
}

async function preparePrintView (type) {
  const container = document.getElementById('print-container')
  container.innerHTML = ''

  // Récupération des données brutes
  const recap = await getRecap()

  let allDates, sortedRows

  if (type === 'cognin') {
    // Logique reprise de renderCognin (Mise à jour avec règle du Jeudi)
    recap.sort((a, b) => a.date.localeCompare(b.date))
    allDates = recap.map(t => t.date)
    const stats = new Map()

    recap.forEach(tournoi => {
      const { date, scores } = tournoi
      // Détection du Jeudi
      const [y, m, d] = date.split('-')
      const dateObj = new Date(Number(y), Number(m) - 1, Number(d))
      const isJeudi = (dateObj.getDay() === 4)

      const validScores = scores.filter(row => Array.isArray(row) && row.length >= 2)
      // On récupère le score pour le tri, même si le jeudi on donne 1 point fixe
      const roundScores = validScores.map(row => ({ name: row[0], score: Number(row[row.length - 1]) || 0 }))
      // Tri décroissant par score
      roundScores.sort((a, b) => b.score - a.score)

      const nbJoueurs = roundScores.length

      roundScores.forEach((p, index) => {
        let points
        if (isJeudi) {
          // Règle du Jeudi : 1 point pour tout le monde (Prime = 1)
          points = 1
        } else {
          // Règle Standard : (Nb Joueurs - Rang) calculé à partir de 0 (donc index 0 -> max points)
          // index 0 -> 1er -> points = nbJoueurs - 0 = nbJoueurs
          // index 1 -> 2e -> points = nbJoueurs - 1
          points = nbJoueurs - index
        }

        if (!stats.has(p.name)) stats.set(p.name, { total: 0, byDate: {} })
        const s = stats.get(p.name)
        s.byDate[date] = points
        s.total += points
      })
    })
    // Build gains map for Cognin PDF
    const cogGainsMap = new Map()
    try {
      const defaultsData = await fetchRedistribDefaults()
      for (const t of recap) {
        try {
          const scoresT = (t.scores || []).filter(r => !String(r[0] || '').toUpperCase().startsWith('MORT'))
          const nbPlayersT = scoresT.length
          if (nbPlayersT === 0) continue
          const placesT = getPlacesFromDefaults(defaultsData, t.date, nbPlayersT)
          if (!placesT || placesT.length === 0) continue
          const ranked = scoresT.map(r => ({ nom: r[0], total: Number(r[r.length - 1]) || 0 }))
          ranked.sort((a, b) => b.total - a.total)
          ranked.forEach((p, idx) => {
            const val = Number(placesT[idx] || 0)
            if (val) cogGainsMap.set(p.nom, (cogGainsMap.get(p.nom) || 0) + val)
          })
          if (t && Array.isArray(t.rewards)) {
            const names = new Set()
            t.rewards.forEach(r => { if (r && r.name) names.add(r.name) })
            names.forEach(name => { if (name) cogGainsMap.set(name, (cogGainsMap.get(name) || 0) + 2.5) })
          }
        } catch (_e) { /* ignore */ }
      }
    } catch (_e) { /* ignore */ }

    sortedRows = Array.from(stats.entries())
      .filter(([nom]) => !nom.startsWith('Mort '))
      .map(([nom, data]) => ({ nom, total: data.total, gains: cogGainsMap.get(nom) || 0, dates: data.byDate }))
    sortedRows.sort((a, b) => b.total - a.total)
  } else {
    // Logique reprise de renderClassement
    const rawScores = await getClassement()
    const sortedDates = recap.map(t => t.date).sort()
    allDates = sortedDates

    // Build gains map (same logic as renderClassement)
    const gainsMap = new Map()
    try {
      const defaultsData = await fetchRedistribDefaults()
      for (const t of recap) {
        try {
          const scoresT = (t.scores || []).filter(r => !String(r[0] || '').toUpperCase().startsWith('MORT'))
          const nbPlayersT = scoresT.length
          if (nbPlayersT === 0) continue
          const placesT = getPlacesFromDefaults(defaultsData, t.date, nbPlayersT)
          if (!placesT || placesT.length === 0) continue
          const ranked = scoresT.map(r => ({ nom: r[0], total: Number(r[r.length - 1]) || 0 }))
          ranked.sort((a, b) => b.total - a.total)
          ranked.forEach((p, idx) => {
            const val = Number(placesT[idx] || 0)
            if (val) gainsMap.set(p.nom, (gainsMap.get(p.nom) || 0) + val)
          })
          if (t && Array.isArray(t.rewards)) {
            const names = new Set()
            t.rewards.forEach(r => { if (r && r.name) names.add(r.name) })
            names.forEach(name => { if (name) gainsMap.set(name, (gainsMap.get(name) || 0) + 2.5) })
          }
        } catch (_e) { /* ignore */ }
      }
    } catch (_e) { /* ignore */ }

    sortedRows = rawScores
      .filter(row => !row[0].startsWith('Mort '))
      .map(row => {
        const nom = row[0]
        const parDate = row.slice(1).map(Number)
        const nbTournoisJoues = parDate.filter(v => v !== 0).length
        const somme = parDate.reduce((a, b) => a + b, 0)
        const prime = nbTournoisJoues * 50
        const total = somme + prime
        const gains = gainsMap.get(nom) || 0

        // Convert array scores back to date map for unified logic
        const dateMap = {}
        sortedDates.forEach((d, i) => { dateMap[d] = parDate[i] })

        return { nom, total, score: somme, prime, gains, dates: dateMap }
      })
    sortedRows.sort((a, b) => b.total - a.total)
  }

  // Calculer la largeur nécessaire pour le nom le plus long (approx en caractères)
  // On ajoute une marge de sécurité (ex: +3 ch)
  const maxNameLen = sortedRows.reduce((max, r) => Math.max(max, (r.nom || '').length), 0)
  const w = Math.max(10, maxNameLen + 3)
  // On force min et max width pour garantir une largeur STRICTEMENT IDENTIQUE sur chaque page
  const nameColStyle = `width: ${w}ch; min-width: ${w}ch; max-width: ${w}ch;`
  const rankColStyle = 'width: 4ch; min-width: 4ch; max-width: 4ch;'

  // On revient à un découpage manuel strict pour garantir la lisibilité et le contrôle des sauts de page
  const COLS_PER_PAGE = 15 // Réduit car les colonnes sont plus larges avec le jour de la semaine
  const ROWS_PER_PAGE = 25 // Réduit car les lignes seront plus hautes avec une police plus grande (A4 Paysage)

  const nbDatePages = Math.ceil(allDates.length / COLS_PER_PAGE) || 1
  const nbPlayerPages = Math.ceil(sortedRows.length / ROWS_PER_PAGE) || 1

  for (let pDate = 0; pDate < nbDatePages; pDate++) {
    const startDate = pDate * COLS_PER_PAGE
    const endDate = Math.min(startDate + COLS_PER_PAGE, allDates.length)
    const pageDates = allDates.slice(startDate, endDate)

    // Titre de la section de dates
    const dateRange = nbDatePages > 1
      ? ` (${formatDateShort(pageDates[0])} au ${formatDateShort(pageDates[pageDates.length - 1])})`
      : ''

    for (let pPlayer = 0; pPlayer < nbPlayerPages; pPlayer++) {
      const startRow = pPlayer * ROWS_PER_PAGE
      const endRow = Math.min(startRow + ROWS_PER_PAGE, sortedRows.length)
      const pageRows = sortedRows.slice(startRow, endRow)

      // -- SAUT DE PAGE --
      // On le met AVANT le contenu de la nouvelle page (sauf pour la toute première page absolue)
      if (pDate > 0 || pPlayer > 0) {
        const pageBreak = document.createElement('div')
        pageBreak.className = 'print-page-break'
        // Important : on s'assure qu'il prend de la place ou force le break
        pageBreak.style.height = '1px'
        container.appendChild(pageBreak)
      }

      // Titre explicite
      const title = document.createElement('h3')
      title.style.margin = '10px 0 5px 0'

      let titleText = `${type === 'classement' ? 'Classement Annuel' : 'Classement Cognin'}`
      // Ajout info pagination si nécessaire
      if (nbDatePages > 1 || nbPlayerPages > 1) {
        // Calcul page courante globale pour info
        const currentPage = (pDate * nbPlayerPages) + pPlayer + 1
        const totalPages = nbDatePages * nbPlayerPages
        titleText += ` - Page ${currentPage}/${totalPages}`
      }
      titleText += dateRange
      // Ajout info joueurs si découpage vertical
      if (nbPlayerPages > 1) {
        titleText += ` (Joueurs ${startRow + 1} à ${endRow})`
      }

      title.textContent = titleText
      container.appendChild(title)

      // Créer la table
      const table = document.createElement('table')
      table.className = 'print-split-table'

      // Header : On masque Total/Prime si ce n'est pas la première page de DATES (gauche)
      // MAIS on garde toujours le Rang et le Nom pour savoir qui est qui
      // Ordre : Rang, Nom, Score, Prime, Total
      const theadHtml = `<thead><tr>
          <th style="${rankColStyle}">#</th>
          <th class="col-nom" style="${nameColStyle}">Joueur</th>
          ${pDate === 0 && type === 'classement' ? '<th style="width:50px">Score<br>Tournoi</th>' : ''}
          ${pDate === 0 && type === 'classement' ? '<th style="width:50px">Prime</th>' : ''}
          ${pDate === 0 && type === 'classement' ? '<th style="width:50px">Gains</th>' : ''}
          ${pDate === 0 && type === 'cognin' ? '<th style="width:50px">Gains</th>' : ''}
          ${pDate === 0 ? '<th style="width:50px">Total<br>Général</th>' : ''}
          ${pageDates.map(d => {
             const [y, m, day] = d.split('-')
             const isJeudi = new Date(y, m - 1, day).getDay() === 4
             // Couleur bleue pour les jeudis UNIQUEMENT en mode Cognin
             const style = (type === 'cognin' && isJeudi) ? 'color:#2196F3' : ''
             return `<th style="width:55px; ${style}">${formatDateShort(d).replace(' ', '<br>')}</th>`
          }).join('')}
        </tr></thead>`
      table.innerHTML = theadHtml

      // Body
      let tbodyHtml = '<tbody>'
      pageRows.forEach((row, idx) => {
        const globalRank = startRow + idx + 1
        tbodyHtml += `<tr>
             <td>${globalRank}</td>
             <td class="col-nom">${row.nom}</td>
             ${pDate === 0 && type === 'classement' ? `<td>${row.score}</td>` : ''}
             ${pDate === 0 && type === 'classement' ? `<td>${row.prime || 0}</td>` : ''}
             ${pDate === 0 && type === 'classement' ? `<td>${row.gains ? row.gains + '\u20ac' : ''}</td>` : ''}
             ${pDate === 0 && type === 'cognin' ? `<td>${row.gains ? row.gains + '\u20ac' : ''}</td>` : ''}             ${pDate === 0 ? `<td><strong>${row.total}</strong></td>` : ''}
             ${pageDates.map(d => {
                 const [y, m, day] = d.split('-')
                 const isJeudi = new Date(y, m - 1, day).getDay() === 4
                 const cellStyle = (type === 'cognin' && isJeudi) ? 'style="color:#2196F3; font-weight:bold;"' : ''
                 const val = row.dates[d]
                 // Affiche '-' si pas de valeur (pour Cognin surtout) ou 0 pour affichage standard
                 const txt = (val !== undefined && val !== null) ? val : (type === 'cognin' ? '-' : 0)
                 return `<td ${cellStyle}>${txt}</td>`
             }).join('')}
           </tr>`
      })
      tbodyHtml += '</tbody>'
      table.insertAdjacentHTML('beforeend', tbodyHtml)

      container.appendChild(table)
    }
  }
}

if (btnExportPdfClassement) {
  btnExportPdfClassement.addEventListener('click', exportCurrentToPdf)
}
if (btnExportPdfCognin) {
  btnExportPdfCognin.addEventListener('click', exportCurrentToPdf)
}

async function supprimerDateClassement (dateASup) {
  const recap = await getRecap()
  const nouveauRecap = recap.filter((t) => t.date !== dateASup)
  await setRecap(nouveauRecap)

  // rebuild classement from updated recap, but keep any existing players
  try {
    const ancienClassement = await getClassement()
    const nouveauClassement = buildClassementFromRecap(nouveauRecap, ancienClassement)
    await setClassement(nouveauClassement)
  } catch (e) {
    console.warn('supprimerDateClassement rebuild failed', e)
  }

  await renderRecap()
  await renderClassement()
  await renderCognin()
}

// ------------------ Récap ------------------

async function exportRecapTournoiPDF (date) {
  const recap = await getRecap()
  const tour = recap.find((t) => t.date === date)
  if (!tour) return

  const scores = tour.scores || []
  let rows = scores
    .filter((r) => Array.isArray(r) && r.length >= 2)
    .map((r) => {
      const vals = r.slice(1).map(Number)
      const gameScore = vals[vals.length - 1] || 0
      const manches = vals.slice(0, vals.length - 1)
      return {
        name: r[0],
        manches,
        gameScore
      }
    })

  // Tri par Total (gameScore + prime) desc
  rows.sort((a, b) => (b.gameScore + 50) - (a.gameScore + 50))

  const nbJoueurs = rows.length

  // Calcul Pts Cognin
  const [yy, mm, dd2] = date.split('-')
  const isJeudi = new Date(Number(yy), Number(mm) - 1, Number(dd2)).getDay() === 4

  // Calcul gains redistribution
  let recapPlaces = []
  try {
    recapPlaces = await computeRedistribPlacesFor(date, nbJoueurs)
  } catch (_e) { recapPlaces = [] }

  rows = rows.map((r, i) => {
    const prime = 50
    const total = r.gameScore + prime
    const ptsCognin = isJeudi ? 1 : nbJoueurs - i
    let gain = ''
    if (recapPlaces && recapPlaces[i] !== undefined && recapPlaces[i] > 0) {
      gain = recapPlaces[i] + '\u20ac'
    }
    // Check lucky/rewards
    if (tour.rewards && Array.isArray(tour.rewards)) {
      for (const rw of tour.rewards) {
        if (rw && rw.name === r.name) {
          const luckyAmount = Number(rw.amount || 0)
          if (luckyAmount > 0) gain = gain ? gain + ' + ' + luckyAmount + '\u20ac' : luckyAmount + '\u20ac'
        }
      }
    }
    return { ...r, prime, total, ptsCognin, gain }
  })

  const maxLen = rows.reduce((acc, r) => Math.max(acc, r.manches.length), 0)
  const mancheHeaders = Array.from({ length: maxLen }, (_, i) => `M${i + 1}`)

  const thead = `
      <thead>
        <tr>
           <th class="col-rang">Rang</th>
           <th class="col-joueur">Joueur</th>
           <th class="col-manche">Score Tournoi</th>
           <th class="col-prime">Prime</th>
           <th class="col-prime" style="color:#2196F3">Pts Cognin</th>
           <th class="col-total" style="color:#ffb300">Total</th>
           <th class="col-gain">Gain</th>
           ${mancheHeaders
             .map((h) => `<th class="col-manche">${h}</th>`)
             .join('')}
        </tr>
      </thead>
    `

  const tbody = `
      <tbody>
        ${rows
          .map(
            (r, i) => `
            <tr>
                <td class="col-rang">${i + 1}</td>
                <td class="col-joueur">${r.name}</td>
                <td class="col-manche"><strong>${r.gameScore}</strong></td>
                <td class="col-prime">${r.prime}</td>
                <td class="col-prime" style="color:#2196F3; font-weight:bold;">${r.ptsCognin}</td>
                <td class="col-total" style="color:#ffb300;"><strong>${r.total}</strong></td>
                <td class="col-gain">${r.gain}</td>
                ${Array.from(
                  { length: maxLen },
                  (_, idx) =>
                    `<td class="col-manche">${
                      r.manches[idx] !== undefined ? r.manches[idx] : ''
                    }</td>`
                ).join('')}
            </tr>
        `
          )
          .join('')}
      </tbody>
    `

  const container = document.getElementById('print-container')
  container.innerHTML = `
        <h2>Tournoi du ${formatDateFr(date)}</h2>
        <table class="table-recap-pdf">
            ${thead}
            ${tbody}
        </table>
    `

  if (window.electronAPI && window.electronAPI.exportPDF) {
    try {
      const res = await window.electronAPI.exportPDF({
        landscape: true,
        title: `Recap_${date}`
      })
      if (res) showConfirmation()
    } catch (e) {
      console.error(e)
      showAlert('Erreur export PDF')
    }
  } else {
    const [y, m, dd] = date.split('-')
    const dateFr = `${dd}-${m}-${y}`
    triggerPrint(() => { container.innerHTML = '' }, `Tournoi du ${dateFr}.pdf`)
  }
}

const recapSortState = { col: 'date', order: 'asc' }

async function renderRecap () {
  const recapRaw = await getRecap()

  // Tri
  const recap = [...recapRaw].sort((a, b) => {
    const valA = a.date
    const valB = b.date
    if (valA < valB) return recapSortState.order === 'asc' ? -1 : 1
    if (valA > valB) return recapSortState.order === 'asc' ? 1 : -1
    return 0
  })

  const tableRecap = document.getElementById('table-recap')
  const thead = tableRecap.querySelector('thead')

  const getSortMark = (c) => (recapSortState.col === c ? (recapSortState.order === 'asc' ? ' ▲' : ' ▼') : '')

  // Render Header
  thead.innerHTML = `
    <tr>
      <th class="sort-header" data-sort="date" style="cursor:pointer">Date${getSortMark('date')}</th>
      <th>Action</th>
    </tr>
  `

  // Attach Listener Header
  thead.querySelectorAll('.sort-header').forEach(th => {
    th.addEventListener('click', () => {
      if (recapSortState.col === th.dataset.sort) {
        recapSortState.order = recapSortState.order === 'asc' ? 'desc' : 'asc'
      } else {
        recapSortState.col = th.dataset.sort
        recapSortState.order = 'desc'
      }
      renderRecap()
    })
  })

  tbodyRecap.innerHTML = recap
    .map(
      (t) => `<tr>
      <td>
        <div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
          ${formatDateFr(t.date)}
          <button type="button" data-date="${t.date}" class="btn-trash btn-del-recap" title="Supprimer">🗑︎</button>
        </div>
      </td>
      <td>
        <button data-date="${t.date}" class="btn-secondary btn-show-recap" title="Détails">Afficher</button>
        <button data-date="${t.date}" class="btn-secondary btn-export-recap-pdf" title="Export PDF">Export PDF</button>
      </td>
    </tr>`
    )
    .join('')

  const closeAllRecaps = () => {
    tbodyRecap.querySelectorAll('.recap-detail-row').forEach(row => row.remove())
  }

  // Handler STANDARD (avec Prime)
  tbodyRecap.querySelectorAll('.btn-show-recap').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const tr = btn.closest('tr')
      const nextTr = tr.nextElementSibling

      // Gestion bascule affichage
      if (nextTr && nextTr.classList.contains('recap-detail-row')) {
        if (nextTr.dataset.viewType === 'standard') {
          nextTr.remove() // Déjà ouvert => On ferme simple
          return
        }
        nextTr.remove()
      }

      closeAllRecaps()

      const date = btn.dataset.date
      const recapData = await getRecap()
      const tour = recapData.find((t) => t.date === date)
      if (!tour) return

      const scores = tour.scores || []
      // Préparation données
      let rowsData = scores.map((row) => {
        const nom = row[0]
        const vals = row.slice(1).map(Number)
        const scoreJeu = vals.length ? vals[vals.length - 1] : 0
        const manches = vals.slice(0, vals.length - 1)
        const prime = 50
        const totalGeneral = scoreJeu + prime
        // Reporter la prime de redistribution si présente dans l'objet tour
        // Redistribution/gain removed — no gain values available
        const gainNumeric = ''
        const gain = ''
        return { nom, scoreJeu, manches, prime, totalGeneral, gain, gainNumeric }
      })

      // Tri par défaut (totalGeneral desc) pour calculer le rang
      rowsData.sort((a, b) => b.totalGeneral - a.totalGeneral)

      // Calcul Pts Cognin
      const [y, m, d] = date.split('-')
      const isJeudi = new Date(Number(y), Number(m) - 1, Number(d)).getDay() === 4
      const nbJoueurs = rowsData.length

      // Compute redistribution places for this tournament date (display-only)
      let recapPlaces = []
      try {
        recapPlaces = await computeRedistribPlacesFor(date, nbJoueurs)
      } catch (_e) { recapPlaces = [] }

      rowsData = rowsData.map((r, i) => {
        let ptsCognin
        if (isJeudi) {
          ptsCognin = 1
        } else {
          ptsCognin = nbJoueurs - i
        }
        return { ...r, rangInitial: i + 1, ptsCognin }
      })

      const maxLen = rowsData.reduce((m, r) => Math.max(m, r.manches.length), 0)
      const nbManches = maxLen // maxLen correspond au nb de manches car row.slice(0, length-1)

      // State tri local
      const localSort = { col: 'total', order: 'desc' }

      const detailRow = document.createElement('tr')
      detailRow.className = 'recap-detail-row'
      detailRow.dataset.viewType = 'standard'
      detailRow.innerHTML = `
        <td colspan="2" style="padding: 10px;">
            <h4 style="margin-top:0">Tournoi du ${formatDateFr(date)} (Standard)</h4>

            <div id="container-recap-std-${date.replace(/-/g, '')}"></div>
        </td>
      `
      tr.insertAdjacentElement('afterend', detailRow)

      const renderInner = () => {
        const sorted = [...rowsData].sort((a, b) => {
          let valA, valB
          if (localSort.col === 'rang') { valA = a.rangInitial; valB = b.rangInitial } else if (localSort.col === 'nom') { valA = a.nom; valB = b.nom } else if (localSort.col === 'score') { valA = a.scoreJeu; valB = b.scoreJeu } else if (localSort.col === 'prime') { valA = a.prime; valB = b.prime } else if (localSort.col === 'ptsCognin') { valA = a.ptsCognin; valB = b.ptsCognin } else if (localSort.col === 'total') { valA = a.totalGeneral; valB = b.totalGeneral } else if (localSort.col.startsWith('M')) {
            const idx = parseInt(localSort.col.substring(1)) - 1
            valA = a.manches[idx] !== undefined ? a.manches[idx] : -999999
            valB = b.manches[idx] !== undefined ? b.manches[idx] : -999999
          }

          if (localSort.col === 'nom') {
            return localSort.order === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA)
          }
          if (valA < valB) return localSort.order === 'asc' ? -1 : 1
          if (valA > valB) return localSort.order === 'asc' ? 1 : -1
          return 0
        })

        const getMark = (c) => (localSort.col === c ? (localSort.order === 'asc' ? ' ▲' : ' ▼') : '')
        const mancheHeaders = Array.from({ length: nbManches }, (_, i) => `M${i + 1}`)

        const html = `
            <table class="table-recap-tournoi" style="font-size: 0.9em;">
                <thead>
                  <tr>
                     <th class="col-rang sort-header-std" data-sort="rang" style="cursor:pointer">Rang${getMark('rang')}</th>
                     <th class="col-joueur sort-header-std" data-sort="nom" style="cursor:pointer">Joueur${getMark('nom')}</th>
                     <th class="col-manche sort-header-std" data-sort="score" style="cursor:pointer">Score<br>Tournoi${getMark('score')}</th>
                     <th class="col-prime sort-header-std" data-sort="prime" style="cursor:pointer">Prime${getMark('prime')}</th>
                     <th class="col-prime sort-header-std" data-sort="ptsCognin" style="cursor:pointer; color:#2196F3;">Pts<br>Cognin${getMark('ptsCognin')}</th>
                     <th class="col-total sort-header-std" data-sort="total" style="cursor:pointer; color:#ffb300;">Total${getMark('total')}</th>
                     <th class="col-gain sort-header-std" data-sort="gain" style="cursor:pointer">Gain</th>
                     ${mancheHeaders.map((h) => `<th class="col-manche sort-header-std" data-sort="${h}" style="cursor:pointer">${h}${getMark(h)}</th>`).join('')}

                  </tr>
                </thead>
                <tbody>
                  ${sorted.map(row => `
                     <tr>
                        <td class="col-rang">${row.rangInitial}</td>
                        <td class="col-joueur">${row.nom}</td>
                        <td class="col-manche"><strong>${row.scoreJeu}</strong></td>
                        <td class="col-prime">${row.prime}</td>
                        <td class="col-prime" style="color:#2196F3; font-weight:bold;">${row.ptsCognin}</td>
                        <td class="col-total" style="color:#ffb300;"><strong>${row.totalGeneral}</strong></td>
                        <td class="col-gain">${(() => {
                    const val = (recapPlaces && recapPlaces[row.rangInitial - 1] !== undefined) ? recapPlaces[row.rangInitial - 1] : ''
                    // Normalize name for robust comparisons
                    const normName = normalizeNom(row.nom)

                    // 1) check persisted rewards for this tour (sum any 'lucky' amounts for this player)
                    let persistedLuckyAmount = 0
                    if (tour.rewards && Array.isArray(tour.rewards)) {
                      for (const r of tour.rewards) {
                        if (!r || !r.name) continue
                        if (String(r.type || '').toLowerCase() === 'lucky' && normalizeNom(r.name) === normName) {
                          persistedLuckyAmount += Number(r.amount || 0)
                        }
                      }
                    }

                    // 2) fallback to in-memory state
                    const luckyInMem = (luckyWinnerByDate[date] && normalizeNom(luckyWinnerByDate[date]) === normName)
                    const rewardedInMem = (rewardedPlayersByDate[date] || new Set())
                    const rewardedInMemHas = Array.from(rewardedInMem).some(n => normalizeNom(n) === normName)

                    if (persistedLuckyAmount > 0) return `<span class="gain-lucky">${persistedLuckyAmount}€</span>`
                    if (luckyInMem) return `<span class="gain-lucky">2.5€</span>`
                    if (rewardedInMemHas) return `<span class="gain-rewarded">2.5€</span>`
                    return val ? `<span class="gain-regular">${val}€</span>` : ''
                  })()}</td>
                        ${Array.from({ length: nbManches }, (_, i) => `<td class="col-manche">${row.manches[i] !== undefined ? row.manches[i] : ''}</td>`).join('')}

                     </tr>
                  `).join('')}
                </tbody>
            </table>
          `

        const container = detailRow.querySelector('div')
        if (container) {
          container.innerHTML = html
          container.querySelectorAll('.sort-header-std').forEach(th => {
            th.addEventListener('click', (ev) => {
              ev.stopPropagation()
              const col = th.dataset.sort
              if (localSort.col === col) {
                localSort.order = localSort.order === 'asc' ? 'desc' : 'asc'
              } else {
                localSort.col = col
                localSort.order = 'desc'
                if (col === 'rang' || col === 'nom') localSort.order = 'asc'
              }
              renderInner()
            })
          })
        }
      }

      renderInner()
    })
  })

  // Handler EXPORT PDF
  tbodyRecap.querySelectorAll('.btn-export-recap-pdf').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      await exportRecapTournoiPDF(btn.dataset.date)
    })
  })

  tbodyRecap.querySelectorAll('.btn-del-recap').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const date = btn.dataset.date
      if (!await askConfirm(`Supprimer le tournoi du ${formatDateFr(date)} ?`)) return
      const recap = await getRecap()
      const filtered = recap.filter((t) => t.date !== date)
      await setRecap(filtered)
      await renderRecap()
      await renderClassement()
      await renderCognin()
    })
  })

  // Global listener to close on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.recap-detail-row') &&
          !e.target.closest('.btn-show-recap') &&
          !e.target.closest('.btn-show-cognin')) {
      closeAllRecaps()
    }
  })
}

const cogninSortState = { col: 'total', order: 'desc' }

async function renderCognin () {
  const recap = await getRecap()
  recap.sort((a, b) => a.date.localeCompare(b.date))

  const allDates = recap.map(t => t.date)
  const stats = new Map()

  // 1. Calcul des points pour chaque tournoi
  recap.forEach(tournoi => {
    const { date, scores } = tournoi
    const validScores = scores.filter(row => Array.isArray(row) && row.length >= 2)
    const roundScores = validScores.map(row => {
      const name = row[0]
      const val = row[row.length - 1]
      return { name, score: Number(val) || 0 }
    })
    // Tri du tournoi spécifique pour attribuer les points (1er = nbJoueurs points, dernier = 1 point)
    roundScores.sort((a, b) => b.score - a.score)
    const nbJoueurs = roundScores.length

    // Détection Jeudi (Date format YYYY-MM-DD)
    const [y, m, d] = date.split('-').map(Number)
    const dateObj = new Date(y, m - 1, d)
    const isJeudi = dateObj.getDay() === 4

    roundScores.forEach((p, index) => {
      let points

      if (isJeudi) {
        // Règle Jeudi Cognin : 1 point fixe
        points = 1
      } else {
        // Règle standard Cognin refondue : Seules les primes (classement) comptent
        // Points = Nombre de joueurs - Rang (0-indexed)
        points = nbJoueurs - index
      }

      if (!stats.has(p.name)) {
        stats.set(p.name, { total: 0, byDate: {} })
      }
      const s = stats.get(p.name)

      s.byDate[date] = points
      s.total += points
    })
  })

  // 2. Build gains map (same logic as renderClassement)
  const gainsMap = new Map()
  try {
    const defaultsData = await fetchRedistribDefaults()
    for (const t of recap) {
      try {
        const scoresT = (t.scores || []).filter(r => !String(r[0] || '').toUpperCase().startsWith('MORT'))
        const nbPlayersT = scoresT.length
        if (nbPlayersT === 0) continue
        const placesT = getPlacesFromDefaults(defaultsData, t.date, nbPlayersT)
        if (!placesT || placesT.length === 0) continue
        const ranked = scoresT.map(r => ({ nom: r[0], total: Number(r[r.length - 1]) || 0 }))
        ranked.sort((a, b) => b.total - a.total)
        ranked.forEach((p, idx) => {
          const val = Number(placesT[idx] || 0)
          if (val) gainsMap.set(p.nom, (gainsMap.get(p.nom) || 0) + val)
        })
        if (t && Array.isArray(t.rewards)) {
          const names = new Set()
          t.rewards.forEach(r => { if (r && r.name) names.add(r.name) })
          names.forEach(name => { if (name) gainsMap.set(name, (gainsMap.get(name) || 0) + 2.5) })
        }
      } catch (_e) { /* ignore */ }
    }
  } catch (_e) { /* ignore */ }

  // 2b. Transformation en tableau
  let resultRows = Array.from(stats.entries())
    .filter(([nom]) => !nom.toUpperCase().includes('MORT'))
    .map(([nom, data]) => ({
      nom,
      total: data.total,
      gains: gainsMap.get(nom) || 0,
      byDate: data.byDate
    }))

  // 3. Calcul du Rang (basé sur Total DESC)
  resultRows.sort((a, b) => b.total - a.total)
  resultRows = resultRows.map((row, i) => ({ ...row, rang: i + 1 }))

  // 4. Tri pour l'affichage (selon cogninSortState)
  resultRows.sort((a, b) => {
    let valA, valB
    const col = cogninSortState.col

    if (col === 'rang') {
      valA = a.rang
      valB = b.rang
    } else if (col === 'nom') {
      valA = a.nom
      valB = b.nom
    } else if (col === 'gains') {
      valA = a.gains || 0
      valB = b.gains || 0
    } else if (col === 'total') {
      valA = a.total
      valB = b.total
    } else {
      // Date
      valA = a.byDate[col] || 0
      valB = b.byDate[col] || 0
    }

    if (col === 'nom') {
      return cogninSortState.order === 'asc'
        ? valA.localeCompare(valB)
        : valB.localeCompare(valA)
    }

    if (valA < valB) return cogninSortState.order === 'asc' ? -1 : 1
    if (valA > valB) return cogninSortState.order === 'asc' ? 1 : -1
    return 0
  })

  const getSortMark = (c) => (cogninSortState.col === c ? (cogninSortState.order === 'asc' ? ' ▲' : ' ▼') : '')

  const theadFixe = tableCogninFixe.querySelector('thead')
  const tbodyFixe = tableCogninFixe.querySelector('tbody')
  const theadDates = tableCogninDates.querySelector('thead')
  const tbodyDates = tableCogninDates.querySelector('tbody')

  // 5. Render Headers (Fixe)
  theadFixe.innerHTML = `
    <tr>
        <th class="sort-header" data-sort="rang" style="cursor:pointer">Rang${getSortMark('rang')}</th>
        <th class="sort-header" data-sort="nom" style="cursor:pointer">Joueur${getSortMark('nom')}</th>
        <th class="sort-header" data-sort="gains" style="cursor:pointer">Gains${getSortMark('gains')}</th>
        <th class="sort-header" data-sort="total" style="cursor:pointer; color:#4caf50;">Total${getSortMark('total')}</th>
    </tr>
  `

  // 6. Render Headers (Dates)
  theadDates.innerHTML = `<tr>${allDates.map(d => {
      // Détection Jeudi pour couleur
      const [y, m, day] = d.split('-')
      const dateObj = new Date(Number(y), Number(m) - 1, Number(day))
      const isJeudi = dateObj.getDay() === 4
      const colorStyle = isJeudi ? 'color: #2196F3;' : '' // Bleu pour les jeudis

      return `<th>
        <div class="header-date-cell">
         <span class="sort-header" data-sort="${d}" style="${colorStyle} cursor:pointer">${formatDateShort(d).replace(' ', '<br>')}${getSortMark(d)}</span>
         <button class="btn-trash btn-del-date" data-date="${d}" title="Supprimer cette date">🗑︎</button>
        </div>
       </th>`
  }).join('')}</tr>`

  // Listener suppression date (ajouté pour Cognin aussi)
  theadDates.querySelectorAll('.btn-del-date').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      // prevent sorting trigger
      e.stopPropagation()
      const date = e.target.dataset.date
      if (!await askConfirm(`Supprimer toute la date ${date} ?`)) return

      const recap = await getRecap()
      const filtered = recap.filter((t) => t.date !== date)
      await setRecap(filtered)

      // Update UI
      // We could reload everything, but at least these:
      await renderClassement()
      await renderCognin()
    })
  })

  // 7. Render Body (Fixe)
  tbodyFixe.innerHTML = resultRows.map((row) => `
    <tr>
        <td><strong>${row.rang}</strong></td>
        <td>${row.nom}</td>
        <td>${row.gains ? row.gains + '€' : ''}</td>
        <td style="color:#4caf50;"><strong>${row.total}</strong></td>
    </tr>
  `).join('')

  // 8. Render Body (Dates)
  tbodyDates.innerHTML = resultRows.map(row => `
    <tr>
        ${allDates.map(d => {
            const [y, m, day] = d.split('-')
            const dateObj = new Date(Number(y), Number(m) - 1, Number(day))
            const isJeudi = dateObj.getDay() === 4
            const tdStyle = isJeudi ? 'style="color: #2196F3; font-weight:bold;"' : ''

            const pts = row.byDate[d]
            return `<td ${tdStyle}>${pts !== undefined ? pts : '-'}</td>`
        }).join('')}
    </tr>
  `).join('')

  // 9. Attach Listeners
  const allSortHeaders = [
    ...tableCogninFixe.querySelectorAll('.sort-header'),
    ...tableCogninDates.querySelectorAll('.sort-header')
  ]

  allSortHeaders.forEach(el => {
    el.addEventListener('click', () => {
      const col = el.dataset.sort
      if (cogninSortState.col === col) {
        cogninSortState.order = cogninSortState.order === 'asc' ? 'desc' : 'asc'
      } else {
        cogninSortState.col = col
        cogninSortState.order = 'desc'
        if (col === 'rang' || col === 'nom') cogninSortState.order = 'asc'
      }
      renderCognin()
    })
  })
}

// Helper: collect manual scores from DOM when in manual mode (<12 joueurs)
function collectManualScoresFromDOM () {
  try {
    const rows = Array.from(document.querySelectorAll('#tbody-soiree tr'))
    const result = []
    rows.forEach((tr) => {
      const nom = decodeURIComponent(tr.dataset?.nom || '') || tr.querySelector('.col-joueur')?.textContent?.trim()
      if (!nom) return
      const inputs = tr.querySelectorAll('.manual-manche-input')
      const vals = Array.from(inputs).map(inp => (inp.value !== '' ? Number(inp.value) : ''))
      const any = vals.some(v => v !== '')
      if (!any) return // don't include rows with no entries
      const total = vals.reduce((s, v) => s + (v === '' ? 0 : Number(v)), 0)
      const row = [nom, ...vals]
      row.push(total)
      result.push(row)
    })
    return result
  } catch (e) {
    console.warn('collectManualScoresFromDOM failed', e)
    return []
  }
}

// Update ranks for manual mode: sort rows and assign ranks (competition ranking for ties)
function updateManualRanks () {
  try {
    const rows = Array.from(tbodySoiree.querySelectorAll('tr'))

    // Preserve focus position to restore after reordering
    const active = document.activeElement
    let activeNom = null
    let activeManche = null
    if (active && active.classList && active.classList.contains('manual-manche-input')) {
      activeNom = decodeURIComponent(active.dataset.nom)
      activeManche = Number(active.dataset.manche)
    }

    const items = rows.map((r, i) => {
      const nom = decodeURIComponent(r.dataset?.nom || '') || r.querySelector('.col-joueur')?.textContent?.trim()
      const totalCell = r.querySelector('.col-total')
      const totalText = totalCell ? totalCell.textContent : ''
      const hasAny = totalText !== ''
      const total = hasAny ? Number(totalText) : null
      return { r, nom, total, hasAny, origIndex: i }
    })

    // Sort: hasAny first, then by total desc, then original order
    items.sort((a, b) => {
      if (a.hasAny && !b.hasAny) return -1
      if (!a.hasAny && b.hasAny) return 1
      if (a.hasAny && b.hasAny) return b.total - a.total
      return a.origIndex - b.origIndex
    })

    // Reattach DOM nodes in the new order
    items.forEach((it) => tbodySoiree.appendChild(it.r))

    // After reordering rows, ensure ranks show positional numbers (1..N from top to bottom)
    try { applyPositionalRanks() } catch (e) { console.warn('applyPositionalRanks on reorder failed', e) }

    // Restore focus on same logical input if possible
    if (activeNom !== null) {
      const selector = `.manual-manche-input[data-nom="${encodeURIComponent(activeNom)}"][data-manche="${activeManche}"]`
      const el = tbodySoiree.querySelector(selector)
      if (el) { el.focus(); try { el.select() } catch (_e) {} }
    }
  } catch (e) {
    console.warn('updateManualRanks failed', e)
  }
}

// No-op: ranks are static and based on original list order. Keep function for backward compatibility.
function updateManualRankValues () {
  /* intentionally empty */
}
// Expose for backward/interop usage
try { window.updateManualRankValues = updateManualRankValues } catch (_e) {}

// Apply positional ranks (1..N from top to bottom) to the current table rows
// NOTE: do NOT overwrite the fixed `Rang` column — keep the displayed `Rang` value as the seat/original rank.
// We still store the positional index on the row's dataset for other logic that may need it.
function applyPositionalRanks () {
  try {
    const rows = Array.from(tbodySoiree.querySelectorAll('tr'))

    // Read manualPlaces from tbody dataset if present (seat-based gains)
    let manualPlaces = []
    try { manualPlaces = JSON.parse(tbodySoiree.dataset.manualPlaces || '[]') } catch (_e) { manualPlaces = [] }

    // Determine date for lucky/rewarded checks
    const dateIso = (inputDateTournoi && inputDateTournoi.value) ? inputDateTournoi.value : getTodayIso()
    const luckyForDate = (typeof luckyWinnerByDate !== 'undefined') ? luckyWinnerByDate[dateIso] : null
    const rewardedSet = (typeof rewardedPlayersByDate !== 'undefined') ? (rewardedPlayersByDate[dateIso] || new Set()) : new Set()

    rows.forEach((r, i) => {
      const pos = i + 1
      // visible Rang MUST reflect the seat (position in the table) — static for the tournament
      const rankCell = r.querySelector('.col-rang')
      if (rankCell) rankCell.textContent = String(pos)

      // Store positional index for other logic
      r.dataset.position = String(pos)

      // Update Gain cell so it remains tied to the seat, not to the player that currently sits there
      const gainCell = r.querySelector('.col-gain')
      if (gainCell) {
        // base gain comes from manualPlaces by seat
        const base = (Array.isArray(manualPlaces) && manualPlaces[pos - 1] !== undefined) ? manualPlaces[pos - 1] : ''
        // however, if the current player in this seat is lucky/rewarded, show that visually (player-specific)
        const playerName = r.querySelector('.col-joueur') ? r.querySelector('.col-joueur').textContent.trim() : ''
        let gainHtml = ''
        if (luckyForDate && String(playerName) === String(luckyForDate)) {
          gainHtml = `<span class="gain-lucky">2.5€</span>`
        } else if (rewardedSet && rewardedSet.has && rewardedSet.has(playerName)) {
          gainHtml = `<span class="gain-rewarded">2.5€</span>`
        } else if (base !== '') {
          gainHtml = `<span class="gain-regular">${base}€</span>`
        }
        gainCell.innerHTML = gainHtml
      }
    })
  } catch (e) {
    console.warn('applyPositionalRanks failed', e)
  }
}

// ------------------ Fin de tournoi -> classement annuel ------------------

btnFinTournoi.addEventListener('click', async () => {
  const date = inputDateTournoi.value
  if (!date) {
    showAlert('Choisis une date de tournoi.')
    return
  }
  let scoresSoiree = []

  if (isManualModeActive()) {
    // Collect manual scores directly from the DOM
    const collected = collectManualScoresFromDOM()
    if (!collected.length) {
      showAlert('Pas de scores de soirée à enregistrer.')
      return
    }
    try {
      await setScoresTournoi(collected)
    } catch (e) {
      console.warn('setScoresTournoi failed saving manual scores', e)
    }
    scoresSoiree = collected
  } else {
    scoresSoiree = await getScoresTournoi()
    if (!scoresSoiree.length) {
      showAlert('Pas de scores de soirée à enregistrer.')
      return
    }
  }
  try {
    // Avant d'enregistrer, calculer et afficher les redistributions pour les joueurs (hors MORT)
    const activeRows = scoresSoiree.filter(row => !String(row[0]).toUpperCase().includes('MORT'))
    const nbActifs = activeRows.length

    // Redistribution feature removed — no redistribution computation or application (JSON retained).

    // Continuer l'enregistrement habituel
    const recap = await getRecap()
    if (recap.some((t) => t.date === date)) {
      showAlert('Cette date est déjà saisie dans le recap !')
      return
    }
    // Inclure les redistributions appliquées pour cette date afin de les retrouver dans le recap
    // Also persist any in-memory 'lucky' or 'rewarded' entries for this date (trace only in recap)
    const newEntry = { date, scores: scoresSoiree }
    const rewardsSet = new Set()
    const luckyName = luckyWinnerByDate[date]
    if (luckyName) rewardsSet.add(luckyName)
    const rewardedSet = rewardedPlayersByDate[date]
    if (rewardedSet && rewardedSet.size) rewardedSet.forEach(n => rewardsSet.add(n))

    if (rewardsSet.size) {
      newEntry.rewards = Array.from(rewardsSet).map(n => ({ name: n, type: 'lucky', amount: 2.5 }))
    }

    // Keep history: do not remove previous 'lucky' rewards — append newEntry to recap
    recap.push(newEntry)
    await setRecap(recap)

    const dates = recap.map((t) => t.date).sort()

    // Use helper to build classement robustly (merge recap + ancienClassement)
    try {
        // rebuild using helper to ensure columns match and avoid stray errors
        const ancienClassement = await getClassement()
        const nouveauClassement = buildClassementFromRecap(recap, ancienClassement)
        await setClassement(nouveauClassement)
      } catch (err) {
        console.warn('Failed to rebuild classement from recap — fallback to persisted', err)
        const ancienClassement = await getClassement()
        await setClassement(ancienClassement)
      }
    await renderRecap()
    await renderClassement()
    await renderCognin()

    // Confirmation visuelle (Pouce levé)
    showConfirmation()

    // Ne pas effacer automatiquement la feuille de soirée : conserver les scores et l'affichage
    // Ré-appeler renderFeuilleSoiree pour s'assurer que la colonne 'Gain' est affichée avec les valeurs appliquées
    // Mark this date as just finished so Feuille will display gains immediately
    try { justFinishedTournamentDate = date } catch (_e) {}
    await renderFeuilleSoiree()
    // Clear temporary flag
    try { justFinishedTournamentDate = null } catch (_e) {}

    // Réinitialiser le mode de jeu au mode par défaut
    try { setMode('normal') } catch (_e) { /* ignore */ }

    // Unlock UI that could have been locked for manual mode (respect manual flag)
    try { maybeUnlockUIForNormalFlow() } catch (e) { console.warn('unlockManualModeUI failed', e) }

    // Nettoyage UI Plan
    rotationsResultDiv.innerHTML = ''
    if (planHeadingEl) planHeadingEl.textContent = 'Plan de table / Manches'
    dernierDictRotations = null
    selectRotation.innerHTML = ''

    // Nettoyage données persisantes
    saveTirage([])
  } catch (e) {
    showAlert(e.message)
  }
});

// ------------------ Init ------------------

(async function init () {
  try {
    await renderListeGenerale()
    await initJoueursTournoi()

    // Set initial nav active state
    try {
      document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'))
      const first = document.querySelector('nav button[data-screen="joueurs"]')
      if (first) first.classList.add('active')
    } catch (_e) { /* ignore */ }

    // Clear any stale persistent "today" override left in localStorage (avoids date stuck on e.g. "12")
    try {
      if (typeof window !== 'undefined' && !window.__TODAY_OVERRIDE__ && typeof localStorage !== 'undefined') {
        if (localStorage.getItem('tarot_today_override')) {
          localStorage.removeItem('tarot_today_override')
          try { console.info && console.info('Cleared persistent tarot_today_override at init') } catch (_e) {}
        }
      }
    } catch (_e) { /* ignore */ }

    // Initialize date field first so Feuille can use it immediately for gains
    setTodayForTournoi()
    await renderFeuilleSoiree()
    await renderRecap()
    await renderClassement()
    await renderCognin()

    // Sauvegarde finale à la fermeture (sécurise les changements non encore écrits)
    window.addEventListener('beforeunload', async () => {
      try { await saveListeTournoiNow() } catch (e) { console.error('Erreur save on beforeunload', e) }
    })

    // Recharger le tirage et le plan de table s'ils existent
    const tirageExistant = loadTirage()
    if (tirageExistant && tirageExistant.length > 0) {
      // On tente de recalculer les rotations.
      // Si l'utilisateur n'a pas touché "Nombre de parties", ça prendra 4 par défaut.
      const nbParties = Number(nbPartiesInput.value || 4)
      const nbPartiesToPlan = (getSerpentinEnabled() && nbParties > 1) ? nbParties - 1 : nbParties

      // Load full tirage if present (restoration from previous session)
      try {
        const raw = localStorage.getItem('tarot_full_tirage')
        if (raw) {
          dernierFullTirage = JSON.parse(raw)
        }
      } catch (e) {
        console.warn('Impossible de charger full tirage:', e)
      }

      const dict = calculRotationsRainbow(tirageExistant, nbPartiesToPlan)
      dernierDictRotations = dict

      // Restaurer les exclus si le fichier existe et ajuster leur longueur
      try {
        let exclusArr = await getExclusTournoi()
        if (!Array.isArray(exclusArr)) exclusArr = []
        if (exclusArr.length > 0) {
          if (exclusArr.length < nbParties) {
            for (let i = exclusArr.length; i < nbParties; i++) exclusArr[i] = null
            await setExclusTournoi(exclusArr)
          }
          // Mettre à jour affichage pour montrer qui est exclu par manche
          await updateRotationsDisplay()
        }
      } catch (eEx) {
        console.warn('Impossible de restaurer exclus au démarrage:', eEx.message || eEx)
      }

      mettreAJourSelectRotationsEtTables()

      if (planHeadingEl) {
        planHeadingEl.textContent =
          'Plan de table : ' + getTypeMouvementLabelFromTirage(tirageExistant)
      }

      rotationsResultDiv.innerHTML = Object.entries(dict)
        .map(([nomRot, tables], mancheIndex) => {
          const blocTables = tables
            .map((t) => {
              const [n, s, e, o, x, y] = t.joueurs
              let exemptHtml = ''
              if (x) {
                exemptHtml += `<div class="table-seat table-seat-exemption"><span>${x.nom || '?'}</span></div>`
              }
              if (y) {
                exemptHtml += `<div class="table-seat table-seat-exemption-2"><span>${y.nom || '?'}</span></div>`
              }
              return `
                <div class="table-card">
                  <div class="table-card-center-label">Table ${t.table}</div>
                  <div class="table-seat table-seat-north">
                    <span>${n?.nom || '?'}</span>
                  </div>
                  <div class="table-seat table-seat-south">
                    <span>${s?.nom || '?'}</span>
                  </div>
                  <div class="table-seat table-seat-east">
                    <span>${e?.nom || '?'}</span>
                  </div>
                  <div class="table-seat table-seat-west">
                    <span>${o?.nom || '?'}</span>
                  </div>
                  ${exemptHtml}
                </div>
              `
            })
            .join('')

          // If we restored a tirage at startup, unlock the UI if number of players >= 12
          try {
            maybeUnlockUIForNormalFlow()
          } catch (e) { console.warn('unlock on init failed', e) }

          return `
            <section class="rotation-block">
              <h3>Manche ${mancheIndex + 1}</h3>
              <div class="rotation-tables">
                ${blocTables}
              </div>
            </section>
          `
        })
        .join('')

      // On active l'onglet "Plan de table" si le tirage existe (optionnel, selon préférence utilisateur)
      // document.querySelector('button[data-screen="plan"]').click();
    }

    // Ensure Saisie is rendered by default at startup
    try { renderSaisie() }
    catch (e) { console.warn('renderSaisie on init failed', e) }
  } catch (e) {
    console.error('ERREUR dans init()', e)
  }
})()
