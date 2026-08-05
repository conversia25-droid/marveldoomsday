import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(root, "index.html");
const outputPath = path.join(root, "posters.json");
const token = process.env.TMDB_TOKEN || process.env.TMDB_READ_TOKEN || process.env.TMDB_BEARER_TOKEN;
const refreshAll = process.argv.includes("--refresh");
const fromSupabase = process.argv.includes("--from-supabase");

if (!token) {
  console.error("Defina TMDB_TOKEN com o Token de Leitura da API do TMDB.");
  process.exit(1);
}

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
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = "";
      }
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
          C: new Proxy({}, { get: (_target, prop) => String(prop) }),
          M: { E: "essencial", R: "recomendado", C: "completista" },
        };
        return vm.runInNewContext(`(${branchSource})`, sandbox, { timeout: 1000 });
      }
    }
  }

  throw new Error("Nao consegui fechar o array BRANCHES.");
}

async function fetchPoster(item) {
  const kind = item.tv ? "tv" : "movie";
  const yearParam = item.tv ? "first_air_date_year" : "primary_release_year";
  const params = new URLSearchParams({
    query: item.q || item.t,
    [yearParam]: String(item.y),
    language: "pt-BR",
    page: "1",
  });
  const url = `https://api.themoviedb.org/3/search/${kind}?${params.toString()}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (!response.ok) {
    throw new Error(`TMDB retornou ${response.status} para ${item.t}`);
  }

  const data = await response.json();
  return data.results?.[0]?.poster_path || "";
}

async function loadItemsFromSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Defina SUPABASE_URL e SUPABASE_ANON_KEY para usar --from-supabase.");
  }

  const url = new URL("/rest/v1/movies", supabaseUrl);
  url.searchParams.set("select", "id,title,search_query,release_year,media_type");
  url.searchParams.set("active", "eq.true");
  url.searchParams.set("order", "branch_id.asc,display_order.asc");

  const response = await fetch(url, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  if (!response.ok) throw new Error(`Supabase retornou ${response.status} ao listar filmes.`);

  const rows = await response.json();
  return rows.map((row) => ({
    id: row.id,
    t: row.title,
    q: row.search_query || row.title,
    y: row.release_year,
    tv: row.media_type === "tv" ? 1 : 0,
  }));
}

async function loadLocalItems() {
  const html = fs.readFileSync(indexPath, "utf8");
  const branches = extractBranches(html);
  return branches.flatMap((branch) => branch.items);
}

const items = fromSupabase ? await loadItemsFromSupabase() : await loadLocalItems();
const posters = fs.existsSync(outputPath)
  ? JSON.parse(fs.readFileSync(outputPath, "utf8") || "{}")
  : {};

let found = 0;
let missing = 0;

for (const item of items) {
  if (posters[item.id] && !refreshAll) {
    found += 1;
    continue;
  }

  const poster = await fetchPoster(item);
  if (poster) {
    posters[item.id] = poster;
    found += 1;
    console.log(`OK  ${item.t}`);
  } else {
    missing += 1;
    console.log(`--  sem capa: ${item.t}`);
  }
}

const ordered = Object.fromEntries(
  Object.entries(posters).sort(([a], [b]) => a.localeCompare(b))
);

fs.writeFileSync(outputPath, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
console.log(`\nposters.json atualizado: ${found} capas, ${missing} sem resultado.`);
