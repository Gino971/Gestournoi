// generateSerpentinTables(sortedNames, playersPerTable=4)
// sortedNames: array of player names in descending order (best first)
// returns: array of tables: [{ table: 1, joueurs: [ {nom} or null x4 ] }, ...]
export function generateSerpentinTables (sortedNames, playersPerTable = 4) {
  if (!Array.isArray(sortedNames)) throw new Error('sortedNames must be an array')
  const nbPlayers = sortedNames.length
  const nbTables = Math.ceil(nbPlayers / playersPerTable)
  const tables = Array.from({ length: nbTables }, (_, i) => ({ table: i + 1, joueurs: Array.from({ length: playersPerTable }, () => null) }))

  sortedNames.forEach((nom, idx) => {
    const tableIdx = Math.floor(idx / playersPerTable)
    const seatIdx = idx % playersPerTable
    if (!tables[tableIdx]) tables[tableIdx] = { table: tableIdx + 1, joueurs: Array.from({ length: playersPerTable }, () => null) }
    tables[tableIdx].joueurs[seatIdx] = { nom }
  })

  return tables
}
