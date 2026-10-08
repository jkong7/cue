import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";

const watch = process.argv.includes("--watch");
mkdirSync("dist", { recursive: true });

const common = { bundle: true, sourcemap: "inline", logLevel: "warning", define: { "process.env.NODE_ENV": '"production"' } };

await Promise.all([
  build({ ...common, entryPoints: ["src/main/index.ts"], outfile: "dist/main.js", platform: "node", format: "esm", external: ["electron"], target: "node24" }),
  build({ ...common, entryPoints: ["src/preload/index.ts"], outfile: "dist/preload.cjs", platform: "node", format: "cjs", external: ["electron"], target: "node24" }),
  build({ ...common, entryPoints: { overlay: "src/renderer/overlay.tsx", dashboard: "src/renderer/dashboard.tsx" }, outdir: "dist", platform: "browser", format: "esm", target: "chrome140", jsx: "automatic" }),
  build({ ...common, entryPoints: ["src/renderer/pcm-worklet.ts"], outfile: "dist/pcm-worklet.js", platform: "browser", format: "esm", target: "chrome140" }),
]);

for (const f of ["overlay.html", "dashboard.html", "styles.css"]) cpSync(`src/renderer/${f}`, `dist/${f}`);
const helper = "bin/cue-audio";
const source = "native/cue-audio.swift";
if (process.platform === "darwin" && (!existsSync(helper) || statSync(helper).mtimeMs < statSync(source).mtimeMs)) {
  mkdirSync("bin", { recursive: true });
  try {
    execFileSync("swiftc", ["-O", source, "-o", helper], { stdio: "inherit" });
  } catch {
    console.warn("could not compile the system audio helper; install Xcode command line tools");
  }
}
if (!watch) console.log("built dist/");
