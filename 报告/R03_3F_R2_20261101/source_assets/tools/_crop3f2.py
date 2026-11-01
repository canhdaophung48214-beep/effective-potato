# -*- coding: utf-8 -*-
"""临时脚本：3F 第二轮转述裁价格区。跑完即删。"""
import os
from PIL import Image

SRC = r"C:\Users\25975\.dsh\attachments\v1\objects"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_crop3f")
os.makedirs(OUT, exist_ok=True)

JOBS = [
    # 海源鸡丁米线 价目牌（整块）
    ("haiyuan", "36/3691e6cb9f8778b5c12c3df83254bf675056283ebf56a83f73fe7f1c238a97b4",
     (0.10, 0.33, 0.72, 0.50)),
    # 王记羊肉汤 价格牌
    ("wangji", "e3/e3340e6d79898a205a2ad2a23d3d7ae94f68b292af2643e8f140a8409b2ab73d",
     (0.08, 0.66, 0.68, 0.86)),
    # 山理手工水饺 小牌
    ("shuijiao", "48/4809f6148b813f95b95992bbab40b313d05b87d23b31e6f4a487b83feaa144e6",
     (0.28, 0.55, 0.56, 0.80)),
    # 刘婉婉 右侧价目
    ("liuwan", "44/446b812d187b67cb9d64b2f837547dd38da5c9f2cebb8e03970490f4a3e8e83a",
     (0.58, 0.24, 1.00, 0.46)),
    # 来嗦一碗 价格表
    ("laisuo", "42/42308a835815f72a6dd11f799713a182ebe7239bd35072a9b444a2379f0fed3c",
     (0.16, 0.10, 1.00, 0.45)),
    # 快乐番薯 价目屏
    ("xiangshu", "09/092ab0885effcae1599c5649bfa0bab8adc3d1854983df747bd80ef0ac4672d1",
     (0.28, 0.28, 1.00, 0.80)),
    # 米生 辣番茄 米线价目
    ("lafanqie", "9d/9d149ab4d94dad0cb4d86f1304b712f6097e33d6d453ff8c592f355fd1097e77",
     (0.00, 0.42, 0.75, 0.60)),
    # 爆二爷 价目
    ("baoye", "d3/d394850c442c625a1ab69f76c531a79d16c4e44060016d30254584671a9e5ece",
     (0.00, 0.00, 0.60, 0.27)),
    # 懿百岁 小笼包价目
    ("xiaolongbao", "98/984c68bc1edf2220bb838831cd73f8b895a6501c4fab38444be9bb461143c39a",
     (0.14, 0.24, 0.80, 0.42)),
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
    print(name, crop.size)
