"""Regenera el PDF de dos páginas desde su fuente HTML (herramienta opcional)."""

import os
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    root = Path(__file__).resolve().parent.parent
    source = root / "docs" / "informe.html"
    destination = root / "docs" / "Trujillo_Wilmer_AplWeb_U2.pdf"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
            args=["--no-sandbox"],
        )
        try:
            page = browser.new_page()
            # El HTML es autónomo; no requiere acceso file:// desde Chromium.
            page.set_content(source.read_text(encoding="utf-8"), wait_until="load")
            page.pdf(
                path=str(destination),
                print_background=True,
                prefer_css_page_size=True,
                display_header_footer=False,
            )
        finally:
            browser.close()
    print(f"PDF generado: {destination}")


if __name__ == "__main__":
    main()
