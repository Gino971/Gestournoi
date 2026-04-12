// api.js
import { sanitizeTablesData } from './lib/scores-par-utils.js'

// ============================================================
// Helpers de persistence : 3 niveaux de fallback
//   1. Electron (electronAPI)  → pour l'app desktop
//   2. Backend FastAPI (/api/) → pour le mode réseau local
//   3. localStorage            → pour GitHub Pages / mode hors-ligne
// ============================================================

const LS_PREFIX = 'tarot_data_'

function lsRead (key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function lsWrite (key, data) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(data)) } catch { /* quota exceeded */ }
}

// Détection du backend : on teste une seule fois au démarrage
let _backendAvailable = null
async function isBackendAvailable () {
  if (_backendAvailable !== null) return _backendAvailable
  try {
    const r = await fetch('/api/ping', { method: 'GET', signal: AbortSignal.timeout(2000) })
    _backendAvailable = r.ok
  } catch {
    _backendAvailable = false
  }
  return _backendAvailable
}

// Helper générique : lire depuis le backend ou localStorage
async function apiRead (endpoint, extractKey) {
  if (await isBackendAvailable()) {
    const res = await fetch('/api/' + endpoint)
    const data = await res.json()
    const val = extractKey ? (data[extractKey] || []) : data
    // Miroir dans localStorage pour usage hors-ligne futur
    lsWrite(endpoint, val)
    return val
  }
  return lsRead(endpoint) || []
}

// Helper générique : écrire vers le backend ou localStorage
async function apiWrite (endpoint, bodyObj, data) {
  // Toujours écrire dans localStorage (cache local)
  lsWrite(endpoint, data)
  if (await isBackendAvailable()) {
    const res = await fetch('/api/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj)
    })
    return await res.json()
  }
  return { status: 'ok (local)' }
}

// --- Liste générale de joueurs ---

export async function loadListeJoueurs () {
  if (window.electronAPI) {
    return await window.electronAPI.readData('liste-joueurs')
  }
  const joueurs = await apiRead('liste-joueurs', 'joueurs')
  if (joueurs && joueurs.length > 0) return joueurs
  // Premier lancement sur tablette : charger la liste par défaut
  try {
    const res = await fetch('build/defaults/joueurs_club.json')
    if (res.ok) {
      const defaults = await res.json()
      lsWrite('liste-joueurs', defaults)
      return defaults
    }
  } catch { /* fichier absent, on continue avec une liste vide */ }
  return []
}

export async function saveListeJoueurs (joueurs) {
  if (window.electronAPI) {
    return await window.electronAPI.writeData('liste-joueurs', joueurs)
  }
  return await apiWrite('liste-joueurs', { joueurs }, joueurs)
}

// --- Joueurs du tournoi ---

export async function loadJoueursTournoi () {
  if (window.electronAPI) {
    return await window.electronAPI.readData('joueurs-tournoi')
  }
  return await apiRead('joueurs-tournoi', 'joueurs')
}

export async function saveJoueursTournoi (joueurs) {
  if (window.electronAPI) {
    return await window.electronAPI.writeData('joueurs-tournoi', joueurs)
  }
  return await apiWrite('joueurs-tournoi', { joueurs }, joueurs)
}

// --- Tirage (localStorage) ---
// Tirage utilise déjà localStorage, ce qui fonctionne très bien dans Electron sans rien changer.

const LS_KEYS = {
  tirage: 'tarot_tirage'
}

export function saveTirage (tirage) {
  localStorage.setItem(LS_KEYS.tirage, JSON.stringify(tirage))
}

export function loadTirage () {
  const raw = localStorage.getItem(LS_KEYS.tirage)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// --- scores_tournoi.csv ---

export async function getScoresTournoi () {
  // TEST HOOK: when tests declare a global override, return that value instead
  try {
    if (typeof window !== 'undefined' && window.__testScoresTournoi !== undefined) {
      return JSON.parse(JSON.stringify(window.__testScoresTournoi))
    }
  } catch (_e) { /* ignore */ }

  // return a deep copy to prevent callers from mutating internal cache
  let raw
  if (window.electronAPI) {
    raw = await window.electronAPI.readData('scores_tournoi')
  } else {
    raw = await apiRead('scores_tournoi', 'scores')
  }
  try {
    return Array.isArray(raw) ? JSON.parse(JSON.stringify(raw)) : []
  } catch (_e) {
    return Array.isArray(raw) ? raw.slice() : []
  }
}

export async function setScoresTournoi (scores) {
  const toStore = Array.isArray(scores) ? JSON.parse(JSON.stringify(scores)) : []

  // TEST HOOK: mirror value into global override if present
  try {
    if (typeof window !== 'undefined' && window.__testScoresTournoi !== undefined) {
      window.__testScoresTournoi = JSON.parse(JSON.stringify(toStore))
    }
  } catch (_e) { /* ignore */ }

  if (window.electronAPI) {
    return await window.electronAPI.writeData('scores_tournoi', toStore)
  }
  return await apiWrite('scores_tournoi', { scores: toStore }, toStore)
}

// New: per-table persisted scores (matrix per table)
export async function getScoresParTable () {
  // TEST HOOK: allow artificial delay to mimic slow persistence
  try {
    if (typeof window !== 'undefined' && window.__delayScoresParTable) {
      await new Promise(r => setTimeout(r, window.__delayScoresParTable))
    }
  } catch (_e) {}
  // TEST HOOK: if tests set a global override, respect it exactly (deep copy)
  try {
    if (typeof window !== 'undefined' && window.__testScoresParTable !== undefined) {
      return JSON.parse(JSON.stringify(window.__testScoresParTable))
    }
  } catch (_e) { /* ignore test hook errors */ }
  // Read raw from preferred source (electron IPC > local cache > http fallback)
  let raw = []
  if (window.electronAPI) {
    try {
      const ipcRes = await window.electronAPI.readData('scores_par_table')
      if (ipcRes !== null && typeof ipcRes !== 'undefined') raw = ipcRes
      else {
        const cached = localStorage.getItem('scores_par_table')
        raw = cached ? JSON.parse(cached) : []
      }
    } catch (_e) {
      const cached = localStorage.getItem('scores_par_table')
      raw = cached ? JSON.parse(cached) : []
    }
  } else {
    try {
      if (await isBackendAvailable()) {
        const res = await fetch('/api/scores_par_table')
        const data = await res.json()
        raw = data || []
      } else {
        const cached = localStorage.getItem('scores_par_table')
        raw = cached ? JSON.parse(cached) : []
      }
    } catch (_e) {
      const cached = localStorage.getItem('scores_par_table')
      raw = cached ? JSON.parse(cached) : []
    }
  }

  // Normalize and filter out corrupted entries (table must be a finite number)
  try {
    const normalized = sanitizeTablesData(Array.isArray(raw) ? raw : [])
    const cleaned = normalized.filter(e => Number.isFinite(Number(e.table)) && Array.isArray(e.players) && e.players.length > 0)
    try { localStorage.setItem('scores_par_table', JSON.stringify(cleaned)) } catch (_e) {}
    return cleaned
  } catch (e) {
    try { return Array.isArray(raw) ? raw : [] } catch (_e) { return [] }
  }
}

export async function setScoresParTable (data) {
  // artificial delay for testing slow storage
  try {
    if (typeof window !== 'undefined' && window.__delayScoresParTable) {
      await new Promise(r => setTimeout(r, window.__delayScoresParTable))
    }
  } catch (_e) {}
  // Sanitize incoming data and drop malformed entries (defensive)
  const raw = Array.isArray(data) ? data : []
  const normalized = sanitizeTablesData(raw)
  const filtered = normalized.filter(e => Number.isFinite(Number(e.table)) && Array.isArray(e.players) && e.players.length > 0)

  // Cache immediately for UI responsiveness
  try { localStorage.setItem('scores_par_table', JSON.stringify(filtered)) } catch (_e) {}

  // TEST HOOK: if tests are using the global override, keep it in sync so
  // autosave and subsequent `getScoresParTable` honour changes made via
  // `setScoresParTable`. this mirrors the behavior of the get hook above.
  try {
    if (typeof window !== 'undefined' && window.__testScoresParTable !== undefined) {
      window.__testScoresParTable = JSON.parse(JSON.stringify(filtered))
    }
  } catch (_e) { /* ignore */ }

  // Diagnostics: expose recent writes so DevTools can show what was persisted
  try {
    window.__scoresParTableWrites = window.__scoresParTableWrites || []
    window.__scoresParTableWrites.push({ ts: Date.now(), data: JSON.parse(JSON.stringify(filtered || [])) })
    window.__scoresParTableLastWrite = window.__scoresParTableWrites[window.__scoresParTableWrites.length - 1]
  } catch (_e) { /* ignore diagnostics errors */ }

  if (window.electronAPI) {
    return await window.electronAPI.writeData('scores_par_table', filtered)
  }

  if (await isBackendAvailable()) {
    const res = await fetch('/api/scores_par_table', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filtered)
    })
    return await res.json()
  }
  return { status: 'ok (local)' }
}

// --- Classement_annuel.csv ---

export async function getClassement () {
  if (window.electronAPI) {
    return await window.electronAPI.readData('classement')
  }
  return await apiRead('classement', 'classement')
}

export async function setClassement (classement) {
  if (window.electronAPI) {
    return await window.electronAPI.writeData('classement', classement)
  }
  return await apiWrite('classement', { classement }, classement)
}

// --- recap.json ---

export async function getRecap () {
  // Read raw recap
  let recap = []
  if (window.electronAPI) {
    recap = await window.electronAPI.readData('recap') || []
  } else {
    recap = await apiRead('recap', 'recap')
  }

  // Lightweight migration: convert legacy `lucky` field into `rewards` array entries
  try {
    let migrated = false
    recap = (recap || []).map((entry) => {
      if (!entry) return entry
      const e = { ...entry }
      // ensure rewards is an array when present
      if (e.lucky) {
        const rewards = Array.isArray(e.rewards) ? [...e.rewards] : []
        // add lucky into rewards if not already present
        if (!rewards.some(r => r && r.name === e.lucky && r.type === 'lucky')) {
          rewards.push({ name: e.lucky, type: 'lucky', amount: 2.5 })
          e.rewards = rewards
          migrated = true
        }
        delete e.lucky
      }
      return e
    })

    if (migrated) {
      // persist normalized recap back to storage so migration is one-off
      try { await setRecap(recap) } catch (_e) { /* ignore persistence errors */ }
    }
  } catch (e) {
    console.warn('recap migration failed', e)
  }

  return recap
}

// Redistributions removed from runtime — defaults JSON remains in build/defaults/redistributions.json (no API).

export async function setRecap (recap) {
  if (window.electronAPI) {
    return await window.electronAPI.writeData('recap', recap)
  }
  return await apiWrite('recap', { recap }, recap)
}

// --- exclus_tournoi.json ---

export async function getExclusTournoi () {
  if (window.electronAPI) {
    return await window.electronAPI.readData('exclus_tournoi')
  }
  return await apiRead('exclus_tournoi', 'exclus')
}

export async function setExclusTournoi (exclus) {
  if (window.electronAPI) {
    return await window.electronAPI.writeData('exclus_tournoi', exclus)
  }
  return await apiWrite('exclus_tournoi', { exclus }, exclus)
}
