# Sticker artwork cleanup report

All 40 regular-pack PNGs were reprocessed (512 x 512 RGBA, transparent background). Original characters, poses, expressions, colours and
captions are untouched: only confirmed artifacts were removed (nothing was drawn, filled in or extended), then each sticker was trimmed to its
own bounds and centred, at one shared scale of **1.6107x**, so the widest sticker fills 480 of 512 px (16 px margin) and every sticker
sits within 448-480 x 373-396 px.

What was removed, and how it was confirmed
- **White bars** (neighbour's outline baked into the top edge): `androgynous-sapphic` 06, 07, 08, 09, 10 (08 and 09 were not in the original list). A bar is a
  near-white run of 150+ px in the sticker's first row, followed by rows of the same width, then a gap before the head outline.
- **Detached fragments**: pieces of the neighbouring sticker that are separate from the art and sit on the old crop window (left/right/top/bottom bands),
  plus floating specks of 6 px or less. Fragments were found and removed in 15 files (see the table), more than the 8 in the original list.
- **Ghost pixels**: faint alpha (almost all <= 3/255, never above 50) that is not part of any solid shape, so the background is truly transparent.
- Separate pieces that are real art (for example the puff next to "Tampo ako!" and the sparkles in "Delulu") were kept.

Not fixable here: the source art is cut off by the old crop window
The stickers were cropped from a larger sheet, so in **33 of 40** files part of the coloured artwork itself (hair, torso, a heart, a letter) is
cut by a straight edge at the left, right, top or bottom. That art is missing from the files and cannot be recovered without the original,
un-cropped export, so it was **flagged, not guessed**. The last column lists the cut sides with the number of artwork pixels on the cut line
(for example `androgynous-sapphic/01` is cut straight across the torso at the bottom).

Residue left in place (visible, attached to an outline, needs the source art)
- `androgynous-sapphic/01_hala_siya`: faint grey smudge to the right of "siya!".
- `androgynous-sapphic/04_lambing_naman`: faint pink/grey smudge above "Lambing".
- `androgynous-sapphic/05_delulu`: translucent squiggle under "solulu" and a lilac piece at the left edge.
- `androgynous-sapphic/15_ayoko_na`: small lilac piece to the right of the hands.

| File | Changes | Content size | Art cut off at source (side, px) |
| --- | --- | --- | --- |
| `sapphic-feelings/01_hala_siya.png` | recentred, rescaled | 474x390 | right (13px) |
| `sapphic-feelings/02_kilig_ako.png` | recentred, rescaled | 475x396 | - |
| `sapphic-feelings/03_miss_na_kita.png` | recentred, rescaled | 477x389 | left (22px) |
| `sapphic-feelings/04_lambing_naman.png` | recentred, rescaled | 475x387 | left (13px) |
| `sapphic-feelings/05_delulu.png` | recentred, rescaled | 466x396 | - |
| `sapphic-feelings/06_beh_shes_pretty.png` | recentred, rescaled | 474x393 | - |
| `sapphic-feelings/07_tampo_ako.png` | fragment removed (26 px at x402-404, y258-277); fragment removed (17 px at x403-404, y312-329); recentred, rescaled | 475x387 | left (14px) |
| `sapphic-feelings/08_edi_wow.png` | fragment removed (135 px at x400-405, y248-285); recentred, rescaled | 462x395 | left (51px) |
| `sapphic-feelings/09_love_that_for_you.png` | recentred, rescaled | 474x385 | left (52px) |
| `sapphic-feelings/10_sana_all.png` | recentred, rescaled | 470x390 | left (22px) |
| `sapphic-feelings/11_goodnight_love.png` | recentred, rescaled | 478x375 | - |
| `sapphic-feelings/12_hug_nga.png` | recentred, rescaled | 472x373 | right (24px) |
| `sapphic-feelings/13_im_listening.png` | fragment removed (155 px at x107-114, y176-207); recentred, rescaled | 480x386 | left (10px) |
| `sapphic-feelings/14_gusto_kita.png` | fragment removed (12 px at x403-404, y311-323); recentred, rescaled | 478x386 | left (14px) |
| `sapphic-feelings/15_ayoko_na.png` | recentred, rescaled | 478x381 | left (24px) |
| `sapphic-feelings/16_slay_mhie.png` | recentred, rescaled | 476x380 | top (26px), right (13px) |
| `sapphic-feelings/17_red_flag_ba.png` | recentred, rescaled | 466x380 | - |
| `sapphic-feelings/18_green_flag_ka.png` | fragment removed (159 px at x399-405, y244-284); fragment removed (90 px at x401-405, y306-336); recentred, rescaled | 475x379 | left (18px) |
| `sapphic-feelings/19_chika_muna.png` | fragment removed (852 px at x392-404, y208-343); recentred, rescaled | 468x385 | left (70px), right (20px) |
| `sapphic-feelings/20_iykyk.png` | recentred, rescaled | 478x378 | left (131px) |
| `androgynous-sapphic/01_hala_siya.png` | recentred, rescaled | 474x394 | bottom (204px) |
| `androgynous-sapphic/02_kilig_ako.png` | fragment removed (1093 px at x389-404, y197-307); recentred, rescaled | 454x395 | bottom (209px), left (15px), right (48px) |
| `androgynous-sapphic/03_miss_na_kita.png` | recentred, rescaled | 480x389 | bottom (207px), left (105px) |
| `androgynous-sapphic/04_lambing_naman.png` | fragment removed (9 px at x403-404, y205-214); fragment removed (75 px at x400-404, y225-251); fragment removed (17 px at x402-404, y266-278); fragment removed (100 px at x399-404, y289-315); recentred, rescaled | 464x396 | bottom (209px) |
| `androgynous-sapphic/05_delulu.png` | separate art element kept; recentred, rescaled | 469x395 | bottom (221px), left (76px) |
| `androgynous-sapphic/06_beh_shes_pretty.png` | white bar removed (rows 133-139); fragment removed (288 px at x343-382, y140-151); recentred, rescaled | 473x385 | top (27px) |
| `androgynous-sapphic/07_tampo_ako.png` | white bar removed (rows 133-139); fragment removed (118 px at x335-361, y140-147); fragment removed (228 px at x107-114, y241-286); separate art element kept; recentred, rescaled | 466x383 | top (16px) |
| `androgynous-sapphic/08_edi_wow.png` | white bar removed (rows 133-139); fragment removed (13 px at x404-405, y244-257); fragment removed (59 px at x402-405, y262-289); recentred, rescaled | 473x384 | left (25px) |
| `androgynous-sapphic/09_love_that_for_you.png` | white bar removed (rows 133-139); recentred, rescaled | 461x385 | left (47px) |
| `androgynous-sapphic/10_sana_all.png` | white bar removed (rows 133-139); recentred, rescaled | 466x385 | - |
| `androgynous-sapphic/11_goodnight_love.png` | recentred, rescaled | 478x382 | right (27px) |
| `androgynous-sapphic/12_hug_nga.png` | fragment removed (176 px at x107-115, y144-179); fragment removed (598 px at x394-404, y198-279); recentred, rescaled | 456x391 | right (16px) |
| `androgynous-sapphic/13_im_listening.png` | recentred, rescaled | 479x385 | left (85px) |
| `androgynous-sapphic/14_gusto_kita.png` | fragment removed (5 px at x403-404, y237-242); fragment removed (25 px at x402-404, y257-274); fragment removed (210 px at x181-240, y374-379); recentred, rescaled | 477x385 | - |
| `androgynous-sapphic/15_ayoko_na.png` | recentred, rescaled | 463x385 | left (64px) |
| `androgynous-sapphic/16_slay_mhie.png` | recentred, rescaled | 474x384 | top (46px), right (19px) |
| `androgynous-sapphic/17_red_flag_ba.png` | fragment removed (62 px at x107-110, y179-209); fragment removed (1185 px at x389-404, y187-310); fragment removed (9 px at x107-108, y210-219); recentred, rescaled | 448x385 | top (43px), right (56px) |
| `androgynous-sapphic/18_green_flag_ka.png` | recentred, rescaled | 479x385 | top (34px), left (125px) |
| `androgynous-sapphic/19_chika_muna.png` | fragment removed (88 px at x400-404, y247-276); recentred, rescaled | 478x385 | top (67px), right (18px) |
| `androgynous-sapphic/20_iykyk.png` | recentred, rescaled | 478x385 | top (21px), left (64px) |
