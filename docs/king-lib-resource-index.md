# KING.LIB resource indexing notes

`KING.LIB` contains more graphics than the 52×60 card/contract sprites.  The
repository still must not store the original binary or extracted PNG files, so
the reproducible indexer lives in `scripts/index_king_lib_resources.py` and
writes local-only reports under `assets/original/`.

## How to build the full local index

```bash
python3 scripts/extract_original_assets.py /path/to/original/kingrus
python3 scripts/index_king_lib_resources.py
```

The indexer scans the original `KING.LIB` image headers and also reports
candidate 16-bit offset tables embedded in `KING.EXE` / `KING2.EXE`.  It writes:

- `assets/original/king-lib-resource-index.md`
- `assets/original/king-lib-resource-index.csv`

These generated files are intentionally ignored by Git.

## Contact-list summary from KING.LIB

A scan of the bundled `KING.LIB` copy from `kingrus.zip` finds 96 graphic header
candidates.  The list below is a textual contact-list of every image-sized
resource found by the current header scanner, including non-52×60 resources.

| Count | Size | Likely role |
|---:|---:|---|
| 64 | 52×60 | card/contract sprite |
| 4 | 18×27 | small button/icon |
| 2 | 18×26 | small button/icon |
| 6 | 320×88 | wide background/table/menu band |
| 2 | 60×14 | menu/button strip |
| 2 | 61×14 | menu/button strip |
| 2 | 264×54 | score/table strip |
| 6 | 16×13 | tiny control marker/button |
| 2 | 197×86 | results/table panel |
| 2 | 156×108 | portrait or splash panel |
| 2 | 76×37 | dialog/menu panel |

For the complete offset-by-offset contact-list, run the script locally; the
printed output includes each resource index, decimal/hex offset, dimensions, and
classification label.

## Full contact-list captured in this run

| # | Offset | Size | Likely role |
|---:|---:|---:|---|
| 0 | `0x00080` / 128 | 52×60 | card/contract sprite |
| 1 | `0x0042e` / 1070 | 52×60 | card/contract sprite |
| 2 | `0x00480` / 1152 | 52×60 | card/contract sprite |
| 3 | `0x0086a` / 2154 | 52×60 | card/contract sprite |
| 4 | `0x00880` / 2176 | 52×60 | card/contract sprite |
| 5 | `0x00c92` / 3218 | 52×60 | card/contract sprite |
| 6 | `0x00d00` / 3328 | 52×60 | card/contract sprite |
| 7 | `0x01167` / 4455 | 52×60 | card/contract sprite |
| 8 | `0x01180` / 4480 | 52×60 | card/contract sprite |
| 9 | `0x01811` / 6161 | 52×60 | card/contract sprite |
| 10 | `0x01880` / 6272 | 52×60 | card/contract sprite |
| 11 | `0x01ec0` / 7872 | 52×60 | card/contract sprite |
| 12 | `0x01f00` / 7936 | 52×60 | card/contract sprite |
| 13 | `0x025cb` / 9675 | 52×60 | card/contract sprite |
| 14 | `0x02600` / 9728 | 52×60 | card/contract sprite |
| 15 | `0x02a0a` / 10762 | 52×60 | card/contract sprite |
| 16 | `0x02a80` / 10880 | 52×60 | card/contract sprite |
| 17 | `0x02f00` / 12032 | 52×60 | card/contract sprite |
| 18 | `0x033d1` / 13265 | 52×60 | card/contract sprite |
| 19 | `0x03400` / 13312 | 52×60 | card/contract sprite |
| 20 | `0x03915` / 14613 | 52×60 | card/contract sprite |
| 21 | `0x03980` / 14720 | 52×60 | card/contract sprite |
| 22 | `0x03ee8` / 16104 | 52×60 | card/contract sprite |
| 23 | `0x03f00` / 16128 | 52×60 | card/contract sprite |
| 24 | `0x045a3` / 17827 | 52×60 | card/contract sprite |
| 25 | `0x04600` / 17920 | 52×60 | card/contract sprite |
| 26 | `0x04c28` / 19496 | 52×60 | card/contract sprite |
| 27 | `0x04c80` / 19584 | 52×60 | card/contract sprite |
| 28 | `0x051bf` / 20927 | 52×60 | card/contract sprite |
| 29 | `0x05200` / 20992 | 52×60 | card/contract sprite |
| 30 | `0x0562d` / 22061 | 52×60 | card/contract sprite |
| 31 | `0x05680` / 22144 | 52×60 | card/contract sprite |
| 32 | `0x05a5e` / 23134 | 52×60 | card/contract sprite |
| 33 | `0x05a80` / 23168 | 52×60 | card/contract sprite |
| 34 | `0x05ea0` / 24224 | 52×60 | card/contract sprite |
| 35 | `0x05f00` / 24320 | 52×60 | card/contract sprite |
| 36 | `0x0634e` / 25422 | 52×60 | card/contract sprite |
| 37 | `0x06380` / 25472 | 52×60 | card/contract sprite |
| 38 | `0x06823` / 26659 | 52×60 | card/contract sprite |
| 39 | `0x06880` / 26752 | 52×60 | card/contract sprite |
| 40 | `0x06fad` / 28589 | 52×60 | card/contract sprite |
| 41 | `0x07000` / 28672 | 52×60 | card/contract sprite |
| 42 | `0x0783e` / 30782 | 52×60 | card/contract sprite |
| 43 | `0x07880` / 30848 | 52×60 | card/contract sprite |
| 44 | `0x07fdd` / 32733 | 52×60 | card/contract sprite |
| 45 | `0x08000` / 32768 | 52×60 | card/contract sprite |
| 46 | `0x085b1` / 34225 | 52×60 | card/contract sprite |
| 47 | `0x08600` / 34304 | 52×60 | card/contract sprite |
| 48 | `0x089cc` / 35276 | 52×60 | card/contract sprite |
| 49 | `0x08a00` / 35328 | 52×60 | card/contract sprite |
| 50 | `0x08e0c` / 36364 | 52×60 | card/contract sprite |
| 51 | `0x08e80` / 36480 | 52×60 | card/contract sprite |
| 52 | `0x092b4` / 37556 | 52×60 | card/contract sprite |
| 53 | `0x09300` / 37632 | 52×60 | card/contract sprite |
| 54 | `0x09781` / 38785 | 52×60 | card/contract sprite |
| 55 | `0x09800` / 38912 | 52×60 | card/contract sprite |
| 56 | `0x09dd8` / 40408 | 52×60 | card/contract sprite |
| 57 | `0x09e00` / 40448 | 52×60 | card/contract sprite |
| 58 | `0x0a334` / 41780 | 52×60 | card/contract sprite |
| 59 | `0x0a380` / 41856 | 52×60 | card/contract sprite |
| 60 | `0x0aa3a` / 43578 | 52×60 | card/contract sprite |
| 61 | `0x0aa80` / 43648 | 52×60 | card/contract sprite |
| 62 | `0x0ae90` / 44688 | 52×60 | card/contract sprite |
| 63 | `0x0af00` / 44800 | 52×60 | card/contract sprite |
| 64 | `0x0b38b` / 45963 | 18×27 | small button/icon |
| 65 | `0x0b400` / 46080 | 18×27 | small button/icon |
| 66 | `0x0b56f` / 46447 | 320×88 | wide background/table/menu band |
| 67 | `0x0b580` / 46464 | 320×88 | wide background/table/menu band |
| 68 | `0x0ccbe` / 52414 | 320×88 | wide background/table/menu band |
| 69 | `0x0cd00` / 52480 | 320×88 | wide background/table/menu band |
| 70 | `0x0e5e9` / 58857 | 320×88 | wide background/table/menu band |
| 71 | `0x0e600` / 58880 | 320×88 | wide background/table/menu band |
| 72 | `0x0fc81` / 64641 | 60×14 | menu/button strip |
| 73 | `0x0fd00` / 64768 | 60×14 | menu/button strip |
| 74 | `0x0fee4` / 65252 | 61×14 | menu/button strip |
| 75 | `0x0ff00` / 65280 | 61×14 | menu/button strip |
| 76 | `0x1014f` / 65871 | 18×26 | small button/icon |
| 77 | `0x10180` / 65920 | 18×26 | small button/icon |
| 78 | `0x10309` / 66313 | 18×27 | small button/icon |
| 79 | `0x10380` / 66432 | 18×27 | small button/icon |
| 80 | `0x104d9` / 66777 | 264×54 | score/table strip |
| 81 | `0x10500` / 66816 | 264×54 | score/table strip |
| 82 | `0x10f4e` / 69454 | 16×13 | tiny control marker/button |
| 83 | `0x10f80` / 69504 | 16×13 | tiny control marker/button |
| 84 | `0x1101b` / 69659 | 16×13 | tiny control marker/button |
| 85 | `0x11080` / 69760 | 16×13 | tiny control marker/button |
| 86 | `0x11134` / 69940 | 197×86 | results/table panel |
| 87 | `0x11180` / 70016 | 197×86 | results/table panel |
| 88 | `0x11bde` / 72670 | 156×108 | portrait or splash panel |
| 89 | `0x11c00` / 72704 | 156×108 | portrait or splash panel |
| 90 | `0x1388f` / 80015 | 76×37 | dialog/menu panel |
| 91 | `0x13900` / 80128 | 76×37 | dialog/menu panel |
| 92 | `0x13ef8` / 81656 | 16×13 | tiny control marker/button |
| 93 | `0x13f00` / 81664 | 16×13 | tiny control marker/button |
| 94 | `0x13fce` / 81870 | 16×13 | tiny control marker/button |
| 95 | `0x14000` / 81920 | 16×13 | tiny control marker/button |
