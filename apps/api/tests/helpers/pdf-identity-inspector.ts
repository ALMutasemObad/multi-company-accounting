import { inflateSync } from "node:zlib";

type Font = { id: number; name: string; cid: boolean; ascent: number; descent: number };
export type IdentityPdfGlyphRun = { x: number; y: number; font: Font; size: number; codes: number[]; text: string | null };
export type IdentityPdfPacket = {
  page: number; ordinal: number; order: number; firstY: number;
  font: Font; size: number; runs: IdentityPdfGlyphRun[]; signature: string; text: string | null;
};
export type IdentityPdfPage = {
  height: number; packets: IdentityPdfPacket[];
  rectangles: Array<{ x: number; y: number; width: number; height: number }>;
};

function required<T>(value: T | null | undefined, message: string): T {
  if (value === undefined || value === null) throw new Error(message);
  return value;
}

// Restricted to PDFKit's classic-xref, unencrypted fixtures. Follow object offsets
// and declared stream lengths; compressed font bytes are never parsed as syntax.
function readObjects(pdf: Buffer): Map<number, string> {
  const source = pdf.toString("latin1");
  const offset = Number(required(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(source)?.[1], "Missing classic xref"));
  const xref = source.slice(offset);
  const header = required(/^xref\r?\n0 (\d+)\r?\n/.exec(xref), "Unsupported xref format");
  const lines = xref.slice(header[0].length).split(/\r?\n/);
  const entries: Array<{ id: number; offset: number }> = [];
  for (let id = 0; id < Number(header[1]); id++) {
    const entry = required(/^(\d{10}) (\d{5}) ([nf])/.exec(lines[id] ?? ""), "Invalid xref entry");
    if (entry[3] === "n") {
      if (entry[2] !== "00000") throw new Error("Unsupported object generation");
      entries.push({ id, offset: Number(entry[1]) });
    }
  }
  entries.sort((a, b) => a.offset - b.offset);
  return new Map(entries.map((entry, index) => {
    const body = source.slice(entry.offset, entries[index + 1]?.offset ?? offset);
    const prefix = required(new RegExp(`^${entry.id} 0 obj\\r?\\n`).exec(body), "Invalid object offset");
    if (!/\r?\nendobj\s*$/.test(body)) throw new Error("Unterminated PDF object");
    return [entry.id, body.slice(prefix[0].length).replace(/\r?\nendobj\s*$/, "")] as const;
  }));
}

function readStream(body: string): string {
  const stream = required(/\bstream\r?\n/.exec(body), "Missing stream");
  const dictionary = body.slice(0, stream.index);
  const length = required(/\/Length\s+(\d+)(?:\s+(\d+)\s+R)?/.exec(dictionary), "Missing stream length");
  if (length[2]) throw new Error("Unsupported indirect stream length");
  const start = stream.index + stream[0].length;
  const bytes = Buffer.from(body.slice(start, start + Number(length[1])), "latin1");
  if (/\/Filter\s*\/FlateDecode\b/.test(dictionary)) return inflateSync(bytes).toString("latin1");
  if (/\/Filter\b/.test(dictionary)) throw new Error("Unsupported stream filter");
  return bytes.toString("latin1");
}

export function inspectIdentityPdf(pdf: Buffer): IdentityPdfPage[] {
  const objects = readObjects(pdf);
  const get = (id: number) => required(objects.get(id), `Missing PDF object ${id}`);
  const ref = (body: string, name: string) => Number(required(new RegExp(`/${name}\\s+(\\d+) 0 R`).exec(body)?.[1], `Missing ${name}`));
  const refs = (body: string) => [...body.matchAll(/(\d+) 0 R/g)].map((match) => Number(match[1]));
  const fonts = new Map<number, Font>();
  const font = (id: number): Font => {
    const known = fonts.get(id);
    if (known) return known;
    const body = get(id);
    const name = required(/\/BaseFont\s*\/([^\s/]+)/.exec(body)?.[1], "Missing font name");
    const cid = /\/Subtype\s*\/Type0\b/.test(body);
    let ascent = 718, descent = -207; // Helvetica's existing AFM metrics.
    if (cid) {
      if (!/\/Encoding\s*\/Identity-H\b/.test(body)) throw new Error("Unsupported CID encoding");
      const descendant = get(Number(required(/\/DescendantFonts\s*\[\s*(\d+) 0 R/.exec(body)?.[1], "Missing descendant font")));
      const descriptor = get(ref(descendant, "FontDescriptor"));
      ascent = Number(required(/\/Ascent\s+([-\d.]+)/.exec(descriptor)?.[1], "Missing font ascent"));
      descent = Number(required(/\/Descent\s+([-\d.]+)/.exec(descriptor)?.[1], "Missing font descent"));
    } else if (!/^Helvetica(?:-Bold)?$/.test(name)) throw new Error(`Unsupported standard font ${name}`);
    const value = { id, name, cid, ascent, descent };
    fonts.set(id, value);
    return value;
  };
  const catalog = required([...objects.values()].find((body) => /\/Type\s*\/Catalog\b/.test(body)), "Missing catalog");
  const pageIds: number[] = [];
  const walk = (id: number): void => {
    const body = get(id);
    if (/\/Type\s*\/Page\b/.test(body)) pageIds.push(id);
    else refs(required(/\/Kids\s*\[([^\]]*)\]/.exec(body)?.[1], "Missing page children")).forEach(walk);
  };
  walk(ref(catalog, "Pages"));
  let order = 0;
  return pageIds.map((id, pageIndex) => {
    const body = get(id), resources = get(ref(body, "Resources"));
    const fontReferences = required(/\/Font\s*<<([\s\S]*?)>>/.exec(resources)?.[1], "Missing font resources");
    const pageFonts = new Map([...fontReferences.matchAll(/\/(\S+)\s+(\d+) 0 R/g)].map((match) => [match[1]!, font(Number(match[2]))]));
    const height = Number(required(/\/MediaBox\s*\[\s*0\s+0\s+[\d.]+\s+([\d.]+)\s*\]/.exec(body)?.[1], "Missing page size"));
    const contents = required(/\/Contents\s*((?:\d+ 0 R)|(?:\[[^\]]*\]))/.exec(body)?.[1], "Missing page content");
    const content = refs(contents).map((contentId) => readStream(get(contentId))).join("\n");
    const page: IdentityPdfPage = {
      height, packets: [],
      rectangles: [...content.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re\b/g)].map((match) => ({
        x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]),
      })),
    };
    let ordinal = 0;
    for (const packet of content.matchAll(/BT\s+([\s\S]*?)\s+ET/g)) {
      const packetOrdinal = ordinal++;
      const runs: IdentityPdfGlyphRun[] = [];
      let x = 0, y = 0, size = 0, firstY: number | undefined, selected: Font | undefined;
      const operations = /1 0 0 1 ([-\d.]+) ([-\d.]+) Tm|\/(\S+) ([\d.]+) Tf|\[([^\]]*)\]\s*TJ/g;
      // A future Td/Tj/T* or non-identity matrix must fail this bounded inspector,
      // not leave stale glyph coordinates while the geometry assertions pass.
      if (packet[1]!.replace(operations, "").trim()) throw new Error("Unsupported operation in PDF text packet");
      for (const operation of packet[1]!.matchAll(operations)) {
        if (operation[1] !== undefined) { x = Number(operation[1]); y = Number(operation[2]); firstY ??= y; continue; }
        if (operation[3] !== undefined) { selected = required(pageFonts.get(operation[3]), "Unknown font resource"); size = Number(operation[4]); continue; }
        const active = required(selected, "Text shown before font selection");
        if (operation[5]!.replace(/<([\da-f\s]*)>|[-+]?(?:\d+(?:\.\d*)?|\.\d+)/gi, "").trim()) {
          throw new Error("Unsupported PDF text-show operand");
        }
        const hex = [...operation[5]!.matchAll(/<([\da-f\s]*)>/gi)].map((value) => value[1]!.replace(/\s/g, "")).join("");
        if (active.cid && hex.length % 4) throw new Error("Unaligned Identity-H text");
        if (!active.cid && hex.length % 2) throw new Error("Unaligned standard-font text");
        const codes = active.cid ? (hex.match(/.{4}/g) ?? []).map((value) => parseInt(value, 16)) : [];
        runs.push({ x, y, font: active, size, codes, text: active.cid ? null : Buffer.from(hex, "hex").toString("latin1") });
      }
      const first = runs[0];
      if (!first) continue;
      if (runs.some((run) => run.font.id !== first.font.id || run.size !== first.size)) throw new Error("Unexpected mixed-font BT packet");
      page.packets.push({
        page: pageIndex, ordinal: packetOrdinal, order: order++, firstY: required(firstY, "Missing text matrix"),
        font: first.font, size: first.size, runs,
        signature: `${first.font.id}:${runs.flatMap((run) => run.codes).join(",")}`,
        text: first.font.cid ? null : runs.map((run) => run.text).join(""),
      });
    }
    return page;
  });
}

export const glyphBottom = (page: IdentityPdfPage, run: IdentityPdfGlyphRun) => page.height - run.y - run.font.descent * run.size / 1000;
export const glyphTop = (page: IdentityPdfPage, run: IdentityPdfGlyphRun) => page.height - run.y - run.font.ascent * run.size / 1000;
