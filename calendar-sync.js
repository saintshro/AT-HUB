(() => {
  "use strict";

  const VERSION = "1.3.0";
  const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
  const TOKEN_KEY = "athub-calendar-token-v1";
  const SELECTED_KEY = "athub-calendar-selected-v1";
  const CACHE_KEY = "athub-calendar-events-v1";

  let tokenClient = null;
  let accessToken = "";
  let tokenExpiresAt = 0;
  let calendars = [];

  const emit = (detail) => {
    const state = status();
    const merged = {...state, ...detail};
    window.dispatchEvent(new CustomEvent("athub-calendar-status", {detail: merged}));
    document.querySelectorAll("[data-athub-calendar-status]").forEach(el => {
      el.textContent = merged.connected ? "Kalender verbunden" : (merged.message || "Kalender nicht verbunden");
    });
  };

  const loadGIS = () => new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    let s = document.querySelector('script[data-athub-gis]');
    if (!s) {
      s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.defer = true;
      s.dataset.athubGis = "1";
      document.head.appendChild(s);
    }
    const started = Date.now();
    const timer = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(timer); resolve();
      } else if (Date.now() - started > 12000) {
        clearInterval(timer); reject(new Error("Google-Anmeldung konnte nicht geladen werden."));
      }
    }, 100);
  });

  const getClientId = () =>
    window.ATHubData?.getClientId?.() ||
    localStorage.getItem("athub-google-client-id") ||
    "";

  const saveToken = (token, expiresIn) => {
    accessToken = token || "";
    tokenExpiresAt = Date.now() + Math.max(0, Number(expiresIn || 3600) - 60) * 1000;
    try {
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify({accessToken, tokenExpiresAt}));
    } catch {}
  };

  const restoreToken = () => {
    try {
      const v = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || "null");
      if (v?.accessToken && Number(v.tokenExpiresAt) > Date.now()) {
        accessToken = v.accessToken;
        tokenExpiresAt = Number(v.tokenExpiresAt);
        return true;
      }
    } catch {}
    return false;
  };

  const initTokenClient = async () => {
    const clientId = getClientId();
    if (!clientId) throw new Error("Google OAuth Client-ID fehlt. Bitte zuerst unter Einstellungen speichern.");
    await loadGIS();
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: () => {}
      });
    }
    return tokenClient;
  };

  const requestToken = async (interactive = true) => {
    if (accessToken && tokenExpiresAt > Date.now()) return accessToken;
    if (restoreToken()) {
      emit({connected:true, message:"Kalender verbunden"});
      return accessToken;
    }
    const client = await initTokenClient();
    const token = await new Promise((resolve, reject) => {
      client.callback = (resp) => {
        if (resp?.error) return reject(new Error(resp.error_description || resp.error));
        if (!resp?.access_token) return reject(new Error("Kein Kalender-Zugriffstoken erhalten."));
        saveToken(resp.access_token, resp.expires_in);
        resolve(resp.access_token);
      };
      try {
        client.requestAccessToken({prompt: interactive ? "consent" : ""});
      } catch (e) { reject(e); }
    });
    emit({connected:true, message:"Kalender verbunden"});
    return token;
  };

  const api = async (url) => {
    const token = await requestToken(false);
    const r = await fetch(url, {headers:{Authorization:`Bearer ${token}`}});
    if (r.status === 401) {
      accessToken = ""; tokenExpiresAt = 0; sessionStorage.removeItem(TOKEN_KEY);
      throw new Error("Kalender-Anmeldung ist abgelaufen. Bitte erneut verbinden.");
    }
    if (!r.ok) {
      let msg = `Google Calendar API Fehler ${r.status}`;
      try {
        const j = await r.json();
        msg = j?.error?.message || msg;
      } catch {}
      throw new Error(msg);
    }
    return r.json();
  };

  const connect = async () => {
    await requestToken(true);
    await listCalendars();
    emit({connected:true, message:"Kalender verbunden"});
    return true;
  };

  const listCalendars = async () => {
    const j = await api("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&showHidden=false");
    calendars = (j.items || []).map(c => ({
      id: c.id,
      summary: c.summary || c.id,
      primary: !!c.primary,
      selected: !!c.selected,
      accessRole: c.accessRole
    }));
    emit({connected:true, calendars});
    return calendars;
  };

  const getSelectedCalendarIds = () => {
    try {
      const ids = JSON.parse(localStorage.getItem(SELECTED_KEY) || "null");
      if (Array.isArray(ids) && ids.length) return ids;
    } catch {}
    const primary = calendars.find(c => c.primary)?.id;
    return primary ? [primary] : ["primary"];
  };

  const setSelectedCalendarIds = (ids) => {
    const clean = [...new Set((ids || []).filter(Boolean))];
    localStorage.setItem(SELECTED_KEY, JSON.stringify(clean.length ? clean : ["primary"]));
    try {
      const current = window.ATHubData?.getSection?.("settings") || {};
      window.ATHubData?.patchSection?.("settings", {
        ...current,
        calendar: {
          ...(current.calendar || {}),
          selectedIds: clean.length ? clean : ["primary"],
          updatedAt: new Date().toISOString()
        }
      });
    } catch {}
    return getSelectedCalendarIds();
  };

  const syncSelectionFromHub = () => {
    try {
      const ids = window.ATHubData?.getSection?.("settings")?.calendar?.selectedIds;
      if (Array.isArray(ids) && ids.length) localStorage.setItem(SELECTED_KEY, JSON.stringify(ids));
    } catch {}
  };

  const isoDayBounds = (date = new Date()) => {
    const start = new Date(date); start.setHours(0,0,0,0);
    const end = new Date(date); end.setHours(24,0,0,0);
    return {start:start.toISOString(), end:end.toISOString()};
  };

  const normalizeEvent = (e, calendar) => {
    const allDay = !!e.start?.date;
    const startRaw = e.start?.dateTime || e.start?.date || "";
    const endRaw = e.end?.dateTime || e.end?.date || "";
    return {
      id: `${calendar.id}:${e.id}`,
      calendarId: calendar.id,
      calendar: calendar.summary,
      title: e.summary || "(Ohne Titel)",
      location: e.location || "",
      allDay,
      start: startRaw,
      end: endRaw,
      htmlLink: e.htmlLink || ""
    };
  };

  const loadCachedToday = () => {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      const k = new Date().toISOString().slice(0,10);
      return c?.date === k && Array.isArray(c.events) ? c.events : [];
    } catch { return []; }
  };

  const getTodayEvents = async ({force=false} = {}) => {
    syncSelectionFromHub();
    if (!force) {
      const cached = loadCachedToday();
      if (cached.length && !(accessToken && tokenExpiresAt > Date.now())) return cached;
    }
    if (!calendars.length) await listCalendars();
    const ids = getSelectedCalendarIds();
    const {start,end} = isoDayBounds(new Date());
    const selectedCalendars = ids.map(id => calendars.find(c => c.id === id) || {id,summary:id==="primary"?"Hauptkalender":id});
    const batches = await Promise.all(selectedCalendars.map(async c => {
      const url = "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(c.id) +
        "/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=" + encodeURIComponent(start) +
        "&timeMax=" + encodeURIComponent(end);
      const j = await api(url);
      return (j.items || [])
        .filter(e => e.status !== "cancelled")
        .map(e => normalizeEvent(e,c));
    }));
    const events = batches.flat().sort((a,b) => String(a.start).localeCompare(String(b.start)));
    localStorage.setItem(CACHE_KEY, JSON.stringify({date:new Date().toISOString().slice(0,10),events,updatedAt:new Date().toISOString()}));
    emit({connected:true, events, lastRefresh:new Date().toISOString()});
    return events;
  };

  const status = () => ({
    connected: !!(accessToken && tokenExpiresAt > Date.now()) || restoreToken(),
    version: VERSION,
    calendars,
    selectedIds: getSelectedCalendarIds()
  });

  restoreToken();
  syncSelectionFromHub();

  window.ATHubCalendar = {
    version: VERSION,
    connect,
    listCalendars,
    getTodayEvents,
    loadCachedToday,
    getSelectedCalendarIds,
    setSelectedCalendarIds,
    status
  };

  setTimeout(() => emit({message: status().connected ? "Kalender verbunden" : "Kalender nicht verbunden"}), 50);
})();