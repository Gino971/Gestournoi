// lib/classement-utils.js

// Utility for building/merging annual classement rows based on recap data.
// The function is pure and does not depend on DOM or other side effects.

/**
 * Build a "classement" array (suitable for persistence/display) from the recap
 * history and an optional existing persisted classement.
 *
 * @param {Array<Object>} recap - array of {date, scores: [[name,...],...]} entries
 * @param {Array<Array>} [persisted=[]] - existing classement rows ([name, ...scores])
 * @returns {Array<Array>} new classement rows where each row has the form
 *   [name, scoreForDate1, scoreForDate2, ...] (dates sorted asc).
 */
export function buildClassementFromRecap(recap, persisted = []) {
  const dates = Array.isArray(recap) ? recap.map(t => t.date).sort() : []
  const rowsMap = new Map()

  recap.forEach((t) => {
    const idx = dates.indexOf(t.date)
    ;(Array.isArray(t.scores) ? t.scores : []).forEach((r) => {
      const name = r && r[0]
      if (!name) return
      let score = Number(r[r.length - 1] || 0)
      if (isNaN(score)) score = 0
      if (!rowsMap.has(name)) rowsMap.set(name, new Array(dates.length).fill(0))
      rowsMap.get(name)[idx] = score
    })
  })

  // Preserve any names already present in persisted classement
  ;(Array.isArray(persisted) ? persisted : []).forEach((r) => {
    const name = r && r[0]
    if (name && !rowsMap.has(name)) {
      rowsMap.set(name, new Array(dates.length).fill(0))
    }
  })

  return Array.from(rowsMap.entries()).map(([n, arr]) => [n, ...arr])
}
