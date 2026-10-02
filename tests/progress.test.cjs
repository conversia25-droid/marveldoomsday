const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const html = readFileSync(join(__dirname, "../index.html"), "utf8");
// Exercise the actual account lifecycle without loading the CDN presentation layer.
const appSource = html.slice(html.indexOf("function readCachedProgress("), html.indexOf("  const lvl = FILTER_LEVEL[filter];"))
  + "return { watched, profile, progressReady, progressLocked, toggle, resetAll, syncState, refreshProfile }; } App;";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function harness({ cache = {}, rows = {}, premium = {}, online = true } = {}) {
  const storage = new Map(Object.entries(cache));
  const requests = [];
  const readDelays = new Map();
  const readErrors = new Set();
  let writeError = false;
  let writeDelay = null;
  let authListener;
  let currentSession = null;
  const client = {
    auth: {
      onAuthStateChange(listener) {
        authListener = listener;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel() {},
    from(table) {
      const query = {
        table, action: "select", filters: {},
        select() { return this; },
        eq(key, value) { this.filters[key] = value; return this; },
        upsert(value) { this.action = "upsert"; this.value = value; return this; },
        delete() { this.action = "delete"; return this; },
        maybeSingle() { return execute(this); },
        then(resolve, reject) { return execute(this).then(resolve, reject); },
      };
      return query;
    },
  };
  async function execute(query) {
    requests.push(query);
    if (query.table === "profiles") {
      const id = query.filters.id;
      return { data: { id, premium_lifetime: premium[id] !== false }, error: null };
    }
    assert.equal(query.table, "watch_progress");
    const id = query.filters.user_id || query.value?.user_id;
    if (query.action === "select") {
      if (readDelays.has(id)) return readDelays.get(id).promise;
      if (readErrors.has(id)) return { error: { message: "offline" } };
      const data = (rows[id] || []).filter((row) => query.filters.watched === undefined || row.watched === query.filters.watched);
      return { data, error: null };
    }
    if (writeDelay) await writeDelay.promise;
    if (writeError) return { error: { message: "write failed" } };
    if (query.action === "upsert") {
      rows[id] = [...(rows[id] || []).filter((row) => row.movie_id !== query.value.movie_id), query.value];
    } else {
      rows[id] = query.filters.movie_id
        ? (rows[id] || []).filter((row) => row.movie_id !== query.filters.movie_id)
        : [];
    }
    return { error: null };
  }

  const slots = [];
  const pendingEffects = new Map();
  let cursor = 0;
  let dirty = true;
  let app;
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const branches = [{ id: "test", items: [{ id: "i01", t: "Iron Man" }] }];
  const context = vm.createContext({
    console,
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    sessionStorage: { getItem: () => null },
    window: { addEventListener() {}, removeEventListener() {} },
    setTimeout: () => 1,
    clearTimeout() {},
    confirm: () => true,
    createRouteClient: () => online ? client : null,
    readInitialSession: async () => currentSession,
    cleanAuthUrl() {},
    profileToForm: () => ({}),
    profileFromSession: (session) => ({ id: session.user.id, premium_lifetime: false }),
    isPwaStandalone: () => true,
    loadRouteFromSupabase: async () => branches,
    loadPosterManifest: async () => false,
    BRANCHES: branches,
    posterCache: {},
    TMDB_TOKEN: "",
    PROFILE_SELECT: "id,premium_lifetime",
    PWA_NUDGE_SESSION_KEY: "pwa",
    LIFETIME_PRICE_LABEL: "R$9,99",
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, (value) => {
        const next = typeof value === "function" ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) {
          slots[index].value = next;
          dirty = true;
        }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo(fn, deps) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { value: fn(), deps };
      return slots[index].value;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || !sameDeps(previous.deps, deps)) {
        slots[index] = { deps, cleanup: previous?.cleanup };
        pendingEffects.set(index, fn);
      }
    },
  });
  const App = vm.runInContext(appSource, context);
  function render() {
    cursor = 0;
    dirty = false;
    app = App();
    return app;
  }
  async function flush() {
    for (let i = 0; i < 30; i++) {
      render();
      for (const [index, effect] of pendingEffects) {
        pendingEffects.delete(index);
        slots[index].cleanup?.();
        slots[index].cleanup = effect();
      }
      await new Promise(setImmediate);
      if (!dirty && !pendingEffects.size) return app;
    }
    throw new Error("Account lifecycle did not settle");
  }
  return {
    flush, render, storage, requests, readDelays, readErrors,
    get app() { return app; },
    switchUser(id) {
      currentSession = id ? { user: { id, email: `${id}@example.test` } } : null;
      authListener("SIGNED_IN", currentSession);
    },
    failWrites(value) { writeError = value; },
    delayWrites(value) { writeDelay = value; },
  };
}

const watchedRow = (movie_id) => ({ movie_id, watched: true });
const writes = (h) => h.requests.filter((query) => query.table === "watch_progress" && query.action !== "select");

test("a new account never imports the shared legacy cache or another account's cache", async () => {
  const h = harness({ cache: { rd_watched: '["i01"]', "rd_watched:alice": '["i02"]' } });
  await h.flush();
  h.switchUser("bob");
  await h.flush();
  assert.equal(h.app.watched.size, 0);
  assert.equal(h.storage.get("rd_watched:bob"), "[]");
  assert.equal(writes(h).length, 0);
});

test("switching accounts hides old progress before the next profile is loaded", async () => {
  const h = harness({ rows: { alice: [watchedRow("i01")], bob: [watchedRow("i02")] } });
  await h.flush();
  h.switchUser("alice");
  await h.flush();
  assert.deepEqual([...h.app.watched], ["i01"]);
  h.switchUser("bob");
  const firstRender = h.render();
  assert.equal(firstRender.watched.size, 0);
  assert.equal(firstRender.profile, null);
  assert.equal(firstRender.progressLocked, true);
  await h.flush();
  assert.deepEqual([...h.app.watched], ["i02"]);
  assert.equal(h.storage.get("rd_watched:alice"), '["i01"]');
  assert.equal(writes(h).length, 0);
});

test("a delayed read from a previous account cannot overwrite the current account", async () => {
  const h = harness({ rows: { bob: [watchedRow("i02")] } });
  const pending = deferred();
  h.readDelays.set("alice", pending);
  await h.flush();
  h.switchUser("alice");
  await h.flush();
  h.switchUser("bob");
  await h.flush();
  pending.resolve({ data: [watchedRow("i01")], error: null });
  await h.flush();
  assert.deepEqual([...h.app.watched], ["i02"]);
  assert.equal(h.storage.has("rd_watched:alice"), false);
});

test("offline fallback reads only this user's cache and cannot save unverified progress", async () => {
  const h = harness({ cache: { rd_watched: '["i01"]', "rd_watched:alice": '["i02"]', "rd_watched:bob": '["i03"]' } });
  h.readErrors.add("bob");
  await h.flush();
  h.switchUser("bob");
  await h.flush();
  assert.deepEqual([...h.app.watched], ["i03"]);
  assert.equal(h.app.progressReady, false);
  await h.app.toggle("i04");
  assert.equal(writes(h).length, 0);
});

test("an account without lifetime access cannot inherit another account's entitlement", async () => {
  const h = harness({ premium: { bob: false }, rows: { alice: [watchedRow("i01")] } });
  await h.flush();
  h.switchUser("alice");
  await h.flush();
  h.switchUser("bob");
  await h.render().toggle("i02");
  await h.flush();
  assert.equal(h.app.watched.size, 0);
  assert.equal(h.app.progressLocked, true);
  assert.equal(writes(h).length, 0);
});

test("rows marked unwatched do not count as watched", async () => {
  const h = harness({ rows: { alice: [watchedRow("i01"), { movie_id: "i02", watched: false }] } });
  await h.flush();
  h.switchUser("alice");
  await h.flush();
  assert.deepEqual([...h.app.watched], ["i01"]);
});

test("a successful marking is saved and cached only for the current user", async () => {
  const h = harness({ rows: { alice: [watchedRow("i01")] } });
  await h.flush();
  h.switchUser("alice");
  await h.flush();
  await h.app.toggle("i02");
  await h.flush();
  assert.deepEqual([...h.app.watched], ["i01", "i02"]);
  assert.equal(writes(h)[0].value.user_id, "alice");
  assert.equal(h.storage.get("rd_watched:alice"), '["i01","i02"]');
  await h.app.toggle("i01");
  await h.flush();
  assert.deepEqual([...h.app.watched], ["i02"]);
  assert.equal(writes(h)[1].filters.user_id, "alice");
});

test("failed writes and failed resets preserve the confirmed progress", async () => {
  const h = harness({ rows: { alice: [watchedRow("i01")] } });
  await h.flush();
  h.switchUser("alice");
  await h.flush();
  h.failWrites(true);
  await h.app.toggle("i02");
  await h.flush();
  assert.deepEqual([...h.app.watched], ["i01"]);
  assert.equal(h.storage.get("rd_watched:alice"), '["i01"]');
  await h.app.resetAll();
  await h.flush();
  assert.deepEqual([...h.app.watched], ["i01"]);
  assert.equal(h.app.syncState, "falha ao zerar");
});

test("a pending write cannot modify the next account or its cache", async () => {
  const h = harness({ rows: { bob: [watchedRow("i03")] } });
  const pending = deferred();
  await h.flush();
  h.switchUser("alice");
  await h.flush();
  h.delayWrites(pending);
  const saving = h.app.toggle("i01");
  h.switchUser("bob");
  await h.flush();
  pending.resolve();
  await saving;
  await h.flush();
  assert.deepEqual([...h.app.watched], ["i03"]);
  assert.equal(h.storage.get("rd_watched:bob"), '["i03"]');
  assert.equal(h.storage.get("rd_watched:alice"), "[]");
});

test("logging out hides confirmed progress immediately", async () => {
  const h = harness({ rows: { alice: [watchedRow("i01")] } });
  await h.flush();
  h.switchUser("alice");
  await h.flush();
  h.switchUser(null);
  assert.equal(h.render().watched.size, 0);
  await h.flush();
  assert.equal(h.app.watched.size, 0);
});

test("local-only mode keeps its own cache without importing account progress", async () => {
  const h = harness({ online: false, cache: { rd_watched: '["i01"]', "rd_watched:local": '["i02"]' } });
  await h.flush();
  assert.deepEqual([...h.app.watched], ["i02"]);
  await h.app.toggle("i03");
  await h.flush();
  assert.equal(h.storage.get("rd_watched:local"), '["i02","i03"]');
});
