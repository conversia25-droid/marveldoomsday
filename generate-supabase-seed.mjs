import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(root, "index.html");
const postersPath = path.join(root, "posters.json");
const outputPath = path.join(root, "supabase", "seed.sql");

function extractBranches(html) {
  const marker = "const BRANCHES = ";
  const start = html.indexOf(marker);
  if (start < 0) throw new Error("Nao encontrei const BRANCHES no index.html.");

  const arrayStart = html.indexOf("[", start + marker.length);
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let i = arrayStart; i < html.length; i += 1) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "[") depth += 1;
    if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        const branchSource = html.slice(arrayStart, i + 1);
        const sandbox = {
          C: {
            mcu: "#E5484D",
            series: "#2DD4BF",
            xmen: "#F5B841",
            spider: "#8B7BFF",
            extra: "#8A94A6",
            doom: "#34D399",
            gold: "#E8B04B",
          },
          M: { E: "essencial", R: "recomendado", C: "completista" },
        };
        return vm.runInNewContext(`(${branchSource})`, sandbox, { timeout: 1000 });
      }
    }
  }

  throw new Error("Nao consegui fechar o array BRANCHES.");
}

function sql(value) {
  if (value === undefined || value === null || value === "") return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${String(value).replaceAll("'", "''")}'`;
}

const html = fs.readFileSync(indexPath, "utf8");
const branches = extractBranches(html);
const posters = fs.existsSync(postersPath)
  ? JSON.parse(fs.readFileSync(postersPath, "utf8") || "{}")
  : {};

const lines = [
  "begin;",
  "",
  "insert into public.branches (id, color, emblem, title, subtitle, merge_text, dashed, display_order)",
  "values",
];

lines.push(branches.map((branch, index) => (
  `  (${sql(branch.id)}, ${sql(branch.color)}, ${sql(branch.emblem)}, ${sql(branch.title)}, ${sql(branch.sub)}, ${sql(branch.merge)}, ${sql(!!branch.dashed)}, ${index + 1})`
)).join(",\n"));

lines.push(`on conflict (id) do update set
  color = excluded.color,
  emblem = excluded.emblem,
  title = excluded.title,
  subtitle = excluded.subtitle,
  merge_text = excluded.merge_text,
  dashed = excluded.dashed,
  display_order = excluded.display_order;`);
lines.push("");
lines.push("insert into public.movies (id, branch_id, title, search_query, release_year, story_year, media_type, importance, note, why, poster_path, active, display_order)");
lines.push("values");

const movieValues = [];
branches.forEach((branch) => {
  branch.items.forEach((item, index) => {
    movieValues.push(`  (${sql(item.id)}, ${sql(branch.id)}, ${sql(item.t)}, ${sql(item.q || item.t)}, ${sql(item.y)}, ${sql(item.cy)}, ${sql(item.tv ? "tv" : "movie")}, ${sql(item.m)}, ${sql(item.note)}, ${sql(item.w)}, ${sql(posters[item.id])}, true, ${index + 1})`);
  });
});
lines.push(movieValues.join(",\n"));
lines.push(`on conflict (id) do update set
  branch_id = excluded.branch_id,
  title = excluded.title,
  search_query = excluded.search_query,
  release_year = excluded.release_year,
  story_year = excluded.story_year,
  media_type = excluded.media_type,
  importance = excluded.importance,
  note = excluded.note,
  why = excluded.why,
  poster_path = excluded.poster_path,
  active = excluded.active,
  display_order = excluded.display_order;`);
lines.push("");
lines.push("commit;");
lines.push("");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
console.log(`Seed gerado em ${outputPath}`);
