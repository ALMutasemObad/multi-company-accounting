import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../src/document-output-kernel/fonts/NotoSansArabic.ttf", import.meta.url));
const target = fileURLToPath(new URL("../dist/document-output-kernel/fonts/NotoSansArabic.ttf", import.meta.url));
mkdirSync(fileURLToPath(new URL("../dist/document-output-kernel/fonts/", import.meta.url)), { recursive: true });
copyFileSync(source, target);
