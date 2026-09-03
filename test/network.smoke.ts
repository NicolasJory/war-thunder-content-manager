/**
 * Résilience réseau. `npm run smoke:network`.
 *
 * Tout se joue contre un serveur local qu'on fait échouer à la demande : c'est
 * la seule façon de vérifier des réessais et des délais d'attente sans
 * dépendre d'une panne réelle, et sans marteler l'API de Live.
 */

import assert from "assert";
import { createServer, type Server } from "http";
import { fetchPage, setEndpoints, endpoints } from "../src/main/wtLive.js";
import { DEFAULT_ENDPOINTS } from "../src/shared/endpoints.js";

let passed = 0;
const ok = (l: string) => {
  passed++;
  console.log(`  ✓ ${l}`);
};

/** Serveur qui répond selon un scénario donné, et compte ses visites. */
function stub(handler: (n: number) => { status: number; body?: string; delayMs?: number }) {
  let hits = 0;
  const server: Server = createServer(async (_req, res) => {
    const step = handler(++hits);
    if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
    res.writeHead(step.status, { "content-type": "application/json" });
    res.end(step.body ?? JSON.stringify({ data: { list: [], pageTitle: "" } }));
  });
  return {
    server,
    hits: () => hits,
    listen: () =>
      new Promise<number>((r) =>
        server.listen(0, "127.0.0.1", () => r((server.address() as { port: number }).port))
      ),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Pointe l'application sur le serveur local, avec des attentes courtes. */
function aim(port: number, limits: Partial<typeof DEFAULT_ENDPOINTS.limits> = {}) {
  setEndpoints({
    ...DEFAULT_ENDPOINTS,
    base: `http://127.0.0.1:${port}`,
    limits: { ...DEFAULT_ENDPOINTS.limits, retryBaseMs: 40, apiTimeoutMs: 600, ...limits },
  });
}

async function main() {
  console.log("\n[1] Réessai sur erreur serveur");
  {
    // Deux 500 puis un succès : l'appel doit aboutir sans que rien ne remonte.
    const s = stub((n) => (n <= 2 ? { status: 503 } : { status: 200 }));
    const port = await s.listen();
    aim(port);
    const page = await fetchPage({ page: 0 });
    assert.deepEqual(page.data.list, []);
    assert.equal(s.hits(), 3, `${s.hits()} appels au lieu de 3`);
    ok("deux 503 puis succès : l'appel aboutit après 3 tentatives");
    await s.close();
  }

  console.log("\n[2] Ce qu'on ne réessaie pas");
  {
    // Un 404 ne changera pas d'avis : insister ne ferait que retarder l'erreur.
    const s = stub(() => ({ status: 404 }));
    const port = await s.listen();
    aim(port);
    await assert.rejects(() => fetchPage({ page: 0 }), /E_API/);
    assert.equal(s.hits(), 1, `${s.hits()} appels : un 404 a été réessayé`);
    ok("un 404 remonte tout de suite, sans réessai");
    await s.close();
  }

  console.log("\n[3] Limitation de débit");
  {
    const s = stub((n) => (n === 1 ? { status: 429 } : { status: 200 }));
    const port = await s.listen();
    aim(port);
    await fetchPage({ page: 0 });
    assert.equal(s.hits(), 2);
    ok("un 429 est réessayé une fois, puis passe");
    await s.close();
  }

  console.log("\n[4] Délai d'attente");
  {
    // Un serveur qui ne répond jamais bloquait l'interface sans fin.
    const s = stub(() => ({ status: 200, delayMs: 5000 }));
    const port = await s.listen();
    aim(port, { retries: 0 });
    const started = Date.now();
    await assert.rejects(() => fetchPage({ page: 0 }));
    const waited = Date.now() - started;
    assert(waited < 3000, `abandon après ${waited} ms, le délai n'a pas joué`);
    ok(`un serveur muet est abandonné après ${waited} ms au lieu d'attendre sans fin`);
    await s.close();
  }

  console.log("\n[5] Abandon définitif");
  {
    // Après ses réessais, l'erreur remonte : on n'insiste pas indéfiniment.
    const s = stub(() => ({ status: 500 }));
    const port = await s.listen();
    aim(port);
    await assert.rejects(() => fetchPage({ page: 0 }));
    assert.equal(s.hits(), DEFAULT_ENDPOINTS.limits.retries + 1, `${s.hits()} tentatives`);
    ok(`une panne durable s'arrête après ${s.hits()} tentatives, sans marteler`);
    await s.close();
  }

  console.log("\n[6] Le manifeste pilote ces valeurs");
  {
    setEndpoints({
      ...DEFAULT_ENDPOINTS,
      limits: { ...DEFAULT_ENDPOINTS.limits, retries: 5, apiTimeoutMs: 1234 },
    });
    assert.equal(endpoints().limits.retries, 5);
    assert.equal(endpoints().limits.apiTimeoutMs, 1234);
    ok("réessais et délai se règlent depuis endpoints.json, sans recompiler");
  }

  setEndpoints(DEFAULT_ENDPOINTS);
  console.log(`\n${passed} checks OK\n`);
}

main().catch((e) => {
  console.error("\nECHEC :", (e as Error).message);
  process.exit(1);
});
