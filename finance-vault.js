(() => {
  const DB_NAME = "athub-fin-v7";
  const STORE_NAME = "state";
  const PRIVATE_CONFIG_KEY = "privateConfig";
  const DEFAULT_PRIVATE_CONFIG_FILE = "AT_HUB_Finanzconfig_v1.json";

  const $ = (id) => document.getElementById(id);

  function privateConfigFileName() {
    return config?.drive?.privateConfigFileName || DEFAULT_PRIVATE_CONFIG_FILE;
  }

  function setVaultStatus(text, tone = "") {
    const el = $("vaultStatus");
    if (!el) return;
    el.textContent = text;
    el.dataset.tone = tone;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function readLocalPrivateConfig() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(PRIVATE_CONFIG_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function writeLocalPrivateConfig(value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(value, PRIVATE_CONFIG_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function deleteLocalPrivateConfig() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(PRIVATE_CONFIG_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function cleanPrivateConfig(raw) {
    if (!raw || typeof raw !== "object") throw new Error("Die Datei ist keine gueltige JSON-Konfiguration.");
    const allowed = [
      "currentSnapshot",
      "overdraftLimit",
      "financialMonthStartDay",
      "financeCycle",
      "plan",
      "dues",
      "recurrences",
      "drive"
    ];
    const next = {};
    allowed.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(raw, key)) next[key] = raw[key];
    });
    if (!Object.keys(next).length) throw new Error("Keine Finanz-Konfigurationsdaten erkannt.");
    return next;
  }

  function mergePrivateConfig(base, privateConfig) {
    const merged = { ...(base || {}) };
    ["currentSnapshot", "plan", "financeCycle"].forEach((key) => {
      if (privateConfig[key] && typeof privateConfig[key] === "object" && !Array.isArray(privateConfig[key])) {
        merged[key] = { ...(merged[key] || {}), ...privateConfig[key] };
      }
    });
    ["overdraftLimit", "financialMonthStartDay", "dues", "recurrences"].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(privateConfig, key)) merged[key] = privateConfig[key];
    });
    if (privateConfig.drive && typeof privateConfig.drive === "object") {
      merged.drive = { ...(merged.drive || {}), ...privateConfig.drive };
      merged.drive.scope = merged.drive.scope || "https://www.googleapis.com/auth/drive.file";
      merged.drive.fileName = merged.drive.fileName || "AT_HUB_Finanzen_v1.json";
      merged.drive.privateConfigFileName = merged.drive.privateConfigFileName || DEFAULT_PRIVATE_CONFIG_FILE;
    }
    return merged;
  }

  async function applyPrivateConfig(privateConfig, source) {
    config = mergePrivateConfig(config, cleanPrivateConfig(privateConfig));
    try { if (typeof migrateState === "function") migrateState(); } catch (_) {}
    try { if (typeof saveState === "function") await saveState(false); } catch (_) {}
    try { if (typeof render === "function") render(); } catch (_) {}
    setVaultStatus(`Private Finanz-Konfiguration aktiv (${source}).`, "ok");
  }

  async function loadLocalPrivateConfig() {
    try {
      const localConfig = await readLocalPrivateConfig();
      if (localConfig) await applyPrivateConfig(localConfig, "lokal");
      else setVaultStatus("GitHub Pages enthaelt nur die sichere Grundkonfiguration. Private Finanzdaten kommen aus Drive oder Import.", "info");
    } catch (err) {
      setVaultStatus(`Lokaler Tresor konnte nicht geladen werden: ${err.message}`, "warn");
    }
  }

  async function findDriveJson(name) {
    if (typeof dfetch !== "function") throw new Error("Drive ist noch nicht verbunden.");
    const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and trashed=false`);
    const result = await dfetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&spaces=drive`);
    return result.files?.[0] || null;
  }

  async function loadPrivateConfigFromDrive() {
    try {
      setVaultStatus("Suche private Finanz-Konfiguration in Drive ...", "info");
      const file = await findDriveJson(privateConfigFileName());
      if (!file) {
        setVaultStatus(`Keine ${privateConfigFileName()} in Drive gefunden. Importiere sie einmal oder sichere sie nach Drive.`, "warn");
        return;
      }
      const privateConfig = await dfetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
      const cleaned = cleanPrivateConfig(privateConfig);
      await writeLocalPrivateConfig(cleaned);
      await applyPrivateConfig(cleaned, "Drive");
    } catch (err) {
      setVaultStatus(`Drive-Laden nicht moeglich: ${err.message}`, "warn");
    }
  }

  async function savePrivateConfigToDrive() {
    try {
      const localConfig = await readLocalPrivateConfig();
      if (!localConfig) {
        setVaultStatus("Keine lokale Privat-Konfiguration vorhanden. Erst importieren, dann sichern.", "warn");
        return;
      }
      if (typeof driveToken === "undefined" || !driveToken) throw new Error("Drive ist noch nicht verbunden.");
      setVaultStatus("Sichere private Finanz-Konfiguration in Drive ...", "info");
      const name = privateConfigFileName();
      const body = JSON.stringify(cleanPrivateConfig(localConfig), null, 2);
      const found = await findDriveJson(name);
      if (found) {
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${found.id}?uploadType=media`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${driveToken}`, "Content-Type": "application/json" },
          body
        });
      } else {
        const boundary = "athub_vault_boundary";
        const metadata = JSON.stringify({ name, mimeType: "application/json" });
        await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
          method: "POST",
          headers: { Authorization: `Bearer ${driveToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
          body: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`
        });
      }
      setVaultStatus(`Private Finanz-Konfiguration in Drive gesichert: ${name}`, "ok");
    } catch (err) {
      setVaultStatus(`Drive-Sichern nicht moeglich: ${err.message}`, "warn");
    }
  }

  function importPrivateConfigFile(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const cleaned = cleanPrivateConfig(JSON.parse(reader.result));
        await writeLocalPrivateConfig(cleaned);
        await applyPrivateConfig(cleaned, "Import");
      } catch (err) {
        setVaultStatus(`Import abgebrochen: ${err.message}`, "warn");
      }
    };
    reader.readAsText(file);
  }

  function injectVaultPanel() {
    const drivePane = $("drive");
    if (!drivePane || $("financeVaultPanel")) return;
    const panel = document.createElement("div");
    panel.className = "panel vault-panel";
    panel.id = "financeVaultPanel";
    panel.innerHTML = `
      <div class="eyebrow">FINANZ-TRESOR</div>
      <h3>Private Finanzdaten aus Drive laden</h3>
      <p class="muted">Die oeffentliche GitHub-Seite enthaelt nur die App. Deine privaten Planwerte, Fixkosten und Kontostandsbasis liegen lokal im Browser oder in deiner privaten Drive-Datei. Der Zugriff laeuft ueber dein Google-Konto und dessen 2-Faktor-Schutz.</p>
      <div class="vault-status" id="vaultStatus"></div>
      <input id="vaultImportFile" type="file" accept="application/json,.json" hidden>
      <div class="actions vault-actions">
        <button id="vaultImportBtn" class="btn" type="button">Private JSON importieren</button>
        <button id="vaultLoadBtn" class="btn secondary" type="button">Aus Drive laden</button>
        <button id="vaultSaveBtn" class="btn secondary" type="button">In Drive sichern</button>
        <button id="vaultForgetBtn" class="btn secondary" type="button">Lokal vergessen</button>
      </div>
      <p class="muted">Dateiname in Drive: <strong>${privateConfigFileName()}</strong>. Die normale Sync-Datei fuer Buchungen bleibt separat: <strong>${config?.drive?.fileName || "AT_HUB_Finanzen_v1.json"}</strong>.</p>`;
    drivePane.appendChild(panel);

    $("vaultImportBtn")?.addEventListener("click", () => $("vaultImportFile")?.click());
    $("vaultImportFile")?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) importPrivateConfigFile(file);
      event.target.value = "";
    });
    $("vaultLoadBtn")?.addEventListener("click", loadPrivateConfigFromDrive);
    $("vaultSaveBtn")?.addEventListener("click", savePrivateConfigToDrive);
    $("vaultForgetBtn")?.addEventListener("click", async () => {
      await deleteLocalPrivateConfig();
      setVaultStatus("Lokale Privat-Konfiguration entfernt. Nach einem Neuladen ist nur die sichere Grundkonfiguration aktiv.", "info");
    });
  }

  function enhanceDriveConnect() {
    if (typeof connectDrive !== "function" || connectDrive.__vaultEnhanced) return;
    const original = connectDrive;
    connectDrive = async function enhancedConnectDrive(...args) {
      const result = await original.apply(this, args);
      setTimeout(loadPrivateConfigFromDrive, 800);
      return result;
    };
    connectDrive.__vaultEnhanced = true;
  }

  function addStyles() {
    if (document.getElementById("financeVaultStyles")) return;
    const style = document.createElement("style");
    style.id = "financeVaultStyles";
    style.textContent = `
      .vault-panel{border-color:rgba(94,234,212,.22)}
      .vault-status{margin:12px 0;padding:12px;border-radius:8px;background:#101820;color:#d8dee9;font-size:14px;line-height:1.45}
      .vault-status[data-tone="ok"]{background:#0f2a22;color:#b6f3d1}
      .vault-status[data-tone="warn"]{background:#2d2210;color:#ffd699}
      .vault-status[data-tone="info"]{background:#111c2b;color:#c7ddff}
      .vault-actions{flex-wrap:wrap}
    `;
    document.head.appendChild(style);
  }

  function init() {
    addStyles();
    injectVaultPanel();
    enhanceDriveConnect();
    loadLocalPrivateConfig();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
