# -*- coding: utf-8 -*-
"""
生成「山理吃什么」校园论坛分享海报。

用法：
    python tools/gen_poster.py                    # 生成占位版两张
    python tools/gen_poster.py --mini-qr a.png --group-qr b.png   # 贴真实二维码

产物：
    assets/poster/poster_square.png   1080x1080  论坛发帖主图
    assets/poster/poster_long.png     1080x1620  群介绍 / 朋友圈长图

说明：
    - 只读取 assets/icon/icon_a.png，不改动任何业务文件。
    - 颜色取小程序导航栏同款橙 #FF7A45。
    - 未提供二维码时画虚线占位框，绝不画假码。
"""

import os
import sys
import argparse

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "poster")
ICON_PATH = os.path.join(ROOT, "assets", "icon", "icon_a.png")

# ---- 色板 ----------------------------------------------------------------
BG = (255, 249, 245)          # 暖米白
ORANGE = (255, 122, 69)       # #FF7A45 品牌橙
INK = (43, 33, 25)            # 深墨
MUTED = (138, 122, 110)       # 次要灰
MUTED_LIGHT = (208, 196, 186)
WHITE = (255, 255, 255)

FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_REG = r"C:\Windows\Fonts\msyh.ttc"

# ---- 文案 ----------------------------------------------------------------
NAME = "山理吃什么"
KICKER = "校园美食 · 挑选工具"
HEAD_LINE1 = "今天"
HEAD_LINE2 = "吃什么？"

SELLING_POINTS = [
    ("01", "六家食堂、六家校外店，能同时勾几家"),
    ("02", "每家单独挑楼层档口，互不串条件"),
    ("03", "按预算、口味、主食类型筛，不满意就换"),
    ("04", "每条都标着数据状态：现在全是「演示」"),
]

DISCLAIMER = "演示版：45 道菜、12 家店的名字和价格都是占位，真实菜单还在录入"
CTA = "微信搜索「山理吃什么」"

LONG_KICKER = "进群之后"
LONG_INVITE1 = "你在群里说一句哪家窗口、什么价，"
LONG_INVITE2 = "我录进去，状态从「演示」改成「已核实」。"
LONG_LABEL_MINI = "小程序码"
LONG_LABEL_GROUP = "群二维码"


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


def text_w(draw, text, f):
    box = draw.textbbox((0, 0), text, font=f)
    return box[2] - box[0]


def _rounded_path(box, radius, arc_steps=14):
    """把圆角矩形拆成折线点序列：四段直线 + 四段四分之一圆弧。"""
    import math

    x0, y0, x1, y1 = box
    r = radius
    pts = []

    def arc(cx, cy, a0, a1):
        for i in range(arc_steps + 1):
            a = math.radians(a0 + (a1 - a0) * i / arc_steps)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))

    pts.append((x0 + r, y0))
    pts.append((x1 - r, y0))
    arc(x1 - r, y0 + r, -90, 0)
    pts.append((x1, y1 - r))
    arc(x1 - r, y1 - r, 0, 90)
    pts.append((x0 + r, y1))
    arc(x0 + r, y1 - r, 90, 180)
    pts.append((x0, y0 + r))
    arc(x0 + r, y0 + r, 180, 270)
    return pts


def dashed_round_rect(draw, box, radius=24, color=MUTED_LIGHT, width=3, dash=16, gap=11):
    """沿圆角矩形轮廓按弧长画虚线，段内插值裁剪，避免整段画满。"""
    pts = _rounded_path(box, radius)
    on = True
    remain = float(dash)
    for i in range(len(pts) - 1):
        p0, p1 = pts[i], pts[i + 1]
        seg = ((p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2) ** 0.5
        if seg <= 1e-9:
            continue
        pos = 0.0
        while pos < seg - 1e-9:
            step = min(remain, seg - pos)
            t0, t1 = pos / seg, (pos + step) / seg
            a = (p0[0] + (p1[0] - p0[0]) * t0, p0[1] + (p1[1] - p0[1]) * t0)
            b = (p0[0] + (p1[0] - p0[0]) * t1, p0[1] + (p1[1] - p0[1]) * t1)
            if on:
                draw.line([a, b], fill=color, width=width)
            pos += step
            remain -= step
            if remain <= 1e-9:
                on = not on
                remain = float(dash if on else gap)


def paste_qr(canvas, path, box, radius=20):
    """把二维码图片贴进指定方框，居中不拉伸。"""
    size = box[2] - box[0]
    qr = Image.open(path).convert("RGBA")
    qr.thumbnail((size - 16, size - 16), Image.LANCZOS)
    x = box[0] + (size - qr.width) // 2
    y = box[1] + (size - qr.height) // 2
    canvas.paste(qr, (x, y), qr)


def draw_header(canvas, draw, w, kicker):
    """左上角图标 + 名字，右上角定位语。"""
    icon = Image.open(ICON_PATH).convert("RGBA").resize((104, 104), Image.LANCZOS)
    canvas.paste(icon, (72, 72), icon)

    f_name = font(50, bold=True)
    draw.text((204, 82), NAME, font=f_name, fill=INK)

    f_meta = font(24)
    meta_w = text_w(draw, kicker, f_meta)
    draw.text((w - 72 - meta_w, 106), kicker, font=f_meta, fill=MUTED)


def draw_headline(draw, top):
    f_head = font(124, bold=True)
    draw.text((66, top), HEAD_LINE1, font=f_head, fill=INK)
    draw.text((62, top + 160), HEAD_LINE2, font=f_head, fill=ORANGE)
    # 标题左侧一条橙色短竖条，压住视觉重心，长度与两行标题齐平
    draw.rounded_rectangle((72 - 44, top + 22, 72 - 33, top + 322), radius=5, fill=ORANGE)


def draw_points(draw, top, step=74):
    f_no = font(26, bold=True)
    f_txt = font(35)
    y = top
    for no, txt in SELLING_POINTS:
        draw.text((72, y + 8), no, font=f_no, fill=ORANGE)
        draw.text((140, y), txt, font=f_txt, fill=INK)
        y += step
    return y


def make_square(path, mini_qr=None):
    w = h = 1080
    canvas = Image.new("RGB", (w, h), BG)
    draw = ImageDraw.Draw(canvas)

    draw_header(canvas, draw, w, KICKER)
    draw_headline(draw, 230)
    draw_points(draw, 610)

    f_dis = font(22)
    dis_w = text_w(draw, DISCLAIMER, f_dis)
    draw.text(((w - dis_w) / 2, 908), DISCLAIMER, font=f_dis, fill=MUTED)

    # 底部通栏 CTA
    draw.rectangle((0, 970, w, h), fill=ORANGE)
    f_cta = font(38, bold=True)
    cta_w = text_w(draw, CTA, f_cta)
    draw.text(((w - cta_w) / 2, 1005), CTA, font=f_cta, fill=WHITE)

    canvas.save(path, quality=95)
    return path


def make_long(path, mini_qr=None, group_qr=None):
    w, h = 1080, 1600
    canvas = Image.new("RGB", (w, h), BG)
    draw = ImageDraw.Draw(canvas)

    draw_header(canvas, draw, w, KICKER)
    draw_headline(draw, 226)
    draw_points(draw, 588)

    f_dis = font(22)
    dis_w = text_w(draw, DISCLAIMER, f_dis)
    draw.text(((w - dis_w) / 2, 886), DISCLAIMER, font=f_dis, fill=MUTED)

    # 分隔线
    draw.rectangle((72, 928, w - 72, 931), fill=(240, 226, 216))

    f_kick = font(26, bold=True)
    draw.text((72, 956), LONG_KICKER, font=f_kick, fill=ORANGE)

    f_inv = font(40, bold=True)
    draw.text((72, 1002), LONG_INVITE1, font=f_inv, fill=INK)
    draw.text((72, 1060), LONG_INVITE2, font=f_inv, fill=INK)

    # 两个二维码位
    box_size = 272
    y0 = 1168
    boxes = [(128, y0, 128 + box_size, y0 + box_size), (680, y0, 680 + box_size, y0 + box_size)]
    for box, qr, label in (
        (boxes[0], mini_qr, LONG_LABEL_MINI),
        (boxes[1], group_qr, LONG_LABEL_GROUP),
    ):
        draw.rounded_rectangle(box, radius=20, fill=WHITE)
        if qr:
            paste_qr(canvas, qr, box)
        else:
            dashed_round_rect(draw, box, radius=20, color=(226, 198, 184), width=3)
        f_lb = font(24)
        lb_w = text_w(draw, label, f_lb)
        draw.text((box[0] + (box_size - lb_w) / 2, y0 + box_size + 22), label, font=f_lb, fill=MUTED)

    f_tip = font(22)
    tip = "微信搜索「山理吃什么」也能直接打开"
    tip_w = text_w(draw, tip, f_tip)
    draw.text(((w - tip_w) / 2, y0 + box_size + 74), tip, font=f_tip, fill=MUTED)

    canvas.save(path, quality=95)
    return path


def make_quote(path):
    """纯语录卡：发帖配图第二张，被单独转发也不丢信息。"""
    w = h = 1080
    canvas = Image.new("RGB", (w, h), BG)
    draw = ImageDraw.Draw(canvas)

    icon = Image.open(ICON_PATH).convert("RGBA").resize((72, 72), Image.LANCZOS)
    canvas.paste(icon, (88, 88), icon)
    draw.text((182, 102), NAME, font=font(34, bold=True), fill=MUTED)

    f_q = font(96, bold=True)
    lines = ["饭点到了，", "别再站在", "食堂门口想了"]
    y0, step = 320, 144
    for i, line in enumerate(lines):
        draw.text((92, y0 + i * step), line, font=f_q, fill=INK)

    # 橙色句点，垂直居中于最后一行
    last_w = text_w(draw, lines[-1], f_q)
    cy = y0 + 2 * step + 46
    draw.ellipse((92 + last_w + 6, cy - 18, 92 + last_w + 42, cy + 18), fill=ORANGE)

    draw.text((92, 876), "微信搜索「山理吃什么」", font=font(28), fill=ORANGE)
    draw.text((92, 922), "按预算、口味、主食类型挑，还能随机抽一道", font=font(24), fill=MUTED)

    canvas.save(path, quality=95)
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mini-qr", default=None, help="小程序码图片路径")
    parser.add_argument("--group-qr", default=None, help="群二维码图片路径")
    args = parser.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    outs = [
        make_square(os.path.join(OUT_DIR, "poster_square.png"), args.mini_qr),
        make_long(os.path.join(OUT_DIR, "poster_long.png"), args.mini_qr, args.group_qr),
        make_quote(os.path.join(OUT_DIR, "poster_quote.png")),
    ]
    for p in outs:
        print("生成:", os.path.relpath(p, ROOT), os.path.getsize(p), "bytes")


if __name__ == "__main__":
    sys.exit(main())
