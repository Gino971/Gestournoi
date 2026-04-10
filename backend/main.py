from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Any
import csv
import json
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# Dossier frontend (à côté du backend)
FRONTEND_DIR = BASE_DIR.parent / "frontend"

# Dossier des sauvegardes
BACKUP_DIR = DATA_DIR / "backups"
BACKUP_DIR.mkdir(exist_ok=True)

SCORES_FILE = DATA_DIR / "scores_tournoi.csv"
CLASSEMENT_FILE = DATA_DIR / "Classement_annuel.csv"
RECAP_FILE = DATA_DIR / "recap.json"
LISTE_JOUEURS_FILE = DATA_DIR / "liste_joueurs.csv"
JOUEURS_TOURNOI_FILE = DATA_DIR / "joueurs_tournoi.csv"
SCORES_PAR_TABLE_FILE = DATA_DIR / "scores_par_table.json"
EXCLUS_FILE = DATA_DIR / "exclus_tournoi.json"
REDISTRIBUTIONS_FILE = FRONTEND_DIR / "build" / "defaults" / "redistributions.json"

app = FastAPI()

# CORS pour le frontend (utile en dev; en prod le frontend est servi par FastAPI)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScoresTournoiPayload(BaseModel):
    scores: List[List[Any]]


class ClassementPayload(BaseModel):
    classement: List[List[Any]]


class RecapPayload(BaseModel):
    recap: List[Any]


class JoueursPayload(BaseModel):
    joueurs: List[str]


class ExclusPayload(BaseModel):
    exclus: List[Any]


class BackupPayload(BaseModel):
    filename: str
    content: str


def read_csv(path: Path) -> List[List[str]]:
    if not path.exists():
        return []
    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        return [row for row in reader]


def write_csv(path: Path, rows: List[List[Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        for row in rows:
            writer.writerow(row)


def read_recap(path: Path):
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError:
            return []
    return data


def write_recap(path: Path, recap):
    with path.open("w", encoding="utf-8") as f:
        json.dump(recap, f, ensure_ascii=False, indent=2)


def read_json(path: Path):
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return []


def write_json(path: Path, data):
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def sanitize_filename(name: str) -> str:
    """Remove dangerous characters from filename."""
    return re.sub(r'[^\w\-. ]', '_', name)


# ============================================================
# API ENDPOINTS (préfixe /api/)
# ============================================================

@app.get("/api/ping")
def ping():
    return {"message": "pong"}


# --- scores_tournoi ---

@app.get("/api/scores_tournoi")
def get_scores_tournoi():
    rows = read_csv(SCORES_FILE)
    return {"scores": rows}


@app.post("/api/scores_tournoi")
def post_scores_tournoi(payload: ScoresTournoiPayload):
    write_csv(SCORES_FILE, payload.scores)
    return {"status": "ok"}


# --- classement ---

@app.get("/api/classement")
def get_classement():
    rows = read_csv(CLASSEMENT_FILE)
    return {"classement": rows}


@app.post("/api/classement")
def post_classement(payload: ClassementPayload):
    write_csv(CLASSEMENT_FILE, payload.classement)
    return {"status": "ok"}


# --- recap ---

@app.get("/api/recap")
def get_recap():
    recap = read_recap(RECAP_FILE)
    return {"recap": recap}


@app.post("/api/recap")
def post_recap(payload: RecapPayload):
    write_recap(RECAP_FILE, payload.recap)
    return {"status": "ok"}


# --- liste générale de joueurs ---

@app.get("/api/liste-joueurs")
def get_liste_joueurs():
    rows = read_csv(LISTE_JOUEURS_FILE)
    joueurs = [row[0] for row in rows if row]
    return {"joueurs": joueurs}


@app.post("/api/liste-joueurs")
def post_liste_joueurs(payload: JoueursPayload):
    rows = [[nom] for nom in payload.joueurs]
    write_csv(LISTE_JOUEURS_FILE, rows)
    return {"status": "ok"}


# --- joueurs du tournoi courant ---

@app.get("/api/joueurs-tournoi")
def get_joueurs_tournoi():
    rows = read_csv(JOUEURS_TOURNOI_FILE)
    joueurs = [row[0] for row in rows if row]
    return {"joueurs": joueurs}


@app.post("/api/joueurs-tournoi")
def post_joueurs_tournoi(payload: JoueursPayload):
    rows = [[nom] for nom in payload.joueurs]
    write_csv(JOUEURS_TOURNOI_FILE, rows)
    return {"status": "ok"}


# --- scores_par_table ---

@app.get("/api/scores_par_table")
def get_scores_par_table():
    data = read_json(SCORES_PAR_TABLE_FILE)
    return data


@app.post("/api/scores_par_table")
async def post_scores_par_table(request: Request):
    payload = await request.json()
    write_json(SCORES_PAR_TABLE_FILE, payload)
    return {"status": "ok"}


# --- exclus_tournoi ---

@app.get("/api/exclus_tournoi")
def get_exclus_tournoi():
    data = read_json(EXCLUS_FILE)
    return {"exclus": data}


@app.post("/api/exclus_tournoi")
def post_exclus_tournoi(payload: ExclusPayload):
    write_json(EXCLUS_FILE, payload.exclus)
    return {"status": "ok"}


# --- redistributions (lecture seule) ---

@app.get("/api/redistributions")
def get_redistributions():
    if REDISTRIBUTIONS_FILE.exists():
        return read_json(REDISTRIBUTIONS_FILE)
    return {}


# ============================================================
# BACKUPS (pour le mode web / tablette)
# ============================================================

@app.get("/api/backups")
def list_backups():
    backups = []
    for f in sorted(BACKUP_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        backups.append({
            "name": f.name,
            "date": f.stat().st_mtime * 1000  # ms timestamp comme Electron
        })
    return backups


@app.post("/api/backups")
def save_backup(payload: BackupPayload):
    safe_name = sanitize_filename(payload.filename)
    if not safe_name.endswith('.json'):
        safe_name += '.json'
    filepath = BACKUP_DIR / safe_name
    filepath.write_text(payload.content, encoding="utf-8")
    return {"success": True}


@app.get("/api/backups/{filename}")
def read_backup(filename: str):
    safe_name = sanitize_filename(filename)
    filepath = BACKUP_DIR / safe_name
    if not filepath.exists():
        return {"error": "Fichier non trouvé"}
    return json.loads(filepath.read_text(encoding="utf-8"))


@app.delete("/api/backups/{filename}")
def delete_backup(filename: str):
    safe_name = sanitize_filename(filename)
    filepath = BACKUP_DIR / safe_name
    if filepath.exists():
        filepath.unlink()
        return {"success": True}
    return {"success": False, "error": "Fichier non trouvé"}


# ============================================================
# SERVICE DES FICHIERS STATIQUES (frontend)
# ============================================================

# Servir les sous-dossiers statiques du frontend
if FRONTEND_DIR.exists():
    for subdir in ["build", "lib"]:
        sub_path = FRONTEND_DIR / subdir
        if sub_path.exists():
            app.mount(f"/{subdir}", StaticFiles(directory=str(sub_path)), name=f"static_{subdir}")


# Route catch-all : servir les fichiers frontend ou Index.html par défaut
@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    # Ne pas intercepter les routes /api/
    if full_path.startswith("api/"):
        return {"error": "Not found"}

    # Essayer de servir le fichier demandé
    file_path = FRONTEND_DIR / full_path
    if file_path.is_file() and FRONTEND_DIR in file_path.resolve().parents:
        return FileResponse(file_path)

    # Par défaut : Index.html (SPA fallback)
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)

    return {"error": "Frontend not found"}
