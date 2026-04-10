// lucky-utils.js
// Pure helpers to compute eligible players for the "Tirage chanceux".

export function normalizeNomLocal(n) {
  return (n || '').toString().trim().toLowerCase()
}

// tbodyRowsData: array of { ds, disp, gain } where ds = dataset.nom (decoded) or ''
// scores: array of [name, ...values]
// placesForDate: array of place amounts (e.g. [7,5,4,2])
export function computeEligible ({ scores = [], placesForDate = [], tbodyRowsData = [] } = {}) {
  const allNames = scores.map(r => r[0])

  // playersWithGain: names (from sortedByTotal where placesForDate has a non-empty value)
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
  const playersWithGainNormalized = new Set(Array.from(playersWithGain).map(n => normalizeNomLocal(n)))

  // Build map from tbody rows
  const nameToRowKey = new Map()
  tbodyRowsData.forEach((row) => {
    const ds = row.ds || ''
    const disp = row.disp || ''
    const keyDisp = normalizeNomLocal(disp)
    if (keyDisp) nameToRowKey.set(keyDisp, row)
    if (ds) nameToRowKey.set(normalizeNomLocal(ds), row)
  })

  // Displayed gain set from tbody
  const displayedGainSet = new Set()
  tbodyRowsData.forEach((row) => {
    if (row.gain && String(row.gain).trim() !== '') displayedGainSet.add(normalizeNomLocal(row.ds || row.disp || ''))
  })

  // initial eligible (exclude only playersWithGain)
  let eligible = allNames.filter(n => !playersWithGainNormalized.has(normalizeNomLocal(n)))

  // If excluded everyone, fall back to using displayed gains, else allow all
  if (!eligible.length && allNames.length) {
    const eligibleFromDisplayed = allNames.filter(n => !displayedGainSet.has(normalizeNomLocal(n)))
    if (eligibleFromDisplayed.length) eligible = eligibleFromDisplayed
    else eligible = allNames.slice()
  }

  const eligibleFiltered = eligible.filter(n => !displayedGainSet.has(normalizeNomLocal(n)))
  const eligibleRows = eligibleFiltered.map(n => nameToRowKey.get(normalizeNomLocal(n))).filter(Boolean)

  return {
    playersWithGain: Array.from(playersWithGain),
    playersWithGainNormalized: Array.from(playersWithGainNormalized),
    displayedGainSet: Array.from(displayedGainSet),
    eligible,
    eligibleFiltered,
    eligibleRows,
    nameToRowKeys: Array.from(nameToRowKey.keys())
  }
}

// Choose a winner index in [0, count-1] using `rand` for testability.
export function pickLuckyWinnerIndex (count, rand = Math.random) {
  const c = Number(count) || 0
  if (c <= 0) return 0
  const v = Math.max(0, Math.min(0.9999999, Number(rand()) || 0))
  return Math.floor(v * c)
}
