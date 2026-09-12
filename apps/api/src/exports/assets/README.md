# Ticket font

`NotoSans-Regular.bin` is the unmodified Noto Sans Regular TrueType font from the [official Noto font repository](https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf). It is bundled under the SIL Open Font License in [OFL.txt](OFL.txt).

Downloaded on 2026-09-13. SHA-256 is `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5`.

The `.bin` extension makes the font an `ArrayBuffer` module under the [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/reference/non-javascript-modules/). The Worker needs no runtime font request. The PDF renderer embeds only the glyphs used by each ticket. The bundled font covers Latin, Kazakh and Russian text; unsupported code points are printed explicitly as `U+` notation instead of invisible missing glyphs.
