Instructions de build (macOS & Windows)

Prérequis
- Node.js 18+ et npm
- git
- Pour macOS : Xcode command line tools (pour codesign si nécessaire)
- Pour Windows : aucun outil spécial si on utilise GitHub Actions; localement NSIS peut être nécessaire pour créer l'installateur .exe

Build local (mac) — sur macOS uniquement
1. Se placer dans le dossier `frontend` :

```bash
cd frontend
```

2. Installer les dépendances :

```bash
npm ci
```

3. Lancer la création des paquets mac :

```bash
npm run build:mac
```

Les fichiers produits seront dans `frontend/dist` (ex. `.dmg`, `.zip`).

Remarques :
- Pour signer une app mac (`.dmg`) vous devez configurer `identity` dans `package.json`/`build` et disposer d'un certificat Apple Developer.

Build local (Windows) — sur Windows uniquement
1. Ouvrir PowerShell/CMD et se placer dans `frontend`.
2. Installer dépendances : `npm ci`.
3. Lancer :

```powershell
npm run build:win
```

Les artéfacts (.exe, .nsis, .zip) se trouvent dans `frontend/dist`.

CI / Builds automatisés
- Un workflow GitHub Actions `.github/workflows/packaging.yml` est fourni ; il construit les installateurs pour macOS et Windows et publie les artefacts de build.
- Pour que GitHub puisse produire des installateurs signés (mac), il faut configurer les secrets Apple (certificats) et adapter `build.mac.identity`.

Publier un release
- Après avoir pushé un tag `vX.Y.Z` GitHub Actions s'exécutera (si workflow activé) et génèrera les artéfacts ; récupérez les artéfacts depuis l'onglet Actions ou en attachant les fichiers au release.
