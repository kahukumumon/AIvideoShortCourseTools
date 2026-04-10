# オリキャラ設定ツール

プロンプトを作成可能
- 髪型
  - ショート
  - ミディアム
  - ロング
  - エクストラロング
- 髪型追加
  - なし
  - ツインテール
  - ポニーテール
- 髪色
  - 黒
  - 茶
  - 金
  - 銀
- 目の色
  - ピンク
  - 赤
  - オレンジ
  - 黄色
  - 緑
  - 水色
  - 青
  - 紫
- 頭部へのアクセント
  - なし
  - ヘアピン
  - カチューシャ
  - リボン
- おっぱい
  - 巨乳
  - 爆乳
- 肌の色
  - 指定なし
  - tan
  - dark skin
- lora(使用する場合はloraファイルを用意して、導入してください) 非表示
  - ATNR_V1.1_Lokr_f4_warmup_stable_decay:0.2
  - USNR_V1.1_Lokr_f4_warmup_stable_decay:0.2
- 動画用（チェックボックス）

以下を書き出す。
parameters: <髪色> hair,<髪型>,<髪型追加>,<頭部へのアクセント>,<目の色>,<おっぱい>,school uniform,classroom,Wave hand,standing,cowboy shot,smile
Negative prompt: (multi color hair,Inner color:1.2),score_6,score_5,score_4,score_furry,source_pony,source_cartoon,ugly face,ugly eyes,red pupils,(deformity, out door),username,manicure,earring,bag,shoes,text,letters,symbols,question mark,watermark,logo,(sword:1.2),
<この行は動画用にチェック有でON, wet water,action lines, impact lines, speed lines, collision effect, comic burst, comic effect lines, manga effect, stylized explosion, motion blur lines, cartoon impact, dynamic lines, swoosh lines, onomatopoeia, steam, hot steam, vapor, mist, fog, condensation, visible breath, breath vapor, breath mist, white breath, puff of air, breath puff, breath cloud, anime breath, smoke puff,>
<この行は動画用にチェック有でON, sweat, perspiration, sweat drops, sweatdrop, dripping sweat, sweat beads, water droplets, droplets, wet skin, wet spot, damp skin, moist skin, oily sheen, glistening skin, sweaty shine, dripping liquid, trickle, sticky skin,>
Steps: 25, Sampler: Euler a, Schedule type: Automatic, CFG scale: 7, Seed: -1, Size: 768x1088, Model hash: bdb59bac77, Model: waiNSFWIllustrious_v140, Denoising strength: 0.37, ADetailer model: face_yolov8n.pt, ADetailer confidence: 0.3, ADetailer dilate erode: 4, ADetailer mask blur: 4, ADetailer denoising strength: 0.4, ADetailer inpaint only masked: True, ADetailer inpaint padding: 32, ADetailer version: 25.3.0, Hires Module 1: Use same choices, Hires CFG Scale: 5, Hires upscale: 1.5, Hires upscaler: R-ESRGAN 4x+, Version: f2.0.1v1.10.1-previous-669-gdfdcbab6, Module 1: sdxl_vae
