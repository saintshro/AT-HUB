/* AT HUB Finanzcockpit v8.8.1 – Kernlogik
   - Kontostand wird aus einem bestätigten Basisstand + neuen Buchungen fortgeschrieben.
   - Aktuelle Fälligkeiten werden aus den Wiederholungsregeln des Finanzmonats 15. -> 15. gebaut.
   - Bereits gebuchte Fälligkeiten werden automatisch aus "Noch offen" entfernt.
   - Drive-Sync behält die bestehende Datei und synchronisiert den neuen Balance-Anker mit. */

function finance881Round(value){
  return Math.round((Number(value)||0)*100)/100;
}

function finance881KnownIds(transactions=[]){
  return [...new Set(transactions.map(t=>typeof t==="string"?t:t?.id).filter(Boolean))];
}

function finance881AnchorFromState(s){
  if(s?.balanceAnchor && Number.isFinite(Number(s.balanceAnchor.amount))){
    return {
      amount: finance881Round(s.balanceAnchor.amount),
      date: s.balanceAnchor.date || localDateISO(new Date()),
      changedAt: s.balanceAnchor.changedAt || s.fieldChangedAt?.balance || s.localChangedAt || new Date().toISOString(),
      source: s.balanceAnchor.source || "legacy",
      knownTransactionIds: finance881KnownIds(s.balanceAnchor.knownTransactionIds || [])
    };
  }
  if(Number.isFinite(Number(s?.balance))){
    return {
      amount: finance881Round(s.balance),
      date: localDateISO(new Date()),
      changedAt: s?.fieldChangedAt?.balance || s?.localChangedAt || new Date().toISOString(),
      source: "legacy",
      knownTransactionIds: finance881KnownIds(s?.transactions || [])
    };
  }
  return null;
}

function finance881SetBalanceAnchor(amount,source="manual"){
  if(!Number.isFinite(Number(amount))) return;
  const now=new Date().toISOString();
  state.balanceAnchor={
    amount:finance881Round(amount),
    date:localDateISO(new Date()),
    changedAt:now,
    source,
    knownTransactionIds:finance881KnownIds(state.transactions)
  };
  state.balance=finance881Round(amount);
  touchField("balance");
}

function finance881DerivedBalanceFor(s){
  const anchor=finance881AnchorFromState(s);
  if(!anchor) return null;
  const known=new Set(anchor.knownTransactionIds||[]);
  let value=Number(anchor.amount)||0;
  for(const t of (s.transactions||[])){
    if(!t?.id || known.has(t.id)) continue;
    // Ältere nachträglich importierte Historie darf einen heute bestätigten
    // Kontostand nicht rückwirkend verändern.
    if(!t.iso || t.iso<anchor.date) continue;
    value+=Number(t.amount)||0;
  }
  return finance881Round(value);
}

function finance881RecalculateBalance(){
  const value=finance881DerivedBalanceFor(state);
  if(value==null) return null;
  const changed=state.balance!==value;
  state.balance=value;
  if(changed) touchField("balance");
  return value;
}

function defaultState(){
  const {cycle,rows}=buildCycleDues();
  const now=new Date().toISOString();
  const startingBalance=config.currentSnapshot?.balance ?? null;
  return {
    balance:startingBalance,
    balanceAnchor:Number.isFinite(Number(startingBalance))?{
      amount:finance881Round(startingBalance),
      date:config.currentSnapshot?.date || localDateISO(new Date()),
      changedAt:now,
      source:"config",
      knownTransactionIds:[]
    }:null,
    transactions:[],
    financeCycleId:`${cycle.startISO}_${cycle.endISO}`,
    dueActive:Object.fromEntries(rows.map(d=>[d.id,true])),
    planActive:{emergencyBuffer:true,vacationSavings:false,plannedPaydown:false},
    lastSyncAt:null,
    localChangedAt:now,
    deviceId:localStorage.getItem("athub-device-id")||("dev-"+crypto.randomUUID()),
    fieldChangedAt:{balance:now,dueActive:now,planActive:now},
    drive:{clientId:config.drive.clientId||"",autoSync:config.drive.autoSync!==false},
    migratedTo:"8.8.1"
  };
}

function migrateState(){
  if(!state || typeof state!=="object") state=defaultState();
  if(!state.deviceId) state.deviceId=localStorage.getItem("athub-device-id")||("dev-"+crypto.randomUUID());
  localStorage.setItem("athub-device-id",state.deviceId);
  if(!state.fieldChangedAt) state.fieldChangedAt={balance:state.localChangedAt||new Date().toISOString(),dueActive:state.localChangedAt||new Date().toISOString(),planActive:state.localChangedAt||new Date().toISOString()};
  if(!Array.isArray(state.transactions)) state.transactions=[];
  if(!state.dueActive || typeof state.dueActive!=="object") state.dueActive={};
  if(!state.planActive) state.planActive={emergencyBuffer:true,vacationSavings:false,plannedPaydown:false};
  if(!state.drive) state.drive={clientId:config.drive.clientId||"",autoSync:config.drive.autoSync!==false};
  if(typeof state.drive.autoSync!=="boolean") state.drive.autoSync=config.drive.autoSync!==false;
  if(!state.balanceAnchor && Number.isFinite(Number(state.balance))) state.balanceAnchor=finance881AnchorFromState(state);
  state.migratedTo="8.8.1";
  ensureCycleState();
  finance881RecalculateBalance();
  saveState(false).catch(()=>{});
}

function finance881WindowForRule(rule,dt){
  if(rule.type==="biweekly"){
    const a=new Date(dt),b=new Date(dt);
    a.setDate(a.getDate()-1);b.setDate(b.getDate()+1);
    return {start:localDateISO(a),end:localDateISO(b)};
  }
  const startDay=rule.dayStart||dt.getDate();
  const endDay=rule.dayEnd||startDay;
  const y=dt.getFullYear(),m=dt.getMonth();
  return {
    start:localDateISO(new Date(y,m,Math.min(startDay,daysInMonth(y,m)))),
    end:localDateISO(new Date(y,m,Math.min(endDay,daysInMonth(y,m))))
  };
}

function buildCycleDues(){
  const cycle=cycleForDate();
  const rows=[];
  const legacyById=new Map((config.dues||[]).map(d=>[d.id,d]));
  for(const rule of (config.recurrences||[])){
    if(rule.type==="manual") continue;
    for(const dt of occurrenceDates(rule,cycle)){
      const legacy=legacyById.get(rule.id)||{};
      rows.push({
        ...legacy,
        ...rule,
        match:rule.match||legacy.match||[],
        cycleId:`${rule.id}@${localDateISO(dt)}`,
        baseId:rule.id,
        id:`${rule.id}@${localDateISO(dt)}`,
        dueDate:localDateISO(dt),
        date:euroDate(dt),
        window:finance881WindowForRule(rule,dt),
        includeInForecast:true
      });
    }
  }
  rows.sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.name.localeCompare(b.name));
  return {cycle,rows};
}

function inDueWindow(tx,d){
  if(!d?.window || !tx?.iso) return false;
  return tx.iso>=d.window.start && tx.iso<=d.window.end;
}

function dueCanBeSettledByTx(tx,d){
  if(!tx || Number(tx.amount)>=0) return false;
  if(!matchesDue(tx.name,d)) return false;
  if(!inDueWindow(tx,d)) return false;
  const base=d.baseId||d.id;
  if(base==="fitness" && Math.abs(Math.abs(Number(tx.amount))-29.99)>0.02) return false;
  if(base==="fitness_2" && Math.abs(Math.abs(Number(tx.amount))-17.96)>0.02) return false;
  return true;
}

function finance881ReconcileDues(rows){
  let changed=false;
  for(const d of rows){
    if(state.dueActive[d.id]===false) continue;
    if((state.transactions||[]).some(t=>dueCanBeSettledByTx(t,d))){
      state.dueActive[d.id]=false;
      changed=true;
    }
  }
  return changed;
}

function ensureCycleState(){
  const {cycle,rows}=buildCycleDues();
  const cycleId=`${cycle.startISO}_${cycle.endISO}`;
  let changed=false;
  if(state.financeCycleId!==cycleId){
    const previous=state.dueActive||{};
    state.financeCycleId=cycleId;
    state.dueActive=Object.fromEntries(rows.map(d=>[
      d.id,
      Object.prototype.hasOwnProperty.call(previous,d.id)
        ? previous[d.id]
        : (Object.prototype.hasOwnProperty.call(previous,d.baseId)?previous[d.baseId]:true)
    ]));
    changed=true;
  }else{
    for(const d of rows){
      if(!(d.id in state.dueActive)){state.dueActive[d.id]=true;changed=true;}
    }
    const valid=new Set(rows.map(d=>d.id));
    for(const id of Object.keys(state.dueActive)){
      if(!valid.has(id)){delete state.dueActive[id];changed=true;}
    }
  }
  if(finance881ReconcileDues(rows)) changed=true;
  if(changed){touchField("dueActive");saveState(false).catch(()=>{});}
  return {cycle,rows};
}

function render(){
  const {cycle,rows}=ensureCycleState();
  finance881RecalculateBalance();
  const open=rows.filter(d=>state.dueActive[d.id]!==false);
  const openSum=open.reduce((s,x)=>s+Number(x.amount||0),0);
  const reserves=activeReserveSum();
  const available=state.balance==null?null:finance881Round(state.balance-openSum-reserves);
  const dispoLeft=available==null?null:Math.max(0,config.overdraftLimit-Math.max(0,-available));

  $("#period").textContent=`Finanzmonat ${fmt(cycle.start)} → ${fmt(cycle.end)}`;
  $("#current").textContent=state.balance==null?"fehlt":euro.format(state.balance);
  $("#futureSum").textContent=euro.format(openSum);
  $("#reserveSum").textContent=euro.format(reserves);
  $("#forecast").textContent=available==null?"Kontostand eingeben":euro.format(available);
  $("#forecast").classList.toggle("red",available!=null&&available<0);
  $("#forecastText").textContent=available==null
    ?"Bitte aktuellen Kontostand eintragen."
    :`Kontostand ${euro.format(state.balance)} − noch offen ${euro.format(openSum)} − reserviert ${euro.format(reserves)}.`;
  $("#dispoLeft").textContent=dispoLeft==null?"–":euro.format(dispoLeft);
  $("#saveGoal").textContent=euro.format(config.plan?.plannedPaydown||0);
  $("#vacationValue").textContent=euro.format(config.plan?.vacationSavings||0);

  $("#planRows").innerHTML=reserveRows().map(([k,label,val,note])=>
    `<div class="due"><div><b>${esc(label)}</b><small>${euro.format(val)} · ${esc(note)}</small></div>
     <div class="right"><button class="toggle ${state.planActive[k]?"on":""}" onclick="togglePlan('${k}')">${state.planActive[k]?"aktiv ✓":"aus"}</button></div></div>`
  ).join("");

  $("#dues").innerHTML=rows.length?rows.map(d=>
    `<div class="due"><div><b>${esc(d.name)}</b><small>${esc(d.date)} · ${euro.format(d.amount)} · ${state.dueActive[d.id]!==false?"noch offen":"durch Buchung bestätigt / erledigt"}${d.note?` · ${esc(d.note)}`:""}</small></div>
     <div class="right"><button class="toggle ${state.dueActive[d.id]!==false?"on":""}" onclick="toggleDue('${d.id}')">${state.dueActive[d.id]!==false?"eingerechnet ✓":"bezahlt / aus"}</button></div></div>`
  ).join(""):'<p class="muted">Für diesen Finanzmonat sind keine wiederkehrenden Abbuchungen hinterlegt.</p>';

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
  const d=buildCycleDues().rows.find(x=>x.id===id);
  if(!d) return;
  state.dueActive[id]=state.dueActive[id]===false;
  touchField("dueActive");
  await saveState();
  render();
  queueAutoSync();
};

function bind(){
  $$(".tab").forEach(b=>b.onclick=()=>{
    $$(".tab").forEach(x=>x.classList.remove("active"));
    $$(".pane").forEach(x=>x.classList.remove("active"));
    b.classList.add("active");
    $("#"+b.dataset.tab).classList.add("active");
  });
  $("#saveBal").onclick=async()=>{
    const v=Number($("#bal").value);
    if(Number.isFinite(v)){
      finance881SetBalanceAnchor(v,"manual");
      await saveState();render();queueAutoSync();
    }
  };
  const drop=$("#drop"),pdf=$("#pdf");
  drop.onclick=()=>pdf.click();
  drop.ondragover=e=>{e.preventDefault();drop.classList.add("drag");};
  drop.ondragleave=()=>drop.classList.remove("drag");
  drop.ondrop=e=>{e.preventDefault();drop.classList.remove("drag");if(e.dataTransfer.files[0]) handlePDF(e.dataTransfer.files[0]);};
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
    await saveState();render();if(state.drive.autoSync) queueAutoSync();
  };
}

async function confirmImport(){
  const ids=new Set(state.transactions.map(t=>t.id));
  const settledNow=[];
  const addedRows=[];
  const {rows}=ensureCycleState();
  let dueChanged=false;

  reviewRows.forEach((t,i)=>{
    const row=$( `.review[data-i="${i}"]` );
    if(row){
      t.type=row.querySelector("select").value;
      t.include=row.querySelector('input[type="checkbox"]').checked;
    }else{
      t.include=Number.isFinite(pendingImportBalance)?false:t.include;
    }
    if(t.include && !ids.has(t.id)){
      const saved={...t,importedAt:new Date().toISOString()};
      delete saved.importStatus;delete saved.include;delete saved.legacyId;
      state.transactions.push(saved);ids.add(t.id);addedRows.push(saved);
    }
    if(!t.include) return;
    for(const d of rows){
      if(state.dueActive[d.id]===false) continue;
      if(!dueCanBeSettledByTx(t,d)) continue;
      state.dueActive[d.id]=false;dueChanged=true;
      settledNow.push({due:d.name,tx:t.name,date:t.date,amount:t.amount});
    }
  });

  let balanceMessage="";
  if(Number.isFinite(pendingImportBalance)){
    finance881SetBalanceAnchor(pendingImportBalance,"statement");
    balanceMessage=`Kontostand auf ${euro.format(state.balance)} gesetzt`;
  }else if(state.balanceAnchor || Number.isFinite(Number(state.balance))){
    if(!state.balanceAnchor) state.balanceAnchor=finance881AnchorFromState(state);
    const before=Number(state.balance);
    finance881RecalculateBalance();
    const delta=finance881Round(Number(state.balance)-before);
    balanceMessage=addedRows.length
      ?`Kontostand anhand neuer Buchungen ${delta===0?"bestätigt":`um ${euro.format(delta)} fortgeschrieben`} auf ${euro.format(state.balance)}`
      :`Kontostand unverändert bei ${euro.format(state.balance)}`;
  }

  if(finance881ReconcileDues(rows)) dueChanged=true;
  if(dueChanged) touchField("dueActive");
  await saveState();

  const duplicateCount=reviewRows.filter(t=>t.importStatus==="duplicate").length;
  $("#pdfMsg").textContent=`Import abgeschlossen: ${addedRows.length} neue Buchungen gespeichert, ${duplicateCount} Doppelbuchungen verhindert, ${settledNow.length} aktuelle Fälligkeiten bestätigt${balanceMessage?` und ${balanceMessage}`:""}.`;
  $("#pdfMsg").className="msg good";
  $("#review").innerHTML=settledNow.length
    ?`<div class="panel"><h3>Aktuell bestätigte Fälligkeiten</h3>${settledNow.map(x=>`<div class="due"><div><b>${esc(x.due)}</b><small>${esc(x.date)} · erkannt über ${esc(x.tx)}</small></div><b>${euro.format(x.amount)}</b></div>`).join("")}</div>`
    :'<p class="muted">Keine aktuell fällige Position wurde durch diesen Auszug als bezahlt bestätigt.</p>';
  render();queueAutoSync();
}

function mergeStates(local,remote){
  const merged={...local};
  merged.transactions=mergeTransactions(local.transactions,remote.transactions);

  const localAnchor=finance881AnchorFromState(local);
  const remoteAnchor=finance881AnchorFromState(remote);
  const localAnchorTs=Date.parse(localAnchor?.changedAt||local.fieldChangedAt?.balance||local.localChangedAt||0);
  const remoteAnchorTs=Date.parse(remoteAnchor?.changedAt||remote.fieldChangedAt?.balance||remote.localChangedAt||0);
  merged.balanceAnchor=remoteAnchorTs>localAnchorTs?remoteAnchor:localAnchor;

  merged.dueActive=mergeObjectByTimestamp(
    local.dueActive,remote.dueActive,
    local.fieldChangedAt?.dueActive||local.localChangedAt,
    remote.fieldChangedAt?.dueActive||remote.localChangedAt
  );
  const validCycleIds=new Set(buildCycleDues().rows.map(d=>d.id));
  merged.dueActive=Object.fromEntries(Object.entries(merged.dueActive||{}).filter(([id])=>validCycleIds.has(id)));

  merged.planActive=mergeObjectByTimestamp(
    local.planActive,remote.planActive,
    local.fieldChangedAt?.planActive||local.localChangedAt,
    remote.fieldChangedAt?.planActive||remote.localChangedAt
  );

  merged.fieldChangedAt={
    balance: remoteAnchorTs>localAnchorTs
      ? (remote.fieldChangedAt?.balance||remoteAnchor?.changedAt)
      : (local.fieldChangedAt?.balance||localAnchor?.changedAt),
    dueActive: Date.parse(remote.fieldChangedAt?.dueActive||0)>Date.parse(local.fieldChangedAt?.dueActive||0)
      ? remote.fieldChangedAt?.dueActive : local.fieldChangedAt?.dueActive,
    planActive: Date.parse(remote.fieldChangedAt?.planActive||0)>Date.parse(local.fieldChangedAt?.planActive||0)
      ? remote.fieldChangedAt?.planActive : local.fieldChangedAt?.planActive
  };

  merged.drive={...local.drive,clientId:local.drive?.clientId||remote.drive?.clientId||"",autoSync:local.drive?.autoSync!==false};
  merged.localChangedAt=new Date(Math.max(Date.parse(local.localChangedAt||0),Date.parse(remote.localChangedAt||0),Date.now())).toISOString();
  merged.migratedTo="8.8.1";
  merged.deviceId=local.deviceId;
  merged.balance=finance881DerivedBalanceFor(merged);
  return merged;
}

async function pushDrive(payload){
  const data={...payload,updatedAt:new Date().toISOString(),schemaVersion:"8.8.1"};
  if(!driveFileId){
    const boundary="athub"+Date.now();
    const meta={name:config.drive.fileName,mimeType:"application/json"};
    const body=`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
    const r=await dfetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",{
      method:"POST",headers:{"Content-Type":"multipart/related; boundary="+boundary},body
    });
    driveFileId=(await r.json()).id;
  }else{
    await dfetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`,{
      method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)
    });
  }
}
