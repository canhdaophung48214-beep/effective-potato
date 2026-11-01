# -*- coding: utf-8 -*-
"""临时脚本：把 3F 重核用的关键价目区裁剪放大。跑完即删。"""
import os
from PIL import Image

SRC = r"C:\Users\25975\.dsh\attachments\v1\objects"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_crop3f")
os.makedirs(OUT, exist_ok=True)

# (输出名, 源相对路径, 裁剪框比例 left,top,right,bottom)
JOBS = [
    ("jiangdao", "e1/e18a41a5ddc1f277b24234ee16f95280561422f62d07263f639ebf86e5e2a735",
     (0.20, 0.28, 0.95, 0.68)),
    ("gigi", "c2/c246e69a3b11221dfc2eaa12ff80e48f25de394a2dbe6c186ef58d615fc74fd3",
     (0.55, 0.42, 1.00, 0.80)),
    ("wukexin", "d3/d3e975456fbb1dbe0495e2c4448db576ddc99a125e51798dfae7f5921f37f3ad",
     (0.00, 0.24, 1.00, 0.40)),
    ("chapao", "ba/baabd23c778abb4fa516c4890afdfd80b09a61b30ec604c3667131d0d2485b38",
     (0.00, 0.22, 1.00, 0.42)),
    ("lataifan", "9d/9d149ab4d94dad0cb4d86f1304b712f6097e33d6d453ff8c592f355fd1097e77",
     (0.18, 0.26, 0.82, 0.52)),
    ("lirou", "bd/bda0a6be97dea0b6fa54a68bfc1133af8a7c64c6f36a22fffbd25f4b8ba3eebc",
     (0.03, 0.22, 0.72, 0.40)),
    ("liruo", "fc/fc7c5cc01bdbacf1a665a5d972578f73b19611dd79fb105a836483d9e013b151",
     (0.00, 0.28, 0.80, 0.52)),
]

for name, rel, box in JOBS:
    p = os.path.join(SRC, rel.replace("/", os.sep))
    im = Image.open(p).convert("RGB")
    w, h = im.size
    l, t, r, b = box
    crop = im.crop((int(w * l), int(h * t), int(w * r), int(h * b)))
    scale = 1900 / crop.width
    if scale > 1:
        crop = crop.resize((1900, int(crop.height * scale)), Image.LANCZOS)
    out = os.path.join(OUT, name + ".png")
    crop.save(out)
    print(out, crop.size)
