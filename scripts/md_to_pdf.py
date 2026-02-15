#!/usr/bin/env python3
from pathlib import Path
import textwrap

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


def md_to_text(md: str) -> list[str]:
    lines = md.splitlines()
    out: list[str] = []
    in_code = False
    for raw in lines:
        line = raw.rstrip("\n")
        if line.strip().startswith("```"):
            in_code = not in_code
            out.append("")
            continue
        if in_code:
            out.append("    " + line)
            continue
        if line.startswith("# "):
            out.append(line[2:].strip())
            out.append("=" * max(8, len(line[2:].strip())))
            out.append("")
            continue
        if line.startswith("## "):
            out.append(line[3:].strip())
            out.append("-" * max(6, len(line[3:].strip())))
            out.append("")
            continue
        if line.startswith("### "):
            out.append(line[4:].strip())
            out.append("")
            continue
        if line.startswith("- "):
            out.append("* " + line[2:])
            continue
        out.append(line)
    return out


def render_text_to_pdf(lines: list[str], output_path: Path) -> None:
    page_w, page_h = A4
    margin = 48
    line_height = 14
    max_chars = 100

    c = canvas.Canvas(str(output_path), pagesize=A4)
    c.setTitle(output_path.stem)
    c.setFont("Helvetica", 11)

    y = page_h - margin
    for line in lines:
        wrapped = textwrap.wrap(line, width=max_chars) if line else [""]
        for segment in wrapped:
            if y <= margin:
                c.showPage()
                c.setFont("Helvetica", 11)
                y = page_h - margin
            c.drawString(margin, y, segment)
            y -= line_height
    c.save()


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    docs_dir = root / "docs"
    pdf_dir = root / "pdf"
    pdf_dir.mkdir(parents=True, exist_ok=True)

    for md_path in sorted(docs_dir.glob("*.md")):
        md_content = md_path.read_text(encoding="utf-8")
        lines = md_to_text(md_content)
        pdf_path = pdf_dir / f"{md_path.stem}.pdf"
        render_text_to_pdf(lines, pdf_path)


if __name__ == "__main__":
    main()
