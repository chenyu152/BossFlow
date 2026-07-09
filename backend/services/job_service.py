import io
import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, List

from fastapi import HTTPException
from fastapi.responses import Response

from backend.services.score_store import apply_scores_to_jobs


def query_jobs(project_dir: Path, search: str = "", limit: int = 500, offset: int = 0) -> Dict[str, Any]:
    db_path = project_dir / "jobs_data.db"
    if not db_path.exists() or db_path.stat().st_size == 0:
        return {"items": [], "total": 0}
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        where = ""
        params: List[Any] = []
        if search:
            where = "WHERE title LIKE ? OR company LIKE ? OR desc LIKE ?"
            like = f"%{search}%"
            params.extend([like, like, like])
        total = conn.execute(f"SELECT COUNT(*) FROM jobs {where}", params).fetchone()[0]
        rows = conn.execute(
            f"""
            SELECT * FROM jobs {where}
            ORDER BY avg DESC, last_seen DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
    finally:
        conn.close()

    items = []
    for row in rows:
        try:
            cats = json.loads(row["cats_json"] or "[]")
        except Exception:
            cats = []
        item = {
            "id": row["id"],
            "title": row["title"] or "",
            "company": row["company"] or "",
            "city": row["city"] or "",
            "salary": row["salary"] or "",
            "avg": float(row["avg"] or 0),
            "tier": row["tier"] or "",
            "exp": row["exp"] or "",
            "edu": row["edu"] or "",
            "cats": cats,
            "desc": row["desc"] or "",
            "url": row["url"] or "",
            "lastSeen": row["last_seen"] or "",
        }
        keys = set(row.keys())
        if "live_status" in keys:
            item.update(
                {
                    "liveStatus": row["live_status"] or "",
                    "liveStatusRaw": row["live_status_raw"] or "",
                    "liveCheckedAt": row["live_checked_at"] or "",
                    "liveClosedAt": row["live_closed_at"] or "",
                    "liveCheckError": row["live_check_error"] or "",
                }
            )
        items.append(item)
    return {"items": apply_scores_to_jobs(project_dir.name, items), "total": int(total)}


def get_jobs_by_ids(project_dir: Path, job_ids: list[int]) -> list[dict[str, Any]]:
    ids = [int(job_id) for job_id in job_ids if int(job_id) > 0]
    if not ids:
        return []
    db_path = project_dir / "jobs_data.db"
    if not db_path.exists() or db_path.stat().st_size == 0:
        return []

    placeholders = ",".join("?" for _ in ids)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            f"SELECT * FROM jobs WHERE id IN ({placeholders}) ORDER BY avg DESC, last_seen DESC, id DESC",
            ids,
        ).fetchall()
    finally:
        conn.close()

    items: list[dict[str, Any]] = []
    for row in rows:
        try:
            cats = json.loads(row["cats_json"] or "[]")
        except Exception:
            cats = []
        item = {
            "id": row["id"],
            "title": row["title"] or "",
            "company": row["company"] or "",
            "city": row["city"] or "",
            "salary": row["salary"] or "",
            "avg": float(row["avg"] or 0),
            "tier": row["tier"] or "",
            "exp": row["exp"] or "",
            "edu": row["edu"] or "",
            "cats": cats,
            "desc": row["desc"] or "",
            "url": row["url"] or "",
            "lastSeen": row["last_seen"] or "",
        }
        keys = set(row.keys())
        if "live_status" in keys:
            item.update(
                {
                    "liveStatus": row["live_status"] or "",
                    "liveStatusRaw": row["live_status_raw"] or "",
                    "liveCheckedAt": row["live_checked_at"] or "",
                    "liveClosedAt": row["live_closed_at"] or "",
                    "liveCheckError": row["live_check_error"] or "",
                }
            )
        items.append(item)
    return apply_scores_to_jobs(project_dir.name, items)


def get_job_by_id(project_dir: Path, job_id: int) -> dict[str, Any]:
    jobs = get_jobs_by_ids(project_dir, [job_id])
    if not jobs:
        raise HTTPException(status_code=404, detail=f"Job not found: {project_dir.name}#{job_id}")
    return jobs[0]


def export_jobs_response(rows: list[dict[str, Any]]) -> Response:
    if not rows:
        raise HTTPException(status_code=404, detail="当前筛选条件下没有可导出的数据")
    try:
        import openpyxl
        from openpyxl.styles import Alignment, Font, PatternFill
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="Missing dependency: openpyxl") from exc

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "岗位数据"
    headers = ["岗位名称", "公司名称", "城市", "薪资", "平均薪资(K)", "经验", "学历", "分类", "最后活跃", "详情链接"]
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(name="Microsoft YaHei", size=11, bold=True, color="FFFFFF")
        cell.fill = PatternFill(start_color="0067c0", end_color="0067c0", fill_type="solid")
        cell.alignment = Alignment(horizontal="center", vertical="center")
    for row in rows:
        ws.append(
            [
                row["title"],
                row["company"],
                row["city"],
                row["salary"],
                row["avg"],
                row["exp"],
                row["edu"],
                ", ".join(row["cats"]),
                row["lastSeen"],
                row["url"],
            ]
        )
    for col in ws.columns:
        width = max(len(str(cell.value or "")) for cell in col) + 3
        ws.column_dimensions[col[0].column_letter].width = max(10, min(width, 42))
    out = io.BytesIO()
    wb.save(out)
    return Response(
        out.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="boss_jobs_export.xlsx"'},
    )
