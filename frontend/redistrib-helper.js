export function normalizePlacesEntry(entry) {
  if (!entry) return []
  if (Array.isArray(entry)) return entry
  if (entry.places && Array.isArray(entry.places)) return entry.places
  return []
}

export function getPlacesFromDefaults(data, isoDate, nbPlayers) {
  if (!data || typeof isoDate !== 'string') return []
  const [y, m, d] = isoDate.split('-').map(Number)
  const isJeudi = new Date(y, m - 1, d).getDay() === 4

  if (isJeudi) {
    if (data.Jeudi) {
      // Try numeric key first, then textual singular/plural formats (e.g. "9 joueur" / "9 joueurs")
      const keys = [String(nbPlayers), `${nbPlayers} joueur`, `${nbPlayers} joueurs`]
      for (const k of keys) {
        if (data.Jeudi[k]) return normalizePlacesEntry(data.Jeudi[k])
      }
    }
    return []
  }

  // NonJeudi: only look under NonJeudi
  const nbTables = Math.ceil(nbPlayers / 4)
  if (data.NonJeudi) {
    if (data.NonJeudi.Tables && data.NonJeudi.Tables[String(nbTables)]) {
      return normalizePlacesEntry(data.NonJeudi.Tables[String(nbTables)])
    }
    const keysToTry = [String(nbTables), `${nbTables} table`, `${nbTables} tables`]
    for (const k of keysToTry) {
      if (data.NonJeudi[k]) return normalizePlacesEntry(data.NonJeudi[k])
    }
  }

  return []
}

export function countActivePlayersFromNames(list) {
  if (!Array.isArray(list)) return 0
  return list.filter(n => !String(n || '').toUpperCase().startsWith('MORT')).length
}
