# -*- coding: utf-8 -*-
"""
梗图宣传图生成器（土味/表情包风格，用于校园论坛与群传播）。

用法：
    python tools/gen_meme.py            # 生成全部模板
    python tools/gen_meme.py sponge     # 只生成海绵宝宝模板

产物在 assets/poster/ 下：
    meme_sponge.png

设计纪律：
    - 不改动原始素材，只在副本上叠字。
    - 底部品牌条只写「微信搜索」，不写扫码（未发布时扫不到）。
    - 不宣称「吃过 / 试过 / 收录」，只描述功能。
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "poster", "src")
OUT = os.path.join(ROOT, "assets", "poster")

ORANGE = (255, 122, 69)
INK = (28, 22, 18)
WHITE = (255, 255, 255)
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_REG = r"C:\Windows\Fonts\msyh.ttc"

BRAND = "微信搜索「山理吃什么」"
SUB = "演示数据，真实菜单还在录"


def font(size, bold=True):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


def center_text(draw, cx, y, text, f, fill):
    box = draw.textbbox((0, 0), text, font=f)
    draw.text((cx - (box[2] - box[0]) / 2 - box[0], y), text, font=f, fill=fill)


def brand_bar(canvas, draw, w, y0, hgt, main=40, sub=22):
    """底部品牌条：橙底，两行白字。"""
    draw.rectangle((0, y0, w, y0 + hgt), fill=ORANGE)
    rows = [(main, BRAND, 0.30), (sub, SUB, 0.72)]
    for size, text, pos in rows:
        f = font(size, bold=(size == main))
        box = draw.textbbox((0, 0), text, font=f)
        tw = box[2] - box[0]
        draw.text(
            ((w - tw) / 2 - box[0], y0 + hgt * pos - (box[3] - box[1]) / 2),
            text,
            font=f,
            fill=WHITE if size == main else (255, 226, 212),
        )


def make_sponge():
    """海绵宝宝躺地板 + 白框：白框里写「今天吃什么？」。"""
    im = Image.open(os.path.join(SRC, "meme_sponge.jpg")).convert("RGB")
    w0, h0 = im.size
    w = 1080
    h = int(h0 * w / w0)
    im = im.resize((w, h), Image.LANCZOS)

    scale = w / w0
    # 探测得到的白框原始范围
    px0, py0, px1, py1 = 446, 30, 679, 323
    box = (int(px0 * scale), int(py0 * scale), int(px1 * scale), int(py1 * scale))
    bw, bh = box[2] - box[0], box[3] - box[1]
    cx = (box[0] + box[2]) / 2

    canvas = Image.new("RGB", (w, h + 124), (240, 240, 240))
    canvas.paste(im, (0, 0))
    draw = ImageDraw.Draw(canvas)

    f_q = font(int(bw * 0.19))
    lines = ["今天", "吃什么？"]
    lh = int(f_q.size * 1.26)
    total = lh * len(lines)
    y = box[1] + (bh - total) / 2 + 12
    for line in lines:
        center_text(draw, cx - 16, y, line, f_q, INK)
        y += lh

    brand_bar(canvas, draw, w, h, 124)
    out = os.path.join(OUT, "meme_sponge.png")
    canvas.save(out, quality=95)
    return out


BUILDERS = {"sponge": make_sponge}


def main():
    which = sys.argv[1:] or list(BUILDERS)
    for name in which:
        if name not in BUILDERS:
            print("未知模板:", name, "可选:", ", ".join(BUILDERS))
            continue
        p = BUILDERS[name]()
        print("生成:", os.path.relpath(p, ROOT), os.path.getsize(p), "bytes")


if __name__ == "__main__":
    main()
