// Costruisce la pagina unica: TypeScript -> bundle -> iniettato dentro shell.html.
// Nessun framework, nessuna dipendenza a runtime oltre a SheetJS, che la pagina carica da CDN.
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const OUT = "dist";

const bundle = await build({
  entryPoints: ["main.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: process.argv.includes("--minify"),
  write: false,
  logLevel: "info",
});

const js = bundle.outputFiles[0].text;
const shell = await readFile("shell.html", "utf8");
if (!shell.includes("/*__APP__*/")) {
  throw new Error("shell.html non contiene il segnaposto /*__APP__*/");
}

await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/index.html`, shell.replace("/*__APP__*/", js));
// GitHub Pages non serve i file dentro cartelle che iniziano con "_" senza questo file.
await writeFile(`${OUT}/.nojekyll`, "");

const kb = Math.round((await readFile(`${OUT}/index.html`)).length / 1024);
console.log(`dist/index.html — ${kb} KB`);
