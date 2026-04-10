const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

function createWindow () {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#121212', // Fond sombre pour éviter le flash blanc
    show: false, // Masquer la fenêtre tant qu'elle n'est pas prête
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // Désactiver le cache HTTP pour toujours charger les fichiers à jour
  win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    details.requestHeaders['Pragma'] = 'no-cache'
    callback({ requestHeaders: details.requestHeaders })
  })

  win.loadFile('index.html')

  // Afficher la fenêtre uniquement quand le rendu est prêt
  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
    // Ouvrir les devtools uniquement si on l'indique explicitement (par ex. OPEN_DEVTOOLS=1)
    // Par défaut on n'ouvre PAS la console au démarrage.
    if (process.env.NODE_ENV !== 'production' && process.env.OPEN_DEVTOOLS === '1') {
      win.webContents.openDevTools()
    }
  })
}

// --- Gestion des fichiers locaux (remplace le serveur Python) ---

const DATA_DIR = path.join(app.getPath('userData'), 'data')
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

// --- Importation automatique des anciennes données (Migration) ---

const DOCUMENTS_DIR = app.getPath('documents')
const BACKUP_DIR = path.join(DOCUMENTS_DIR, 'Sauvegardes tournois de tarot')

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
}

// Handlers Sauvegardes
ipcMain.handle('save-backup', async (event, { filename, content }) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true })
    }
    const filePath = path.join(BACKUP_DIR, filename)
    fs.writeFileSync(filePath, content, 'utf-8')
    return { success: true, path: filePath }
  } catch (error) {
    console.error('Erreur sauvegarde:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('list-backups', async () => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return []
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json'))
    return files.map(f => {
      const stats = fs.statSync(path.join(BACKUP_DIR, f))
      return { name: f, date: stats.mtime }
    }).sort((a, b) => b.date - a.date)
  } catch (error) {
    console.error('Erreur liste backups:', error)
    return []
  }
})

ipcMain.handle('read-backup', async (event, filename) => {
  try {
    const filePath = path.join(BACKUP_DIR, filename)
    if (!fs.existsSync(filePath)) throw new Error('Fichier introuvable')
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    console.error('Erreur lecture backup:', error)
    throw error
  }
})

ipcMain.handle('delete-backup', async (event, filename) => {
  try {
    const filePath = path.join(BACKUP_DIR, filename)
    if (!fs.existsSync(filePath)) throw new Error('Fichier introuvable')
    fs.unlinkSync(filePath)
    return { success: true }
  } catch (error) {
    console.error('Erreur suppression backup:', error)
    return { success: false, error: error.message }
  }
})

function migrateData () {
  const oldDataDir = path.join(__dirname, '..', 'backend', 'data')
  if (!fs.existsSync(oldDataDir)) return

  // Ensure redistributions defaults are present in DATA_DIR (copy from bundled defaults if missing)
  try {
    const redisUserPath = path.join(DATA_DIR, 'redistributions.json')
    if (!fs.existsSync(redisUserPath)) {
      const fallbackCandidates = [
        path.join(__dirname, 'defaults', 'redistributions.json'),
        path.join(__dirname, 'build', 'defaults', 'redistributions.json'),
        path.join(process.resourcesPath || '', 'defaults', 'redistributions.json'),
        path.join(process.resourcesPath || '', 'app', 'defaults', 'redistributions.json'),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'defaults', 'redistributions.json'),
        path.join(process.resourcesPath || '', 'app.asar', 'defaults', 'redistributions.json')
      ]
      for (const cand of fallbackCandidates) {
        try {
          if (cand && fs.existsSync(cand)) {
            const raw = fs.readFileSync(cand, 'utf8')
            fs.writeFileSync(redisUserPath, raw, 'utf8')
            console.info('Migrated redistributions.json to DATA_DIR from', cand)
            break
          }
        } catch (e) { /* ignore candidate failures */ }
      }
    }
  } catch (e) {
    console.error('Erreur migration redistributions to DATA_DIR', e)
  }

  // 1. Liste des joueurs (CSV -> Array<String>)
  const joueursClubPath = path.join(DATA_DIR, 'joueurs_club.json')
  let doMigrateJoueurs = !fs.existsSync(joueursClubPath)

  // Si le fichier existe mais est vide (ou array vide), on force la migration si le CSV existe
  if (!doMigrateJoueurs) {
    const existing = readJson('joueurs_club.json', [])
    if (Array.isArray(existing) && existing.length === 0) {
      doMigrateJoueurs = true
    }
  }

  if (doMigrateJoueurs) {
    // Tentative 1: importer l'ancien CSV s'il existe
    try {
      const csvPath = path.join(oldDataDir, 'liste_joueurs.csv')
      if (fs.existsSync(csvPath)) {
        const content = fs.readFileSync(csvPath, 'utf-8')
        const json = content.split(/\r?\n/).filter(line => line.trim() !== '')
        writeJson('joueurs_club.json', json)
        // Si l'import a réussi, on continue
      } else {
        // Tentative 2: importer la liste par défaut fournie dans l'installateur
        try {
          const defaultPath = path.join(__dirname, 'defaults', 'joueurs_club.json')
          if (fs.existsSync(defaultPath)) {
            const raw = fs.readFileSync(defaultPath, 'utf-8')
            const json = JSON.parse(raw)
            if (Array.isArray(json) && json.length > 0) {
              writeJson('joueurs_club.json', json)
            }
          }
        } catch (e) {
          console.error('Erreur lecture default joueurs_club.json', e)
        }
      }
    } catch (e) { console.error('Pas de liste_joueurs.csv ou erreur', e) }
  } else {
    // Si le fichier existe mais est vide, tenter de remplir depuis defaults
    try {
      const existing = readJson('joueurs_club.json', [])
      if (Array.isArray(existing) && existing.length === 0) {
        const defaultPath = path.join(__dirname, 'defaults', 'joueurs_club.json')
        if (fs.existsSync(defaultPath)) {
          const raw = fs.readFileSync(defaultPath, 'utf-8')
          const json = JSON.parse(raw)
          if (Array.isArray(json) && json.length > 0) {
            writeJson('joueurs_club.json', json)
          }
        }
      }
    } catch (e) { console.error('Erreur remplissage joueurs_club depuis defaults', e) }
  }
}

// Helper pour lire/écrire JSON
function readJson (filename, defaultValue) {
  const filePath = path.join(DATA_DIR, filename)
  if (!fs.existsSync(filePath)) {
    return defaultValue
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch (e) {
    console.error(`Erreur lecture ${filename}`, e)
    return defaultValue
  }
}

function writeJson (filename, data) {
  const filePath = path.join(DATA_DIR, filename)
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    return true
  } catch (e) {
    console.error(`Erreur écriture ${filename}`, e)
    throw e
  }
}

app.whenReady().then(async () => {
  // Vider le cache Electron pour garantir le chargement des fichiers à jour
  const ses = require('electron').session.defaultSession
  await ses.clearCache()
  await ses.clearStorageData({ storages: ['cachestorage', 'shadercache', 'serviceworkers'] })
  console.info('[Cache] Cache Electron vidé au démarrage')

  migrateData() // Lancer la migration au démarrage

  // Handlers IPC pour l'API
  ipcMain.handle('read-data', (event, key) => {
    // Mapping des clés vers des fichiers
    switch (key) {
      case 'liste-joueurs': return readJson('joueurs_club.json', [])
      case 'joueurs-tournoi': return readJson('joueurs_tournoi.json', [])
      case 'scores_tournoi': return readJson('scores_temp.json', [])
      case 'classement': return readJson('classement_annuel.json', [])
      case 'recap': return readJson('recap_tournois.json', [])
      case 'exclus_tournoi': return readJson('exclus_tournoi.json', [])
      case 'scores_par_table': return readJson('scores_par_table.json', [])
      case 'redistributions': {
        try {
          const candidates = [
            path.join(DATA_DIR, 'redistributions.json'),
            path.join(__dirname, 'defaults', 'redistributions.json'),
            path.join(__dirname, 'build', 'defaults', 'redistributions.json'),
            path.join(process.resourcesPath || '', 'defaults', 'redistributions.json'),
            path.join(process.resourcesPath || '', 'app', 'defaults', 'redistributions.json'),
            path.join(process.resourcesPath || '', 'app.asar.unpacked', 'defaults', 'redistributions.json'),
            path.join(process.resourcesPath || '', 'app.asar', 'defaults', 'redistributions.json')
          ]
          for (const p of candidates) {
            try {
              if (p && fs.existsSync(p)) {
                try {
                  const raw = fs.readFileSync(p, 'utf8')
                  const parsed = JSON.parse(raw)
                  console.info('Loaded redistributions.json from', p)
                  return parsed
                } catch (e) {
                  console.error('Erreur parse redistributions.json at', p, e)
                }
              }
            } catch (e) {
              /* ignore */
            }
          }
        } catch (e) {
          console.error('Erreur lecture defaults redistributions', e)
        }
        console.warn('redistributions.json not found in any candidate; returning empty {}')
        return {}
      }
      case 'scores_par_table': {
        // Persisted per-table matrices (new feature)
        try {
          const p = path.join(DATA_DIR, 'scores_par_table.json')
          if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf8')
            return JSON.parse(raw)
          }
        } catch (e) {
          console.error('Erreur lecture scores_par_table', e)
        }
        return []
      }
      default: return null
    }
  })

  ipcMain.handle('write-data', (event, { key, data }) => {
    switch (key) {
      case 'liste-joueurs': return writeJson('joueurs_club.json', data)
      case 'joueurs-tournoi': return writeJson('joueurs_tournoi.json', data)
      case 'scores_tournoi': return writeJson('scores_temp.json', data)
      case 'classement': return writeJson('classement_annuel.json', data)
      case 'recap': return writeJson('recap_tournois.json', data)
      case 'exclus_tournoi': return writeJson('exclus_tournoi.json', data)
      case 'scores_par_table': return writeJson('scores_par_table.json', data)
      default: return false
    }
  })

  // Debug helper: expose runtime paths so renderer can confirm where DATA_DIR points
  ipcMain.handle('get-paths', () => {
    return {
      DATA_DIR,
      resourcesPath: process.resourcesPath || null,
      appPath: app.getAppPath(),
      env: process.env.NODE_ENV || null
    }
  })

  ipcMain.handle('quit-app', () => {
    app.quit()
  })

  ipcMain.handle('print-to-pdf', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender)

    // 1. Demander à l'utilisateur où enregistrer le PDF
    const baseName = options?.title || 'Classement'
    const date = new Date()
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const year = date.getFullYear()
    const dateStr = `${day}-${month}-${year}`

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Enregistrer en PDF',
      defaultPath: `${baseName}-${dateStr}.pdf`,
      filters: [{ name: 'Fichiers PDF', extensions: ['pdf'] }]
    })

    if (canceled || !filePath) return false

    // 2. Générer le PDF
    try {
      const data = await win.webContents.printToPDF({
        printBackground: true,
        landscape: options?.landscape !== undefined ? options.landscape : true, // Par défaut paysage pour les tableaux larges
        pageSize: 'A4'
        // margins: { top: 0, bottom: 0, left: 0, right: 0 } // Optionnel
      })

      // 3. Écrire le fichier
      fs.writeFileSync(filePath, data)
      return true
    } catch (e) {
      console.error('Erreur génération PDF:', e)
      throw e
    }
  })

  // --- Boite de dialogue de confirmation (Oui/Non) ---
  ipcMain.handle('show-confirm-dialog', async (event, message) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Non', 'Oui'],
      defaultId: 1, // Oui par défaut
      cancelId: 0, // Non par esc
      title: 'Confirmation',
      message,
      noLink: true
    })
    return result.response === 1 // Retourne true si "Oui" (index 1)
  })

  // --- Boite de dialogue d'alerte (OK) ---
  ipcMain.handle('show-alert-dialog', async (event, message) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    await dialog.showMessageBox(win, {
      type: 'warning', // ou 'info' ou 'error'
      buttons: ['OK'],
      defaultId: 0,
      title: 'Information',
      message,
      noLink: true
    })
    return true
  })

  // --- Boite de dialogue de choix multiples ---
  ipcMain.handle('show-choice-dialog', async (event, { message, buttons }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1, // Dernier bouton comme cancel (Annuler)
      title: 'Choix',
      message,
      noLink: true
    })
    return result.response // Retourne l'index du bouton cliqué
  })

  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
