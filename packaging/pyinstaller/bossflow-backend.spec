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
# BossFlow passes its own bundled v6 model paths to RapidOCR, so packaging the
# library's default model set would duplicate roughly 30 MB of model files.
rapidocr_datas = collect_data_files(
    "rapidocr",
    excludes=["models/*", "models/**/*"],
)
# RapidOCR still initializes the lightweight angle-classifier even when
# individual recognition calls disable classification. Keep this single
# model in the bundle so first-run PDF parsing remains fully offline.
rapidocr_datas += collect_data_files(
    "rapidocr",
    includes=["models/ch_ppocr_mobile_v2.0_cls_mobile.onnx"],
)
# RapidOCR supports several interchangeable inference engines. BossFlow uses
# the ONNX runtime, so pulling Paddle/PyTorch/TensorRT modules from a developer
# environment only bloats (and can break) the sidecar analysis.
rapidocr_optional_engines = (
    "rapidocr.inference_engine.paddle",
    "rapidocr.inference_engine.pytorch",
    "rapidocr.inference_engine.tensorrt",
    "rapidocr.inference_engine.openvino",
    "rapidocr.inference_engine.mnn",
)
rapidocr_hiddenimports = collect_submodules(
    "rapidocr",
    filter=lambda module: not module.startswith(rapidocr_optional_engines),
)

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
        "notebook", "pytest", "sphinx", "tkinter", "torch", "torchvision",
        "torchaudio", "paddle", "tensorrt", "openvino", "MNN",
        "tensorflow", "pandas", "scipy", "dask", "distributed", "numba",
        "llvmlite", "pyarrow",
    ],
    noarchive=False,
)
# OpenCV's video codec bridge is not used by the PNG-only resume OCR path.
# Excluding it saves roughly 30 MB without affecting image decoding.
a.binaries = [
    entry for entry in a.binaries
    if not any("opencv_videoio_ffmpeg" in str(part).lower() for part in entry[:2])
]
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    name="BossFlowBackend",
    console=False,
    # Keep large runtime libraries next to the executable.  Embedding them in
    # the bootloader turns this into a one-file application that extracts on
    # every launch; Paddle's OCR runtime can then exceed Electron's startup
    # timeout.  The COLLECT step below produces the intended one-directory
    # sidecar instead.
    exclude_binaries=True,
    disable_windowed_traceback=False,
)
coll = COLLECT(exe, a.binaries, a.zipfiles, a.datas, name="BossFlowBackend")
