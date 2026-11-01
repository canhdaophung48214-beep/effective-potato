# -*- coding: utf-8 -*-
"""生成小程序头像候选方案（144x144，PNG）。

输出：
  assets/icon/icon_a.png  「吃」字，橙底白字
  assets/icon/icon_b.png  碗+筷子，橙底白图形（纯图形，缩放最稳）
  assets/icon/icon_c.png  白底橙色圆环徽章 + 「吃」
  assets/icon/icon_d.png  橙底白「山理」两字
  assets/icon/preview.png 方案总览（含圆形裁切预览）
"""

import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "icon")
os.makedirs(OUT, exist_ok=True)

SZ = 144          # 微信要求 144x144
SS = 8            # 超采样倍数
W = SZ * SS

ORANGE = (255, 122, 69, 255)      # 与 app.json navigationBarBackgroundColor #FF7A45 一致
ORANGE_D = (233, 96, 44, 255)
CREAM = (255, 246, 239, 255)
WHITE = (255, 255, 255, 255)

FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"


def font(size):
    return ImageFont.truetype(FONT_BOLD, int(size))


def new_canvas(bg):
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, W - 1, W - 1], radius=int(W * 0.24), fill=bg)
    return img, d


def text_fit(img, center, text, fill, max_w, max_h):
    """自动缩字号，使文字墨迹恰好落在 max_w x max_h 内并精确居中。"""
    d = ImageDraw.Draw(img)
    lo, hi = 4, int(W * 1.2)
    best = None
    while lo <= hi:
        mid = (lo + hi) // 2
        f = font(mid)
        x0, y0, x1, y1 = d.textbbox((0, 0), text, font=f)
        if (x1 - x0) <= max_w and (y1 - y0) <= max_h:
            best = (f, x0, y0, x1, y1)
            lo = mid + 1
        else:
            hi = mid - 1
    f, x0, y0, x1, y1 = best
    d.text((center[0] - (x0 + x1) / 2, center[1] - (y0 + y1) / 2), text, font=f, fill=fill)


def bowl_and_chopsticks(d, cx, cy, w, color, chop_color=None):
    """碗 + 筷子，w 为碗口宽度（像素），cy 为碗身视觉中心偏上处。"""
    chop_color = chop_color or color
    half = w / 2
    rim_h = w * 0.115
    rim_top = cy - rim_h * 0.5
    body_w, body_h = w, w * 0.52
    # 碗身：下半椭圆
    d.pieslice(
        [cx - body_w / 2, rim_top + rim_h * 0.5 - body_h / 2,
         cx + body_w / 2, rim_top + rim_h * 0.5 + body_h / 2],
        start=0, end=180, fill=color,
    )
    # 碗口
    d.rounded_rectangle(
        [cx - half, rim_top - rim_h * 0.5, cx + half, rim_top + rim_h * 0.5],
        radius=rim_h * 0.5, fill=color,
    )
    # 筷子：两根平行、有清晰间隙，从碗口右侧斜插向上
    lw = max(2, int(w * 0.048))
    r = lw / 2
    dx, dy = 0.34, -1.0                      # 方向（右上）
    norm = (dx * dx + dy * dy) ** 0.5
    ux, uy = dx / norm, dy / norm            # 单位方向
    px, py = -uy, ux                         # 垂直单位向量
    base = (cx + half * 0.22, rim_top + rim_h * 0.15)
    length = w * 0.62
    for off in (-0.042 * w, 0.042 * w):
        sx, sy = base[0] + px * off, base[1] + py * off
        ex, ey = sx + ux * length, sy + uy * length
        d.line([(sx, sy), (ex, ey)], fill=chop_color, width=lw)
        d.ellipse([sx - r, sy - r, sx + r, sy + r], fill=chop_color)
        d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=chop_color)


# ---------------- A：橙底白「吃」 ----------------
def icon_a():
    img, d = new_canvas(ORANGE)
    text_fit(img, (W / 2, W / 2 + W * 0.015), "吃", WHITE, W * 0.60, W * 0.60)
    return img


# ---------------- B：橙底白碗筷（纯图形） ----------------
def icon_b():
    img, d = new_canvas(ORANGE)
    bowl_and_chopsticks(d, W * 0.50, W * 0.60, W * 0.60, WHITE)
    return img


# ---------------- C：白底橙色圆环徽章 + 「吃」 ----------------
def icon_c():
    img, d = new_canvas(CREAM)
    r = W * 0.345
    d.ellipse([W / 2 - r, W / 2 - r, W / 2 + r, W / 2 + r], fill=ORANGE)
    text_fit(img, (W / 2, W / 2 + W * 0.012), "吃", WHITE, r * 1.12, r * 1.12)
    return img


# ---------------- D：橙底白「山理」 ----------------
def icon_d():
    img, d = new_canvas(ORANGE)
    text_fit(img, (W / 2, W / 2 + W * 0.015), "山理", WHITE, W * 0.66, W * 0.34)
    return img


def save(img, name):
    p = os.path.join(OUT, name)
    img.resize((SZ, SZ), Image.LANCZOS).save(p, "PNG", optimize=True)
    return p


def circle_mask(px):
    m = Image.new("L", (px, px), 0)
    ImageDraw.Draw(m).ellipse([0, 0, px - 1, px - 1], fill=255)
    return m


def preview(paths):
    tile = 240
    pad = 44
    label_h = 46
    cols = len(paths)
    pw = pad * 2 + cols * tile + (cols - 1) * 28
    ph = pad + tile + label_h + 34 + tile + pad
    board = Image.new("RGBA", (pw, ph), (247, 248, 250, 255))
    d = ImageDraw.Draw(board)
    f_lbl = font(26)
    f_small = font(20)
    names = ["A 吃（橙底白字）", "B 碗筷（图形）", "C 徽章（白底橙圆）", "D 山理（双字）"]
    x = pad
    for i, p in enumerate(paths):
        im = Image.open(p).convert("RGBA").resize((tile, tile), Image.LANCZOS)
        board.alpha_composite(im, (x, pad))
        # 圆形裁切预览
        cir = Image.new("RGBA", (tile, tile), (0, 0, 0, 0))
        cir.paste(im, (0, 0), circle_mask(tile))
        board.alpha_composite(cir, (x, pad + tile + label_h))
        d.text((x, pad + tile + 10), names[i], font=f_lbl, fill=(40, 44, 52, 255))
        d.text((x, pad + tile + label_h + tile + 8), "圆形裁切预览", font=f_small,
               fill=(140, 146, 156, 255))
        x += tile + 28
    out = os.path.join(OUT, "preview.png")
    board.convert("RGB").save(out, "PNG")
    return out


if __name__ == "__main__":
    ps = [save(icon_a(), "icon_a.png"),
          save(icon_b(), "icon_b.png"),
          save(icon_c(), "icon_c.png"),
          save(icon_d(), "icon_d.png")]
    print("\n".join(ps))
    print(preview(ps))
