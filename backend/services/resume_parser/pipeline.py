"""PDF 简历解析主流程：PDF → 图片 → OCR → LLM → cv.md"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

from rapidocr_onnxruntime import RapidOCR

from .llm_extract import extract_resume
from .pdf_to_images import pdf_to_images
from .to_cv import to_cv_markdown


def run_pipeline(
    pdf_path: str,
    output_dir: str = "output",
    dpi: int = 200,
    save_images: bool = True,
    save_json: bool = True,
) -> str:
    """
    完整解析流程。

    Returns:
        生成的 cv.md 内容字符串
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    pdf_name = Path(pdf_path).stem

    # ── Step 1: PDF → Images ──
    print(f"[1/4] PDF → 图片 (DPI={dpi}) ...")
    image_dir = out / "images" if save_images else out
    images = pdf_to_images(pdf_path, str(image_dir), dpi=dpi)
    print(f"  生成 {len(images)} 页: {', '.join(images)}")

    # ── Step 2: OCR ──
    print("[2/4] RapidOCR v6 (ONNX) 识别中 ...")
    models_dir = Path(__file__).parent / "models"
    ocr = RapidOCR(
        det_model_path=str(models_dir / "v6_det.onnx"),
        rec_model_path=str(models_dir / "v6_rec.onnx"),
        rec_keys_path=str(models_dir / "v6_charset.txt"),
        use_cls=False,
    )

    all_lines: list[str] = []
    for img_path in images:
        result, _ = ocr(img_path)
        page_lines: list[str] = []
        if result:
            for box, text, score in result:
                text = text.strip()
                if text:
                    page_lines.append(text)

        page_text = "\n".join(page_lines)
        all_lines.append(f"--- 第 {len(all_lines) + 1} 页 ---\n{page_text}")
        print(f"  {img_path}: {len(page_lines)} 行文本")

    ocr_text = "\n\n".join(all_lines)
    print(f"  共识别 {len(ocr_text)} 字符")

    if not ocr_text.strip():
        print("[!] OCR 未识别到任何文本，请检查 PDF 是否清晰或包含文字。")
        sys.exit(1)

    # ── Step 3: LLM 提取 ──
    print("[3/4] LLM 结构化提取 ...")
    resume = extract_resume(ocr_text)
    print(f"  姓名: {resume.candidate.name or '(未识别)'}")
    print(f"  工作经历: {len(resume.work_experience)} 段")
    print(f"  项目经历: {len(resume.projects)} 个")
    print(f"  技能: {len(resume.languages + resume.frameworks + resume.databases + resume.ai_llm + resume.tools + resume.skills)} 项")

    # ── Step 4: 生成 cv.md ──
    print("[4/4] 生成 cv.md ...")
    cv_content = to_cv_markdown(resume)
    cv_path = out / f"{pdf_name}_cv.md"
    cv_path.write_text(cv_content, encoding="utf-8")
    print(f"  → {cv_path}")

    # 可选：保存 JSON
    if save_json:
        json_path = out / f"{pdf_name}_resume.json"
        json_path.write_text(
            resume.model_dump_json(indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"  → {json_path}")

    # 可选：保存 OCR 原文
    ocr_path = out / f"{pdf_name}_ocr.txt"
    ocr_path.write_text(ocr_text, encoding="utf-8")
    print(f"  → {ocr_path}")

    print("\n✅ 完成!")
    return cv_content


def main():
    parser = argparse.ArgumentParser(description="PDF 简历解析 → cv.md")
    parser.add_argument("pdf", help="PDF 简历文件路径")
    parser.add_argument("-o", "--output", default="output", help="输出目录 (默认 output)")
    parser.add_argument("--dpi", type=int, default=200, help="图片 DPI (默认 200)")
    parser.add_argument("--no-images", action="store_true", help="不保存切图")
    parser.add_argument("--no-json", action="store_true", help="不保存 JSON")
    args = parser.parse_args()

    if not os.path.exists(args.pdf):
        print(f"[!] 文件不存在: {args.pdf}")
        sys.exit(1)

    run_pipeline(
        args.pdf,
        output_dir=args.output,
        dpi=args.dpi,
        save_images=not args.no_images,
        save_json=not args.no_json,
    )


if __name__ == "__main__":
    main()
