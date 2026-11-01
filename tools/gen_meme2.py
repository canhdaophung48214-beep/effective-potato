# -*- coding: utf-8 -*-
"""梗图合成：Will Smith 展示 + 真实小程序截图。

用法:
    python tools/gen_meme2.py wills
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'assets', 'poster', 'src')
OUT = os.path.join(ROOT, 'assets', 'poster')

BRAND_BG = (217, 65, 43)      # 小程序导航栏红 #D9412B
INK = (26, 22, 20)
LINE = (226, 220, 212)
FONT_BOLD = r'C:\Windows\Fonts\msyhbd.ttc'
FONT = r'C:\Windows\Fonts\msyh.ttc'


def font(size, bold=True):
    return ImageFont.truetype(FONT_BOLD if bold else FONT, size)


def text_w(draw, s, f):
    box = draw.textbbox((0, 0), s, font=f)
    return box[2] - box[0]


def center_text(draw, cx, y, s, f, fill):
    draw.text((cx - text_w(draw, s, f) / 2, y), s, font=f, fill=fill)


def rounded_mask(size, radius):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius, fill=255)
    return m


def brand_bar(canvas, y, height, main, sub=None):
    draw = ImageDraw.Draw(canvas)
    draw.rectangle([0, y, canvas.width, y + height], fill=BRAND_BG)
    f_main = font(int(height * 0.34))
    if sub:
        f_sub = font(int(height * 0.18), False)
        gap = 8
        total = f_main.size + gap + f_sub.size
        top = y + (height - total) / 2 - 2
        center_text(draw, canvas.width / 2, top, main, f_main, (255, 255, 255))
        center_text(draw, canvas.width / 2, top + f_main.size + gap, sub, f_sub, (255, 214, 204))
    else:
        center_text(draw, canvas.width / 2, y + (height - f_main.size) / 2 - 6, main, f_main, (255, 255, 255))


def make_wills():
    W, H = 1080, 1214
    BAR_H = 104
    IMG_H = H - BAR_H
    canvas = Image.new('RGB', (W, H), (255, 255, 255))
    draw = ImageDraw.Draw(canvas)

    # 1) 人物：白底素材，直接贴在纯白画布上，无接缝
    man = Image.open(os.path.join(SRC, 'willsmith.jpg')).convert('RGB')
    mw = 740
    man = man.resize((mw, int(man.height * mw / man.width)), Image.LANCZOS)
    mx, my = -6, int((IMG_H - man.height) / 2) + 8
    canvas.paste(man, (mx, my))

    # 2) 手机卡：真实截图 + 圆角 + 描边 + 投影
    shot = Image.open(os.path.join(SRC, 'shot_home.jpg')).convert('RGB')
    sw = 376
    sh = int(shot.height * sw / shot.width)
    shot = shot.resize((sw, sh), Image.LANCZOS)
    sx = W - sw - 64
    sy = int((IMG_H - sh) / 2)

    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [sx + 6, sy + 16, sx + sw + 6, sy + sh + 16], 28, fill=(40, 30, 25, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(15))
    canvas.paste(shadow, (0, 0), shadow)

    mask = rounded_mask(shot.size, 28)
    canvas.paste(shot, (sx, sy), mask)
    draw.rounded_rectangle([sx, sy, sx + sw, sy + sh], 28, outline=LINE, width=2)

    # 3) 底部品牌条
    brand_bar(canvas, IMG_H, BAR_H, '微信搜索「食神寻味」', '校园美食 · 随机抽签')

    path = os.path.join(OUT, 'meme_wills.png')
    canvas.save(path, optimize=True)
    print('生成:', os.path.relpath(path, ROOT), canvas.size)


if __name__ == '__main__':
    job = sys.argv[1] if len(sys.argv) > 1 else 'wills'
    {'wills': make_wills}[job]()
