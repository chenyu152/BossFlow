"""PDF → PNG images using pymupdf."""

import os
from pathlib import Path

import fitz  # pymupdf


def pdf_to_images(pdf_path: str, output_dir: str = ".", dpi: int = 200) -> list[str]:
    """
    将 PDF 每一页转为 PNG 图片。

    Args:
        pdf_path: PDF 文件路径
        output_dir: 图片输出目录（默认当前目录）
        dpi: 输出 DPI（200 足够 OCR）

    Returns:
        生成的图片路径列表（按页码排序）
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    pdf_name = Path(pdf_path).stem
    image_paths: list[str] = []

    doc = fitz.open(pdf_path)
    for page in doc:
        pix = page.get_pixmap(dpi=dpi)
        img_path = str(out / f"{pdf_name}_page_{page.number + 1:02d}.png")
        pix.save(img_path)
        image_paths.append(img_path)

    doc.close()
    return image_paths


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python pdf_to_images.py <pdf_path> [output_dir]")
        sys.exit(1)

    paths = pdf_to_images(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ".")
    for p in paths:
        print(f"  输出: {p}")
    print(f"Done: {len(paths)} pages")
