import subprocess
import sys
import webbrowser
from pathlib import Path
import time
from threading import Thread

BASE_DIR = Path(__file__).resolve().parent

BACKEND_DIR = BASE_DIR / "backend"
FRONTEND_DIR = BASE_DIR / "frontend"

BACKEND_CMD = [sys.executable, "-m", "uvicorn", "main:app", "--reload", "--port", "8000"]
FRONTEND_CMD = [sys.executable, "-m", "http.server", "8080"]

def run_backend():
  return subprocess.Popen(BACKEND_CMD, cwd=str(BACKEND_DIR))

def run_frontend_fallback():
  return subprocess.Popen(FRONTEND_CMD, cwd=str(FRONTEND_DIR))

def run_livereload_server():
  try:
    from livereload import Server
  except Exception:
    return None
  server = Server()
  # watch the frontend directory recursively
  server.watch(str(FRONTEND_DIR))
  server.watch(str(FRONTEND_DIR / '**/*'))
  server.serve(root=str(FRONTEND_DIR), port=8080, host='127.0.0.1', open_url_delay=None)

def main():
  # Lancer le backend FastAPI
  backend_proc = run_backend()

  # Essayer d'utiliser livereload pour le frontend, sinon fallback sur http.server
  frontend_proc = None
  livereload_thread = None
  try:
    # Vérifier la présence de 'livereload' sans utiliser importlib.util (certaines env peuvent shadow importlib)
    try:
      import importlib
      importlib.import_module('livereload')
      has_livereload = True
    except Exception:
      has_livereload = False

    if has_livereload:
      livereload_thread = Thread(target=run_livereload_server, daemon=True)
      livereload_thread.start()
      time.sleep(1)
      print("Frontend (livereload) sur http://localhost:8080/")
    else:
      raise ImportError
  except ImportError:
    frontend_proc = run_frontend_fallback()
    print("Frontend (http.server) sur http://localhost:8080/ (pas de live-reload, installe 'livereload' via pip)")

  # Attendre un peu que les serveurs démarrent
  time.sleep(2)

  # Ouvrir le navigateur sur le backend (même origine pour /api/)
  webbrowser.open("http://localhost:8000/")

  print("Backend sur http://localhost:8000/")
  print("Appuyez sur Ctrl+C pour arrêter.")

  try:
    if frontend_proc:
      # Attendre que les deux processus se terminent
      backend_proc.wait()
      frontend_proc.wait()
    else:
      # Si livereload tourne dans un thread, attendre le backend
      backend_proc.wait()
  except KeyboardInterrupt:
    print("Arrêt demandé, fermeture des serveurs...")
    try:
      backend_proc.terminate()
    except Exception:
      pass
    if frontend_proc:
      try:
        frontend_proc.terminate()
      except Exception:
        pass

if __name__ == "__main__":
  main()
