import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { renderLogo } from "./content/logo.js";

const { env } = loadConfig();
const dir = resolve("data/brand");
mkdirSync(dir, { recursive: true });
const brand = env.BRAND_NAME ?? "Achadinhos";
await renderLogo(resolve(dir, "logo-1080.png"), 1080, brand);
await renderLogo(resolve(dir, "logo-512.png"), 512, brand);
await renderLogo(resolve(dir, "icone-512.png"), 512, brand, false);
await renderLogo(resolve(dir, "favicon-64.png"), 64, brand, false);
console.log(`[logo] gerado em ${dir}`);
