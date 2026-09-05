(() => {
  "use strict";

  const VERSION = "1.0.1";
  const BASE_YEAR = 2026;
  const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
  const STATUS_LABEL = {A:"Anwesend",E:"Extern",U:"Urlaub",F:"Frei",FT:"Feiertag",K:"Krank"};
  const STATUS_CLASS = {A:"a",E:"e",U:"u",F:"f",FT:"ft",K:"k"};

  let viewDate = new Date();
  if(viewDate.getFullYear() !== BASE_YEAR) viewDate = new Date(BASE_YEAR, 0, 1);
  let state = null;
  let seedPreview = null;
  let initializedFromDrive = false;

  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2,"0");
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const clone = o => JSON.parse(JSON.stringify(o));

  function blankEntry(){
    return {status:"",workplace:"",task:"",box:"",description:"",start:"",end:"",pauseMinutes:0,schoolStart:"",schoolEnd:"",overnight:false,externalLocation:"",tax:{businessTrip:false,training:false,homeOffice:false,distanceKm:null,businessKm:null,employerReimbursement:null,receiptLink:""}};
  }

  function normalizeEntry(e){
    return {...blankEntry(), ...(e||{}), tax:{...blankEntry().tax,...((e||{}).tax||{})}};
  }

  function normalizeState(s){
    const out = s && typeof s === "object" ? clone(s) : {};
    out.schemaVersion = 1;
    out.version = VERSION;
    out.year ||= BASE_YEAR;
    out.entries ||= {};
    Object.keys(out.entries).forEach(k => out.entries[k] = normalizeEntry(out.entries[k]));
    out.updatedAt ||= new Date().toISOString();
    return out;
  }

  async function loadSeed(){
    if(seedPreview) return clone(seedPreview);
    try{
      const r = await fetch("worktime-seed-2026.json", {cache:"no-store"});
      if(!r.ok) throw new Error("Seed nicht verfügbar");
      const entries = await r.json();
      seedPreview = normalizeState({year:BASE_YEAR,source:"Arbeitszeit 2026.xlsx",importedAt:"2026-09-03",entries});
    }catch{
      seedPreview = normalizeState({year:BASE_YEAR,source:"leer",entries:{}});
    }
    return clone(seedPreview);
  }

  function readStored(){
    const section = window.ATHubData?.getSection("translogistik") || {};
    return section.arbeitszeit ? normalizeState(section.arbeitszeit) : null;
  }

  function persist(){
    if(!state) return;
    state.updatedAt = new Date().toISOString();
    const section = window.ATHubData?.getSection("translogistik") || {};
    window.ATHubData?.setSection("translogistik", {...section, arbeitszeit:clone(state)});
  }

  async function initialize({allowCreate=false}={}){
    let stored = readStored();
    if(stored){
      state=stored;
      const seed = await loadSeed();
      state.migrations ||= {};
      if(!state.migrations.juneJuly2026v1){
        for(const [k,v] of Object.entries(seed.entries||{})){
          if(k.startsWith("2026-06-") || k.startsWith("2026-07-")) state.entries[k]=normalizeEntry(v);
        }
        state.migrations.juneJuly2026v1 = new Date().toISOString();
        persist();
      }
      initializedFromDrive=true; renderAll(); return;
    }

    try{
      await window.ATHubData?.sync({interactive:false});
      stored = readStored();
      if(stored){
        state=stored;
        const seed = await loadSeed();
        state.migrations ||= {};
        if(!state.migrations.juneJuly2026v1){
          for(const [k,v] of Object.entries(seed.entries||{})){
            if(k.startsWith("2026-06-") || k.startsWith("2026-07-")) state.entries[k]=normalizeEntry(v);
          }
          state.migrations.juneJuly2026v1 = new Date().toISOString();
          persist();
        }
        initializedFromDrive=true; renderAll(); return;
      }
      if(allowCreate){
        state = await loadSeed();
        initializedFromDrive=true;
        persist();
        renderAll();
        return;
      }
    }catch{}

    state = await loadSeed();
    initializedFromDrive=false;
    renderAll();
    setMessage("Vorschau aus Arbeitszeit 2026 geladen. Bitte Drive verbinden, bevor du den Kalender auf mehreren Geräten pflegst.");
  }

  function setMessage(text){
    const el=$("wtFormMessage"); if(el) el.textContent=text||"";
  }

  function durationMinutes(e){
    if(!e?.start || !e?.end) return 0;
    const [sh,sm]=e.start.split(":").map(Number), [eh,em]=e.end.split(":").map(Number);
    if([sh,sm,eh,em].some(Number.isNaN)) return 0;
    let mins=(eh*60+em)-(sh*60+sm); if(mins<0) mins+=1440;
    return Math.max(0,mins-(Number(e.pauseMinutes)||0));
  }
  function fmtMinutes(mins){ const h=Math.floor(mins/60), m=mins%60; return `${h}:${pad(m)} h`; }

  function entriesForMonth(year,month){
    return Object.entries(state?.entries||{}).filter(([k])=>Number(k.slice(0,4))===year && Number(k.slice(5,7))===month+1);
  }

  function statsForMonth(year,month){
    const entries=entriesForMonth(year,month).map(([,e])=>e);
    return {
      present: entries.filter(e=>e.status==="A"||e.status==="E").length,
      external: entries.filter(e=>e.status==="E").length,
      vacation: entries.filter(e=>e.status==="U").length,
      free: entries.filter(e=>e.status==="F").length,
      holiday: entries.filter(e=>e.status==="FT").length,
      sick: entries.filter(e=>e.status==="K").length,
      overnight: entries.filter(e=>e.overnight).length,
      minutes: entries.reduce((a,e)=>a+durationMinutes(e),0)
    };
  }

  function renderKpis(){
    const s=statsForMonth(viewDate.getFullYear(),viewDate.getMonth());
    const data=[
      ["⏱","Erfasste Zeit",fmtMinutes(s.minutes)],
      ["💼","Anwesend A+E",s.present],
      ["📍","Extern",s.external],
      ["🏖","Urlaub",s.vacation],
      ["🛋","Frei",s.free],
      ["🎉","Feiertag",s.holiday],
      ["🤒","Krank",s.sick],
      ["🛏","Übernachtungen",s.overnight]
    ];
    $("wtKpis").innerHTML=data.map(x=>`<div class="wt-kpi"><span>${x[0]}</span><div><strong>${x[2]}</strong><small>${x[1]}</small></div></div>`).join("");
  }

  function daySummary(e){
    if(!e) return "";
    if(e.status==="A"){
      if(e.workplace==="Box" && e.box) return `Box ${escapeHtml(e.box)}`;
      if(e.workplace==="Büro" || e.task==="Büro") return "Büro";
      return escapeHtml(e.task||"Anwesend");
    }
    if(e.status==="E") return escapeHtml(e.externalLocation||e.description||e.task||"Extern");
    return escapeHtml(e.task||STATUS_LABEL[e.status]||"");
  }

  function renderCalendar(){
    const y=viewDate.getFullYear(), m=viewDate.getMonth();
    $("wtMonthLabel").textContent=`${MONTHS[m]} ${y}`;
    const first=new Date(y,m,1), daysInMonth=new Date(y,m+1,0).getDate();
    const mondayIndex=(first.getDay()+6)%7;
    const cells=[];
    for(let i=0;i<mondayIndex;i++) cells.push(`<div class="wt-day wt-empty"></div>`);
    const today=dateKey(new Date());
    for(let d=1;d<=daysInMonth;d++){
      const key=`${y}-${pad(m+1)}-${pad(d)}`;
      const e=state?.entries?.[key] ? normalizeEntry(state.entries[key]) : blankEntry();
      const cls=e.status?` status-${STATUS_CLASS[e.status]||""}`:"";
      const time=(e.start&&e.end)?`${e.start}–${e.end}`:"";
      const school=(e.schoolStart||e.schoolEnd)?`🎓 ${e.schoolStart||""}${e.schoolEnd?`–${e.schoolEnd}`:""}`:"";
      const overnight=e.overnight?"🛏":"";
      cells.push(`<button type="button" class="wt-day${cls}${key===today?" wt-today":""}" data-date="${key}">
        <span class="wt-day-number">${d}</span>
        <span class="wt-status">${escapeHtml(e.status||"")}</span>
        <strong>${daySummary(e)}</strong>
        <small>${escapeHtml(time)}</small>
        <small>${escapeHtml(school)} ${overnight}</small>
      </button>`);
    }
    $("wtCalendar").innerHTML=cells.join("");
    $("wtCalendar").querySelectorAll("[data-date]").forEach(b=>b.addEventListener("click",()=>openEditor(b.dataset.date)));
  }

  function renderYear(){
    const y=viewDate.getFullYear(); $("wtYearTitle").textContent=y;
    const rows=MONTHS.map((name,m)=>{ const s=statsForMonth(y,m); return `<tr><td>${name}</td><td>${s.present}</td><td>${s.external}</td><td>${s.vacation}</td><td>${s.free}</td><td>${s.holiday}</td><td>${s.sick}</td><td>${s.overnight}</td><td>${fmtMinutes(s.minutes)}</td></tr>`; });
    const totals=MONTHS.map((_,m)=>statsForMonth(y,m)).reduce((a,s)=>{Object.keys(a).forEach(k=>a[k]+=s[k]);return a;},{present:0,external:0,vacation:0,free:0,holiday:0,sick:0,overnight:0,minutes:0});
    $("wtYearTable").innerHTML=`<thead><tr><th>Monat</th><th>A+E</th><th>Extern</th><th>Urlaub</th><th>Frei</th><th>FT</th><th>Krank</th><th>ÜN</th><th>Zeit</th></tr></thead><tbody>${rows.join("")}<tr class="wt-total"><td>Gesamt</td><td>${totals.present}</td><td>${totals.external}</td><td>${totals.vacation}</td><td>${totals.free}</td><td>${totals.holiday}</td><td>${totals.sick}</td><td>${totals.overnight}</td><td>${fmtMinutes(totals.minutes)}</td></tr></tbody>`;
  }

  function renderAll(){ renderKpis(); renderCalendar(); renderYear(); }

  function escapeHtml(s){ return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

  function prettyDate(key){
    const [y,m,d]=key.split("-").map(Number);
    return new Intl.DateTimeFormat("de-DE",{weekday:"long",day:"2-digit",month:"long",year:"numeric"}).format(new Date(y,m-1,d));
  }

  function openEditor(key){
    const e=normalizeEntry(state?.entries?.[key]);
    $("wtDate").value=key; $("wtDateText").textContent=prettyDate(key);
    $("wtStatus").value=e.status; $("wtWorkplace").value=e.workplace;
    $("wtBox").value=e.box; $("wtExternalLocation").value=e.externalLocation;
    $("wtStart").value=e.start; $("wtEnd").value=e.end; $("wtPause").value=Number(e.pauseMinutes)||0;
    $("wtTask").value=e.task; $("wtDescription").value=e.description;
    $("wtSchoolStart").value=e.schoolStart; $("wtSchoolEnd").value=e.schoolEnd;
    $("wtOvernight").checked=!!e.overnight;
    $("wtBusinessTrip").checked=!!e.tax.businessTrip; $("wtTraining").checked=!!e.tax.training;
    $("wtDistanceKm").value=e.tax.distanceKm ?? ""; $("wtBusinessKm").value=e.tax.businessKm ?? "";
    updateFormRules(); setMessage(""); $("wtModal").hidden=false;
  }

  function closeEditor(){ $("wtModal").hidden=true; }

  function updateFormRules(){
    const status=$("wtStatus").value, workplace=$("wtWorkplace");
    if(status==="E") workplace.value="Extern";
    if(status==="A" && workplace.value==="Extern") workplace.value="";
    $("wtWorkplaceWrap").hidden=!["A","E"].includes(status);
    $("wtBoxWrap").hidden=!(status==="A" && workplace.value==="Box");
    $("wtExternalWrap").hidden=status!=="E";
    if(status==="E") $("wtBusinessTrip").checked=true;
  }

  function applyBoxDefault(){
    if($("wtStatus").value==="A" && $("wtWorkplace").value==="Box" && $("wtBox").value.trim()==="658"){
      if(!$("wtStart").value) $("wtStart").value="06:30";
      if(!$("wtEnd").value) $("wtEnd").value="16:30";
    }
  }

  async function ensureWritable(){
    if(initializedFromDrive) return true;
    try{
      await window.ATHubData.connect();
      const remote=readStored();
      if(remote) state=remote; else { state=await loadSeed(); persist(); }
      initializedFromDrive=true; renderAll(); return true;
    }catch(err){
      setMessage(`Drive-Verbindung erforderlich: ${err?.message||err}`); return false;
    }
  }

  async function saveEditor(ev){
    ev.preventDefault();
    if(!await ensureWritable()) return;
    const key=$("wtDate").value, status=$("wtStatus").value, workplace=$("wtWorkplace").value;
    if(status==="A" && !["Büro","Box"].includes(workplace)){ setMessage("Bei A bitte Büro oder Box auswählen."); return; }
    if(status==="E" && workplace!=="Extern"){ setMessage("Extern wird automatisch als Arbeitsort gesetzt."); return; }
    const current=normalizeEntry(state.entries[key]);
    const valNum=id=>$(id).value===""?null:Number($(id).value);
    const next={...current,
      status, workplace: status==="E"?"Extern":workplace,
      box: status==="A"&&workplace==="Box" ? $("wtBox").value.trim() : "",
      externalLocation: status==="E" ? $("wtExternalLocation").value.trim() : "",
      start:$("wtStart").value,end:$("wtEnd").value,pauseMinutes:Number($("wtPause").value)||0,
      task:$("wtTask").value.trim(),description:$("wtDescription").value.trim(),
      schoolStart:$("wtSchoolStart").value,schoolEnd:$("wtSchoolEnd").value,overnight:$("wtOvernight").checked,
      tax:{...current.tax,businessTrip:$("wtBusinessTrip").checked,training:$("wtTraining").checked,distanceKm:valNum("wtDistanceKm"),businessKm:valNum("wtBusinessKm")}
    };
    if(status==="A" && workplace==="Büro" && !next.task) next.task="Büro";
    if(status==="E" && !next.task) next.task="Extern";
    if(["U","F","FT","K"].includes(status) && !next.task) next.task=STATUS_LABEL[status];
    state.entries[key]=normalizeEntry(next); persist(); renderAll(); closeEditor();
  }

  async function clearDay(){
    if(!await ensureWritable()) return;
    const key=$("wtDate").value;
    if(!confirm(`${prettyDate(key)} wirklich leeren?`)) return;
    state.entries[key]=blankEntry(); persist(); renderAll(); closeEditor();
  }

  async function connectDrive(){
    const btn=$("wtConnectBtn"); btn.disabled=true; btn.textContent="Verbinde…";
    try{
      await window.ATHubData.connect();
      let remote=readStored();
      if(remote) state=remote; else { state=await loadSeed(); persist(); await window.ATHubData.sync({interactive:false}); }
      initializedFromDrive=true; renderAll();
    }catch(err){ alert(`Drive konnte nicht verbunden werden: ${err?.message||err}`); }
    finally{ btn.disabled=false; btn.textContent="Drive verbinden"; }
  }

  async function syncNow(){
    const btn=$("wtSyncBtn"); btn.disabled=true; btn.textContent="Synchronisiere…";
    try{
      await window.ATHubData.sync({interactive:false});
      const remote=readStored(); if(remote){state=remote;initializedFromDrive=true;renderAll();}
    }catch(err){ alert(`Synchronisierung nicht möglich: ${err?.message||err}`); }
    finally{ btn.disabled=false; btn.textContent="Jetzt synchronisieren"; }
  }

  $("wtPrevMonth").addEventListener("click",()=>{viewDate=new Date(viewDate.getFullYear(),viewDate.getMonth()-1,1);renderAll();});
  $("wtNextMonth").addEventListener("click",()=>{viewDate=new Date(viewDate.getFullYear(),viewDate.getMonth()+1,1);renderAll();});
  $("wtTodayBtn").addEventListener("click",()=>{const n=new Date();viewDate=new Date(n.getFullYear(),n.getMonth(),1);renderAll();});
  $("wtYearBtn").addEventListener("click",()=>{$("wtYearPanel").hidden=!$("wtYearPanel").hidden;if(!$("wtYearPanel").hidden) $("wtYearPanel").scrollIntoView({behavior:"smooth"});});
  $("wtConnectBtn").addEventListener("click",connectDrive); $("wtSyncBtn").addEventListener("click",syncNow);
  $("wtCloseBtn").addEventListener("click",closeEditor); $("wtCancelBtn").addEventListener("click",closeEditor); $("wtClearBtn").addEventListener("click",clearDay);
  $("wtModal").addEventListener("click",e=>{if(e.target===$("wtModal")) closeEditor();});
  $("wtForm").addEventListener("submit",saveEditor);
  $("wtStatus").addEventListener("change",updateFormRules); $("wtWorkplace").addEventListener("change",()=>{updateFormRules();applyBoxDefault();}); $("wtBox").addEventListener("change",applyBoxDefault);
  window.addEventListener("athub-data-updated",()=>{const fresh=readStored();if(fresh){state=fresh;initializedFromDrive=true;renderAll();}});

  initialize();
})();
