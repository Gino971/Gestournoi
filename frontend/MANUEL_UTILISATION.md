# Manuel d'Utilisation et de Développement
# Gestion Tournoi Tarot (Version Autonome)

Ce projet a été transformé d'une application Web (Client + Serveur Python) vers une application de bureau 100% autonome (Electron). Il n'y a plus besoin de serveur externe ni de Python.

---

## 1. Pour l'Utilisateur Final (Vos amis)

L'utilisateur n'a rien à installer (ni Node.js, ni Python).

### Sur Windows
- Transmettez le fichier : `dist/gestion-tournoi-tarot Setup 1.0.0.exe`
- L'utilisateur double-clique pour installer. L'application se lance et créé un raccourci sur le bureau.

### Sur Mac
- Transmettez le fichier : `dist/gestion-tournoi-tarot-1.0.0.dmg`
- L'utilisateur ouvre le fichier et glisse l'icône dans le dossier Applications.
- **Important** : Au premier lancement, comme l'application n'est pas "signée" (payant chez Apple), il faut faire :
  1. **Clic-droit** sur l'application.
  2. Cliquer sur **Ouvrir**.
  3. Confirmer l'ouverture.

**Note importante** : L'écran de saisie des scores s'appelle désormais **"Saisie"** (anciennement "Saisie Rapide"). Le mode table-based « feuille » a été retiré — utilisez uniquement la page **Saisie** pour entrer les scores.

### Les Données
- Lors de la première installation chez un ami, l'application est **vide** (pas de liste de joueurs).
- Les données sont sauvegardées automatiquement sur leur ordinateur dans un dossier caché système (Application Data).

---

## 2. Pour le Développeur (Vous)

Toutes les commandes se lancent depuis le terminal dans le dossier `frontend`.

### Tester les modifications
Si vous modifiez le code (`.js`, `.html`, `.css`), testez immédiatement avec :
```bash
npm start
```

Note utilisateur : l'entrée "Nombre de manches" dispose maintenant de petites flèches visibles en permanence permettant d'ajouter/retirer une manche. Les flèches sont noires pour une bonne lisibilité.

### Créer l'Exécutable (Build)
Une fois satisfait des modifications, pour créer les fichiers à distribuer :

**Pour Windows et Mac (en même temps) :**
```bash
npm run build:all
```

Les fichiers finaux se trouvent ensuite dans le dossier `dist`.

---

## 3. Architecture Technique

- **Moteur** : Electron (Framework permettant de créer des apps bureau avec des technos web).
- **Stockage** : Fichiers JSON locaux.
  - Le fichier `main.js` gère la lecture/écriture sur le disque dur.
  - Le fichier `api.js` fait le lien : si l'app est dans Electron, elle sauvegarde en local. Sinon, elle essaie le réseau (fallback).
- **Migration** : Au démarrage, l'application cherche si d'anciennes données existent dans `../backend/data` pour les importer.

---

## 4. En cas de problème

**Si "npm start" ne marche pas :**
Vérifiez que vous êtes bien dans le dossier `frontend` et que vous avez fait `npm install` au moins une fois.

**Si les listes sont vides :**
L'application stocke les données dans le dossier utilisateur système.
- Mac : `~/Library/Application Support/gestion-tournoi-tarot/data/`
- Windows : `%APPDATA%/gestion-tournoi-tarot/data/`
Vous pouvez supprimer ce dossier pour remettre l'application à zéro.
