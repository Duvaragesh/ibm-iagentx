"""
make_gifs.py — Capture each iAgentX demo slide as a looping animated GIF.
Usage: python make_gifs.py
Output: demo/gifs/slide_<N>.gif
"""

import asyncio, os, sys
from pathlib import Path
from PIL import Image
import io

try:
    from playwright.async_api import async_playwright
except ImportError:
    print("Installing playwright...")
    os.system(f"{sys.executable} -m pip install playwright")
    os.system(f"{sys.executable} -m playwright install chromium")
    from playwright.async_api import async_playwright

HTML_PATH = Path(__file__).parent / "iagentx4i-demo.html"
OUT_DIR   = Path(__file__).parent / "gifs"
OUT_DIR.mkdir(exist_ok=True)

# DOM index (0=blank, 1=hook, 2=slide-1 title, ... 13=slide-12 get-started)
# (dom_idx, label, anim_ms, fps, n_frames, cap_height)
# cap_height: viewport height used during capture; result is always resized to WIDTH x HEIGHT
SLIDES = [
    (1,  "00_hook",          4500, 6, 28,  720),
    (2,  "01_title",         3500, 6, 22,  720),
    (3,  "02_challenge",     3500, 6, 22,  720),
    (4,  "03_market_gap",    4000, 6, 25,  720),
    (5,  "04_introducing",   3500, 6, 22,  720),
    (6,  "05_architecture",  4000, 6, 25,  720),
    (7,  "06_security",      4000, 6, 25,  720),
    (8,  "07_tools",         3500, 6, 22,  720),
    (9,  "08_demo1_msgw",    3500, 6, 22,  720),
    (10, "09_demo2_rowcount",3500, 6, 22,  720),
    (11, "10_demo3_fk",      3500, 6, 22,  1040),
    (12, "11_impact",        3500, 6, 22,  720),
    (13, "12_get_started",   4000, 6, 25,  720),
]

WIDTH, HEIGHT = 1280, 720


async def capture_slide(page, slide_idx: int, label: str,
                        anim_ms: int, fps: int, n_frames: int,
                        cap_height: int = 720) -> list[Image.Image]:
    """Navigate to a slide and capture n_frames screenshots across anim_ms.
    cap_height lets tall slides render at a larger viewport; frames are
    always resized to WIDTH x HEIGHT in the output GIF."""
    # Resize viewport for this slide
    await page.set_viewport_size({"width": WIDTH, "height": cap_height})
    # Reset any zoom from a previous slide
    await page.evaluate("document.body.style.zoom = '1'")

    total_slides = await page.evaluate("document.querySelectorAll('.slide').length")
    if slide_idx >= total_slides:
        print(f"  SKIP slide index {slide_idx} out of range (total={total_slides})")
        return None

    # Jump directly to the target slide
    await page.evaluate(f"""
        () => {{
            const slides = document.querySelectorAll('.slide');
            slides.forEach(s => {{
                s.classList.remove('active', 'exit-left');
                s.style.transform = '';
                s.style.opacity = '';
                s.style.transition = 'none';
            }});
            const target = slides[{slide_idx}];
            target.querySelectorAll('*').forEach(el => {{
                el.style.animation = 'none';
                el.style.opacity = '';
            }});
            void target.offsetWidth;
            target.querySelectorAll('*').forEach(el => {{
                el.style.animation = '';
            }});
            target.classList.add('active');
        }}
    """)
    # Let first elements appear before recording starts
    await page.wait_for_timeout(200)

    interval = anim_ms / n_frames
    frames: list[Image.Image] = []
    durations: list[int] = []
    frame_ms = int(1000 / fps)

    for i in range(n_frames):
        await asyncio.sleep(interval / 1000)
        png = await page.screenshot(type="png")
        img = Image.open(io.BytesIO(png)).convert("RGBA")
        img = img.resize((WIDTH, HEIGHT), Image.LANCZOS)
        frames.append(img)
        # Hold last frame 2.5 s so viewer can read the content
        durations.append(2500 if i == n_frames - 1 else frame_ms)

    return frames, durations


def frames_to_gif(frames: list[Image.Image], durations: list[int], out_path: Path):
    if not frames:
        return
    palette_frames = []
    for f in frames:
        bg = Image.new("RGB", f.size, (0, 0, 0))
        bg.paste(f, mask=f.split()[3])
        p = bg.quantize(colors=256, method=Image.Quantize.FASTOCTREE)
        palette_frames.append(p)

    palette_frames[0].save(
        out_path,
        save_all=True,
        append_images=palette_frames[1:],
        loop=0,
        duration=durations,
        optimize=True,
    )
    size_kb = out_path.stat().st_size // 1024
    print(f"  OK {out_path.name}  ({len(frames)} frames, {size_kb} KB)")


async def main():
    print(f"Opening: {HTML_PATH.as_uri()}")
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": WIDTH, "height": HEIGHT})
        await page.goto(HTML_PATH.as_uri())
        await page.wait_for_timeout(600)
        # Hide navigation chrome for clean LinkedIn GIFs
        await page.evaluate("""
        () => {
            document.getElementById('nav').style.display = 'none';
            document.getElementById('progress-bar-wrap').style.display = 'none';
            document.getElementById('kb-hint').style.display = 'none';
        }
        """)

        for slide_idx, label, anim_ms, fps, n_frames, cap_height in SLIDES:
            print(f">> Slide {slide_idx}: {label}")
            result = await capture_slide(page, slide_idx, label, anim_ms, fps, n_frames, cap_height)
            if result:
                frames, durations = result
                out_path = OUT_DIR / f"slide_{slide_idx:02d}_{label}.gif"
                frames_to_gif(frames, durations, out_path)

        await browser.close()

    print(f"\nDone - GIFs saved to: {OUT_DIR}")


if __name__ == "__main__":
    asyncio.run(main())
