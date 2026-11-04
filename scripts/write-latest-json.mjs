// Run after `npm run app:build`. Writes the latest.json that installed copies of ScriptOS
// look for, describing the new installer. Attach it to the GitHub release along with the
// installer and its .sig file.
import { existsSync, readFileSync, writeFileSync } from "fs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const dir = new URL("../src-tauri/target/release/bundle/nsis/", import.meta.url);
const installer = `ScriptOS_${version}_x64-setup.exe`;
const sig = new URL(`${installer}.sig`, dir);

if (!existsSync(new URL(installer, dir)) || !existsSync(sig)) {
  console.error(`No signed ${version} installer found. Build it first, with TAURI_SIGNING_PRIVATE_KEY set.`);
  process.exit(1);
}

const manifest = {
  version,
  notes: process.argv.slice(2).join(" "),
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: readFileSync(sig, "utf8").trim(),
      url: `https://github.com/DonkableDoof/ScriptOS/releases/download/v${version}/${installer}`,
    },
  },
};
const out = new URL("latest.json", dir);
writeFileSync(out, JSON.stringify(manifest, null, 2));
console.log(`Wrote latest.json for ${version}. Attach these to the v${version} release:`);
console.log(`  ${installer}\n  ${installer}.sig\n  latest.json`);
