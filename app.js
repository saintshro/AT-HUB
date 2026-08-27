const euro=new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"});
let config=null,state=null,reviewRows=[],driveToken=null,driveFileId=null;
const DB="athub-fin-v7",STORE="state",MIGRATION="8.6.0";
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];

async function db(){
  return await new Promise((res,rej)=>{
    const r=indexedDB.open(DB,1);
    r.onupgradeneeded=()=>r.result.createObjectStore(STORE);
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
  });
}
async function loadState(){
  const d=await db();
  return await new Promise((res,rej)=>{
    const t=d.transaction(STORE,"readonly"),q=t.objectStore(STORE).get("main");
    q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error);
  });
}
async function saveState(localChange=true){
  if(localChange) state.localChangedAt=new Date().toISOString();
  const d=await db();
  return await new Promise((res,rej)=>{
    const t=d.transaction(STORE,"readwrite");
    t.objectStore(STORE).put(state,"main");
    t.oncomplete=res; t.onerror=()=>rej(t.error);
  });
}

function touchField(field){
  if(!state.fieldChangedAt) state.fieldChangedAt={};
  state.fieldChangedAt[field]=new Date().toISOString();
}
function defaultState(){
  return {
    balance:config.currentSnapshot?.balance ?? null,
    transactions:[],
    dueActive:Object.fromEntries(config.dues.map(d=>[d.id,true])),
    planActive:{emergencyBuffer:true,vacationSavings:false,plannedPaydown:false},
    lastSyncAt:null,
    localChangedAt:new Date().toISOString(),
    deviceId:localStorage.getItem("athub-device-id")||("dev-"+crypto.randomUUID()),
    fieldChangedAt:{balance:new Date().toISOString(),dueActive:new Date().toISOString(),planActive:new Date().toISOString()},
    drive:{clientId:config.drive.clientId||"",autoSync:config.drive.autoSync!==false},
    migratedTo:MIGRATION
  };
}
function migrateState(){
  if(!state || typeof state!=="object") state=defaultState();
  if(!state.deviceId) state.deviceId=localStorage.getItem("athub-device-id")||("dev-"+crypto.randomUUID());
  localStorage.setItem("athub-device-id",state.deviceId);
  if(!state.fieldChangedAt) state.fieldChangedAt={balance:state.localChangedAt||new Date().toISOString(),dueActive:state.localChangedAt||new Date().toISOString(),planActive:state.localChangedAt||new Date().toISOString()};
  if(!state.transactions) state.transactions=[];
  if(!state.dueActive) state.dueActive={};
  for(const d of config.dues){
    if(!(d.id in state.dueActive)) state.dueActive[d.id]=true;
  }
  if(!state.planActive) state.planActive={emergencyBuffer:true,vacationSavings:false,plannedPaydown:false};
  if(!state.drive) state.drive={clientId:config.drive.clientId||"",autoSync:config.drive.autoSync!==false};
  if(typeof state.drive.autoSync!=="boolean") state.drive.autoSync=config.drive.autoSync!==false;

  if(state.migratedTo!==MIGRATION){
    state.balance=config.currentSnapshot?.balance ?? state.balance;
    state.dueActive=Object.fromEntries(config.dues.map(d=>[d.id, d.includeInForecast!==false]));
    state.planActive={emergencyBuffer:true,vacationSavings:false,plannedPaydown:false};
    state.migratedTo=MIGRATION;
    touchField("dueActive");
    touchField("planActive");
    saveState(false).catch(()=>{});
  }
}
function financePeriod(){
  const n=new Date(),s=config.financialMonthStartDay||15,d=n.getDate();
  let start,end;
  if(d>=s){start=new Date(n.getFullYear(),n.getMonth(),s);end=new Date(n.getFullYear(),n.getMonth()+1,s);}
  else{start=new Date(n.getFullYear(),n.getMonth()-1,s);end=new Date(n.getFullYear(),n.getMonth(),s);}
  return{start,end};
}
function fmt(d){return d.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"});}
function reserveRows(){
  return [
    ["emergencyBuffer","Puffer für Unvorhergesehenes",Number(config.plan?.emergencyBuffer||0),"monatlich reservieren"],
    ["vacationSavings","Urlaubssparen",Number(config.plan?.vacationSavings||0),"in 900 € Daniela enthalten – nur aktivieren, wenn noch nicht bezahlt"],
    ["plannedPaydown","Dispo-/Schuldenabbau",Number(config.plan?.plannedPaydown||0),"optionales Monatsziel"]
  ];
}
function activeReserveSum(){
  return reserveRows().reduce((s,[k,,v])=>s+(state.planActive?.[k]?v:0),0);
}
function render(){
  const p=financePeriod();
  const open=config.dues.filter(d=>d.includeInForecast!==false && state.dueActive[d.id]!==false);
  const openSum=open.reduce((s,x)=>s+Number(x.amount||0),0);
  const reserves=activeReserveSum();
  const available=state.balance==null?null:state.balance-openSum-reserves;
  const dispoLeft=available==null?null:Math.max(0,config.overdraftLimit-Math.max(0,-available));

  $("#period").textContent=`Finanzmonat ${fmt(p.start)} → ${fmt(p.end)}`;
  $("#current").textContent=state.balance==null?"fehlt":euro.format(state.balance);
  $("#futureSum").textContent=euro.format(openSum);
  $("#reserveSum").textContent=euro.format(reserves);
  $("#forecast").textContent=available==null?"Kontostand eingeben":euro.format(available);
  $("#forecast").classList.toggle("red",available!=null&&available<0);
  $("#forecastText").textContent=available==null
    ?"Bitte aktuellen Kontostand eintragen."
    :`Kontostand ${euro.format(state.balance)} − offene Abbuchungen ${euro.format(openSum)} − reserviert ${euro.format(reserves)}.`;
  $("#dispoLeft").textContent=dispoLeft==null?"–":euro.format(dispoLeft);
  $("#saveGoal").textContent=euro.format(config.plan?.plannedPaydown||0);
  $("#vacationValue").textContent=euro.format(config.plan?.vacationSavings||0);

  $("#planRows").innerHTML=reserveRows().map(([k,label,val,note])=>
    `<div class="due"><div><b>${esc(label)}</b><small>${euro.format(val)} · ${esc(note)}</small></div>
     <div class="right"><button class="toggle ${state.planActive[k]?"on":""}" onclick="togglePlan('${k}')">${state.planActive[k]?"aktiv ✓":"aus"}</button></div></div>`
  ).join("");

  $("#dues").innerHTML=config.dues.map(d=>
    `<div class="due"><div><b>${esc(d.name)}</b><small>${d.date} · ${euro.format(d.amount)} · Sicherheit: ${d.confidence}${d.note?` · ${esc(d.note)}`:""}${d.includeInForecast===false?` · nicht Teil der aktuellen Prognose`:""}</small></div>
     <div class="right"><button class="toggle ${d.includeInForecast!==false && state.dueActive[d.id]!==false?"on":""}" onclick="toggleDue('${d.id}')">${d.includeInForecast===false?"nach dem 15. · ausgeschlossen":(state.dueActive[d.id]!==false?"eingerechnet ✓":"bezahlt / aus")}</button></div></div>`
  ).join("");

  $("#txList").innerHTML=state.transactions.length
    ?state.transactions.slice().sort((a,b)=>b.iso.localeCompare(a.iso)).map(t=>
      `<div class="tx"><div><b>${esc(t.name)}</b><small>${t.date} · ${esc(t.category)}</small></div>
       <b class="${t.amount<0?"red":"good"}">${euro.format(t.amount)}</b></div>`).join("")
    :'<p class="muted">Noch keine importierten Buchungen gespeichert.</p>';

  $("#bal").value=state.balance??"";
  $("#clientId").value=state.drive.clientId||"";
  if($("#autoSync")) $("#autoSync").checked=state.drive.autoSync!==false;
  if($("#autoSyncState")) $("#autoSyncState").textContent=state.drive.autoSync!==false?"aktiv":"aus";
  if($("#lastSync")) $("#lastSync").textContent=state.lastSyncAt?new Date(state.lastSyncAt).toLocaleString("de-DE"):"–";
  if($("#driveStatus")) $("#driveStatus").textContent=driveToken?"verbunden":"nicht verbunden";
}
window.toggleDue=async id=>{
  const d=config.dues.find(x=>x.id===id);
  if(d?.includeInForecast===false){
    state.dueActive[id]=false;
    touchField("dueActive");
    await saveState();
    render();
    return;
  }
  state.dueActive[id]=state.dueActive[id]===false;
  touchField("dueActive");
  await saveState();
  render();
  queueAutoSync();
};
window.togglePlan=async id=>{state.planActive[id]=!state.planActive[id];touchField("planActive");await saveState();render();queueAutoSync();};

function bind(){
  $$(".tab").forEach(b=>b.onclick=()=>{
    $$(".tab").forEach(x=>x.classList.remove("active"));
    $$(".pane").forEach(x=>x.classList.remove("active"));
    b.classList.add("active");
    $("#"+b.dataset.tab).classList.add("active");
  });
  $("#saveBal").onclick=async()=>{
    const v=Number($("#bal").value);
    if(Number.isFinite(v)){state.balance=v;touchField("balance");await saveState();render();queueAutoSync();}
  };
  const drop=$("#drop"),pdf=$("#pdf");
  drop.onclick=()=>pdf.click();
  drop.ondragover=e=>{e.preventDefault();drop.classList.add("drag");};
  drop.ondragleave=()=>drop.classList.remove("drag");
  drop.ondrop=e=>{
    e.preventDefault();drop.classList.remove("drag");
    if(e.dataTransfer.files[0]) handlePDF(e.dataTransfer.files[0]);
  };
  pdf.onchange=()=>pdf.files[0]&&handlePDF(pdf.files[0]);

  $("#saveClient").onclick=async()=>{
    state.drive.clientId=$("#clientId").value.trim();
    await saveState();
    msgDrive(state.drive.clientId?"Client-ID gespeichert.":"Client-ID entfernt.","good");
  };
  $("#connect").onclick=connectDrive;
  $("#sync").onclick=syncDrive;
  $("#autoSync").onchange=async()=>{
    state.drive.autoSync=$("#autoSync").checked;
    await saveState();
    render();
    if(state.drive.autoSync) queueAutoSync();
  };
}
async function loadPdfJs(){
  return await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/+esm");
}
async function handlePDF(file){
  const msg=$("#pdfMsg");
  $("#review").innerHTML="";
  const isPdf=file && (file.type==="application/pdf" || /\.pdf$/i.test(file.name||""));
  if(!isPdf){
    msg.textContent="Bitte einen PDF-Kontoauszug auswählen.";
    msg.className="msg bad"; return;
  }
  msg.textContent="DKB-PDF wird lokal gelesen …";
  msg.className="msg";

  try{
    const pdfjs=await loadPdfJs();
    pdfjs.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs";
    const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
    let lines=[];

    for(let p=1;p<=pdf.numPages;p++){
      const pg=await pdf.getPage(p),c=await pg.getTextContent(),rows=new Map();
      for(const it of c.items){
        const y=Math.round((it.transform?.[5]||0)*2)/2;
        if(!rows.has(y)) rows.set(y,[]);
        rows.get(y).push({x:it.transform?.[4]||0,s:it.str||""});
      }
      lines.push(...[...rows.entries()]
        .sort((a,b)=>b[0]-a[0])
        .map(([,items])=>items.sort((a,b)=>a.x-b.x).map(v=>v.s).join(" ").replace(/\s+/g," ").trim())
        .filter(Boolean));
    }

    reviewRows=parseDKBLines(lines);
    msg.textContent=`${pdf.numPages} Seiten gelesen · ${reviewRows.length} Buchungen erkannt.`;
    msg.className=reviewRows.length?"msg good":"msg bad";
    renderReview();
  }catch(e){
    msg.textContent="PDF konnte nicht gelesen werden: "+e.message;
    msg.className="msg bad";
  }
}
function parseMoney(raw){
  let s=String(raw||"").trim().replace(/\s/g,"").replace(/[€]/g,"");
  if(!s) return NaN;
  const neg=s.startsWith("-");
  s=s.replace(/^[-+]/,"");
  const lc=s.lastIndexOf(","),ld=s.lastIndexOf(".");
  if(lc>=0&&ld>=0){
    if(lc>ld)s=s.replace(/\./g,"").replace(",",".");
    else s=s.replace(/,/g,"");
  }else if(lc>=0){
    const p=s.split(",");
    s=p.at(-1).length===2?p.slice(0,-1).join("")+"."+p.at(-1):s.replace(/,/g,"");
  }else if(ld>=0){
    const p=s.split(".");
    s=p.at(-1).length===2?p.slice(0,-1).join("")+"."+p.at(-1):s.replace(/\./g,"");
  }
  const n=Number(s);
  return Number.isFinite(n)?(neg?-n:n):NaN;
}
function parseDKBLines(lines){
  const out=[],seen=new Set();
  const rowRx=/^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s+(-?\d{1,9}(?:[.,]\d{2}))$/;

  for(const line of lines){
    const m=line.match(rowRx);
    if(!m) continue;
    const date=m[1],name=m[2].trim(),amount=parseMoney(m[3]);
    if(!Number.isFinite(amount) || /^(Datum|Zeitraum|Auszug)$/i.test(name)) continue;
    const key=`${date}|${name}|${amount.toFixed(2)}`;
    if(seen.has(key)) continue;
    seen.add(key);
    const [dd,mm,yy]=date.split(".");
    out.push({
      id:hash(key),date,iso:`${yy}-${mm}-${dd}`,name,amount,
      type:autoType(name,amount),category:autoCat(name,amount)
    });
  }
  return out.slice(0,700);
}
function matchesDue(name,d){
  const n=name.toLowerCase();
  return (d.match||[]).some(x=>n.includes(String(x).toLowerCase()));
}
function inDueWindow(tx,d){
  if(!d.window) return false;
  return tx.iso>=d.window.start && tx.iso<=d.window.end;
}
function dueCanBeSettledByTx(tx,d){
  if(tx.amount>=0) return false;
  if(!matchesDue(tx.name,d)) return false;
  return inDueWindow(tx,d);
}
function autoType(n,a){
  const low=n.toLowerCase();
  if(a>0) return low.includes("waltersdorf")?"income":"income_other";
  if(low.includes("add to balance")) return "transfer";
  if(config.dues.some(d=>matchesDue(n,d))) return "fixed";
  return "variable";
}
function autoCat(n,a){
  const low=n.toLowerCase();
  if(a>0) return low.includes("waltersdorf")?"Gehalt":"Einnahme";
  for(const d of config.dues) if(matchesDue(n,d)) return d.name;
  if(low.includes("paypal")) return "PayPal / prüfen";
  if(low.includes("lidl")||low.includes("rewe")||low.includes("netto")||low.includes("aldi")||low.includes("kaufland")) return "Lebensmittel";
  if(low.includes("audible")) return "Abonnement";
  if(low.includes("google")) return "Digital / Google";
  return "Variable Ausgabe";
}
function renderReview(){
  if(!reviewRows.length){
    $("#review").innerHTML='<p class="muted">Keine DKB-Buchungen erkannt. Bitte prüfen, ob es sich um den DKB-Umsatz-PDF-Export handelt.</p>';
    return;
  }
  $("#review").innerHTML=reviewRows.map((t,i)=>
    `<div class="review" data-i="${i}">
      <div class="head"><div><b>${esc(t.name)}</b><small>${t.date}</small></div><b>${euro.format(t.amount)}</b></div>
      <select>
        <option value="fixed" ${t.type==="fixed"?"selected":""}>Fixkosten</option>
        <option value="variable" ${t.type==="variable"?"selected":""}>Variable Ausgabe</option>
        <option value="one_off">Sonderausgabe</option>
        <option value="transfer" ${t.type==="transfer"?"selected":""}>Umbuchung</option>
        <option value="income" ${t.type==="income"?"selected":""}>Gehalt</option>
        <option value="income_other" ${t.type==="income_other"?"selected":""}>Sonstige Einnahme</option>
      </select>
    </div>`).join("")+
    '<button class="btn" id="confirmImport">Geprüfte Buchungen übernehmen</button>';
  $("#confirmImport").onclick=confirmImport;
}
async function confirmImport(){
  const ids=new Set(state.transactions.map(t=>t.id));
  const settledNow=[];
  let added=0;

  reviewRows.forEach((t,i)=>{
    t.type=$(`.review[data-i="${i}"] select`).value;
    if(!ids.has(t.id)){
      state.transactions.push(t);
      ids.add(t.id);
      added++;
    }

    // Nur aktuelle Fälligkeiten im expliziten Zahlungsfenster dürfen erledigt werden.
    for(const d of config.dues){
      if(d.includeInForecast===false) continue;
      if(state.dueActive[d.id]===false) continue;
      if(!dueCanBeSettledByTx(t,d)) continue;

      // Bei Best Fitness zusätzlich Betrag gegen Vertrag prüfen.
      if(d.id==="fitness" && Math.abs(Math.abs(t.amount)-29.99)>0.02) continue;
      if(d.id==="fitness_2" && Math.abs(Math.abs(t.amount)-17.96)>0.02) continue;

      state.dueActive[d.id]=false;
      settledNow.push({due:d.name,tx:t.name,date:t.date,amount:t.amount});
    }
  });

  await saveState();

  const historical=reviewRows.filter(t=>{
    return !config.dues.some(d=>dueCanBeSettledByTx(t,d));
  }).length;

  $("#pdfMsg").textContent=
    `Auszug analysiert: ${reviewRows.length} Buchungen erkannt, ${added} neu gespeichert, `+
    `${settledNow.length} aktuelle Fälligkeiten bestätigt. Historische Buchungen ändern die Prognose nicht.`;
  $("#pdfMsg").className="msg good";

  $("#review").innerHTML = settledNow.length
    ? `<div class="panel"><h3>Aktuell bestätigte Fälligkeiten</h3>${
        settledNow.map(x=>`<div class="due"><div><b>${esc(x.due)}</b><small>${esc(x.date)} · erkannt über ${esc(x.tx)}</small></div><b>${euro.format(x.amount)}</b></div>`).join("")
      }</div>`
    : '<p class="muted">Keine aktuell fällige Position wurde durch diesen Auszug als bezahlt bestätigt.</p>';

  render();
  queueAutoSync();
}

async function loadGIS(){
  if(window.google?.accounts?.oauth2)return;
  await new Promise((res,rej)=>{
    const s=document.createElement("script");
    s.src="https://accounts.google.com/gsi/client";
    s.onload=res;s.onerror=()=>rej(Error("Google-Anmeldung konnte nicht geladen werden"));
    document.head.appendChild(s);
  });
}
function msgDrive(t,k=""){const e=$("#driveMsg");e.textContent=t;e.className="msg "+k;}
async function connectDrive(){
  if(!state.drive.clientId){msgDrive("Bitte zuerst Client-ID eintragen.","bad");return;}
  try{
    await loadGIS();
    const tc=google.accounts.oauth2.initTokenClient({
      client_id:state.drive.clientId,scope:config.drive.scope,
      callback:r=>{
        if(r.error){msgDrive(r.error,"bad");return;}
        driveToken=r.access_token;$("#sync").disabled=false;msgDrive("Google Drive verbunden.","good");startAutoSyncLoop();render();if(state.drive.autoSync!==false) syncDrive();
      }
    });
    tc.requestAccessToken({prompt:"consent"});
  }catch(e){msgDrive(e.message,"bad");}
}

async function dfetch(url,opt={}){
  const h=new Headers(opt.headers||{});
  h.set("Authorization","Bearer "+driveToken);
  const r=await fetch(url,{...opt,headers:h});
  if(!r.ok) throw Error("Drive-Fehler "+r.status);
  return r;
}
async function findDrive(){
  const q=encodeURIComponent(`name='${config.drive.fileName}' and trashed=false`);
  const r=await dfetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,modifiedTime,name)`);
  const j=await r.json();
  driveFileId=j.files?.[0]?.id||null;
  return j.files?.[0]||null;
}
async function pullDrive(){
  const meta=await findDrive();
  if(!meta) return null;
  const r=await dfetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`);
  return await r.json();
}
async function pushDrive(payload){
  const data={...payload,updatedAt:new Date().toISOString(),schemaVersion:"8.5.0"};
  if(!driveFileId){
    const boundary="athub"+Date.now();
    const meta={name:config.drive.fileName,mimeType:"application/json"};
    const body=`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
    const r=await dfetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",{
      method:"POST",
      headers:{"Content-Type":"multipart/related; boundary="+boundary},
      body
    });
    driveFileId=(await r.json()).id;
  }else{
    await dfetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`,{
      method:"PATCH",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(data)
    });
  }
}
function newerValue(localVal,remoteVal,localTs,remoteTs){
  const l=Date.parse(localTs||0),r=Date.parse(remoteTs||0);
  return r>l?remoteVal:localVal;
}
function mergeTransactions(a=[],b=[]){
  const map=new Map();
  for(const t of [...a,...b]){
    if(!t?.id) continue;
    const prev=map.get(t.id);
    if(!prev) map.set(t.id,t);
    else{
      const pt=Date.parse(prev.updatedAt||prev.iso||0);
      const nt=Date.parse(t.updatedAt||t.iso||0);
      if(nt>pt) map.set(t.id,t);
    }
  }
  return [...map.values()];
}
function mergeObjectByTimestamp(localObj={},remoteObj={},localTs,remoteTs){
  return Date.parse(remoteTs||0)>Date.parse(localTs||0)?{...remoteObj}:{...localObj};
}
function mergeStates(local,remote){
  const merged={...local};
  merged.transactions=mergeTransactions(local.transactions,remote.transactions);

  merged.balance=newerValue(
    local.balance,remote.balance,
    local.fieldChangedAt?.balance||local.localChangedAt,
    remote.fieldChangedAt?.balance||remote.localChangedAt
  );

  merged.dueActive=mergeObjectByTimestamp(
    local.dueActive,remote.dueActive,
    local.fieldChangedAt?.dueActive||local.localChangedAt,
    remote.fieldChangedAt?.dueActive||remote.localChangedAt
  );
  for(const d of config.dues){
    if(d.includeInForecast===false) merged.dueActive[d.id]=false;
  }

  merged.planActive=mergeObjectByTimestamp(
    local.planActive,remote.planActive,
    local.fieldChangedAt?.planActive||local.localChangedAt,
    remote.fieldChangedAt?.planActive||remote.localChangedAt
  );

  merged.fieldChangedAt={
    balance: Date.parse(remote.fieldChangedAt?.balance||0)>Date.parse(local.fieldChangedAt?.balance||0)
      ? remote.fieldChangedAt?.balance : local.fieldChangedAt?.balance,
    dueActive: Date.parse(remote.fieldChangedAt?.dueActive||0)>Date.parse(local.fieldChangedAt?.dueActive||0)
      ? remote.fieldChangedAt?.dueActive : local.fieldChangedAt?.dueActive,
    planActive: Date.parse(remote.fieldChangedAt?.planActive||0)>Date.parse(local.fieldChangedAt?.planActive||0)
      ? remote.fieldChangedAt?.planActive : local.fieldChangedAt?.planActive
  };

  merged.drive={...local.drive,clientId:local.drive?.clientId||remote.drive?.clientId||"",autoSync:local.drive?.autoSync!==false};
  merged.localChangedAt=new Date(Math.max(Date.parse(local.localChangedAt||0),Date.parse(remote.localChangedAt||0))).toISOString();
  merged.migratedTo=MIGRATION;
  merged.deviceId=local.deviceId;
  return merged;
}
async function syncDrive(){
  if(!driveToken){msgDrive("Nicht verbunden.","bad");return;}
  try{
    msgDrive("Synchronisierung läuft …");
    const remote=await pullDrive();

    if(!remote){
      await pushDrive(state);
      state.lastSyncAt=new Date().toISOString();
      await saveState(false);
      msgDrive("Drive-Datei angelegt. Dieses Gerät ist jetzt synchronisiert.","good");
      render();
      return;
    }

    state=mergeStates(state,remote);
    migrateState();
    await saveState(false);
    await pushDrive(state);
    state.lastSyncAt=new Date().toISOString();
    await saveState(false);

    msgDrive("Synchronisiert. Handy und Rechner verwenden denselben Datenstand.","good");
    render();
  }catch(e){
    msgDrive(e.message,"bad");
  }
}
let autoSyncTimer=null;
let autoSyncQueued=null;
function startAutoSyncLoop(){
  clearInterval(autoSyncTimer);
  const sec=Math.max(30,Number(config.drive.syncIntervalSeconds||60));
  autoSyncTimer=setInterval(()=>{
    if(state?.drive?.autoSync!==false && driveToken) syncDrive();
  },sec*1000);
}
function queueAutoSync(){
  if(state?.drive?.autoSync===false || !driveToken) return;
  clearTimeout(autoSyncQueued);
  autoSyncQueued=setTimeout(()=>syncDrive(),1200);
}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16);}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}

(async()=>{
  config=await fetch("config.json",{cache:"no-store"}).then(r=>r.json());
  state=await loadState().catch(()=>null)||defaultState();
  migrateState();
  bind();
  render();
  startAutoSyncLoop();
  if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
