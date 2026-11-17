// Popular Lospec palettes (https://lospec.com/palette-list), at most 64 colors each,
// bundled so they can be picked offline. Each one belongs to its author, credited
// here and in the import dialog; the palette page on Lospec has the details.
// Colors are space-separated "rrggbb" strings, to keep the file compact.

export interface BundledPalette {
  slug: string
  name: string
  /** Empty when Lospec lists no author. */
  author: string
  colors: string
}

export const BUNDLED_PALETTES: BundledPalette[] = [
  { slug: "resurrect-64", name: "Resurrect 64", author: "Kerrie Lake", colors: "2e222f 3e3546 625565 966c6c ab947a 694f62 7f708a 9babb2 c7dcd0 ffffff 6e2727 b33831 ea4f36 f57d4a ae2334 e83b3b fb6b1d f79617 f9c22b 7a3045 9e4539 cd683d e6904e fbb954 4c3e24 676633 a2a947 d5e04b fbff86 165a4c 239063 1ebc73 91db69 cddf6c 313638 374e4a 547e64 92a984 b2ba90 0b5e65 0b8a8f 0eaf9b 30e1b9 8ff8e2 323353 484a77 4d65b4 4d9be6 8fd3ff 45293f 6b3e75 905ea9 a884f3 eaaded 753c54 a24b6f cf657f ed8099 831c5d c32454 f04f78 f68181 fca790 fdcbb0" },
  { slug: "apollo", name: "Apollo", author: "AdamCYounis", colors: "172038 253a5e 3c5e8b 4f8fba 73bed3 a4dddb 19332d 25562e 468232 75a743 a8ca58 d0da91 4d2b32 7a4841 ad7757 c09473 d7b594 e7d5b3 341c27 602c2c 884b2b be772b de9e41 e8c170 241527 411d31 752438 a53030 cf573c da863e 1e1d39 402751 7a367b a23e8c c65197 df84a5 090a14 10141f 151d28 202e37 394a50 577277 819796 a8b5b2 c7cfcc ebede9" },
  { slug: "endesga-32", name: "Endesga 32", author: "ENDESGA", colors: "be4a2f d77643 ead4aa e4a672 b86f50 733e39 3e2731 a22633 e43b44 f77622 feae34 fee761 63c74d 3e8948 265c42 193c3e 124e89 0099db 2ce8f5 ffffff c0cbdc 8b9bb4 5a6988 3a4466 262b44 181425 ff0044 68386c b55088 f6757a e8b796 c28569" },
  { slug: "lospec500", name: "Lospec500", author: "", colors: "10121c 2c1e31 6b2643 ac2847 ec273f 94493a de5d3a e98537 f3a833 4d3533 6e4c30 a26d3f ce9248 dab163 e8d282 f7f3b7 1e4044 006554 26854c 5ab552 9de64e 008b8b 62a477 a6cb96 d3eed3 3e3b65 3859b3 3388de 36c5f4 6dead6 5e5b8c 8c78a5 b0a7b8 deceed 9a4d76 c878af cc99ff fa6e79 ffa2ac ffd1d5 f6e8e0 ffffff" },
  { slug: "endesga-64", name: "Endesga 64", author: "ENDESGA", colors: "ff0040 131313 1b1b1b 272727 3d3d3d 5d5d5d 858585 b4b4b4 ffffff c7cfdd 92a1b9 657392 424c6e 2a2f4e 1a1932 0e071b 1c121c 391f21 5d2c28 8a4836 bf6f4a e69c69 f6ca9f f9e6cf edab50 e07438 c64524 8e251d ff5000 ed7614 ffa214 ffc825 ffeb57 d3fc7e 99e65f 5ac54f 33984b 1e6f50 134c4c 0c2e44 00396d 0069aa 0098dc 00cdf9 0cf1ff 94fdff fdd2ed f389f5 db3ffd 7a09fa 3003d9 0c0293 03193f 3b1443 622461 93388f ca52c9 c85086 f68187 f5555d ea323c c42430 891e2b 571c27" },
  { slug: "cc-29", name: "CC-29", author: "Alpha6", colors: "f2f0e5 b8b5b9 868188 646365 45444f 3a3858 212123 352b42 43436a 4b80ca 68c2d3 a2dcc7 ede19e d3a068 b45252 6a536e 4b4158 80493a a77b5b e5ceb4 c2d368 8ab060 567b79 4e584a 7b7243 b2b47e edc8c4 cf8acb 5f556a" },
  { slug: "slso8", name: "SLSO8", author: "Luis Miguel Maldonado", colors: "0d2b45 203c56 544e68 8d697a d08159 ffaa5e ffd4a3 ffecd6" },
  { slug: "aap-64", name: "AAP-64", author: "Adigun A. Polack", colors: "060608 141013 3b1725 73172d b4202a df3e23 fa6a0a f9a31b ffd541 fffc40 d6f264 9cdb43 59c135 14a02e 1a7a3e 24523b 122020 143464 285cc4 249fde 20d6c7 a6fcdb ffffff fef3c0 fad6b8 f5a097 e86a73 bc4a9b 793a80 403353 242234 221c1a 322b28 71413b bb7547 dba463 f4d29c dae0ea b3b9d1 8b93af 6d758d 4a5462 333941 422433 5b3138 8e5252 ba756a e9b5a3 e3e6ff b9bffb 849be4 588dbe 477d85 23674e 328464 5daf8d 92dcba cdf7e2 e4d2aa c7b08b a08662 796755 5a4e44 423934" },
  { slug: "pear36", name: "Pear36", author: "PineappleOnPizza", colors: "5e315b 8c3f5d ba6156 f2a65e ffe478 cfff70 8fde5d 3ca370 3d6e70 323e4f 322947 473b78 4b5bab 4da6ff 66ffe3 ffffeb c2c2d1 7e7e8f 606070 43434f 272736 3e2347 57294b 964253 e36956 ffb570 ff9166 eb564b b0305c 73275c 422445 5a265e 80366b bd4882 ff6b97 ffb5b5" },
  { slug: "oil-6", name: "Oil 6", author: "", colors: "fbf5ef f2d3ab c69fa5 8b6d9c 494d7e 272744" },
  { slug: "31", name: "31", author: "catastrofie", colors: "636663 87857c bcad9f f2b888 eb9661 b55945 734c44 3d3333 593e47 7a5859 a57855 de9f47 fdd179 fee1b8 d4c692 a6b04f 819447 44702d 2f4d2f 546756 89a477 a4c5af cae6d9 f1f6f0 d5d6db bbc3d0 96a9c1 6c81a1 405273 303843 14233a" },
  { slug: "sweetie-16", name: "Sweetie 16", author: "", colors: "1a1c2c 5d275d b13e53 ef7d57 ffcd75 a7f070 38b764 257179 29366f 3b5dc9 41a6f6 73eff7 f4f4f4 94b0c2 566c86 333c57" },
  { slug: "pico-8", name: "PICO-8", author: "", colors: "000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa" },
  { slug: "vinik24", name: "Vinik24", author: "Vinik", colors: "000000 6f6776 9a9a97 c5ccb8 8b5580 c38890 a593a5 666092 9a4f50 c28d75 7ca1c0 416aa3 8d6268 be955c 68aca9 387080 6e6962 93a167 6eaa78 557064 9d9f7f 7e9e99 5d6872 433455" },
  { slug: "fantasy-24", name: "Fantasy 24", author: "", colors: "1f240a 39571c a58c27 efac28 efd8a1 ab5c1c 183f39 ef692f efb775 a56243 773421 724113 2a1d0d 392a1c 684c3c 927e6a 276468 ef3a0c 45230d 3c9f9c 9b1a0a 36170c 550f0a 300f0a" },
  { slug: "journey", name: "Journey", author: "PineappleOnPizza", colors: "050914 110524 3b063a 691749 9c3247 d46453 f5a15d ffcf8e ff7a7d ff417d d61a88 94007a 42004e 220029 100726 25082c 3d1132 73263d bd4035 ed7b39 ffb84a fff540 c6d831 77b02a 429058 2c645e 153c4a 052137 0e0421 0c0b42 032769 144491 488bd4 78d7ff b0fff1 faffff c7d4e1 928fb8 5b537d 392946 24142c 0e0f2c 132243 1a466b 10908e 28c074 3dff6e f8ffb8 f0c297 cf968c 8f5765 52294b 0f022e 35003b 64004c 9b0e3e d41e3c ed4c40 ff9757 d4662f 9c341a 691b22 450c28 2d002e" },
  { slug: "nintendo-entertainment-system", name: "Nintendo Entertainment System", author: "", colors: "000000 fcfcfc f8f8f8 bcbcbc 7c7c7c a4e4fc 3cbcfc 0078f8 0000fc b8b8f8 6888fc 0058f8 0000bc d8b8f8 9878f8 6844fc 4428bc f8b8f8 f878f8 d800cc 940084 f8a4c0 f85898 e40058 a80020 f0d0b0 f87858 f83800 a81000 fce0a8 fca044 e45c10 881400 f8d878 f8b800 ac7c00 503000 d8f878 b8f818 00b800 007800 b8f8b8 58d854 00a800 006800 b8f8d8 58f898 00a844 005800 00fcfc 00e8d8 008888 004058 f8d8f8 787878" },
  { slug: "lost-century", name: "Lost Century", author: "SurrealEmber", colors: "d1b187 c77b58 ae5d40 79444a 4b3d44 ba9158 927441 4d4539 77743b b3a555 d2c9a5 8caba1 4b726e 574852 847875 ab9b8e" },
  { slug: "mulfok32", name: "mulfok32", author: "mulfok", colors: "5ba675 6bc96c abdd64 fcef8d ffb879 ea6262 cc425e a32858 751756 390947 611851 873555 a6555f c97373 f2ae99 ffc3f2 ee8fcb d46eb3 873e84 1f102a 4a3052 7b5480 a6859f d9bdc8 ffffff aee2ff 8db7ff 6d80fa 8465ec 834dc4 7d2da0 4e187c" },
  { slug: "zughy-32", name: "Zughy 32", author: "", colors: "472d3c 5e3643 7a444a a05b53 bf7958 eea160 f4cca1 b6d53c 71aa34 397b44 3c5956 302c2e 5a5353 7d7071 a0938e cfc6b8 dff6f5 8aebf1 28ccdf 3978a8 394778 39314b 564064 8e478c cd6093 ffaeb6 f4b41b f47e1b e6482e a93b3b 827094 4f546b" },
  { slug: "na16", name: "NA16", author: "Nauris", colors: "8c8fae 584563 3e2137 9a6348 d79b7d f5edba c0c741 647d34 e4943a 9d303b d26471 70377f 7ec4c1 34859d 17434b 1f0e1c" },
  { slug: "midnight-ablaze", name: "Midnight ablaze", author: "Inkpendude", colors: "ff8274 d53c6a 7c183c 460e2b 31051e 1f0510 130208" },
  { slug: "1bit-monitor-glow", name: "1bit Monitor Glow", author: "Polyducks", colors: "222323 f0f6f0" },
  { slug: "twilight-5", name: "Twilight 5", author: "Star", colors: "fbbbad ee8695 4a7a96 333f58 292831" },
  { slug: "waldgeist", name: "Waldgeist", author: "Acid Burritos", colors: "a6884a 906c30 825337 83473d 66352e 562923 612638 46332c 323230 3e4055 382d35 323b42 1f2d36 141f25 0b1016 245273 4e7499 5e7e8b 798a92 879ea3 e3ddd1 bdbbae af9e94 907c75 a29f7e 969372 78735d 696353 4f493b 212528 595c55 4b4e4f 57562a 675f30 727234 73804b 5f7b53 3b6d62 32534a" },
  { slug: "wplace-palette-free-colours", name: "Wplace Palette (Free Colours)", author: "billystorm", colors: "000000 3c3c3c 787878 d2d2d2 ffffff 600018 ed1c24 ff7f27 f6aa09 f9dd3b fffabc 0eb968 13e67b 87ff5e 0c816e 10aea6 13e1be 28509e 4093e4 60f7f2 6b50f6 99b1fb 780c99 aa38b9 e09ff9 cb007a ec1f80 f38da9 684634 95682a f8b277" },
  { slug: "blk-nx64", name: "BLK NX64", author: "BurakoIRL", colors: "000000 12173d 293268 464b8c 6b74b2 909edd c1d9f2 ffffff a293c4 7b6aa5 53427f 3c2c68 431e66 5d2f8c 854cbf b483ef 8cff9b 42bc7f 22896e 14665b 0f4a4c 0a2a33 1d1a59 322d89 354ab2 3e83d1 50b9eb 8cdaff 53a1ad 3b768f 21526b 163755 008782 00aaa5 27d3cb 78fae6 cdc599 988f64 5c5d41 353f23 919b45 afd370 ffe091 ffaa6e ff695a b23c40 ff6675 dd3745 a52639 721c2f b22e69 e54286 ff6eaf ffa5d5 ffd3ad cc817a 895654 61393b 3f1f3c 723352 994c69 c37289 f29faa ffccd0" },
  { slug: "steam-lords", name: "Steam Lords", author: "Slynyrd", colors: "213b25 3a604a 4f7754 a19f7c 77744f 775c4f 603b3a 3b2137 170e19 2f213b 433a60 4f5277 65738c 7c94a1 a0b9ba c0d1cc" },
  { slug: "nyx8", name: "Nyx8", author: "", colors: "08141e 0f2a3f 20394f f6d6bd c3a38a 997577 816271 4e495f" },
  { slug: "famicube", name: "Famicube", author: "", colors: "000000 e03c28 ffffff d7d7d7 a8a8a8 7b7b7b 343434 151515 0d2030 415d66 71a6a1 bdffca 25e2cd 0a98ac 005280 00604b 20b562 58d332 139d08 004e00 172808 376d03 6ab417 8cd612 beeb71 eeffa9 b6c121 939717 cc8f15 ffbb31 ffe737 f68f37 ad4e1a 231712 5c3c0d ae6c37 c59782 e2d7b5 4f1507 823c3d da655e e18289 f5b784 ffe9c5 ff82ce cf3c71 871646 a328b3 cc69e4 d59cfc fec9ed e2c9ff a675fe 6a31ca 5a1991 211640 3d34a5 6264dc 9ba0ef 98dcff 5ba8ff 0a89ff 024aca 00177d" },
]

export function bundledColors(p: BundledPalette): string[] {
  return p.colors.split(' ').map((c) => `#${c}`)
}
