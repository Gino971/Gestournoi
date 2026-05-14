import { upsertTableInto, sanitizeTablesData } from './scores-par-utils.js'
import { placeAttackerAtIndex, validateAttackerDivisibility } from '../coreTournoi.js'

// Dynamic parties-per-manche accessor (set by app.js on window)
function _maxParties () {
  try { return (typeof window !== 'undefined' && window.getNbPartiesParManche) ? window.getNbPartiesParManche() : 5 } catch (_) { return 5 }
}

// Pure helper: compute totals from parties (null -> 0)
export function computeTotalsFromParties (parties, playersLen) {
  const totals = new Array(playersLen).fill(0)
  for (let p = 0; p < (parties || []).length; p++) {
    const sc = Array.isArray(parties[p] && parties[p].scores) ? parties[p].scores : new Array(playersLen).fill(null)
    for (let i = 0; i < playersLen; i++) totals[i] += Number(sc[i] || 0)
  }
  return totals
}

// Build a canonical table entry with the provided manche inserted
export function buildValidatedTableEntry (tableId, players, mancheIdx, rowScores) {
  const playersLen = (players || []).length || 0
  const nbParties = _maxParties()
  const parties = []
  for (let p = 0; p < nbParties; p++) parties.push({ partie: p + 1, scores: new Array(playersLen).fill(null) })
  parties[mancheIdx] = { partie: mancheIdx + 1, scores: rowScores.slice() }
  const totals = computeTotalsFromParties(parties, playersLen)
  return { table: tableId, players: players.slice(), parties, totals }
}

// Apply a validated manche to persisted tables (pure)
// - persistedTables: Array (may be mutated copy)
// - tableId, players: identity for the table
// - mancheIdx: index of manche validated
// - rowScores: array of numbers for the manche (length must equal players.length)
// Returns a new sanitized tables array (deep copy semantics)
export function applyValidatedManche (persistedTables, tableId, players, mancheIdx, rowScores) {
  if (!Array.isArray(rowScores) || !Array.isArray(players) || rowScores.length !== players.length) {
    throw new Error('Invalid inputs for applyValidatedManche')
  }

  const incoming = buildValidatedTableEntry(tableId, players, mancheIdx, rowScores)
  // Upsert replaces entire table entry for the tableId
  const afterUpsert = upsertTableInto(Array.isArray(persistedTables) ? persistedTables.map(x => ({ ...x, parties: (x.parties || []).map(p => ({ partie: p.partie, scores: Array.isArray(p.scores) ? p.scores.slice() : [] })) })) : [], incoming)

  // Clear the next manche for all tables (defensive, keeps behavior consistent)
  const curIdx = mancheIdx
  const nextIdx = curIdx + 1
  for (const t of afterUpsert) {
    while ((t.parties || []).length <= nextIdx) t.parties = (t.parties || []).concat([{ partie: (t.parties || []).length + 1, scores: new Array((t.players || []).length).fill(null) }])
    t.parties[nextIdx].scores = new Array((t.players || []).length).fill(null)
  }

  // Sanitize before returning
  return sanitizeTablesData(afterUpsert)
}

// Lightweight helper: if user provided a single attacker value, expand to full row
export function normalizeInputRow (inputs) {
  // inputs: array where some elements may be null; if exactly 1 non-null, expand it
  const nonEmpty = (inputs || []).filter(v => v !== null && v !== undefined && String(v) !== '')
  if (nonEmpty.length === 1) {
    const idx = inputs.findIndex(v => v !== null && v !== undefined && String(v) !== '')
    const val = Number(inputs[idx])
    return placeAttackerAtIndex(val, inputs.length, idx)
  }
  // Otherwise assume inputs already full row; convert strings to numbers and nulls
  return (inputs || []).map(v => (v === null || v === undefined || v === '') ? null : Number(v))
}

// Ensure inputs are valid (attacker divisibility when single non-null)
export function validateInputRow (inputs) {
  const playersLen = inputs.length
  const nonEmpty = inputs.map((v, i) => ({ idx: i, val: v })).filter(x => x.val !== null && x.val !== undefined && String(x.val) !== '')
  if (nonEmpty.length === 0) return { ok: false, reason: 'empty' }
  if (nonEmpty.length === 1) {
    const v = Number(nonEmpty[0].val)
    if (!validateAttackerDivisibility(v, playersLen)) return { ok: false, reason: 'not-divisible' }
    return { ok: true }
  }
  // multiple values -> accept if all numbers
  if (nonEmpty.every(x => !isNaN(Number(x.val)))) return { ok: true }
  return { ok: false, reason: 'invalid-number' }
}

// Clear next manche across persisted tables (pure)
export function clearNextManche (persistedTables, nextIdx) {
  const copy = Array.isArray(persistedTables) ? persistedTables.map(t => ({ table: t.table, players: Array.isArray(t.players) ? t.players.slice() : [], parties: Array.isArray(t.parties) ? t.parties.map(p => ({ partie: p.partie, scores: Array.isArray(p.scores) ? p.scores.slice() : [] })) : [], totals: Array.isArray(t.totals) ? t.totals.slice() : [] })) : []
  for (const t of copy) {
    const tableSize = (t.players || []).length || 0
    t.parties = t.parties || []
    while (t.parties.length <= nextIdx) t.parties.push({ partie: t.parties.length + 1, scores: new Array(tableSize).fill(null) })
    t.parties[nextIdx].scores = new Array(tableSize).fill(null)
  }
  return copy
}

// Utility: ensure stored table entries align with current rotation
export function mergeRotationWithStoredTables(rotationTables, storedTables) {
  // rotationTables: array of { table, joueurs: [{nom}, ...] }
  // storedTables: array of { table, players, parties, totals }
  const result = []
  rotationTables.forEach((td) => {
    const players = (td.joueurs || []).map(p => (p && p.nom) || '')
    const existing = Array.isArray(storedTables)
      ? storedTables.find(t => Number(t.table) === Number(td.table))
      : null
    if (existing) {
      const same = existing.players.length === players.length &&
        existing.players.every((n, i) => n === players[i])
      if (same) {
        result.push(existing)
        return
      }
      // mismatch -> drop the old entry and start fresh
    }
    // build blank entry
    const nbParties = _maxParties()
    const parties = []
    for (let p = 1; p <= nbParties; p++) parties.push({ partie: p, scores: new Array(players.length).fill(null) })
    const totals = new Array(players.length).fill(0)
    result.push({ table: td.table, players: players.slice(), parties, totals })
  })
  return result
}

// Apply `feuille` (per-table feuille: [[nom, scoreManche, cumulativeAfter], ...]) to the
// global `scoresSoiree`. Uses `transfertTotauxTable` when possible, otherwise
// falls back to a conservative manual merge so smaller tables (eg. 3-player)
// do not prevent the tournament scores from being updated.
import { transfertTotauxTable } from '../coreTournoi.js'
export function applyFeuilleToScoresSoiree (scoresSoiree, feuille, nbPartiesMax, targetIndex = -1) {
  const norm = (n) => (typeof n === 'string' ? n.trim() : n)

  try {
    // prefer canonical implementation (throws when feuille.length < 4)
    return transfertTotauxTable(scoresSoiree || [], feuille, nbPartiesMax, targetIndex)
  } catch (e) {
    // fallback: update per-player entries using the cumulative value (feuille[i][2])
    const map = new Map((scoresSoiree || []).map(r => [norm(r[0]), r.slice(1).map(Number)]))
    for (const row of (feuille || [])) {
      const nom = norm(row[0])
      if (!nom) continue
      // if previous scores exist and player not seen before, ignore this row
      if ((scoresSoiree && scoresSoiree.length > 0) && !map.has(nom)) {
        continue
      }
      const cumulative = Number(row[2] || 0)
      const existing = map.get(nom) || []
      let manches = existing.length > 0 ? existing.slice(0, -1) : []
      if (targetIndex !== -1) {
        while (manches.length < targetIndex) manches.push(0)
        manches[targetIndex] = cumulative
      } else {
        // append at the end
        manches.push(cumulative)
      }
      const total = manches.reduce((a, b) => a + Number(b || 0), 0)
      map.set(nom, [...manches, total])
    }
    const newScores = Array.from(map.entries()).map(([n, scores]) => [n, ...scores])

    // safeguard: avoid wiping non-zero data entirely
    try {
      const prevHad = (scoresSoiree || []).some(r => r.slice(1).some(v => Number(v) !== 0))
      const allZero = newScores.every(r => r.slice(1).every(v => Number(v) === 0))
      if (prevHad && allZero) {
        console.warn('applyFeuilleToScoresSoiree produced all-zero results, keeping previous', { scoresSoiree, feuille })
        return scoresSoiree || []
      }
    } catch (_e) { /* ignore */ }

    return newScores
  }
}
