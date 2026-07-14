# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller definition for the Electron-managed FastAPI sidecar."""

import os
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules


ROOT = Path(os.environ.get("BOSSFLOW_SOURCE_DIR", Path.cwd())).resolve()

# DrissionPage imports several CDP implementation modules lazily.  Include its
# own submodules and data files, but do not use ``collect_all``: that follows
# optional packages from a developer's environment (notably Anaconda's NumPy,
# MKL, IPython and Qt stacks) and can inflate the installer by hundreds of MB.
drission_datas = collect_data_files("DrissionPage")
drission_hiddenimports = collect_submodules("DrissionPage")
rapidocr_datas = collect_data_files("rapidocr")
rapidocr_hiddenimports = collect_submodules("rapidocr")

a = Analysis(
    [str(ROOT / "backend" / "desktop_entry.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=drission_datas + rapidocr_datas + [
        (str(ROOT / "cv.example.md"), "."),
        (str(ROOT / "crawler" / "config"), "crawler/config"),
        (str(ROOT / "backend" / "services" / "resume_parser" / "models"), "backend/services/resume_parser/models"),
    ],
    hiddenimports=drission_hiddenimports + rapidocr_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # BossFlow uses DrissionPage's Chromium/CDP mode; GUI and notebook stacks
    # are not runtime dependencies of the desktop sidecar.
    excludes=[
        "IPython", "PyQt5", "PyQt6", "PySide2", "PySide6", "matplotlib",
        "notebook", "pytest", "sphinx", "tkinter",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="BossFlowBackend",
    console=False,
    disable_windowed_traceback=False,
)
coll = COLLECT(exe, a.binaries, a.zipfiles, a.datas, name="BossFlowBackend")
