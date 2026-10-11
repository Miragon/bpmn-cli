# Arimo (Latin)

`Arimo-Regular-Latin.ttf` is the font `bpmn render` draws PNG text with
(`src/node/render.ts`): Arimo Regular, the Latin subset published by
Fontsource (`@fontsource/arimo` 5.3.0, `arimo-latin-400-normal.woff`),
unpacked from WOFF to TrueType without changing a glyph or table. Arimo is
metric-compatible with Arial, so the line breaks the renderer computes with
Arial's advance widths (`src/diagram/text.ts`) hold in the image.

Copyright 2020 The Arimo Project Authors (https://github.com/googlefonts/arimo),
licensed under the SIL Open Font License, Version 1.1: see `OFL.txt`.
