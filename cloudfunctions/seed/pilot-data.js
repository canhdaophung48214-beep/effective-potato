/* 由 tools/pilot/build_pilot_dataset.js 从采集 CSV 生成，请勿手工编辑。
 * 数据源：tools/pilot/batch1_min/{shops,floors,stalls,dishes}.csv
 * 生成时间：2026-10-26T15:46:09.186Z
 * 记录数：店铺 1 / 窗口 1 / 菜品 12
 * 每条记录自带 source（kind/detail/ref），与 CSV 逐行一致。
 */
'use strict';

module.exports = {
  BATCH_ID: "pilot_c02_batch1_20261022",
  RESTAURANTS: [
    {
      "_id": "c02",
      "name": "三餐",
      "area": "campus",
      "building": "第三餐厅",
      "location": "三餐 · 2 楼最西侧",
      "source": {
        "kind": "field",
        "detail": "2026-10-22 现场拍摄韩小面门头（招牌含「重庆风味」）与价目表；照片可支持：招牌名「韩小面」「重庆风味」；餐厅名称（三餐/第三餐厅）、楼层（2 楼）与方位（最西侧）来自项目负责人 2026-10-26 提供的现场信息，非餐厅负责人签字，照片未独立证明；area/building/location 仍有占位成分",
        "ref": ""
      },
      "floors": [
        {
          "id": "c02_f2",
          "label": "2 楼",
          "source": {
            "kind": "field",
            "detail": "楼层「2 楼」来自项目负责人 2026-10-26 提供的现场信息，非餐厅负责人签字，照片未独立证明（现有照片为门头与价目表，不含楼层指引牌）；floor_id c02_f2 为结构占位",
            "ref": ""
          },
          "__row": 2
        }
      ],
      "__row": 2
    }
  ],
  STALLS: [
    {
      "_id": "c02_t02",
      "restaurantId": "c02",
      "floorId": "c02_f2",
      "name": "韩小面",
      "side": "west",
      "noStatus": "unverified",
      "no": "",
      "source": {
        "kind": "field",
        "detail": "2026-10-22 现场拍摄韩小面价目表（含汤面 / 拌面 / 清汤 / 小吃四栏与店长提示）；档口名与价格有照片支持；方位 west 来自项目负责人 2026-10-26 提供的现场信息，非餐厅负责人签字，照片未独立证明；no_status 保持 unverified",
        "ref": ""
      },
      "__row": 2
    }
  ],
  DISHES: [
    {
      "_id": "c02_d060",
      "name": "重庆小面（素）",
      "price": 7,
      "foodType": "noodle",
      "restaurantId": "c02",
      "stallId": "c02_t02",
      "tastes": [
        "spicy"
      ],
      "source": {
        "kind": "field",
        "detail": "2026-10-22 现场价目表抄录；名称与价格有照片支持；辣度（香辣）来自项目负责人 2026-10-26 提供的现场信息，非餐厅负责人签字，照片未独立证明",
        "ref": ""
      },
      "__row": 2
    },
    {
      "_id": "c02_d061",
      "name": "杂酱面（素）",
      "price": 9,
      "foodType": "noodle",
      "restaurantId": "c02",
      "stallId": "c02_t02",
      "tastes": [
        "spicy"
      ],
      "source": {
        "kind": "field",
        "detail": "2026-10-22 现场价目表抄录；名称与价格有照片支持；辣度（香辣）来自项目负责人 2026-10-26 提供的现场信息，非餐厅负责人签字，照片未独立证明",
        "ref": ""
      },
      "__row": 3
    },
    {
      "_id": "c02_d062",
      "name": "招牌豌杂面（素）",
      "price": 11,
      "foodType": "noodle",
      "restaurantId": "c02",
      "stallId": "c02_t02",
      "tastes": [
        "spicy"
      ],
      "source": {
        "kind": "field",
        "detail": "2026-10-22 现场价目表抄录；名称与价格有照片支持；辣度（香辣）来自项目负责人 2026-10-26 提供的现场信息，非餐厅负责人签字，照片未独立证明",
        "ref": ""
      },
      "__row": 4
    },
    {
      "_id": "c02_d063",
      "name": "酸菜面（素）",
      "price": 8,
      "foodType": "noodle",
      "restaurantId": "c02",
      "stallId": "c02_t02",
      "tastes": [
        "mild_spicy"
      ],
      "source": {
        "kind": "field",
        "detail": "2026-10-22 现场价目表抄录；名称与价格有照片支持；辣度（微辣）来自项目负责人 2026-10-26 提供的现场信息，非餐厅负责人签字，照片未独立证明",
        "ref": ""
      },
      "__row": 5
    },
    {
      "_id": "c02_d064",
      "name": "牛肉面（荤）",
      "price": 15,
      "foodType": "noodle",
      "restaurantId": "c02",
      "stallId": "c02_t02",
      "tastes": [
        "mild_spicy"
      ],
      "source": {
        "kind": "field",
        "detail": "2026-10-22 现场价目表抄录；名称与价格有照片支持；辣度（微辣）来自项目负责人 2026-10-26 提供的现场信息，非餐厅负责人签字，照片未独立证明",
        "ref": ""
      },
      "__row": 6
    },
    {
      "_id": "c02_d065",
      "name": "干拌小面（素）",
      "price": 7,
      "foodType": "noodle",
      "restaurantId": "c02",
      "stallId": "c02_t02",
      "tastes": [
        "spicy"
      ],
      "source": {
        "kind": "field",
        "detail": "2026-10-22 现场价目表抄录；名称与价格有照片支持；辣度（香辣）来自项目负责人 2026-10-26 提供的现场信息，非餐厅负责人签字，照片未独立证明",
        "ref": ""
      },
      "__row": 7
    },
    {
      "_id": "c02_d066",
      "name": "干拌杂酱面（素）",
      "price": 9,
      "foodType": "noodle",
      "restaurantId": "c02",
      "stallId": "c02_t02",
      "tastes": [
        "spicy"
      ],
      "source": {
        "kind": "field",
        "detail": "2026-10-22 现场价目表抄录；名称与价格有照片支持；辣度（香辣）来自项目负责人 2026-10-26 提供的现场信息，非餐厅负责人签字，照片未独立证明",
        "ref": ""
      },
      "__row": 8
    },
    {
      "_id": "c02_d067",
      "name": "干拌豌杂面（素）",
      "price": 11,
      "foodType": "noodle",
      "restaurantId": "c02",
      "stallId": "c02_t02",
      "tastes": [
        "spicy"
      ],
      "source": {
        "kind": "field",
        "detail": "2026-10-22 现场价目表抄录；名称与价格有照片支持；辣度（香辣）来自项目负责人 2026-10-26 提供的现场信息，非餐厅负责人签字，照片未独立证明",
        "ref": ""
      },
      "__row": 9
    },
    {
      "_id": "c02_d068",
      "name": "清汤小面",
      "price": 7,
      "foodType": "noodle",
      "restaurantId": "c02",
      "stallId": "c02_t02",
      "tastes": [
        "choice"
      ],
      "source": {
        "kind": "field",
        "detail": "2026-10-22 现场价目表抄录；名称与价格有照片支持；辣度未核实（按品类推断）",
        "ref": ""
      },
      "__row": 10
    },
    {
      "_id": "c02_d069",
      "name": "清汤杂酱面",
      "price": 9,
      "foodType": "noodle",
      "restaurantId": "c02",
      "stallId": "c02_t02",
      "tastes": [
        "choice"
      ],
      "source": {
        "kind": "field",
        "detail": "2026-10-22 现场价目表抄录；名称与价格有照片支持；辣度未核实（按品类推断）",
        "ref": ""
      },
      "__row": 11
    },
    {
      "_id": "c02_d070",
      "name": "清汤豌杂面",
      "price": 11,
      "foodType": "noodle",
      "restaurantId": "c02",
      "stallId": "c02_t02",
      "tastes": [
        "choice"
      ],
      "source": {
        "kind": "field",
        "detail": "2026-10-22 现场价目表抄录；名称与价格有照片支持；辣度未核实（按品类推断）",
        "ref": ""
      },
      "__row": 12
    },
    {
      "_id": "c02_d071",
      "name": "麻酱凉面",
      "price": 8,
      "foodType": "noodle",
      "restaurantId": "c02",
      "stallId": "c02_t02",
      "tastes": [
        "choice"
      ],
      "source": {
        "kind": "field",
        "detail": "2026-10-22 现场价目表抄录；名称与价格有照片支持；辣度未核实（按品类推断）",
        "ref": ""
      },
      "__row": 13
    }
  ],
  SHEET: { shops: 1, stalls: 1, dishes: 12 }
};
