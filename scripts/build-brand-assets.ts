/**
 * Brand asset pipeline.
 *
 *     npx tsx scripts/build-brand-assets.ts <source.png>
 *
 * Turns a raw logo export into the sizes the app actually ships.
 *
 * Why this exists rather than "just drop the PNG in /public":
 *
 *   1. The source is 2000x2000 with the mark filling ~40% of the canvas. Shipping
 *      it raw means a 27px header logo costs a 177 KB download, and the visible
 *      mark is ~11px.
 *   2. The source is 24bpp RGB — no alpha. Dropped straight onto the near-black
 *      UI it renders as a white square.
 *   3. Favicons, the header mark and the OG image each want a different size and
 *      a different amount of padding, and hand-maintaining those means they drift.
 *
 * The background knockout is the interesting part.
 *
 * The source looks white in any image viewer, but `removeAlpha()` shows the
 * pixels are actually (0,0,0) — a black backdrop with no alpha channel. Reading
 * it as white would have inverted every pixel and produced an invisible logo, so
 * this samples the corners rather than trusting the preview.
 *
 * Compositing maths against a black backdrop:
 *
 *     observed = alpha * foreground          (background contributes 0)
 *  =>  alpha   = max(r,g,b) / 255
 *  =>  fg_c    = observed_c / alpha
 *
 * Taking the *maximum* channel as the opacity estimate is what makes this clean:
 * a pixel only reads as opaque where some channel is bright, so anti-aliased
 * edges get a gradient alpha instead of a stair-step, and the un-premultiply
 * normalises the brightest channel back to exactly 255 — which means fully-opaque
 * interior pixels come through **bit-identical** and only the edges are touched.
 * (Knocking out a *white* backdrop has to use the minimum channel instead, and
 * unavoidably deepens every colour. Black is the better backdrop to receive.)
 *
 * Known limitation: a pixel of pure saturated red (255,0,0) implies alpha 1.0 and
 * unpremultiplies to itself — correct. But a *dim* red (20,0,0) reads as alpha
 * ~0.08 and comes back brighter than authored. Invisible on this mark, which has
 * no near-black fills. If you swap in a logo with dark tones, export a real
 * transparent PNG and this whole step becomes unnecessary.
 */
import sharp from 'sharp';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const SRC = process.argv[2] ?? 'C:/Users/ocean/Downloads/Black Modern A letter Logo.png';
const OUT_PUBLIC = path.resolve('apps/web/public/brand');
const OUT_APP = path.resolve('apps/web/app');

/** Page background, so previews and the OG image match the real thing. */
const BG = { r: 0x0a, g: 0x0a, b: 0x0a };

/**
 * Pixels at or below this brightness are backdrop. The 3 is not arbitrary
 * noise-tolerance fudging: PNG round-tripping of a near-black matte can leave a
 * value of 1-2, and treating that as content produces a full-canvas bbox and a
 * logo with a visible dark halo.
 */
const FLOOR = 3;

/**
 * Verify the backdrop before trusting it. Every corner must be background, and
 * the four edge midpoints too — if any is content the mark is bleeding off the
 * canvas and a trim would clip it, which is worth failing loudly over.
 */
async function assertFlatBackdrop(width: number, height: number, channels: number, data: Buffer) {
  const at = (x: number, y: number) => {
    const p = (y * width + x) * channels;
    return Math.max(data[p], data[p + 1], data[p + 2]);
  };
  const probes: Array<[string, number, number]> = [
    ['top-left', 0, 0],
    ['top-right', width - 1, 0],
    ['bottom-left', 0, height - 1],
    ['bottom-right', width - 1, height - 1],
    ['top-mid', width >> 1, 0],
    ['bottom-mid', width >> 1, height - 1],
    ['left-mid', 0, height >> 1],
    ['right-mid', width - 1, height >> 1],
  ];
  const lit = probes.filter(([, x, y]) => at(x, y) > FLOOR);
  if (lit.length) {
    throw new Error(
      `Backdrop is not flat — these probes contain artwork: ${lit.map(([n]) => n).join(', ')}. ` +
        `A trim would clip the mark; supply a version with transparent margins.`,
    );
  }
}

async function main() {
  const src = await stat(SRC).catch(() => null);
  if (!src) throw new Error(`Source not found: ${SRC}`);

  await mkdir(OUT_PUBLIC, { recursive: true });

  // ── 1. Read as raw RGB and derive alpha ────────────────────────────────
  const img = sharp(SRC).removeAlpha();
  const meta = await img.metadata();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  console.log(`  source      ${width}x${height} ${meta.format} ${meta.space ?? '?'}`);

  await assertFlatBackdrop(width, height, channels, data);

  const rgba = Buffer.alloc(width * height * 4);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let i = 0, p = 0; i < width * height; i++, p += channels) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];

    // Opacity from the brightest channel.
    const max = Math.max(r, g, b);
    const o = i * 4;
    if (max <= FLOOR) {
      // Fully transparent. RGB is undefined here; 0 keeps the buffer tidy for
      // any encoder that ignores alpha.
      rgba[o] = 0;
      rgba[o + 1] = 0;
      rgba[o + 2] = 0;
      rgba[o + 3] = 0;
      continue;
    }

    // Un-premultiply out of the black backdrop.
    const inv = 255 / max;
    rgba[o] = Math.min(255, Math.round(r * inv));
    rgba[o + 1] = Math.min(255, Math.round(g * inv));
    rgba[o + 2] = Math.min(255, Math.round(b * inv));
    rgba[o + 3] = max;

    // Content bbox. Threshold is low so a soft edge still counts as content and
    // the swoosh tips are not shaved off.
    const x = i % width;
    const y = (i / width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (maxX < 0) throw new Error('No artwork found — the source looks empty.');

  // 2% breathing room so the tightest crop does not clip the swoosh tips.
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.02);
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const w = Math.min(width - left, maxX - minX + 1 + pad * 2);
  const h = Math.min(height - top, maxY - minY + 1 + pad * 2);
  console.log(`  content bbox ${minX},${minY} -> ${maxX},${maxY}  (crop ${w}x${h})`);

  // ── 2. Crop to content, on a transparent canvas ───────────────────────
  const trimmed = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .extract({ left, top, width: w, height: h })
    .png()
    .toBuffer();

  await writeFile(path.join(OUT_PUBLIC, 'logo.png'), trimmed);
  console.log(`  logo.png     ${w}x${h} (source of truth, trimmed)`);

  // ── 3. Header mark ───────────────────────────────────────────────────
  // Small on screen, so it must not be over-downsampled: 2x the 28px slot.
  await sharp(trimmed).resize(112, 112, { fit: 'inside' }).png({ compressionLevel: 9 }).toFile(
    path.join(OUT_PUBLIC, 'logo-112.png'),
  );

  // ── 4. Favicon set ───────────────────────────────────────────────────
  for (const size of [16, 32, 48]) {
    await sharp(trimmed).resize(size, size, { fit: 'contain', background: { ...BG, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT_PUBLIC, `favicon-${size}.png`));
  }

  // ── 5. Next.js app icons (file conventions in app/) ─────────────────
  // Next generates <link rel=icon> and the Apple touch icon from these.
  await sharp(trimmed).resize(512, 512, { fit: 'contain', background: { ...BG, alpha: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_APP, 'icon.png'));

  await sharp(trimmed).resize(180, 180, { fit: 'contain', background: { ...BG, alpha: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_APP, 'apple-icon.png'));

  // ── 6. Open Graph card ───────────────────────────────────────────────
  // 1200x630 is the size every social platform crops to. Logo centred on the
  // page background so the card matches the site it links to.
  const CARD_W = 1200;
  const CARD_H = 630;
  const markH = Math.round(CARD_H * 0.52);
  const mark = await sharp(trimmed).resize({ height: markH }).png().toBuffer();

  await sharp({
    create: { width: CARD_W, height: CARD_H, channels: 4, background: { ...BG, alpha: 1 } },
  })
    .composite([{ input: mark, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_APP, 'opengraph-image.png'));

  // ── 7. Preview on the real background ────────────────────────────────
  // The whole point of the knockout is that it looks right on near-black, so
  // actually look at it rather than trusting the maths.
  const prev = await sharp(trimmed)
    .resize(360, 360, { fit: 'inside' })
    .flatten({ background: BG })
    .png()
    .toBuffer();
  await writeFile(path.join(OUT_PUBLIC, '_preview-on-bg.png'), prev);

  for (const f of ['logo.png', 'logo-112.png', 'favicon-16.png', 'favicon-32.png', 'favicon-48.png']) {
    const s = await stat(path.join(OUT_PUBLIC, f));
    console.log(`  ${f.padEnd(16)} ${String(Math.round(s.size / 102.4) / 10).padStart(6)} KB`);
  }
  for (const f of ['icon.png', 'apple-icon.png', 'opengraph-image.png']) {
    const s = await stat(path.join(OUT_APP, f));
    console.log(`  app/${f.padEnd(11)} ${String(Math.round(s.size / 102.4) / 10).padStart(6)} KB`);
  }
}

main().catch((e) => {
  console.error('brand asset build failed:', e);
  process.exit(1);
});