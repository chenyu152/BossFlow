# BossSpider Web Rewrite Workspace

This folder is a standalone copy of the BOSS crawler runtime and Web API scaffold.

It does not import files from the parent project. The copied crawler package lives in `new/crawler`, and role projects live in `new/projects`.

## Run API

```bash
cd new
pip install -r requirements.txt
python -m uvicorn backend.app:app --reload --port 8000
```

Open API docs:

```text
http://127.0.0.1:8000/docs
```

No HTML UI has been implemented yet. The API replaces the old PyQt `GuiBridge` layer so a Figma-designed Web UI can be implemented against stable endpoints.
