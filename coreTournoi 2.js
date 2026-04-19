// coreTournoi.js

// Tirage au sort : renvoie [{ nom, numero }]
export function tirageAuSort (listeTournoi) {
  const nbJoueurs = listeTournoi.length
  // On doit travailler sur un multiple de 4 pour les tables complètes,
  // mais la fonction tirage est générique.
  // Cependant, pour placer les morts, il faut assumer un certain nb de tables.
  // Si le nb de joueurs n'est pas multiple de 4, on fait un tirage simple.
  if (nbJoueurs % 4 !== 0) {
    return [...listeTournoi]
      .map((nom) => ({ nom, r: Math.random() }))
      .sort((a, b) => a.r - b.r)
      .map((o, i) => ({ nom: o.nom, numero: i + 1 }))
  }

  const nbTables = nbJoueurs / 4
  // Détection des morts (contient "Mort" ou commence par "ZZ")
  const morts = listeTournoi.filter((n) => n.toUpperCase().includes('MORT'))
  const vivants = listeTournoi.filter((n) => !n.toUpperCase().includes('MORT'))

  // Mélange aléatoire des groupes
  const shuffle = (arr) =>
    arr
      .map((v) => ({ v, r: Math.random() }))
      .sort((a, b) => a.r - b.r)
      .map((o) => o.v)

  // On NE mélange PAS les morts pour qu'ils soient placés de façon déterministe
  // On les trie en ordre inverse (descendant) pour que :
  // Mort 1 se retrouve à la table la plus "basse" de la série (nbTables - N)
  // Mort X se retrouve à la table la plus "haute" (nbTables - 1)
  const mortsTries = morts.sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' })
  )

  const mortsMelanges = mortsTries // Nom de variable historique, mais ils sont triés
  const vivantsMelanges = shuffle(vivants)

  // Tableau final vide
  const resultat = new Array(nbJoueurs).fill(null)

  // Indices réservés pour les morts : Nords des dernières tables
  // Table t (0-index) => Nord a l'index t*4
  // Tables concernées : nbTables-1, nbTables-2...
  const indicesMorts = []
  for (let i = 0; i < mortsMelanges.length; i++) {
    // Si on a plus de morts que de tables, ça va coincer pour les mettre tous au Nord,
    // mais supposons que k <= nbTables.
    const tableIndex = nbTables - 1 - i
    if (tableIndex >= 0) {
      indicesMorts.push(tableIndex * 4)
    } else {
      // For numeric tableSize (normal tables) we use legacy rules:
      // - tableSize === 3 -> defenders = 2
      // - tableSize >= 4 -> defenders = 3
      if (tableSize === 3) return (Number(attackerScore) % 2) === 0
      return (Number(attackerScore) % 3) === 0
      const def = -attackerScore / 3
    }
  }

  // Placement des morts
  indicesMorts.forEach((idx, i) => {
    resultat[idx] = mortsMelanges[i]
  })

  // Placement des vivants dans les trous restants
  let vIndex = 0
  for (let i = 0; i < nbJoueurs; i++) {
    if (resultat[i] === null) {
      if (vIndex < vivantsMelanges.length) {
        resultat[i] = vivantsMelanges[vIndex]
        vIndex++
      }
    }
  }

  return resultat.map((nom, i) => ({ nom, numero: i + 1 }))
}

// Calcul des rotations : renvoie un dictionnaire
// { "Rotation 1": [ { table: 1, joueurs: [ {nom, numero}, ...4 ] }, ... ], ... }
export function calculRotations (tirage, nbParties) {
  if (!Array.isArray(tirage) || tirage.length === 0) {
    throw new Error('Tirage vide')
  }
  const nbJoueurs = tirage.length
  if (nbJoueurs % 4 !== 0) {
    throw new Error('Le nombre de joueurs doit être un multiple de 4.')
  }
  const nbTables = nbJoueurs / 4

  const dict = {}
  for (let r = 1; r <= nbParties; r++) {
    const nomRot = `Rotation ${r}`
    const tables = []
    for (let t = 0; t < nbTables; t++) {
      const base = (t * 4) % nbJoueurs
      const joueursTable = [
        tirage[(base + 0 + (r - 1) * 0) % nbJoueurs], // N
        tirage[(base + 1 + (r - 1) * 0) % nbJoueurs], // S
        tirage[(base + 2 + (r - 1) * 0) % nbJoueurs], // E
        tirage[(base + 3 + (r - 1) * 0) % nbJoueurs] // O
      ]
      tables.push({
        table: t + 1,
        joueurs: joueursTable
      })
    }
    dict[nomRot] = tables
  }
  return dict
}

/**
 * reportScoreDefense
 * feuille = [[nom, score, total], ...4]
 * indexAttaquant : index 0..3
 * scoreAttaquant : multiple de 3 (ou adapté)
 * exemptIndices : Set d'indices de joueurs qui passent leur tour (score 0)
 *
 * On met le score négatif sur les défenseurs, réparti équitablement.
 * Si un 'Mort' est présent ou un joueur est exempt, il marque 0.
 */
export function reportScoreDefense (feuille, indexAttaquant, scoreAttaquant, exemptIndices = new Set()) {
  const res = feuille.map((l) => [...l])
  const nbJoueurs = res.length

  // Indices à ignorer (Morts nommés + Exempts par rotation)
  const indicesIgnored = new Set(exemptIndices)

  // Ajout des Morts nommés
  res.forEach((row, idx) => {
    if (row[0] && row[0].toUpperCase().includes('MORT')) {
      indicesIgnored.add(idx)
    }
  })

  // compter le nombre de morts dans la table
  const mortCount = res.reduce((c, row) => c + ((row[0] && String(row[0]).toUpperCase().includes('MORT')) ? 1 : 0), 0)

  // Calcul diviseur (par défaut: nbActifs-1)
  const nbActifs = nbJoueurs - indicesIgnored.size
  let nbDefenseurs = Math.max(1, nbActifs - 1)
  try {
    const pref = (typeof localStorage !== 'undefined') ? localStorage.getItem('tarot_morts_divisor') : null
    // Apply user preference only when the table has exactly 1 Mort
    if (mortCount === 1) {
      if (pref === '3') nbDefenseurs = 3
      else if (pref === '2') nbDefenseurs = Math.max(1, Math.min(2, nbActifs - 1))
    }
  } catch (_e) {}
  const scoreDefense = -scoreAttaquant / nbDefenseurs

  for (let i = 0; i < nbJoueurs; i++) {
    if (i === indexAttaquant) {
      res[i][1] = scoreAttaquant
    } else if (indicesIgnored.has(i)) {
      res[i][1] = 0 // Le mort/exempt marque 0
    } else {
      res[i][1] = scoreDefense
    }
  }

  return res
}

/**
 * distributeAttackerScore
 * Retourne un tableau de scores [s0, s1, ...] pour la table donnée en appliquant
 * la règle suivante :
 * - si tableSize === 3 -> défenseurs = -attaque / 2
 * - si tableSize >= 4 -> défenseurs = -attaque / 3
 * Validation (divisibilité) doit être faite en amont.
 */
// attackerScore: number
// tableSizeOrPlayers: either numeric table size or array of player names
// exemptIndices: optional Set<number> of positions that should be ignored
export function distributeAttackerScore (attackerScore, tableSizeOrPlayers, exemptIndices = new Set()) {
  const res = []
  if (Array.isArray(tableSizeOrPlayers)) {
    const players = tableSizeOrPlayers
    const tableSize = players.length
    const isMort = players.map(p => String(p || '').toUpperCase().startsWith('MORT'))
    const mortCount = isMort.filter(Boolean).length
    const nbActifs = Math.max(1, tableSize - mortCount - exemptIndices.size)

    let nbDefenseurs = Math.max(1, nbActifs - 1)
    try {
      const pref = (typeof localStorage !== 'undefined') ? localStorage.getItem('tarot_morts_divisor') : null
      if (mortCount === 1) {
        if (pref === '3') nbDefenseurs = 3
        else if (pref === '2') nbDefenseurs = Math.max(1, Math.min(2, nbActifs - 1))
      }
    } catch (_e) {}

    const def = -attackerScore / nbDefenseurs
    res.push(attackerScore)
    for (let i = 1; i < tableSize; i++) {
      if (isMort[i] || exemptIndices.has(i)) res.push(0)
      else res.push(def)
    }
    return res
  }

  const tableSize = Number(tableSizeOrPlayers || 0)
  if (tableSize >= 3) {
    const def = -attackerScore / 3
    res.push(attackerScore)
    for (let i = 1; i < tableSize; i++) res.push(def)
    return res
  }
  return res
}

export function validateAttackerDivisibility (attackerScore, tableSizeOrPlayers) {
  if (Array.isArray(tableSizeOrPlayers)) {
    const players = tableSizeOrPlayers
    const isMort = players.map(p => String(p || '').toUpperCase().startsWith('MORT'))
    const mortCount = isMort.filter(Boolean).length
    const nbActifs = Math.max(1, players.length - mortCount)

    try {
      const pref = (typeof localStorage !== 'undefined') ? localStorage.getItem('tarot_morts_divisor') : null
      if (mortCount === 1) {
        const val = Number(attackerScore)
        if (pref === '3') return (val % 3) === 0
        if (pref === '2') return (val % 2) === 0
      }
    } catch (_e) {}

    const nbDefenseurs = Math.max(1, nbActifs - 1)
    return (Number(attackerScore) % nbDefenseurs) === 0
  }

  const tableSize = Number(tableSizeOrPlayers || 0)
  if (tableSize >= 3) return (Number(attackerScore) % 3) === 0
  return true
}

/**
 * placeAttackerAtIndex
 * Retourne un tableau de longueur `tableSize` où la valeur de l'attaquant
 * (attackerScore) est placée à l'index `attackerIndex` et les défenseurs
 * occupent les autres positions conformément à la règle de distribution.
 */
// attackerIndex: where the attacker sits (0-based)
// exemptIndices: optional Set of positions to exclude from sharing
export function placeAttackerAtIndex (attackerScore, tableSizeOrPlayers, attackerIndex, exemptIndices = new Set(), divisorOverride = null) {
  const playersProvided = Array.isArray(tableSizeOrPlayers)
  const tableSize = playersProvided ? tableSizeOrPlayers.length : Number(tableSizeOrPlayers || 0)
  // rotate exempt indices into the "base" orientation where index 0 is the attacker
  const rotatedExempt = new Set()
  for (const idx of exemptIndices) {
    const b = ((idx - attackerIndex) % tableSize + tableSize) % tableSize
    rotatedExempt.add(b)
  }
  const base = distributeAttackerScore(attackerScore, tableSizeOrPlayers, rotatedExempt, divisorOverride)
  const res = new Array(tableSize).fill(0)
  for (let i = 0; i < tableSize; i++) {
    const target = (i + attackerIndex) % tableSize
    res[target] = base[i]
  }
  return res
}

/**
 * totalManche
 * Ajoute le score de la manche au total courant de chaque joueur.
 */
export function totalManche (feuille) {
  return feuille.map(([nom, score, total]) => {
    const newTotal = Number(total || 0) + Number(score || 0)
    return [nom, score, newTotal]
  })
}

/**
 * transfertTotauxTable
 * scoresSoiree : [[nom, manche1, manche2, ..., total], ...]
 * feuille : [[nom, scoreManche, totalCumuléAprèsCetteManche], ...4]
 * nbPartiesMax : nombre max de manches
 *
 * On ajoute une colonne "manche" + met à jour le "total" par joueur.
 * Si targetIndex est fourni (>=0), on remplace/insère le score à cet index de manche (0-based).
 */
export function transfertTotauxTable (scoresSoiree, feuille, nbPartiesMax, targetIndex = -1) {
  if (!Array.isArray(feuille) || feuille.length < 4) {
    throw new Error('La feuille doit contenir au moins 4 joueurs.')
  }

  const noms = feuille.map((l) => l[0])
  const totauxManche = feuille.map((l) => Number(l[2] || 0))

  if (noms.some((n) => !n)) {
    throw new Error('Tous les joueurs doivent avoir un nom avant le transfert.')
  }

  // Map nom -> [manches..., total]
  const scoresMap = new Map(
    scoresSoiree.map((row) => [row[0], row.slice(1).map(Number)])
  )

  for (let i = 0; i < noms.length; i++) {
    const nom = noms[i]
    const totalManche = totauxManche[i]

    const existing = scoresMap.get(nom) || []
    // On sépare manches et total
    let manches = []
    if (existing.length > 0) {
      manches = existing.slice(0, -1)
    }

    if (targetIndex !== -1) {
      while (manches.length < targetIndex) {
        manches.push(0)
      }
      manches[targetIndex] = totalManche
    } else {
      if (manches.length >= nbPartiesMax) {
        throw new Error(`${nom} a déjà ${nbPartiesMax} manches.`)
      }
      manches.push(totalManche)
    }

    const nouveauTotal = manches.reduce((acc, cur) => acc + cur, 0)
    const nouvelleLigne = [...manches, nouveauTotal]

    scoresMap.set(nom, nouvelleLigne)
  }

  return Array.from(scoresMap.entries()).map(([nom, scores]) => [nom, ...scores])
}

/**
 * determinerExcluSuivant
 * Sélectionne le joueur exclu pour la manche suivante à partir des scores
 * scoresSoiree : [[nom, M1, M2, ..., total], ...]
 * dejàExclus : Set ou Array de noms de joueurs déjà exclus dans cette rotation
 * indexRot : index de la manche actuelle (0-based)
 * Retourne le nom du joueur avec le score de manche le plus bas (ou null)
 */
export function determinerExcluSuivantGlobal (scoresSoiree, dejàExclus, indexRot) {
  const exclusSet = dejàExclus instanceof Set ? dejàExclus : new Set(Array.isArray(dejàExclus) ? dejàExclus : (dejàExclus ? [dejàExclus] : []))

  const candidats = []
  const scoreIndex = indexRot + 1 // M1 is index 1

  for (const row of scoresSoiree) {
    const nom = row && row[0]
    if (!nom) continue

    if (exclusSet.has(nom)) continue // ne pas proposer un joueur déjà exclu dans cette rotation

    // si la manche n'est pas encore renseignée, on considère un score 0
    let score = 0
    if (row.length > scoreIndex && row[scoreIndex] != null) {
      // utilisation explicite de != null pour exclure undefined et null
      score = Number(row[scoreIndex])
      if (Number.isNaN(score)) score = 0
    }

    candidats.push({ nom, score })
  }

  if (candidats.length === 0) return null

  // Trouver la valeur minimale
  const minScore = Math.min(...candidats.map(c => c.score))
  // Filtrer ex-aequo
  const ties = candidats.filter(c => c.score === minScore)
  // Choix aléatoire parmi les ex-æquo
  const choisi = ties[Math.floor(Math.random() * ties.length)]
  return choisi ? choisi.nom : null
}

/**
 * computeNextExclu
 * Étant donné un tableau `scoresSoiree` et un tableau d'exclusion déjà
 * existant, retourne une copie du tableau avec le joueur choisi pour la
 * manche suivante ajouté à l'index approprié. Aucune modification n'est
 * faite si aucun candidat valide n'est trouvé.
 *
 * Ce helper simplifie les tests et évite de réécrire la logique dans
 * `performGlobalValidateManche`.
 */
export function computeNextExclu (scoresSoiree, exclusArr, indexRot) {
  const arr = Array.isArray(exclusArr) ? [...exclusArr] : []
  // Collecter TOUS les joueurs déjà exclus dans la rotation (pas seulement la manche courante)
  const dejàExclus = new Set(arr.filter(nom => nom != null))
  const next = determinerExcluSuivantGlobal(scoresSoiree, dejàExclus, indexRot)
  if (next) {
    // ensure array is long enough and fill gaps with null
    while (arr.length < indexRot + 1) arr.push(null)
    arr[indexRot + 1] = next
  }
  return arr
}
