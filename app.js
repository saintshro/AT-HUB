const euro=new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"});
let config=null,state=null,reviewRows=[],driveToken=null,driveFileId=null;
const DB="athub-fin-v7",STORE="state";
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
async function db(){return await new Promise((res,rej)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function loadState(){const d=await db();return await new Promise((res,rej)=>{const t=d.transaction(STORE,"readonly"),q=t.objectStore(STORE).get("main");q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}
async function saveState(localChange=true){if(localChange)state.localChangedAt=new Date().toISOString();const d=await db();return await new Promise((res,rej)=>{const t=d.transaction(STORE,"readwrite");t.objectStore(STORE).put(state,"main");t.oncomplete=res;t.onerror=()=>rej(t.error)})}
function defaultState(){const old=Number(localStorage.getItem("athub-balance"));return{balance:Number.isFinite(old)?old:null,transactions:[],dueActive:Object.fromEntries(config.dues.map(d=>[d.id,true])),lastSyncAt:null,localChangedAt:new Date().toISOString(),drive:{clientId:config.drive.clientId||""}}}
function financePeriod(){const n=new Date(),d=n.getDate(),s=15;let start,end;if(d>=s){start=new Date(n.getFullYear(),n.getMonth(),s);end=new Date(n.getFullYear(),n.getMonth()+1,s)}else{start=new Date(n.getFullYear(),n.getMonth()-1,s);end=new Date(n.getFullYear(),n.getMonth(),s)}return{start,end}}
function fmt(d){return d.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"})}
function render(){const p=financePeriod();$("#period").textContent=`Finanzmonat ${fmt(p.start)} → ${fmt(p.end)}`;const open=config.dues.filter(d=>state.dueActive[d.id]!==false),sum=open.reduce((s,x)=>s+x.amount,0),fc=state.balance==null?null:state.balance-sum,used=fc==null?null:Math.min(config.overdraftLimit,Math.max(0,-fc)),left=used==null?null:Math.max(0,config.overdraftLimit-used),over=fc==null?null:Math.max(0,-fc-config.overdraftLimit);
$("#current").textContent=state.balance==null?"fehlt":euro.format(state.balance);$("#futureSum").textContent=euro.format(sum);$("#forecast").textContent=fc==null?"Kontostand eingeben":euro.format(fc);$("#forecast").classList.toggle("red",fc!=null&&fc<0);$("#forecastText").textContent=fc==null?"Bitte aktuellen Kontostand eintragen.":`Kontostand ${euro.format(state.balance)} minus ${euro.format(sum)} noch offene Fixabbuchungen.`;$("#dispoLeft").textContent=left==null?"–":euro.format(left);$("#saveGoal").textContent=over==null?"–":euro.format(Math.ceil(over/10)*10);$("#syncState").textContent=state.lastSyncAt?"Drive":"lokal";
$("#dues").innerHTML=config.dues.map(d=>`<div class="due"><div><b>${esc(d.name)}</b><small>${d.date} · ${euro.format(d.amount)} · Sicherheit: ${d.confidence}</small></div><div class="right"><button class="toggle ${state.dueActive[d.id]!==false?"on":""}" onclick="toggleDue('${d.id}')">${state.dueActive[d.id]!==false?"eingerechnet ✓":"aus"}</button></div></div>`).join("");
$("#txList").innerHTML=state.transactions.length?state.transactions.slice().sort((a,b)=>b.iso.localeCompare(a.iso)).map(t=>`<div class="tx"><div><b>${esc(t.name)}</b><small>${t.date} · ${esc(t.category)}</small></div><b class="${t.amount<0?"red":"good"}">${euro.format(t.amount)}</b></div>`).join(""):'<p class="muted">Noch keine importierten Buchungen gespeichert.</p>';
$("#bal").value=state.balance??"";$("#clientId").value=state.drive.clientId||""}
window.toggleDue=async id=>{state.dueActive[id]=state.dueActive[id]===false;await saveState();render()}
function bind(){$$(".tab").forEach(b=>b.onclick=()=>{$$(".tab").forEach(x=>x.classList.remove("active"));$$(".pane").forEach(x=>x.classList.remove("active"));b.classList.add("active");$("#"+b.dataset.tab).classList.add("active")});
$("#saveBal").onclick=async()=>{const v=Number($("#bal").value);if(Number.isFinite(v)){state.balance=v;await saveState();render()}};
const drop=$("#drop"),pdf=$("#pdf");drop.onclick=()=>pdf.click();drop.ondragover=e=>e.preventDefault();drop.ondrop=e=>{e.preventDefault();if(e.dataTransfer.files[0])handlePDF(e.dataTransfer.files[0])};pdf.onchange=()=>pdf.files[0]&&handlePDF(pdf.files[0]);
$("#saveClient").onclick=async()=>{state.drive.clientId=$("#clientId").value.trim();await saveState();msgDrive(state.drive.clientId?"Client-ID gespeichert.":"Client-ID entfernt.","good")};$("#connect").onclick=connectDrive;$("#sync").onclick=syncDrive}
async function loadPdfJs(){return await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/+esm")}
async function handlePDF(file){
 const msg=$("#pdfMsg");
 $("#review").innerHTML="";

 if(file.type!=="application/pdf"){
  msg.textContent="Bitte PDF auswählen.";
  msg.className="msg bad";
  return;
 }

 msg.textContent="PDF wird lokal gelesen …";
 msg.className="msg";

 try{
  const pdfjs=await loadPdfJs();

  pdfjs.GlobalWorkerOptions.workerSrc=
   "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs";

  const pdf=await pdfjs.getDocument({
   data:new Uint8Array(await file.arrayBuffer())
  }).promise;

  let lines=[];

  for(let p=1;p<=pdf.numPages;p++){
   const pg=await pdf.getPage(p);
   const c=await pg.getTextContent();

   const rows=new Map();

   for(const it of c.items){
    const y=Math.round((it.transform?.[5]||0)*2)/2;

    if(!rows.has(y)){
     rows.set(y,[]);
    }

    rows.get(y).push({
     x:it.transform?.[4]||0,
     s:it.str||""
    });
   }

   const pageLines=[...rows.entries()]
    .sort((a,b)=>b[0]-a[0])
    .map(([y,items])=>
     items
      .sort((a,b)=>a.x-b.x)
      .map(v=>v.s)
      .join(" ")
      .replace(/\s+/g," ")
      .trim()
    )
    .filter(Boolean);

   lines.push(...pageLines);
  }

  reviewRows=parseDKBLines(lines);

  msg.textContent=
   `${pdf.numPages} Seiten gelesen · ${reviewRows.length} Buchungen erkannt.`;

  msg.className="msg good";

  renderReview();

 }catch(e){
  msg.textContent=
   "PDF konnte nicht gelesen werden: "+e.message;

  msg.className="msg bad";
 }
}


function parseMoney(raw){

 let s=String(raw||"")
  .trim()
  .replace(/\s/g,"");

 if(!s){
  return NaN;
 }

 const neg=s.startsWith("-");

 s=s.replace(/^[-+]/,"");

 const lastComma=s.lastIndexOf(",");
 const lastDot=s.lastIndexOf(".");

 if(lastComma>=0 && lastDot>=0){

  if(lastComma>lastDot){
   s=s.replace(/\./g,"")
      .replace(",",".");
  }else{
   s=s.replace(/,/g,"");
  }

 }else if(lastComma>=0){

  const parts=s.split(",");

  if(parts[parts.length-1].length===2){
   s=
    parts.slice(0,-1).join("")+
    "."+
    parts.at(-1);
  }else{
   s=s.replace(/,/g,"");
  }

 }else if(lastDot>=0){

  const parts=s.split(".");

  if(parts[parts.length-1].length===2){
   s=
    parts.slice(0,-1).join("")+
    "."+
    parts.at(-1);
  }else{
   s=s.replace(/\./g,"");
  }
 }

 const n=Number(s);

 return Number.isFinite(n)
  ? (neg ? -n : n)
  : NaN;
}


function parseDKBLines(lines){

 const out=[];
 const seen=new Set();

 const rowRx=
  /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s+(-?\d{1,6}(?:[.,]\d{2}))$/;

 for(let i=0;i<lines.length;i++){

  const m=lines[i].match(rowRx);

  if(!m){
   continue;
  }

  const date=m[1];
  const name=m[2].trim();
  const amount=parseMoney(m[3]);

  if(!Number.isFinite(amount)){
   continue;
  }

  if(/^(Datum|Zeitraum|Auszug)$/i.test(name)){
   continue;
  }

  const key=
   date+"|"+
   name+"|"+
   amount.toFixed(2);

  if(seen.has(key)){
   continue;
  }

  seen.add(key);

  const type=autoType(name,amount);
  const cat=autoCat(name,amount);

  const [dd,mm,yy]=date.split(".");

  out.push({
   id:hash(key),
   date:date,
   iso:`${yy}-${mm}-${dd}`,
   name:name,
   amount:amount,
   type:type,
   category:cat
  });
 }

 return out.slice(0,700);
}
function autoType(n,a){n=n.toLowerCase();if(a>0)return n.includes("waltersdorf")?"income":"income_other";if(n.includes("add to balance"))return"transfer";if(config.dues.some(d=>d.match.some(x=>n.includes(x))))return"fixed";return"variable"}
function autoCat(n,a){n=n.toLowerCase();if(a>0)return n.includes("waltersdorf")?"Gehalt":"Einnahme";for(const d of config.dues)if(d.match.some(x=>n.includes(x)))return d.name;if(n.includes("paypal"))return"PayPal / prüfen";if(n.includes("lidl")||n.includes("rewe")||n.includes("netto")||n.includes("aldi")||n.includes("kaufland"))return"Lebensmittel";return"Variable Ausgabe"}
function renderReview(){if(!reviewRows.length){$("#review").innerHTML='<p class="muted">Keine Buchungen erkannt.</p>';return}$("#review").innerHTML=reviewRows.slice(0,120).map((t,i)=>`<div class="review" data-i="${i}"><div class="head"><div><b>${esc(t.name)}</b><small>${t.date}</small></div><b>${euro.format(t.amount)}</b></div><select><option value="fixed" ${t.type==="fixed"?"selected":""}>Fixkosten</option><option value="variable" ${t.type==="variable"?"selected":""}>Variable Ausgabe</option><option value="one_off">Sonderausgabe</option><option value="transfer" ${t.type==="transfer"?"selected":""}>Umbuchung</option><option value="income" ${t.type==="income"?"selected":""}>Gehalt</option><option value="income_other" ${t.type==="income_other"?"selected":""}>Sonstige Einnahme</option></select></div>`).join("")+'<button class="btn" id="confirmImport">Geprüfte Buchungen übernehmen</button>';$("#confirmImport").onclick=confirmImport}
async function confirmImport(){const ids=new Set(state.transactions.map(t=>t.id));reviewRows.slice(0,120).forEach((t,i)=>{t.type=$(`.review[data-i="${i}"] select`).value;if(!ids.has(t.id))state.transactions.push(t);const low=t.name.toLowerCase();for(const d of config.dues)if(d.match.some(x=>low.includes(x)))state.dueActive[d.id]=false});await saveState();$("#pdfMsg").textContent="Import übernommen. Erkannte Fixkosten wurden als gebucht markiert.";$("#review").innerHTML="";render()}
async function loadGIS(){if(window.google?.accounts?.oauth2)return;await new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://accounts.google.com/gsi/client";s.onload=res;s.onerror=()=>rej(Error("Google-Anmeldung konnte nicht geladen werden"));document.head.appendChild(s)})}
function msgDrive(t,k=""){const e=$("#driveMsg");e.textContent=t;e.className="msg "+k}
async function connectDrive(){if(!state.drive.clientId){msgDrive("Bitte zuerst Client-ID eintragen.","bad");return}try{await loadGIS();const tc=google.accounts.oauth2.initTokenClient({client_id:state.drive.clientId,scope:config.drive.scope,callback:r=>{if(r.error){msgDrive(r.error,"bad");return}driveToken=r.access_token;$("#sync").disabled=false;msgDrive("Google Drive verbunden.","good");}});tc.requestAccessToken({prompt:"consent"})}catch(e){msgDrive(e.message,"bad")}}
async function dfetch(url,opt={}){const h=new Headers(opt.headers||{});h.set("Authorization","Bearer "+driveToken);const r=await fetch(url,{...opt,headers:h});if(!r.ok)throw Error("Drive-Fehler "+r.status);return r}
async function findDrive(){const q=encodeURIComponent(`name='${config.drive.fileName}' and trashed=false`);const r=await dfetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,modifiedTime)`);const j=await r.json();driveFileId=j.files?.[0]?.id||null;return j.files?.[0]||null}
async function pullDrive(){const meta=await findDrive();if(!meta)return null;const r=await dfetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`);return await r.json()}
async function pushDrive(payload){if(!driveFileId){const boundary="athub"+Date.now(),meta={name:config.drive.fileName,mimeType:"application/json"},body=`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}--`;const r=await dfetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",{method:"POST",headers:{"Content-Type":"multipart/related; boundary="+boundary},body});driveFileId=(await r.json()).id}else await dfetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})}
async function syncDrive(){if(!driveToken){msgDrive("Nicht verbunden.","bad");return}try{msgDrive("Synchronisierung läuft …");const remote=await pullDrive();if(!remote){await pushDrive({...state,updatedAt:new Date().toISOString()});state.lastSyncAt=new Date().toISOString();await saveState(false);msgDrive("Erste Drive-Datei angelegt.","good");render();return}const rt=Date.parse(remote.updatedAt||remote.localChangedAt||0),lt=Date.parse(state.localChangedAt||0),st=Date.parse(state.lastSyncAt||0);const localChanged=lt>st,remoteChanged=rt>st;if(localChanged&&remoteChanged){msgDrive("Konflikt: Gerät und Drive wurden geändert. Bitte vorerst Backup prüfen; v7 überschreibt nicht automatisch.","bad");return}if(remoteChanged){state=remote;await saveState(false);msgDrive("Neueren Drive-Stand übernommen.","good")}else if(localChanged){await pushDrive({...state,updatedAt:new Date().toISOString()});state.lastSyncAt=new Date().toISOString();await saveState(false);msgDrive("Lokalen Stand nach Drive gespeichert.","good")}else msgDrive("Alles aktuell.","good");render()}catch(e){msgDrive(e.message,"bad")}}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(16)}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
(async()=>{config=await fetch("config.json").then(r=>r.json());state=await loadState().catch(()=>null)||defaultState();bind();render();if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{})})();
