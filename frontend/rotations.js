// rotations.js

// tirage = tableau de joueurs déjà ordonné par table :
// [ { nom, numero }, { nom, numero }, ... ] avec 4 joueurs par table.

// helper giving the neutral player order for tables of any size (used for
// 5-player dealer rotation etc). returns an array of length `nbParties` that
// cycles through the provided `joueurs` list.
export function neutralOrderForTable(joueurs, nbParties) {
  const size = joueurs.length
  const seq = []
  for (let i = 0; i < nbParties; i++) {
    seq.push(joueurs[i % size])
  }
  return seq
}

export function getMovementInfo (nbTables) {
  // Defaults
  let label = 'Mouvement normal FFT'
  if (nbTables === 3) label = 'Mouvement Howell FFT – 3 tables'
  if (nbTables === 4) label = 'Mouvement Howell FFT – 4 tables'

  // Base movements and exceptions per your rules
  const baseMap = {
    6: { base: 'N fixe, S +1, E +2, O -1', maxManches: 5 },
    8: { base: 'N fixe, S +1, E +2, O -1', maxManches: 6 },
    9: { base: 'N fixe, S +1, E +2, O -2' },
    10: { base: 'N fixe, S +1, E +2, O -1' },
    12: { base: 'N fixe, S +1, E +2, O -2' },
    14: { base: 'N fixe, S +1, E +2, O -2' },
    15: { base: 'N fixe, S +1, E +2, O -2' },
    16: { base: 'N fixe, S +1, E +2, O -2' },
    18: { base: 'N fixe, S +1, E +2, O -2' },
    20: { base: 'N fixe, S +1, E +2, O -2' }
  }

  const exceptionsMap = {
    6: { 3: 'Est +3', 4: 'Ouest -2' },
    8: { 5: 'Sud +2; Est +3', 6: 'Est +4' },
    9: { 4: 'Est +3; Ouest -3', 5: 'Est +3; Ouest -3' },
    10: { 6: 'Est +3; Ouest -2' },
    12: { 4: 'Ouest -3', 7: 'Est +3' },
    14: { 5: 'Ouest -3' },
    15: { 5: 'Ouest -3' },
    16: { 5: 'Ouest -3', 6: 'Ouest -3' },
    18: { 6: 'Ouest -3' },
    20: { 6: 'Ouest -3' }
  }

  const info = baseMap[nbTables] || { base: 'N fixe, S +1, E +2, O -2' }
  const base = info.base
  const maxManches = info.maxManches || null
  const exceptions = exceptionsMap[nbTables] || null

  let comment = base
  if (exceptions) {
    const exStrings = Object.keys(exceptions).map(k => `Manche ${k}: ${exceptions[k]}`)
    comment += ' — Exceptions: ' + exStrings.join('; ')
    // Marquer comme spécial si des exceptions sont présentes
    label = 'Mouvement spécial FFT'
  }

  return { label, comment, maxManches }
}

export function calculRotationsRainbow (tirage, nbParties, modeExclu = false) {
  if (!Array.isArray(tirage) || tirage.length === 0) {
    throw new Error('Tirage vide')
  }
  const nbJoueurs = tirage.length

  // Helper: get movement info for a given number of tables (use getMovementInfo(nbTables) below)

  // Configuration des tables
  let tableSizes = []

  // Cas particuliers pour éviter les mathématiques impossibles avec modulo 4
  if (nbJoueurs % 4 === 1 && modeExclu) {
    // Mode exclu : tables de 4, exclu retiré à chaque manche
    const nbTables = (nbJoueurs - 1) / 4
    tableSizes = new Array(nbTables).fill(4)
  } else if (nbJoueurs === 7) {
    // 3 + 4
    tableSizes = [3, 4]
  } else if (nbJoueurs === 11) {
    // 5 + 6
    tableSizes = [5, 6]
  } else {
    // Cas général: tables de 4 et 5
    const reste = nbJoueurs % 4 // 0, 1, 2, 3
    const nbTables5 = reste
    const nbTables4 = (nbJoueurs - (nbTables5 * 5)) / 4

    if (nbTables4 < 0) {
      // Fallback ultime si algo échoue (ex: < 7 ou autres cas bizarres)
      // On fait des tables de 4 tant que possible, le reste dans la dernière
      console.warn('Calcul tables 4/5 impossible, fallback simple')
      const nbT = Math.ceil(nbJoueurs / 4)
      for (let i = 0; i < nbT - 1; i++) tableSizes.push(4)
      tableSizes.push(nbJoueurs - (nbT - 1) * 4)
    } else {
      for (let i = 0; i < nbTables4; i++) tableSizes.push(4)
      for (let i = 0; i < nbTables5; i++) tableSizes.push(5)
    }
  }

  const nbTables = tableSizes.length

  if (nbJoueurs >= 12 && nbJoueurs % 4 === 0) {
    // ... logic Howell/Mitchell ...
    if (nbTables === 3 || nbTables === 4) {
      const dict = mouvementHowellFFT(tirage, nbParties, nbTables)
      return corrigerPositionMorts(dict)
    }
    // 5 tables et + : Mitchell
    const dict = mouvementNormalFFT(tirage, nbParties)
    return corrigerPositionMorts(dict)
  }

  // SINON : Mode "Club"
  // ...Suite du code...
  const dict = {}
  // On trie le tirage par numéro pour être déterministe
  const sortedJoueurs = [...tirage].sort((a, b) => a.numero - b.numero)

  for (let r = 0; r < nbParties; r++) {
    const nomRot = `Manche ${r + 1}`

    // Rotation cyclique "intelligente"
    const shift = (r * 5) % nbJoueurs
    const currentJoueurs = [
      ...sortedJoueurs.slice(shift),
      ...sortedJoueurs.slice(0, shift)
    ]

    const tables = []
    let idx = 0

    // BUG POTENTIEL FIXÉ : array slice indices
    tableSizes.forEach((size, tIndex) => {
      // slice(0, 5) -> 5 elems. idx=5.
      // slice(5, 5+6) => slice(5, 11) -> 6 elems. idx=11.
      const tableJoueurs = currentJoueurs.slice(idx, idx + size)
      idx += size
      tables.push({
        table: tIndex + 1,
        joueurs: tableJoueurs
      })
    })

    dict[nomRot] = tables
  }

  // Pas de correction de Morts ici car le brassage est déjà fait et les tables varient
  return dict
}

// Utility: compute active array from base + seatIndex + exclu
export function computeActiveFromBase (base, seatIndex, exclu) {
  // base: array of player objects
  // seatIndex: number or null
  // exclu: name string or null
  const b = base.map(p => ({ ...p }))
  if (exclu && seatIndex !== null && typeof seatIndex === 'number' && seatIndex >= 0 && seatIndex < b.length) {
    const idx = b.findIndex(p => (p.nom || '').toLowerCase() === (exclu || '').toLowerCase())
    if (idx >= 0 && idx !== seatIndex) {
      const tmp = b[seatIndex]
      b[seatIndex] = b[idx]
      b[idx] = tmp
    }
    // return without the reserved seat
    return b.filter((_, i) => i !== seatIndex)
  }
  // no exclu for this manche -> return full base
  return b
}

// Fonction pour forcer les Morts au Nord (échange avec le joueur Nord si besoin)
function corrigerPositionMorts (dict) {
  for (const rotName in dict) {
    const tables = dict[rotName]
    for (const t of tables) {
      // t.joueurs = [N, S, E, O]
      const [N, S, E, O] = t.joueurs
      const joueurs = [N, S, E, O]

      // On cherche l'index d'un Mort (le premier trouvé s'il y en a plusieurs)
      // On ignore l'index 0 (Nord) car s'il est déjà au Nord, c'est bon.
      const indexMort = joueurs.findIndex((j, idx) => idx > 0 && j.nom.toUpperCase().includes('MORT'))

      if (indexMort > 0) {
        // On a trouvé un Mort qui n'est pas au Nord (indexMort = 1, 2 ou 3)
        // On échange avec le Nord (index 0)
        // ATTENTION : Cela déplace le joueur initialement prévu au Nord.
        // Dans un mouvement Mitchell (5+ tables), le Nord est censé être fixe.
        // Si on déplace un Vivant du Nord pour mettre un Mort, le Vivant devient mobile (S, E ou O).
        const temp = joueurs[0]
        joueurs[0] = joueurs[indexMort]
        joueurs[indexMort] = temp

        // Mise à jour du tableau
        t.joueurs = joueurs
      }
    }
  }
  return dict
}

// -----------------------------------------------------
// Mouvement normal
// -----------------------------------------------------

function mouvementNormalFFT (tirage, nbParties) {
  const nbJoueurs = tirage.length
  const nbTables = nbJoueurs / 4

  const joueursState = []
  for (let t = 0; t < nbTables; t++) {
    const base = t * 4
    const N0 = tirage[base + 0]
    const S0 = tirage[base + 1]
    const E0 = tirage[base + 2]
    const O0 = tirage[base + 3]

    joueursState.push({ ...N0, table: t, pos: 'N' })
    joueursState.push({ ...S0, table: t, pos: 'S' })
    joueursState.push({ ...E0, table: t, pos: 'E' })
    joueursState.push({ ...O0, table: t, pos: 'O' })
  }

  const dict = {}

  // Cap number of manches for certain table counts (limitation)
  const maxManchesMap = { 6: 5, 8: 6 }
  const effectiveNbParties = Math.min(nbParties, maxManchesMap[nbTables] || nbParties)

  for (let r = 0; r < effectiveNbParties; r++) {
    const nomRot = `Manche ${r + 1}`

    const tables = []
    for (let t = 0; t < nbTables; t++) {
      const jTable = joueursState.filter((j) => j.table === t)
      const N = jTable.find((j) => j.pos === 'N')
      const S = jTable.find((j) => j.pos === 'S')
      const E = jTable.find((j) => j.pos === 'E')
      const O = jTable.find((j) => j.pos === 'O')

      tables.push({
        table: t + 1,
        joueurs: [N, S, E, O]
      })
    }

    dict[nomRot] = tables

    if (r === effectiveNbParties - 1) break

    // Default deltas per position (N,S,E,O). Values are added to current table index.
    // Some table counts use O:-1 instead of -2.
    let defaultDeltas
    if ([6, 8, 10].includes(nbTables)) {
      defaultDeltas = { N: 0, S: 1, E: 2, O: -1 }
    } else {
      defaultDeltas = { N: 0, S: 1, E: 2, O: -2 }
    }

    // Exceptions map for specific nbTables and manche (1-based)
    const movementExceptions = {
      6: {
        3: { E: 3 },
        4: { O: -2 }
      },
      8: {
        5: { S: 2, E: 3 },
        6: { E: 4 }
      },
      9: {
        4: { E: 3, O: -3 },
        5: { E: 3, O: -3 }
      },
      10: {
        6: { E: 3, O: -2 }
      },
      12: {
        4: { O: -3 },
        7: { E: 3 }
      },
      14: {
        5: { O: -3 }
      },
      15: {
        5: { O: -3 }
      },
      16: {
        5: { O: -3 },
        6: { O: -3 }
      },
      18: {
        6: { O: -3 }
      },
      20: {
        6: { O: -3 }
      }
    }

    // Determine deltas to MOVE TO THE NEXT manche.
    // The rule "Manche N: ..." applies to the rotation that *produces* Manche N,
    // i.e. when computing the move from current r to r+1 we should look up targetManche = r+2.
    const targetManche = r + 2
    const overridesForNb = movementExceptions[nbTables] || {}
    const overridesForManche = overridesForNb[targetManche] || {}
    // If an override explicitly sets a position, it REPLACES the base movement for that position.
    const deltas = { ...defaultDeltas, ...overridesForManche }

    for (const j of joueursState) {
      const t = j.table
      const delta = deltas[j.pos] || 0
      j.table = (t + delta + nbTables) % nbTables
    }
  }

  return dict
}

// -----------------------------------------------------
// Howell 3 tables (12 joueurs)
// -----------------------------------------------------

const howell3Tables = [
  // 1ère position
  [
    { num: 1, table: 1, pos: 'N' },
    { num: 2, table: 1, pos: 'S' },
    { num: 3, table: 1, pos: 'E' },
    { num: 4, table: 1, pos: 'O' },

    { num: 5, table: 2, pos: 'N' },
    { num: 6, table: 2, pos: 'S' },
    { num: 7, table: 2, pos: 'E' },
    { num: 8, table: 2, pos: 'O' },

    { num: 9, table: 3, pos: 'N' },
    { num: 10, table: 3, pos: 'S' },
    { num: 11, table: 3, pos: 'E' },
    { num: 12, table: 3, pos: 'O' }
  ],

  // 2ème position
  [
    { num: 1, table: 1, pos: 'N' },
    { num: 2, table: 1, pos: 'S' },
    { num: 7, table: 1, pos: 'E' },
    { num: 12, table: 1, pos: 'O' },

    { num: 5, table: 2, pos: 'N' },
    { num: 6, table: 2, pos: 'S' },
    { num: 11, table: 2, pos: 'E' },
    { num: 3, table: 2, pos: 'O' },

    { num: 9, table: 3, pos: 'N' },
    { num: 10, table: 3, pos: 'S' },
    { num: 4, table: 3, pos: 'E' },
    { num: 8, table: 3, pos: 'O' }
  ],

  // 3ème position
  [
    { num: 1, table: 1, pos: 'N' },
    { num: 8, table: 1, pos: 'S' },
    { num: 7, table: 1, pos: 'E' },
    { num: 10, table: 1, pos: 'O' },

    { num: 5, table: 2, pos: 'N' },
    { num: 2, table: 2, pos: 'S' },
    { num: 11, table: 2, pos: 'E' },
    { num: 12, table: 2, pos: 'O' },

    { num: 9, table: 3, pos: 'N' },
    { num: 3, table: 3, pos: 'S' },
    { num: 4, table: 3, pos: 'E' },
    { num: 6, table: 3, pos: 'O' }
  ],

  // 4ème position
  [
    { num: 1, table: 1, pos: 'N' },
    { num: 8, table: 1, pos: 'S' },
    { num: 6, table: 1, pos: 'E' },
    { num: 11, table: 1, pos: 'O' },

    { num: 5, table: 2, pos: 'N' },
    { num: 2, table: 2, pos: 'S' },
    { num: 4, table: 2, pos: 'E' },
    { num: 10, table: 2, pos: 'O' },

    { num: 9, table: 3, pos: 'N' },
    { num: 3, table: 3, pos: 'S' },
    { num: 12, table: 3, pos: 'E' },
    { num: 7, table: 3, pos: 'O' }
  ],

  // 5ème position
  [
    { num: 1, table: 1, pos: 'N' },
    { num: 9, table: 1, pos: 'S' },
    { num: 5, table: 1, pos: 'E' },
    { num: 3, table: 1, pos: 'O' },

    { num: 7, table: 2, pos: 'N' },
    { num: 11, table: 2, pos: 'S' },
    { num: 4, table: 2, pos: 'E' },
    { num: 10, table: 2, pos: 'O' },

    { num: 2, table: 3, pos: 'N' },
    { num: 6, table: 3, pos: 'S' },
    { num: 12, table: 3, pos: 'E' },
    { num: 8, table: 3, pos: 'O' }
  ],

  // 6ème position
  [
    { num: 1, table: 1, pos: 'N' },
    { num: 9, table: 1, pos: 'S' },
    { num: 7, table: 1, pos: 'E' },
    { num: 2, table: 1, pos: 'O' },

    { num: 5, table: 2, pos: 'N' },
    { num: 11, table: 2, pos: 'S' },
    { num: 4, table: 2, pos: 'E' },
    { num: 12, table: 2, pos: 'O' },

    { num: 10, table: 3, pos: 'N' },
    { num: 6, table: 3, pos: 'S' },
    { num: 3, table: 3, pos: 'E' },
    { num: 8, table: 3, pos: 'O' }
  ]
]

// -----------------------------------------------------
// Howell 4 tables (16 joueurs)
// -----------------------------------------------------

const howell4Tables = [
  // Position 1
  [
    { num: 1, table: 1, pos: 'N' },
    { num: 2, table: 1, pos: 'S' },
    { num: 3, table: 1, pos: 'E' },
    { num: 4, table: 1, pos: 'O' },

    { num: 5, table: 2, pos: 'N' },
    { num: 6, table: 2, pos: 'S' },
    { num: 7, table: 2, pos: 'E' },
    { num: 8, table: 2, pos: 'O' },

    { num: 9, table: 3, pos: 'N' },
    { num: 10, table: 3, pos: 'S' },
    { num: 11, table: 3, pos: 'E' },
    { num: 12, table: 3, pos: 'O' },

    { num: 13, table: 4, pos: 'N' },
    { num: 14, table: 4, pos: 'S' },
    { num: 15, table: 4, pos: 'E' },
    { num: 16, table: 4, pos: 'O' }
  ],

  // Position 2
  [
    { num: 1, table: 1, pos: 'N' },
    { num: 8, table: 1, pos: 'S' },
    { num: 10, table: 1, pos: 'E' },
    { num: 15, table: 1, pos: 'O' },

    { num: 16, table: 2, pos: 'N' },
    { num: 9, table: 2, pos: 'S' },
    { num: 7, table: 2, pos: 'E' },
    { num: 2, table: 2, pos: 'O' },

    { num: 6, table: 3, pos: 'N' },
    { num: 3, table: 3, pos: 'S' },
    { num: 13, table: 3, pos: 'E' },
    { num: 12, table: 3, pos: 'O' },

    { num: 11, table: 4, pos: 'N' },
    { num: 14, table: 4, pos: 'S' },
    { num: 4, table: 4, pos: 'E' },
    { num: 5, table: 4, pos: 'O' }
  ],

  // Position 3
  [
    { num: 1, table: 1, pos: 'N' },
    { num: 7, table: 1, pos: 'S' },
    { num: 12, table: 1, pos: 'E' },
    { num: 14, table: 1, pos: 'O' },

    { num: 15, table: 2, pos: 'N' },
    { num: 9, table: 2, pos: 'S' },
    { num: 6, table: 2, pos: 'E' },
    { num: 4, table: 2, pos: 'O' },

    { num: 8, table: 3, pos: 'N' },
    { num: 2, table: 3, pos: 'S' },
    { num: 13, table: 3, pos: 'E' },
    { num: 11, table: 3, pos: 'O' },

    { num: 10, table: 4, pos: 'N' },
    { num: 16, table: 4, pos: 'S' },
    { num: 3, table: 4, pos: 'E' },
    { num: 5, table: 4, pos: 'O' }
  ],

  // Position 4
  [
    { num: 1, table: 1, pos: 'N' },
    { num: 6, table: 1, pos: 'S' },
    { num: 11, table: 1, pos: 'E' },
    { num: 16, table: 1, pos: 'O' },

    { num: 14, table: 2, pos: 'N' },
    { num: 9, table: 2, pos: 'S' },
    { num: 8, table: 2, pos: 'E' },
    { num: 3, table: 2, pos: 'O' },

    { num: 7, table: 3, pos: 'N' },
    { num: 4, table: 3, pos: 'S' },
    { num: 13, table: 3, pos: 'E' },
    { num: 10, table: 3, pos: 'O' },

    { num: 12, table: 4, pos: 'N' },
    { num: 15, table: 4, pos: 'S' },
    { num: 2, table: 4, pos: 'E' },
    { num: 5, table: 4, pos: 'O' }
  ],

  // Position 5
  [
    { num: 1, table: 1, pos: 'N' },
    { num: 5, table: 1, pos: 'S' },
    { num: 9, table: 1, pos: 'E' },
    { num: 13, table: 1, pos: 'O' },

    { num: 2, table: 2, pos: 'N' },
    { num: 6, table: 2, pos: 'S' },
    { num: 10, table: 2, pos: 'E' },
    { num: 14, table: 2, pos: 'O' },

    { num: 3, table: 3, pos: 'N' },
    { num: 7, table: 3, pos: 'S' },
    { num: 11, table: 3, pos: 'E' },
    { num: 15, table: 3, pos: 'O' },

    { num: 4, table: 4, pos: 'N' },
    { num: 8, table: 4, pos: 'S' },
    { num: 12, table: 4, pos: 'E' },
    { num: 16, table: 4, pos: 'O' }
  ]
]

// -----------------------------------------------------
// Implémentation Howell générique
// -----------------------------------------------------

function mouvementHowellFFT (tirage, nbParties, nbTables) {
  const joueursNum = tirage.map((j, idx) => ({ ...j, num: idx + 1 }))
  const schema = nbTables === 3 ? howell3Tables : howell4Tables
  const dict = {}

  const nbPos = Math.min(nbParties, schema.length)

  for (let r = 0; r < nbPos; r++) {
    const nomRot = `Manche ${r + 1}`
    const position = schema[r]

    const tables = []
    for (let t = 1; t <= nbTables; t++) {
      const joueursTable = position
        .filter((p) => p.table === t)
        .map((p) => {
          const joueur = joueursNum.find((x) => x.num === p.num)
          return { ...joueur, pos: p.pos }
        })

      const N = joueursTable.find((j) => j.pos === 'N')
      const S = joueursTable.find((j) => j.pos === 'S')
      const E = joueursTable.find((j) => j.pos === 'E')
      const O = joueursTable.find((j) => j.pos === 'O')

      tables.push({ table: t, joueurs: [N, S, E, O] })
    }

    dict[nomRot] = tables
  }

  return dict
}
