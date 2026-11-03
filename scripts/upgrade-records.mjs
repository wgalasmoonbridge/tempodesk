// Upgrade safety: source databases are opened read-only; snapshots include committed WAL data.
// Never prints descriptions, client/project names, settings values, or full records.
import { DatabaseSync, backup } from "node:sqlite";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

const tables = {
  clients: ["id"], projects: ["id"], tags: ["id"],
  time_entries: ["id"], entry_tags: ["entry_id", "tag_id"], app_settings: ["key"],
};

function inspect(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000; BEGIN");
    const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
    if (integrity !== "ok") throw new Error("Database integrity check failed");
    const result = { schema: db.prepare("PRAGMA user_version").get().user_version, tables: {} };
    for (const [table, keys] of Object.entries(tables)) {
      const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${keys.join(", ")}`).all();
      result.tables[table] = Object.fromEntries(rows.map((row) => [
        JSON.stringify(keys.map((key) => row[key])),
        createHash("sha256").update(JSON.stringify(row)).digest("hex"),
      ]));
    }
    result.activeTimers = db.prepare("SELECT COUNT(*) AS n FROM time_entries WHERE end_at_utc IS NULL AND deleted_at_utc IS NULL").get().n;
    result.visibleEntries = db.prepare("SELECT COUNT(*) AS n FROM time_entries WHERE deleted_at_utc IS NULL").get().n;
    db.exec("COMMIT");
    return result;
  } finally { db.close(); }
}

function compare(expected, actual) {
  for (const [table, rows] of Object.entries(expected.tables)) {
    for (const [key, hash] of Object.entries(rows)) {
      if (actual.tables[table][key] !== hash) throw new Error(`Existing ${table} record is missing or changed (${key})`);
    }
  }
  return Object.fromEntries(Object.entries(expected.tables).map(([name, rows]) => [name, Object.keys(rows).length]));
}

const [mode, source, destination] = process.argv.slice(2);
if (mode === "snapshot") {
  const root = resolve(".upgrade-backups");
  const target = resolve(destination ?? "");
  if (!isAbsolute(source ?? "") || !target.startsWith(root + sep) || existsSync(target)) {
    throw new Error("Choose an absolute source and a new snapshot directory within .upgrade-backups");
  }
  mkdirSync(target, { recursive: true });
  const snapshot = join(target, "tempodesk-before-upgrade.db");
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, snapshot); } finally { db.close(); }
  const manifest = inspect(snapshot);
  writeFileSync(join(target, "records.json"), JSON.stringify(manifest, null, 2));
  const installed = join(process.env.LOCALAPPDATA, "TempoDesk", "tempodesk.exe");
  if (existsSync(installed)) copyFileSync(installed, join(target, "tempodesk-before-upgrade.exe"));
  console.log(JSON.stringify({ snapshot, schema: manifest.schema, visibleEntries: manifest.visibleEntries, activeTimers: manifest.activeTimers,
    counts: Object.fromEntries(Object.entries(manifest.tables).map(([name, rows]) => [name, Object.keys(rows).length])) }, null, 2));
} else if (mode === "verify") {
  const expected = JSON.parse(readFileSync(destination, "utf8"));
  let actual = inspect(source);
  if (process.argv.includes("--wait-for-schema=2")) {
    const deadline = Date.now() + 30000;
    while (actual.schema !== 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      actual = inspect(source);
    }
    if (actual.schema !== 2) throw new Error("Updated app did not apply schema version 2");
  }
  console.log(JSON.stringify({ verified: true, schema: actual.schema, visibleEntries: actual.visibleEntries, activeTimers: actual.activeTimers, preserved: compare(expected, actual) }, null, 2));
} else if (mode === "binary-verify") {
  const installed = readFileSync(source);
  const expected = readFileSync(destination);
  // Tauri temporarily patches this marker while bundling, then resets the build artifact.
  const marker = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK");
  const position = expected.indexOf(marker);
  if (position < 0 || expected.indexOf(marker, position + 1) >= 0) throw new Error("Release bundle marker is missing or ambiguous");
  expected.write("NSS", position + marker.length - 3, 3, "ascii");
  if (!installed.equals(expected)) throw new Error("Installed program does not match the packaged NSIS release");
  console.log(JSON.stringify({ matched: true, bundleType: "NSIS", sha256: createHash("sha256").update(installed).digest("hex") }));
} else if (mode === "trial-copy") {
  const manifestPath = resolve(destination);
  const trialPath = join(dirname(manifestPath), "migration-trial.db");
  if (!manifestPath.startsWith(resolve(".upgrade-backups") + sep) || existsSync(trialPath)) throw new Error("Invalid migration trial location");
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, trialPath); } finally { db.close(); }
  console.log(trialPath);
} else {
  throw new Error("Usage: upgrade-records.mjs snapshot <absolute-db> <new-backup-folder> | verify <db> <records.json> | trial-copy <snapshot-db> <records.json>");
}
