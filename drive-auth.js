(() => {
  const config = window.ATHubDriveConfig || {};
  let accessToken = "";
  let tokenClient;
  let dataFileId = "";

  function ready() {
    return Boolean(config.clientId && window.google?.accounts?.oauth2);
  }

  function loadGoogleIdentity() {
    if (ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-athub-google-identity]');
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", () => reject(new Error("Google-Anmeldung nicht erreichbar")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.athubGoogleIdentity = "true";
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", () => reject(new Error("Google-Anmeldung nicht erreichbar")), { once: true });
      document.head.append(script);
    });
  }

  async function requestToken() {
    await loadGoogleIdentity();
    if (!ready()) throw new Error("Google-Anmeldung konnte nicht initialisiert werden");
    return new Promise((resolve, reject) => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: config.clientId,
        scope: config.scope,
        callback: (response) => {
          if (response?.error) reject(new Error(response.error));
          else {
            accessToken = response.access_token;
            resolve(accessToken);
          }
        }
      });
      tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
    });
  }

  async function api(path, options = {}) {
    if (!accessToken) throw new Error("Nicht mit Google Drive verbunden");
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${accessToken}`);
    const base = path.startsWith("upload/")
      ? "https://www.googleapis.com/"
      : "https://www.googleapis.com/drive/v3/";
    const response = await fetch(`${base}${path}`, { ...options, headers });
    if (!response.ok) {
      let detail = "";
      try {
        const error = await response.json();
        detail = error?.error?.errors?.[0]?.reason || error?.error?.message || "";
      } catch {
        // Some error responses deliberately have no JSON payload.
      }
      throw new Error(`Google Drive meldet ${response.status}${detail ? ` (${detail})` : ""}`);
    }
    return response;
  }

  async function findFile() {
    if (dataFileId) return dataFileId;
    const name = String(config.fileName || "AT_HUB_Daten_v1.json").replace(/'/g, "\\'");
    const query = encodeURIComponent(`name='${name}' and trashed=false`);
    const response = await api(`files?q=${query}&spaces=drive&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=10`);
    const data = await response.json();
    dataFileId = data.files?.[0]?.id || "";
    return dataFileId;
  }

  async function readData() {
    const id = await findFile();
    if (!id) throw new Error("AT-HUB-Datendatei wurde in diesem Drive nicht gefunden");
    const response = await api(`files/${encodeURIComponent(id)}?alt=media`);
    return response.json();
  }

  async function writeData(data) {
    const id = await findFile();
    if (!id) throw new Error("AT-HUB-Datendatei wurde in diesem Drive nicht gefunden");
    await api(`upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(data)
    });
  }

  function berlinDateStamp() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  }

  async function findNamedFile(name) {
    const escapedName = String(name).replace(/'/g, "\\\\'");
    const query = encodeURIComponent(`name='${escapedName}' and trashed=false`);
    const response = await api(`files?q=${query}&spaces=drive&fields=files(id)&pageSize=1`);
    const data = await response.json();
    return data.files?.[0]?.id || "";
  }

  async function createDailyBackup(data) {
    const name = `AT_HUB_Sicherung_${berlinDateStamp()}.json`;
    if (await findNamedFile(name)) return false;

    const metadata = await api("files", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        name,
        mimeType: "application/json",
        description: "Automatische private AT-HUB-Sicherung vor einer Änderung.",
        appProperties: { athubType: "daily-backup" }
      })
    });
    const file = await metadata.json();
    await api(`upload/drive/v3/files/${encodeURIComponent(file.id)}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(data)
    });
    return true;
  }

  async function listRevisions() {
    const id = await findFile();
    if (!id) throw new Error("AT-HUB-Datendatei wurde in diesem Drive nicht gefunden");
    const response = await api(`files/${encodeURIComponent(id)}/revisions?fields=revisions(id,modifiedTime,size,keepForever)`);
    const data = await response.json();
    return Array.isArray(data.revisions) ? data.revisions : [];
  }

  async function readRevision(revisionId) {
    const id = await findFile();
    if (!id || !revisionId) throw new Error("Drive-Version wurde nicht gefunden");
    const response = await api(`files/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}?alt=media`);
    return response.json();
  }

  function sectionValue(data, key) {
    const direct = data?.[key];
    if (direct && typeof direct === "object") return direct.data && typeof direct.data === "object" ? direct.data : direct;
    const nested = data?.sections?.[key];
    if (nested && typeof nested === "object") return nested.data && typeof nested.data === "object" ? nested.data : nested;
    return null;
  }

  async function updateSection(key, value) {
    const data = await readData();
    await createDailyBackup(data);
    if (data?.sections && typeof data.sections === "object") {
      const previous = data.sections[key];
      data.sections[key] = previous?.data !== undefined
        ? { ...previous, data: value, updatedAt: new Date().toISOString() }
        : value;
    } else {
      data[key] = value;
    }
    await writeData(data);
  }

  window.ATHubDrive = {
    async connect() {
      await requestToken();
      await findFile();
      window.dispatchEvent(new CustomEvent("athub:drive-connected"));
      return { connected: true, fileFound: Boolean(dataFileId) };
    },
    isConnected: () => Boolean(accessToken),
    readData,
    writeData,
    createDailyBackup,
    listRevisions,
    readRevision,
    sectionValue,
    updateSection
  };
})();
