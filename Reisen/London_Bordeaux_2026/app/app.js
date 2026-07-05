const DATA_FILES = {
  version: '../daten/app-version.json',
  plan: '../daten/reiseplan.json',
  connections: '../daten/verbindungen.json',
  places: '../daten/orte.json',
  costs: '../daten/kosten.json',
  checklists: '../daten/checklisten.json',
  runs: '../daten/morning-runs.json',
  updates: '../daten/updates.json'
};

const state = {
  data: {},
  localOverrides: JSON.parse(localStorage.getItem('atHubTravelOverrides') || '{}'),
  checklistState: JSON.parse(localStorage.getItem('atHubTravelChecklistState') || '{}'),
  favorites: JSON.parse(localStorage.getItem('atHubTravelFavorites') || '{}'),
  userData: JSON.parse(localStorage.getItem('atHubTravelUserData') || '{"notes":{},"ratings":{},"photos":[] }'),
  searchQuery: '',
  onlyFavorites: false
};

document.addEventListener('click', event => {
  const screenButton = event.target.closest('[data-screen]');
  if(screenButton){
    showScreen(screenButton.dataset.screen);
    return;
  }

  const dayButton = event.target.closest('[data-day]');
  if(dayButton){
    showScreen('days');
    setTimeout(() => {
      const target = document.getElementById('day-' + dayButton.dataset.day);
      if(target) target.scrollIntoView({ behavior:'smooth', block:'start' });
    }, 50);
    return;
  }

  const favoriteButton = event.target.closest('[data-favorite]');
  if(favoriteButton){
    const id = favoriteButton.dataset.favorite;
    state.favorites[id] = !state.favorites[id];
    if(!state.favorites[id]) delete state.favorites[id];
    localStorage.setItem('atHubTravelFavorites', JSON.stringify(state.favorites));
    renderDays();
    return;
  }

  const favoritesOnlyButton = event.target.closest('#favoritesOnly');
  if(favoritesOnlyButton){
    state.onlyFavorites = !state.onlyFavorites;
    renderDays();
    return;
  }
});

document.addEventListener('input', event => {
  if(event.target.id !== 'daySearch') return;
  state.searchQuery = event.target.value;
  renderDays();
});

document.addEventListener('change', event => {
  const box = event.target.closest('[data-check]');
  if(!box) return;
  state.checklistState[box.dataset.check] = box.checked;
  localStorage.setItem('atHubTravelChecklistState', JSON.stringify(state.checklistState));
});

qs('#updateLater').addEventListener('click', () => qs('#updateBanner').classList.add('hidden'));
qs('#updateNow').addEventListener('click', refreshFromRemote);

start();

async function start(){
  updateOnlineStatus();
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  await registerServiceWorker();

  try{
    await loadAllData();
    renderAll();
    await checkForUpdates();
  }catch(error){
    console.error(error);
    qs('#loadError').classList.remove('hidden');
  }
}

async function loadAllData(){
  const entries = await Promise.all(Object.entries(DATA_FILES).map(async ([key, path]) => {
    const response = await fetch(path, { cache:'no-cache' });
    if(!response.ok) throw new Error('Daten fehlen: ' + path);
    return [key, await response.json()];
  }));

  state.data = Object.fromEntries(entries);
  applyLocalOverrides();
}

function applyLocalOverrides(){
  Object.keys(state.localOverrides).forEach(key => {
    if(state.data[key]){
      state.data[key] = state.localOverrides[key];
    }
  });
}

function renderAll(){
  const trip = state.data.plan.reise;
  qs('#tripTitle').textContent = trip.titel;
  qs('#tripPeriod').textContent = trip.zeitraum;
  qs('#dataVersion').textContent = 'Daten ' + state.data.version.datenVersion;
  qs('#footerTrip').textContent = 'AT HUB · Reisen · ' + trip.id;

  renderHome();
  renderDays();
  renderConnections();
  renderTickets();
  renderRuns();
  renderPlaces();
  renderKnowledge();
  renderAdmin();
}

function renderHome(){
  const trip = state.data.plan.reise;
  const nextDay = getNextDay();
  const today = new Date();
  const stations = getTravelStations(state.data.plan.tage).join(' · ');

  qs('#home').innerHTML = `
    <section class="panel">
      <h2>${escapeHtml(trip.titel)}</h2>
      <p>${escapeHtml(trip.zeitraum)} · ${escapeHtml(stations)}</p>
      <div class="meta-row">
        <span class="badge muted">Heute: ${escapeHtml(today.toLocaleDateString('de-DE'))}</span>
        <span class="badge">Offline nutzbar</span>
        <span class="badge muted">App ${escapeHtml(state.data.version.appVersion)}</span>
        <span class="badge muted">Reisedaten ${escapeHtml(state.data.version.datenVersion)}</span>
      </div>
    </section>
    <section class="panel">
      <h2>Naechster Programmpunkt</h2>
      ${nextDay ? renderNextDay(nextDay) : '<p>Keine weiteren Reisetage gefunden.</p>'}
    </section>
    <section class="quick-grid">
      <button data-screen="days">Tagesplan</button>
      <button data-screen="connections">Verbindungen</button>
      <button data-screen="tickets">Tickets</button>
      <button data-screen="runs">Morning Run</button>
      <button data-screen="places">Orte</button>
    </section>
  `;
}

function renderNextDay(day){
  return `
    <div class="card day-card" data-city="${escapeHtml(day.stadt)}">
      <h3>${escapeHtml(day.tag)}, ${formatDate(day.datum)} · ${escapeHtml(day.titel)}</h3>
      <div class="meta-row">
        <span class="badge">${escapeHtml(day.stadt)}</span>
        <span class="badge muted">${escapeHtml(day.phase)}</span>
        ${day.start ? `<span class="badge muted">Start ${escapeHtml(day.start)}</span>` : ''}
      </div>
      ${day.thema ? `<p>${escapeHtml(day.thema)}</p>` : ''}
      <p>${escapeHtml((day.ablauf || []).join(' · '))}</p>
      <div class="actions"><button data-day="${escapeHtml(day.id)}">Tag anzeigen</button></div>
    </div>
  `;
}

function renderDays(){
  const wasSearching = document.activeElement && document.activeElement.id === 'daySearch';
  const days = getVisibleDays();
  const stations = getTravelStations(state.data.plan.tage);
  const stationSections = stations.map(station => {
    const cards = days.filter(day => getDayStation(day) === station).map(renderDayCard).join('');
    if(!cards) return '';
    return `<section class="panel"><h2>${escapeHtml(station)}</h2><div class="grid">${cards}</div></section>`;
  }).join('');

  qs('#days').innerHTML = `
    <section class="panel">
      <h2>Tagesuebersicht</h2>
      <p>Alle Tage werden aus reiseplan.json erzeugt. Stationen kommen aus den Reisedaten.</p>
      <div class="tool-row">
        <input id="daySearch" type="search" value="${escapeHtml(state.searchQuery)}" placeholder="Suchen: Kirche, Harry Potter, Meal Prep, Bahnhof, Strand, Bunker">
        <button id="favoritesOnly" class="${state.onlyFavorites ? 'active' : ''}">Nur Favoriten</button>
      </div>
    </section>
    ${stationSections || '<section class="panel"><p>Keine passenden Reisetage gefunden.</p></section>'}
  `;

  const search = qs('#daySearch');
  if(search && wasSearching) search.focus({ preventScroll:true });
}

function renderDayCard(day){
  return `
    <article id="day-${escapeHtml(day.id)}" class="card day-card" data-city="${escapeHtml(day.stadt)}">
      <h3>${escapeHtml(day.tag)}, ${formatDate(day.datum)}</h3>
      <p><strong>${escapeHtml(day.titel)}</strong></p>
      <div class="meta-row">
        <span class="badge">${escapeHtml(day.stadt)}</span>
        <span class="badge muted">${escapeHtml(day.phase)}</span>
        ${day.station ? `<span class="badge muted">${escapeHtml(day.station)}</span>` : ''}
        ${day.start ? `<span class="badge muted">Start ${escapeHtml(day.start)}</span>` : ''}
      </div>
      <button class="favorite-button ${state.favorites[day.id] ? 'active' : ''}" data-favorite="${escapeHtml(day.id)}" title="Favorit markieren">${state.favorites[day.id] ? '★ Favorit' : '☆ Favorit'}</button>
      ${day.thema ? `<p>${escapeHtml(day.thema)}</p>` : ''}
      ${detailList('Tagesablauf', day.ablauf)}
      ${detailLinked('Verbindungen', day.verbindungen, state.data.connections.verbindungen, renderConnectionMini)}
      ${detailLinked('Sehenswuerdigkeiten / Orte', day.orte, state.data.places.orte, renderPlaceMini)}
      ${detailList('Verpflegung', day.verpflegung)}
      ${detailLinked('Kosten', day.kosten, state.data.costs.kosten, renderCostMini)}
      ${detailList('Tagescheckliste', day.tagesCheckliste)}
      ${detailLinked('Checkliste', day.checkliste, state.data.checklists.checklisten, renderChecklist)}
    </article>
  `;
}

function renderConnections(){
  const rows = state.data.connections.verbindungen.map(item => `
    <tr>
      <td>${escapeHtml(item.von)}</td>
      <td>${escapeHtml(item.nach)}</td>
      <td>${escapeHtml(item.verkehrsmittel)}</td>
      <td>${escapeHtml(item.linie)}</td>
      <td>${escapeHtml(item.richtung)}</td>
      <td>${escapeHtml(item.umstieg)}</td>
      <td>${escapeHtml(item.ausstieg)}</td>
      <td>${escapeHtml(item.fussweg)}</td>
      <td>${escapeHtml(item.updateHinweis)}</td>
    </tr>
  `).join('');

  qs('#connections').innerHTML = `
    <section class="panel">
      <h2>Verbindungen</h2>
      <p>Fahrzeiten bleiben updatefaehig. Vor Reisetagen bitte Live-Daten pruefen.</p>
    </section>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Von</th><th>Nach</th><th>Verkehr</th><th>Linie</th><th>Richtung</th><th>Umstieg</th><th>Ausstieg</th><th>Fussweg</th><th>Update</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderTickets(){
  const tickets = state.data.plan.tickets.map(ticket => `
    <article class="card">
      <h3>${escapeHtml(ticket.titel)}</h3>
      <div class="meta-row">
        <span class="badge">${escapeHtml(ticket.kategorie)}</span>
        <span class="badge warn">${escapeHtml(ticket.status)}</span>
      </div>
      <p>${escapeHtml(ticket.notiz)}</p>
      <div class="actions">
        <button disabled>${ticket.datei ? 'Ticket oeffnen' : 'Ticket spaeter ergaenzen'}</button>
      </div>
    </article>
  `).join('');

  qs('#tickets').innerHTML = `
    <section class="panel">
      <h2>Tickets</h2>
      <p>Ticketdateien kommen spaeter in den Ordner tickets. Die App-Struktur ist vorbereitet.</p>
    </section>
    <section class="grid three">${tickets}</section>
  `;
}

function renderRuns(){
  const html = state.data.runs.morningRuns.map(group => `
    <section class="panel">
      <h2>${escapeHtml(group.stadt)}</h2>
      <div class="grid">
        ${group.strecken.map(route => `
          <article class="card">
            <h3>${escapeHtml(route.titel)}</h3>
            <div class="meta-row">
              <span class="badge">${escapeHtml(route.distanzKm)} km</span>
              ${route.ueberStammbaeckerei ? '<span class="badge">ueber Stammbäckerei moeglich</span>' : ''}
            </div>
            <p>${escapeHtml(route.route)}</p>
            <a class="button-link" target="_blank" rel="noopener" href="${escapeHtml(route.maps)}">Maps oeffnen</a>
          </article>
        `).join('')}
      </div>
    </section>
  `).join('');

  qs('#runs').innerHTML = html;
}

function renderPlaces(){
  const cards = state.data.places.orte.map(place => `
    <article class="card">
      <h3>${escapeHtml(place.name)}</h3>
      <div class="meta-row">
        <span class="badge">${escapeHtml(place.stadt)}</span>
        <span class="badge muted">${escapeHtml(place.kategorie)}</span>
      </div>
      <p>${escapeHtml(place.adresse)}</p>
      <p>${escapeHtml(place.notizen)}</p>
      <div class="actions">
        <a class="button-link" target="_blank" rel="noopener" href="${escapeHtml(place.maps)}">Google Maps</a>
      </div>
    </article>
  `).join('');

  qs('#places').innerHTML = `
    <section class="panel">
      <h2>Orte</h2>
      <p>Adressen, Kategorien, Maps-Links und Notizen. GPS-Koordinaten koennen spaeter ergaenzt werden.</p>
    </section>
    <section class="grid three">${cards}</section>
  `;
}

function renderKnowledge(){
  const topics = [
    ['Kircheninformationen', 'Historische Kirchen, Kathedralen, Baustile und Besuchsnotizen.'],
    ['Bunkerinformationen', 'Bunker, Schutzraeume, War Rooms und Bordeaux Base Sous-Marine.'],
    ['Militaergeschichte', 'Hintergrundtexte, Karten, Zeitleisten und eigene Notizen.'],
    ['Bilder', 'Eigene Fotos und spaetere Bildgalerien.'],
    ['Videos', 'Links und eigene Clips spaeter.'],
    ['Notizen', 'Reisegedanken, Beobachtungen und Erinnerungen.']
  ];

  qs('#knowledge').innerHTML = `
    <section class="panel">
      <h2>Wissensebene</h2>
      <p>Diese Inhalte gehoeren nicht in die Druckmappe, aber in die App.</p>
    </section>
    <section class="grid three">
      ${topics.map(([title, text]) => `<article class="card"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p><span class="badge warn">vorbereitet</span></article>`).join('')}
    </section>
  `;
}

function renderAdmin(){
  const version = state.data.version;
  const updates = state.data.updates.hinweise.map(item => `
    <div class="admin-box">
      <strong>${escapeHtml(item.titel)}</strong>
      <p>${escapeHtml(item.notiz)}</p>
      <span class="badge warn">${escapeHtml(item.status)}</span>
    </div>
  `).join('');

  qs('#admin').innerHTML = `
    <section class="panel">
      <h2>Admin</h2>
      <p>Nur fuer den Nutzer: Reisedaten aktualisieren, JSON laden, Version pruefen und Daten exportieren.</p>
      <div class="meta-row">
        <span class="badge">App ${escapeHtml(version.appVersion)}</span>
        <span class="badge muted">Daten ${escapeHtml(version.datenVersion)}</span>
      </div>
      <div class="actions">
        <button id="checkUpdates">Version pruefen</button>
        <button id="exportData">Datenexport</button>
        <button id="backupUserData">Backup erstellen</button>
      </div>
      <div class="admin-box">
        <label for="jsonImport"><strong>Reise importieren</strong></label>
        <p>Liest eine reise.json ein und speichert sie lokal als aktuelle Reise. Eigene Favoriten, Notizen und Bewertungen bleiben getrennt erhalten.</p>
        <input id="jsonImport" type="file" accept="application/json">
      </div>
    </section>
    <section class="panel">
      <h2>Update-Hinweise</h2>
      ${updates}
    </section>
  `;

  qs('#checkUpdates').addEventListener('click', checkForUpdates);
  qs('#exportData').addEventListener('click', exportAllData);
  qs('#backupUserData').addEventListener('click', exportUserBackupZip);
  qs('#jsonImport').addEventListener('change', previewJsonImport);
}

function getVisibleDays(){
  const query = state.searchQuery.trim().toLowerCase();
  return state.data.plan.tage.filter(day => {
    if(state.onlyFavorites && !state.favorites[day.id]) return false;
    if(!query) return true;
    return getSearchText(day).includes(query);
  });
}

function getSearchText(day){
  const linked = [
    ...(resolveLinked(day.verbindungen, state.data.connections.verbindungen).map(item => Object.values(item).join(' '))),
    ...(resolveLinked(day.orte, state.data.places.orte).map(item => Object.values(item).join(' '))),
    ...(resolveLinked(day.kosten, state.data.costs.kosten).map(item => Object.values(item).join(' '))),
    ...(resolveLinked(day.checkliste, state.data.checklists.checklisten).map(item => Object.values(item).flat().join(' ')))
  ];

  return [
    Object.values(day).flat(Infinity).join(' '),
    linked.join(' ')
  ].join(' ').toLowerCase();
}

function getTravelStations(days){
  const configured = state.data.plan.reise.stationen || [];
  const fallback = days.map(getDayStation);
  return Array.from(new Set([...configured, ...fallback].filter(Boolean)));
}

function getDayStation(day){
  return day.stadt || day.station || day.phase || 'Reise';
}

function resolveLinked(ids, collection){
  const idList = toArray(ids);
  if(!idList.length || !collection) return [];
  return idList.map(id => collection.find(item => item.id === id)).filter(Boolean);
}

function toArray(value){
  if(Array.isArray(value)) return value;
  if(value === undefined || value === null || value === '') return [];
  return [value];
}

function detailList(title, values){
  const list = toArray(values);
  if(!list.length) return '';
  return `<details><summary>${escapeHtml(title)}</summary><ul>${list.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul></details>`;
}

function detailLinked(title, ids, collection, renderer){
  const idList = toArray(ids);
  if(!idList.length) return '';
  const items = resolveLinked(idList, collection);
  if(!items.length) return '';
  return `<details><summary>${escapeHtml(title)}</summary>${items.map(renderer).join('')}</details>`;
}

function renderConnectionMini(item){
  return `<p><strong>${escapeHtml(item.von)} -> ${escapeHtml(item.nach)}</strong><br>${escapeHtml(item.verkehrsmittel)} · ${escapeHtml(item.linie)} · ${escapeHtml(item.updateHinweis)}</p>`;
}

function renderPlaceMini(item){
  return `<p><strong>${escapeHtml(item.name)}</strong><br>${escapeHtml(item.kategorie)} · ${escapeHtml(item.adresse)}<br><a href="${escapeHtml(item.maps)}" target="_blank" rel="noopener">Maps oeffnen</a></p>`;
}

function renderCostMini(item){
  const amount = item.betrag === null ? 'offen' : item.betrag + ' ' + state.data.costs.waehrung;
  return `<p><strong>${escapeHtml(item.titel)}</strong><br>${escapeHtml(amount)} · ${escapeHtml(item.notiz)}</p>`;
}

function renderChecklist(list){
  return `<div>${list.punkte.map((point, index) => {
    const key = list.id + '-' + index;
    const checked = state.checklistState[key] ? 'checked' : '';
    return `<label class="check-item"><input type="checkbox" data-check="${escapeHtml(key)}" ${checked}> <span>${escapeHtml(point)}</span></label>`;
  }).join('')}</div>`;
}

function getNextDay(){
  const today = new Date();
  today.setHours(0,0,0,0);
  return state.data.plan.tage.find(day => new Date(day.datum + 'T00:00:00') >= today) || state.data.plan.tage[0];
}

function showScreen(id){
  qsa('.screen').forEach(screen => screen.classList.remove('active'));
  const target = qs('#' + id);
  if(target) target.classList.add('active');
  qsa('[data-screen]').forEach(button => button.classList.toggle('active', button.dataset.screen === id));
}

async function checkForUpdates(){
  if(!navigator.onLine) return;
  const config = state.data.updates;
  if(!config.remoteVersionUrl){
    qs('#updateBanner').classList.add('hidden');
    return;
  }

  try{
    const response = await fetch(config.remoteVersionUrl, { cache:'no-cache' });
    if(!response.ok) return;
    const remote = await response.json();
    if(remote.datenVersion && remote.datenVersion !== state.data.version.datenVersion){
      qs('#updateText').textContent = 'Neue Version: ' + remote.datenVersion;
      qs('#updateBanner').classList.remove('hidden');
    }
  }catch(error){
    console.warn('Update-Pruefung nicht moeglich', error);
  }
}

async function refreshFromRemote(){
  qs('#updateBanner').classList.add('hidden');
  alert('Update-System vorbereitet. Remote-JSON-Quelle muss noch in updates.json eingetragen werden.');
}

function exportAllData(){
  const payload = {
    exportedAt:new Date().toISOString(),
    data:state.data,
    userData:getLocalUserPayload()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'at-hub-reise-export-' + safeFileName(state.data.plan.reise.id) + '.json';
  link.click();
  URL.revokeObjectURL(url);
}

function exportUserBackupZip(){
  const tripId = state.data.plan.reise.id || 'reise';
  const payload = {
    backupType:'AT_HUB_REISE_USERDATA',
    exportedAt:new Date().toISOString(),
    tripId,
    userData:getLocalUserPayload()
  };
  const json = JSON.stringify(payload, null, 2);
  const zip = createStoredZip('benutzerdaten.json', json);
  const blob = new Blob([zip], { type:'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'at-hub-reise-backup-' + safeFileName(tripId) + '.zip';
  link.click();
  URL.revokeObjectURL(url);
}

function getLocalUserPayload(){
  return {
    checklistState:state.checklistState,
    favorites:state.favorites,
    notes:state.userData.notes || {},
    ratings:state.userData.ratings || {},
    photos:state.userData.photos || []
  };
}

async function previewJsonImport(event){
  const file = event.target.files && event.target.files[0];
  if(!file) return;
  try{
    const text = await file.text();
    const parsed = JSON.parse(text);
    const importedPlan = parsed.reise && parsed.tage ? parsed : parsed.data && parsed.data.plan;
    if(!importedPlan || !importedPlan.reise || !Array.isArray(importedPlan.tage)){
      alert('Diese Datei ist lesbar, aber keine gueltige reise.json fuer das AT HUB Reisemodul.');
      return;
    }
    state.localOverrides.plan = importedPlan;
    localStorage.setItem('atHubTravelOverrides', JSON.stringify(state.localOverrides));
    state.data.plan = importedPlan;
    renderAll();
    alert('Reise wurde lokal importiert. Eigene Favoriten, Notizen und Checklisten wurden nicht ueberschrieben.');
  }catch(error){
    alert('Diese Datei ist kein gueltiges JSON.');
  }
}

function createStoredZip(fileName, content){
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(fileName);
  const data = encoder.encode(content);
  const crc = crc32(data);
  const localHeader = new Uint8Array(30 + nameBytes.length);
  const centralHeader = new Uint8Array(46 + nameBytes.length);
  const endRecord = new Uint8Array(22);

  writeLocalZipHeader(localHeader, crc, data.length, nameBytes.length);
  localHeader.set(nameBytes, 30);

  writeCentralZipHeader(centralHeader, crc, data.length, nameBytes.length);
  centralHeader.set(nameBytes, 46);

  writeUInt32(endRecord, 0, 0x06054b50);
  writeUInt16(endRecord, 8, 1);
  writeUInt16(endRecord, 10, 1);
  writeUInt32(endRecord, 12, centralHeader.length);
  writeUInt32(endRecord, 16, localHeader.length + data.length);

  const zip = new Uint8Array(localHeader.length + data.length + centralHeader.length + endRecord.length);
  zip.set(localHeader, 0);
  zip.set(data, localHeader.length);
  zip.set(centralHeader, localHeader.length + data.length);
  zip.set(endRecord, localHeader.length + data.length + centralHeader.length);
  return zip;
}

function writeLocalZipHeader(target, crc, size, nameLength){
  writeUInt32(target, 0, 0x04034b50);
  writeUInt16(target, 4, 20);
  writeUInt16(target, 6, 0);
  writeUInt16(target, 8, 0);
  writeUInt16(target, 10, 0);
  writeUInt16(target, 12, 0);
  writeUInt32(target, 14, crc);
  writeUInt32(target, 18, size);
  writeUInt32(target, 22, size);
  writeUInt16(target, 26, nameLength);
  writeUInt16(target, 28, 0);
}

function writeCentralZipHeader(target, crc, size, nameLength){
  writeUInt32(target, 0, 0x02014b50);
  writeUInt16(target, 4, 20);
  writeUInt16(target, 6, 20);
  writeUInt16(target, 8, 0);
  writeUInt16(target, 10, 0);
  writeUInt16(target, 12, 0);
  writeUInt16(target, 14, 0);
  writeUInt32(target, 16, crc);
  writeUInt32(target, 20, size);
  writeUInt32(target, 24, size);
  writeUInt16(target, 28, nameLength);
  writeUInt16(target, 30, 0);
  writeUInt16(target, 32, 0);
  writeUInt16(target, 34, 0);
  writeUInt16(target, 36, 0);
  writeUInt32(target, 38, 0);
  writeUInt32(target, 42, 0);
}

function writeUInt16(target, offset, value){
  target[offset] = value & 255;
  target[offset + 1] = (value >>> 8) & 255;
}

function writeUInt32(target, offset, value){
  target[offset] = value & 255;
  target[offset + 1] = (value >>> 8) & 255;
  target[offset + 2] = (value >>> 16) & 255;
  target[offset + 3] = (value >>> 24) & 255;
}

function crc32(data){
  let crc = -1;
  for(let i = 0; i < data.length; i++){
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 255];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = (() => {
  const table = [];
  for(let i = 0; i < 256; i++){
    let c = i;
    for(let k = 0; k < 8; k++){
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

async function registerServiceWorker(){
  if(!('serviceWorker' in navigator)){
    qs('#cacheStatus').textContent = 'Service Worker nicht verfuegbar';
    return;
  }

  try{
    await navigator.serviceWorker.register('sw.js');
    qs('#cacheStatus').textContent = 'Offline-Cache aktiv';
  }catch(error){
    qs('#cacheStatus').textContent = 'Offline-Cache erst mit Server aktiv';
  }
}

function updateOnlineStatus(){
  qs('#onlineStatus').textContent = navigator.onLine ? 'Online' : 'Offline';
  qs('#onlineStatus').classList.toggle('muted', !navigator.onLine);
}

function formatDate(value){
  return new Date(value + 'T00:00:00').toLocaleDateString('de-DE', {
    day:'2-digit',
    month:'2-digit',
    year:'numeric'
  });
}

function qs(selector){
  return document.querySelector(selector);
}

function qsa(selector){
  return Array.from(document.querySelectorAll(selector));
}

function safeFileName(value){
  return String(value || 'reise').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'reise';
}

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#039;'
  }[char]));
}
