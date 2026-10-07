import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { ROOT, createRunDirectory, isMain, parseOptions, readJson, runLogged, sha256, writeReport } from "./release-utils.mjs";

export const NODE20_VERSION = "20.20.2";
export const NODE20_ARCHIVE = `node-v${NODE20_VERSION}-darwin-arm64.tar.gz`;
// Verified against the version-specific official HTTPS SHASUMS256.txt, not a guessed hash.
export const NODE20_SHA256 = "466e05f3477c20dfb723054dfebffe55bc74660ee77f612166fca121dacb65b6";
export const NODE20_URL = `https://nodejs.org/dist/v${NODE20_VERSION}/`;

export function verifyOfficialChecksum(text, bytes) {
  const matches = text.split(/\r?\n/).filter((line) => line.endsWith(`  ${NODE20_ARCHIVE}`));
  if (matches.length !== 1 || matches[0] !== `${NODE20_SHA256}  ${NODE20_ARCHIVE}` || sha256(bytes) !== NODE20_SHA256) throw new Error("Official Node20 archive checksum mismatch");
  return NODE20_SHA256;
}

export function validateNode20Version(version) {
  if (!/^v20\.\d+\.\d+$/.test(version.trim())) throw new Error("Minimum-runtime evidence requires an actual Node20 executable");
  return version.trim();
}

export function validateArchiveNames(names) {
  const prefix = `node-v${NODE20_VERSION}-darwin-arm64`;
  const files = names.trimEnd().split("\n");
  if (!files.length || files.some((file) => !file.startsWith(`${prefix}/`) || file.includes("\\") || file.split("/").some((part) => part === ".." || part === "."))) throw new Error("Unexpected official archive namespace");
}

async function readGateEvidence(stdout, label) {
  const prefix = label === "source" ? "Source evidence: " : "Packed-consumer evidence: ";
  const line = stdout.split("\n").find((line) => line.startsWith(prefix));
  if (!line) throw new Error("Missing child gate evidence");
  const directory = line.slice(prefix.length);
  if (!directory.startsWith(path.join(ROOT, "tmp/release-contract") + path.sep)) throw new Error("Child evidence outside checkout tmp");
  const report = await readJson(path.join(directory, "report.json"));
  if (report.status !== "passed") throw new Error("Child gate did not pass");
  validateNode20Version(report.node);
  return directory;
}

export async function node20Gate(options = {}) {
  const { download = false, node, network = false } = options;
  if (download && node) throw new Error("Choose --download or a clearly provided --node executable, not both");
  if (!download && !node && !process.version.startsWith("v20.")) throw new Error("Use --download on Darwin arm64, or --node=/absolute/path/to/node20");
  if (download && (process.platform !== "darwin" || process.arch !== "arm64")) throw new Error("Pinned download is Darwin arm64 only; provide an appropriate Node20 executable");
  if (node && !path.isAbsolute(node)) throw new Error("Provided Node executable must be absolute");
  const directory = await createRunDirectory("node20");
  let executable = node ?? process.execPath;
  const evidence = { mode: download ? "official-checksummed-download" : "provided-executable", network, authorization: "none" };
  try {
    if (download) {
      const checksums = path.join(directory, "SHASUMS256.txt");
      const archive = path.join(directory, NODE20_ARCHIVE);
      const curlFlags = ["--disable", "--fail", "--silent", "--show-error", "--proto", "=https", "--tlsv1.2", "--max-time", "180"];
      await runLogged(directory, "download-checksums", "curl", [...curlFlags, "--output", checksums, `${NODE20_URL}SHASUMS256.txt`]);
      await runLogged(directory, "download-archive", "curl", [...curlFlags, "--output", archive, `${NODE20_URL}${NODE20_ARCHIVE}`]);
      evidence.archiveSha256 = verifyOfficialChecksum(await readFile(checksums, "utf8"), await readFile(archive));
      evidence.archiveUrl = `${NODE20_URL}${NODE20_ARCHIVE}`;
      const inventory = await runLogged(directory, "archive-inventory", "tar", ["-tzf", archive]);
      validateArchiveNames(inventory.stdout);
      await runLogged(directory, "extract-archive", "tar", ["-xzf", archive, "-C", directory]);
      executable = path.join(directory, `node-v${NODE20_VERSION}-darwin-arm64/bin/node`);
    }
    executable = await realpath(executable);
    if (!(await lstat(executable)).isFile()) throw new Error("Provided Node executable must be a regular file");
    evidence.executableSha256 = sha256(await readFile(executable));
    const runtime = await runLogged(directory, "runtime-version", executable, ["--version"]);
    evidence.runtime = validateNode20Version(runtime.stdout);
    if (download && evidence.runtime !== `v${NODE20_VERSION}`) throw new Error("Unexpected pinned Node version");
    const flags = network ? ["--network"] : [];
    const source = await runLogged(directory, "source-gate", executable, [path.join(ROOT, "scripts/source-gate.mjs"), ...flags]);
    evidence.sourceEvidence = await readGateEvidence(source.stdout, "source");
    const consumer = await runLogged(directory, "packed-consumer", executable, [path.join(ROOT, "scripts/packed-consumer.mjs"), ...flags]);
    evidence.consumerEvidence = await readGateEvidence(consumer.stdout, "consumer");
    await writeReport(directory, { status: "passed", ...evidence });
    console.log(`Actual Node20 evidence: ${directory}`);
    return directory;
  } catch (error) {
    await writeReport(directory, { status: "failed", ...evidence, failure: error.message });
    throw error;
  }
}

if (isMain(import.meta.url)) {
  try { await node20Gate(parseOptions(process.argv.slice(2), ["node"], ["network", "download"])); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
