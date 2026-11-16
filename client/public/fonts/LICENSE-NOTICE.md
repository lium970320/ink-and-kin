MiSans 字体授权说明
====================

本目录下的 `MiSans-subset.woff2` 由小米 MiSans 可变字体（MiSansVF.ttf，版本
4.009）子集化生成。

来源
----

- 官方站点：https://hyperos.mi.com/font/details/sc
- 源文件：MiSansVF.ttf
- 版权信息（字体内置 name 表）：Copyright © 2020-2025 Beijing Xiaomi Mobile
  Software Co.,Ltd. All Rights Reserved.

许可范围
--------

MiSans 适用小米的独立许可。小米关于嵌入字体的说明要求在使用的软件中标明
MiSans。官方协议第 2 条限制改编和单独分发，并要求副本保留版权声明和协议。
当前公开源码包包含这一历史字体子集，其公开分发的额外授权尚待核实。
[小米官方许可协议](https://hyperos.mi.com/font-download/MiSans%E5%AD%97%E4%BD%93%E7%9F%A5%E8%AF%86%E4%BA%A7%E6%9D%83%E8%AE%B8%E5%8F%AF%E5%8D%8F%E8%AE%AE.pdf) · [小米字体常见问题](https://hyperos.mi.com/font/faq)

本仓库的子集化处理
------------------

`scripts/subset-misans.py` 使用 fonttools 对字体做子集化：

- 只裁剪字符集，**不修改任何字形轮廓**
- 保留 wght 可变轴（150–700 全部字重）
- 保留全部 26 个 OpenType feature（SS01–SS09、frac、sups、case、vert、tnum
  等）以及 GPOS 的 kern
- 字符集来源：界面源码中的中文字面量 + 常用标点数字符号 + 字体 feature 会
  替换进去的额外码位（分数、上下标、Latin-1 等），因此开启任一 feature 都不会
  出现缺字

完整字库可从小米官方渠道获取，处理与分发字体文件时以对应许可为准。
