// lib/scores-par-utils.js
// Pure helpers for sanitizing and merging `scores_par_table` data.

// Dynamic parties-per-manche accessor (set by app.js on window)
function _maxParties () {
  try { return (typeof window !== 'undefined' && window.getNbPartiesParManche) ? window.getNbPartiesParManche() : 5 } catch (_) { return 5 }
}

export function sanitizeTablesData (tablesData) {
  if (!Array.isArray(tablesData)) return []
  // Return a deep-copied, sanitized version where any "future" party
  // indexes (after the last non-empty party) are cleared to nulls.
  return tablesData.map((t) => {
    const table = { ...t }
    const playersLen = (table.players || []).length || 0
    const parties = Array.isArray(table.parties)
    ? table.parties.map(p => ({
        partie: p.partie,
        scores: Array.isArray(p.scores) ? p.scores.slice() : new Array(playersLen).fill(null),
        locked: !!p.locked
      }))
    : []

    // find lastSaved index
    let lastSaved = -1
    for (let p = 0; p < parties.length; p++) {
      const sc = Array.isArray(parties[p].scores) ? parties[p].scores : []
      if (sc.some(v => v !== null && typeof v !== 'undefined')) lastSaved = p
    }

    // clear any parties after lastSaved
    for (let p = lastSaved + 1; p < parties.length; p++) {
      parties[p].scores = new Array(playersLen).fill(null)
    }

    // ensure parties length is at least nbParties for UI compatibility (do not extend if absent)
    // but do not shorten existing parties.
    if (parties.length === 0 && playersLen > 0) {
      const nb = _maxParties()
      for (let p = 1; p <= nb; p++) parties.push({ partie: p, scores: new Array(playersLen).fill(null) })
    }

    const totals = Array.isArray(table.totals) ? table.totals.slice() : new Array(playersLen).fill(0)
    return { table: table.table, players: (table.players || []).slice(), parties, totals }
  })
}

export function upsertTableInto (tablesData, tableObj) {
  const copy = Array.isArray(tablesData) ? tablesData.map(x => ({ ...x })) : []
  const idx = copy.findIndex(x => Number(x.table) === Number(tableObj.table))
  if (idx >= 0) copy[idx] = tableObj
  else copy.push(tableObj)
  return copy
}

// Merge an incoming table into the persisted list but *respect* persisted's
// idea of which parties are "future" (i.e. indices after persisted's lastSaved).
// If persisted has cleared/empty parties beyond lastSaved, ignore any non-null
// values from the incoming table for those indices (prevents stale-local
// overwrites).
export function mergeTableRespectingPersisted (tablesData, incomingTable) {
  const copy = Array.isArray(tablesData) ? tablesData.map((x) => ({
    table: x.table,
    players: Array.isArray(x.players) ? x.players.slice() : [],
    parties: Array.isArray(x.parties) ? x.parties.map(p => ({ partie: p.partie, scores: Array.isArray(p.scores) ? p.scores.slice() : [] })) : [],
    totals: Array.isArray(x.totals) ? x.totals.slice() : []
  })) : []

  const idx = copy.findIndex(x => Number(x.table) === Number(incomingTable.table))
  if (idx === -1) {
    copy.push(incomingTable)
    return copy
  }

  const persisted = copy[idx]
  const playersLen = (persisted.players || []).length || (incomingTable.players || []).length || 0
  const partiesLen = Math.max((persisted.parties || []).length, (incomingTable.parties || []).length)

  // determine persisted lastSaved
  let persistedLastSaved = -1
  for (let p = 0; p < partiesLen; p++) {
    const ps = (persisted.parties && persisted.parties[p] && Array.isArray(persisted.parties[p].scores)) ? persisted.parties[p].scores : new Array(playersLen).fill(null)
    if (ps.some(v => v !== null && typeof v !== 'undefined')) persistedLastSaved = p
  }

  const mergedParties = []
  for (let p = 0; p < partiesLen; p++) {
    const pScores = (persisted.parties && persisted.parties[p] && Array.isArray(persisted.parties[p].scores)) ? persisted.parties[p].scores.slice() : new Array(playersLen).fill(null)
    const iScores = (incomingTable.parties && incomingTable.parties[p] && Array.isArray(incomingTable.parties[p].scores)) ? incomingTable.parties[p].scores.slice() : new Array(playersLen).fill(null)

    if (p > persistedLastSaved) {
      // Keep persisted for future indices (prevents resurrecting cleared values)
      mergedParties.push({ partie: p + 1, scores: pScores })
    } else {
      // For past/validated indices prefer incoming when present
      const hasIncoming = iScores.some(v => v !== null && typeof v !== 'undefined')
      mergedParties.push({ partie: p + 1, scores: hasIncoming ? iScores : pScores })
    }
  }

  const mergedEntry = { table: persisted.table, players: persisted.players.slice(), parties: mergedParties, totals: Array.isArray(persisted.totals) ? persisted.totals.slice() : new Array(playersLen).fill(0) }
  copy[idx] = mergedEntry
  return copy
}

// Clear all party scores and zero totals for every table entry (pure)
export function buildTablesFromRotation (rotationTables) {
  // rotationTables: array of { table: n, joueurs: [{ nom, numero, ... }, ...] }
  if (!Array.isArray(rotationTables)) return []
  return rotationTables.map((t) => {
    const players = Array.isArray(t.joueurs) ? t.joueurs.map(j => (j && j.nom) || '') : []
    const playersLen = players.length
    const nb = _maxParties()
    const parties = []
    for (let p = 1; p <= nb; p++) parties.push({ partie: p, scores: new Array(playersLen).fill(null) })
    const totals = new Array(playersLen).fill(0)
    return { table: t.table, players: players.slice(), parties, totals }
  })
}

export function clearAllTables (tablesData) {
  if (!Array.isArray(tablesData)) return []
  return tablesData.map((t) => {
    const playersLen = (t.players || []).length || 0
    const parties = (t.parties || []).map((p) => ({ partie: p.partie, scores: new Array(playersLen).fill(null) }))
    // ensure at least nbParties parties for UI compatibility
    const nb = _maxParties()
    while (parties.length < nb) parties.push({ partie: parties.length + 1, scores: new Array(playersLen).fill(null) })
    const totals = new Array(playersLen).fill(0)
    return { table: t.table, players: (t.players || []).slice(), parties, totals }
  })
}