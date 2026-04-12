import subprocess
import sys
import webbrowser
from pathlib import Path
import time

BASE_DIR = Path(__file__).resolve().parent

BACKEND_DIR = BASE_DIR / "backend"
FRONTEND_DIR = BASE_DIR / "frontend"

BACKEND_CMD = [sys.executable, "-m", "uvicorn", "main:app", "--reload", "--port", "8000"]
FRONTEND_CMD = [sys.executable, "-m", "http.server", "8080"]

def main():
  # Lancer le backend FastAPI
  backend_proc = subprocess.Popen(
      BACKEND_CMD,
      cwd=str(BACKEND_DIR),
  )

  # Lancer le serveur frontend (python -m http.server)
  frontend_proc = subprocess.Popen(
      FRONTEND_CMD,
      cwd=str(FRONTEND_DIR),
  )

  # Attendre un peu que les deux serveurs démarrent
  time.sleep(2)

  # Ouvrir le navigateur sur le frontend servi par le backend (même origine pour /api/)
  webbrowser.open("http://localhost:8000/")

  print("Backend sur http://localhost:8000/")
  print("Frontend sur http://localhost:8080/")
  print("Appuyez sur Ctrl+C pour arrêter.")

  try:
    # Attendre que l'un des deux se termine
    backend_proc.wait()
    frontend_proc.wait()
  except KeyboardInterrupt:
    print("Arrêt demandé, fermeture des serveurs...")
    backend_proc.terminate()
    frontend_proc.terminate()

if __name__ == "__main__":
  main()
