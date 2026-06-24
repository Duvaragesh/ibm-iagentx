"""Quick test: capture slide 7 (Security) as a single GIF to verify."""
import asyncio, io, os, sys
from pathlib import Path
from PIL import Image

try:
    from playwright.async_api import async_playwright
except ImportError:
    os.system(f"{sys.executable} -m pip install playwright --break-system-packages")
    from playwright.async_api import async_playwright

HTML_PATH = Path(__file__).parent / "iagentx4i-demo.html"
OUT_DIR   = Path(__file__).parent / "gifs"
OUT_DIR.mkdir(exist_ok=True)

WIDTH, HEIGHT = 1280, 720
SLIDE_IDX = 7      # Security slide (0-based in DOM)
ANIM_MS   = 4000
FPS       = 6
N_FRAMES  = 25

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": WIDTH, "height": HEIGHT})
        await page.goto(HTML_PATH.as_uri())
        await page.wait_for_timeout(600)

        # Jump to target slide and reset animations
        await page.evaluate(f"""
        () => {{
            const slides = document.querySelectorAll('.slide');
            slides.forEach(s => {{
                s.classList.remove('active','exit-left');
                s.style.transform = '';
                s.style.opacity = '';
                s.style.transition = 'none';
            }});
            const t = slides[{SLIDE_IDX}];
            // Reset all child animations
            t.querySelectorAll('*').forEach(el => {{
                el.style.animation = 'none';
                el.style.opacity = '';
            }});
            void t.offsetWidth;
            t.querySelectorAll('*').forEach(el => {{ el.style.animation = ''; }});
            t.classList.add('active');
        }}
        """)
        # Small head-start so first frame isn't black
        await page.wait_for_timeout(80)

        interval = ANIM_MS / N_FRAMES
        frames = []
        for i in range(N_FRAMES):
            await asyncio.sleep(interval / 1000)
            png = await page.screenshot(type="png")
            img = Image.open(io.BytesIO(png)).convert("RGBA")
            img = img.resize((WIDTH, HEIGHT), Image.LANCZOS)
            frames.append(img)
            print(f"  frame {i+1}/{N_FRAMES}")

        await browser.close()

    # Convert to GIF
    palette_frames = []
    for f in frames:
        bg = Image.new("RGB", f.size, (0, 0, 0))
        bg.paste(f, mask=f.split()[3])
        p = bg.quantize(colors=256, method=Image.Quantize.FASTOCTREE)
        palette_frames.append(p)

    out = OUT_DIR / "test_slide07_security.gif"
    palette_frames[0].save(
        out, save_all=True, append_images=palette_frames[1:],
        loop=0, duration=int(1000/FPS), optimize=True
    )
    print(f"\n✓ Saved: {out}  ({out.stat().st_size//1024} KB)")

asyncio.run(main())
