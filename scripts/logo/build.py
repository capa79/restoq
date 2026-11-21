import math, os, subprocess
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

INK, RED, WHITE, PAPER = '#141A18', '#D2372B', '#FFFFFF', '#F3F2EF'
OUT = '/tmp/logo/pakke'

# ---------- merket (64 x 64) ----------
def mark(fg, accent=RED):
    cx, cy, r, sw = 32, 32, 21, 5.6
    a0, a1 = math.radians(-52), math.radians(18)   # åpning øverst til høyre
    sx, sy = cx + r*math.cos(a0), cy + r*math.sin(a0)
    ex, ey = cx + r*math.cos(a1), cy + r*math.sin(a1)
    arc = f'<path d="M{ex:.2f} {ey:.2f}A{r} {r} 0 1 1 {sx:.2f} {sy:.2f}" fill="none" stroke="{fg}" stroke-width="{sw}" stroke-linecap="round"/>'
    # pilspiss ved åpningen, i retning med klokka (tangent)
    tx, ty = -math.sin(a0), math.cos(a0)
    nx, ny = -ty, tx
    L, W = 9.5, 6.4
    tip = (sx + tx*L*0.62, sy + ty*L*0.62)
    b1 = (sx - tx*L*0.38 + nx*W, sy - ty*L*0.38 + ny*W)
    b2 = (sx - tx*L*0.38 - nx*W, sy - ty*L*0.38 - ny*W)
    head = f'<path d="M{tip[0]:.2f} {tip[1]:.2f}L{b1[0]:.2f} {b1[1]:.2f}L{b2[0]:.2f} {b2[1]:.2f}Z" fill="{fg}" stroke="{fg}" stroke-width="1.6" stroke-linejoin="round"/>'
    bw, base = 5.6, 42
    bars = ''.join(f'<rect x="{x}" y="{base-h}" width="{bw}" height="{h}" rx="1.6" fill="{c}"/>' for x, h, c in [(21.6, 8, fg), (29.2, 14, fg), (36.8, 20, accent)])
    return arc + head + bars

def mark_small(fg, accent=RED):
    cx, cy, r, sw = 32, 32, 20, 8
    a0, a1 = math.radians(-55), math.radians(20)
    sx, sy = cx + r*math.cos(a0), cy + r*math.sin(a0); ex, ey = cx + r*math.cos(a1), cy + r*math.sin(a1)
    arc = f'<path d="M{ex:.2f} {ey:.2f}A{r} {r} 0 1 1 {sx:.2f} {sy:.2f}" fill="none" stroke="{fg}" stroke-width="{sw}" stroke-linecap="round"/>'
    tx, ty = -math.sin(a0), math.cos(a0); nx, ny = -ty, tx; L, W = 12, 8.5
    tip = (sx + tx*L*0.6, sy + ty*L*0.6); b1 = (sx - tx*L*0.4 + nx*W, sy - ty*L*0.4 + ny*W); b2 = (sx - tx*L*0.4 - nx*W, sy - ty*L*0.4 - ny*W)
    head = f'<path d="M{tip[0]:.2f} {tip[1]:.2f}L{b1[0]:.2f} {b1[1]:.2f}L{b2[0]:.2f} {b2[1]:.2f}Z" fill="{fg}" stroke="{fg}" stroke-width="2" stroke-linejoin="round"/>'
    bars = f'<rect x="23" y="31" width="8" height="12" rx="2" fill="{fg}"/><rect x="34" y="22" width="8" height="21" rx="2" fill="{accent}"/>'
    return arc + head + bars

# ---------- ordmerket som kurver ----------
font = TTFont('/tmp/logo/archivo-800.ttf'); gs = font.getGlyphSet(); cmap = font.getBestCmap(); hmtx = font['hmtx']
def wordmark(text='restoq', size=100, track=-0.025):
    upm = font['head'].unitsPerEm; s = size / upm; x = 0; pen = SVGPathPen(gs)
    for ch in text:
        g = cmap[ord(ch)]; tp = TransformPen(pen, (s, 0, 0, -s, x, 0)); gs[g].draw(tp); x += hmtx[g][0]*s + track*size
    width = x - track*size
    bp = BoundsPen(gs); xx = 0
    for ch in text:
        g = cmap[ord(ch)]; t2 = TransformPen(bp, (s, 0, 0, -s, xx, 0)); gs[g].draw(t2); xx += hmtx[g][0]*s + track*size
    return pen.getCommands(), width, bp.bounds  # bounds: xmin, ymin, xmax, ymax (y ned)

wm_d, wm_w, (bx0, by0, bx1, by1) = wordmark(size=88, track=-0.02)
xh_top = by0  # topp (med «t»), bunn = by1 (q-halen)

def svg(w, h, body, bg=None):
    bgr = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" width="{w:.0f}" height="{h:.0f}">{bgr}{body}</svg>\n'

files = {}
# Ikon (app-ikon): mørk rute med hvitt merke
files['restoq-ikon'] = svg(512, 512, f'<rect width="512" height="512" rx="112" fill="{INK}"/><g transform="translate(64 64) scale(6)">{mark(WHITE)}</g>')
files['restoq-ikon-lys'] = svg(512, 512, f'<rect width="512" height="512" rx="112" fill="{PAPER}"/><g transform="translate(64 64) scale(6)">{mark(INK)}</g>')
# Merke alene
files['restoq-merke'] = svg(64, 64, mark(INK))
files['restoq-ikon-liten'] = svg(64, 64, f'<rect width="64" height="64" rx="14" fill="{INK}"/><g transform="translate(4 4) scale(0.875)">{mark_small(WHITE)}</g>')
files['restoq-merke-hvit'] = svg(64, 64, mark(WHITE))
# Liggende logo: merke + ordmerke. Merket er like høyt som ordmerkets x-høyde + stigning.
def lockup(fg, bg=None):
    mh = 120; scale = mh/64; pad = 40
    text_h = by1 - by0; ty = pad + mh/2 - (by0 + text_h/2) + 2
    tx = pad + mh + 20
    w = tx + wm_w + pad; h = mh + pad*2
    body = f'<g transform="translate({pad} {pad}) scale({scale})">{mark(fg)}</g><path transform="translate({tx:.1f} {ty:.1f})" d="{wm_d}" fill="{fg}"/>'
    return svg(w, h, body, bg)
files['restoq-logo'] = lockup(INK)
files['restoq-logo-hvit'] = lockup(WHITE)
# Stående logo
def stacked(fg, bg=None):
    mh = 160; scale = mh/64; pad = 40; text_h = by1 - by0
    w = max(mh, wm_w) + pad*2; h = pad + mh + 18 + text_h + pad
    mx = (w - mh)/2; tx = (w - wm_w)/2; ty = pad + mh + 18 - by0
    body = f'<g transform="translate({mx:.1f} {pad}) scale({scale})">{mark(fg)}</g><path transform="translate({tx:.1f} {ty:.1f})" d="{wm_d}" fill="{fg}"/>'
    return svg(w, h, body, bg)
files['restoq-logo-staende'] = stacked(INK)
files['restoq-logo-staende-hvit'] = stacked(WHITE)

os.makedirs(f'{OUT}/vektor-svg', exist_ok=True); os.makedirs(f'{OUT}/vektor-pdf', exist_ok=True); os.makedirs(f'{OUT}/png', exist_ok=True); os.makedirs(f'{OUT}/jpg', exist_ok=True)
for n, s in files.items():
    open(f'{OUT}/vektor-svg/{n}.svg', 'w').write(s)
    subprocess.run(['rsvg-convert', '-f', 'pdf', '-o', f'{OUT}/vektor-pdf/{n}.pdf', f'{OUT}/vektor-svg/{n}.svg'], check=True)
print('ordmerke bredde', round(wm_w), 'bounds', round(by0), round(by1))
