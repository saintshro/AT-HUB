/* DKB transaction export import. PDF bytes remain in the browser.
 * Only explicitly confirmed transaction data uses the existing finance sync. */
(function(root) {
  "use strict";
  const clean = value => String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  const normalized = value => clean(value).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const cents = value => Math.round(Number(value) * 100);
  function isoDate(value) {
    const match = String(value).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!match) return "";
    const [, d, m, y] = match, date = new Date(Number(y), Number(m) - 1, Number(d));
    return date.getFullYear() === Number(y) && date.getMonth() === Number(m) - 1 && date.getDate() === Number(d) ? `${y}-${m}-${d}` : "";
  }
  function amount(value) {
    let text = clean(value).replace(/\s/g, "");
    if (!/^[+-]?\d[\d.,]*[+-]?$/.test(text)) return null;
    const negative = text.includes("-");
    text = text.replace(/[+-]/g, "");
    const decimal = Math.max(text.lastIndexOf("."), text.lastIndexOf(","));
    if (decimal < 0 || text.length - decimal !== 3) return null;
    const result = Number(text.slice(0, decimal).replace(/[.,]/g, "") + "." + text.slice(decimal + 1));
    return Number.isFinite(result) ? (negative ? -result : result) : null;
  }
  function linesForPage(page) {
    const lines = [];
    for (const item of page.items.slice().sort((a,b) => a.y-b.y || a.x-b.x)) {
      let line = lines.find(row => Math.abs(row.y-item.y) < 2.5);
      if (!line) { line = { y:item.y, items:[] }; lines.push(line); }
      line.items.push(item);
    }
    return lines.map(line => ({...line, items:line.items.sort((a,b)=>a.x-b.x), text:clean(line.items.map(x=>x.str).join(" "))}));
  }
  function parsePages(pages) {
    const allLines = pages.flatMap(linesForPage), documentText = allLines.map(x=>x.text).join("\n");
    if (!/\bDKB\b|Deutsche Kreditbank/i.test(documentText)) throw new Error("Bitte einen DKB-Umsatzexport verwenden. Das PDF wurde nicht übernommen.");
    const countMatch = documentText.match(/Anzahl der Transaktionen\s*:\s*(\d+)/i);
    const range = documentText.match(/Zeitraum\s*:\s*(\d{2}\.\d{2}\.\d{4})\s*[-–]\s*(\d{2}\.\d{2}\.\d{4})/i);
    const rows = [], warnings = [];
    for (const page of pages) {
      const lines = linesForPage(page);
      const header = lines.find(line => line.items.some(x=>clean(x.str)==="Datum") && /Betrag/.test(line.text));
      if (!header) continue;
      const dateX = header.items.find(x=>clean(x.str)==="Datum").x;
      const merchantX = header.items.find(x=>/^Erl/.test(clean(x.str)))?.x;
      const amountX = header.items.find(x=>/Betrag/.test(x.str))?.x;
      if (merchantX == null || amountX == null) throw new Error("Die Spalten des DKB-Auszuges konnten nicht sicher erkannt werden.");
      const starts = lines.filter(line => line.y > header.y && line.items.some(x=>x.x>=dateX-3 && x.x<merchantX-5 && isoDate(clean(x.str))));
      const footer = lines.find(line => line.y > header.y && line.items.some(x=>x.x<merchantX-5 && /Deutsche Kreditbank/.test(x.str)));
      for (let index=0;index<starts.length;index++) {
        const line=starts[index], dateItem=line.items.find(x=>x.x<merchantX-5 && isoDate(clean(x.str)));
        const amountItems=line.items.filter(x=>x.x>=amountX-12);
        const rowAmount=amount(amountItems.map(x=>x.str).join(""));
        const name=clean(line.items.filter(x=>x.x>=merchantX-3 && x.x<amountX-12).map(x=>x.str).join(" "));
        if (rowAmount == null || !name) { warnings.push("Eine Tabellenzeile konnte nicht sicher gelesen werden."); continue; }
        const bottom=starts[index+1]?.y || footer?.y || page.height;
        const notes=lines.filter(x=>x.y>line.y+2.5 && x.y<bottom-2.5).map(x=>clean(x.items.filter(i=>i.x>=merchantX-3 && i.x<amountX-12).map(i=>i.str).join(" "))).filter(Boolean);
        rows.push({iso:isoDate(clean(dateItem.str)),name,amount:rowAmount,note:notes.join("\n"),status:"booked",category:"DKB-Kontoauszug",source:"DKB PDF"});
      }
    }
    const declaredCount=countMatch ? Number(countMatch[1]) : null;
    if (!rows.length) throw new Error("Keine lesbare DKB-Buchungstabelle gefunden. Bei gescannten PDFs ist dieser Import nicht möglich.");
    if (declaredCount == null) warnings.push("Die Gesamtzahl der Buchungen fehlt im Auszug; keine sichere Übernahme möglich.");
    if (declaredCount != null && declaredCount!==rows.length) warnings.push(`Der Auszug nennt ${declaredCount} Buchungen, erkannt wurden ${rows.length}.`);
    const start=range ? isoDate(range[1]) : "", end=range ? isoDate(range[2]) : "";
    if (!start || !end || rows.some(row=>row.iso<start || row.iso>end)) warnings.push("Buchungszeitraum und erkannte Daten stimmen nicht sicher überein.");
    // A balance buried in a transaction description is never an ending balance.
    // This export format has no explicit closing-balance field; keep the current balance.
    return {rows,start,end,declaredCount,warnings};
  }
  function key(row) { return JSON.stringify([row.iso || row.date,cents(row.amount),normalized(row.name || row.merchant)]); }
  function markDuplicates(rows, existing) {
    const counts=new Map();
    for (const row of existing) {
      if (row.status==="planned") continue;
      const signature=key(row); counts.set(signature,(counts.get(signature)||0)+1);
    }
    const occurrences=new Map();
    return rows.map(row=>{
      const signature=key(row), occurrence=(occurrences.get(signature)||0)+1; occurrences.set(signature,occurrence);
      return {...row,pdfImportId:signature+"#"+occurrence,duplicate:occurrence<=(counts.get(signature)||0)};
    });
  }
  function matchDues(rows, dues) {
    return dues.map(due=>{
      const candidates=rows.filter(row=>row.amount<0 && cents(-row.amount)===cents(due.amount) && normalized(row.name)===normalized(due.name) && Math.abs(new Date(row.iso)-new Date(due.date))<=3*86400000);
      return candidates.length===1 ? {due,transaction:candidates[0]} : null;
    }).filter(Boolean);
  }
  const api={parsePages,markDuplicates,matchDues,isoDate,amount,key};
  if (typeof module!=="undefined" && module.exports) module.exports=api;
  root.ATHubPDF=api;
  if (typeof document==="undefined") return;
  let preview=null, loading=false;
  const html = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const money=value=>new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(value);
  const status=text=>{const element=document.querySelector("#pdfMsg");if(element)element.textContent=text;};
  async function readFile(file) {
    if (loading) return;
    preview=null; const review=document.querySelector("#review"); if(review)review.innerHTML="";
    if (!file || !/\.pdf$/i.test(file.name)) {status("Bitte genau eine PDF-Datei auswählen.");return;}
    loading=true;status("PDF wird lokal gelesen. Es werden noch keine Daten gespeichert …");
    try {
      const library=await import(new URL("pdf.min.mjs",document.baseURI).href);
      library.GlobalWorkerOptions.workerSrc=new URL("pdf.worker.min.mjs",document.baseURI).href;
      const pdf=await library.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,disableFontFace:true}).promise;
      const pages=[];
      try {
        for(let number=1;number<=pdf.numPages;number++){
          const page=await pdf.getPage(number),viewport=page.getViewport({scale:1}),text=await page.getTextContent();
          pages.push({width:viewport.width,height:viewport.height,items:text.items.filter(x=>x.str).map(x=>{const [x0,y0]=viewport.convertToViewportPoint(x.transform[4],x.transform[5]);return{str:x.str,x:x0,y:y0,width:x.width};})});
          page.cleanup();
        }
      } finally {await pdf.destroy();}
      const parsed=parsePages(pages), rows=markDuplicates(parsed.rows,state.transactions || []);
      const openDues=ensureCycleState().rows.filter(row=>state.dueActive[row.id]!==false);
      preview={...parsed,rows,fileName:file.name,basis:financeComparable({state,config}),matches:matchDues(rows,openDues)};
      showPreview();
      status(parsed.warnings.length ? "Die Erkennung ist unvollständig. Es wurden keine Daten gespeichert." : `${rows.length} Buchungen erkannt. Bitte Vorschau prüfen und die Übernahme ausdrücklich bestätigen.`);
    } catch(error) {
      preview=null;status(error.name==="PasswordException" ? "Die PDF ist passwortgeschützt. Bitte einen ungeschützten DKB-Umsatzexport verwenden." : "PDF konnte nicht importiert werden: "+error.message);
    } finally {
      loading=false;const input=document.querySelector("#pdf");if(input)input.value="";
    }
  }
  function showPreview() {
    const review=document.querySelector("#review");if(!review || !preview)return;
    const duplicateCount=preview.rows.filter(x=>x.duplicate).length;
    const balanceDate=state.balanceAsOf || "";
    const adjustment=balanceDate ? preview.rows.filter(row=>!row.duplicate && row.iso>balanceDate).reduce((sum,row)=>sum+row.amount,0) : 0;
    review.innerHTML=`<h3>Vorschau — noch nicht übernommen</h3><p>${html(preview.start)} bis ${html(preview.end)} · ${preview.rows.length} Buchungen · ${duplicateCount} bereits vorhanden</p>
      <p class="muted">Der Auszug enthält keinen eindeutig ausgewiesenen Endsaldo. ${balanceDate?`Nur neue Buchungen nach deinem bestätigten Kontostand vom ${html(balanceDate)} schreiben ihn fort.`:"Der aktuelle Kontostand bleibt unverändert, da für ihn noch kein bestätigtes Datum gespeichert ist."}</p>
      ${preview.warnings.map(text=>`<p class="msg">${html(text)}</p>`).join("")}
      <div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>Übernehmen</th><th>Datum</th><th>Empfänger</th><th>Betrag</th></tr></thead><tbody>
      ${preview.rows.map((row,index)=>`<tr><td><input type="checkbox" data-pdf-row="${index}" ${row.duplicate?'disabled':'checked'} aria-label="Buchung ${index+1} übernehmen">${row.duplicate?" bereits vorhanden":""}</td><td>${html(row.iso)}</td><td>${html(row.name)}<details><summary>Verwendungszweck</summary><p style="white-space:pre-wrap">${html(row.note)}</p></details></td><td style="white-space:nowrap">${money(row.amount)}</td></tr>`).join("")}</tbody></table></div>
      ${preview.matches.length?`<h4>Passende offene Fälligkeiten</h4><p>Nur diese Vorschläge werden nach deiner Bestätigung als gebucht markiert.</p>${preview.matches.map((match,index)=>`<label style="display:block"><input type="checkbox" data-pdf-due="${index}" checked> ${html(match.due.name)} · ${html(match.due.date)} · ${money(match.due.amount)}</label>`).join("")}`:"<p class=\"muted\">Keine offenen Fälligkeiten eindeutig zugeordnet. Bereits bezahlte Fälligkeiten bitte separat prüfen.</p>"}
      <p class="muted">Vorschau der Kontostandsänderung bei Übernahme aller neuen Buchungen: ${money(adjustment)}. Abgewählte Buchungen werden nicht berücksichtigt.</p>
      <div class="actions"><button id="pdfConfirm" class="btn" ${preview.warnings.length?'disabled':''}>Ausgewählte Buchungen übernehmen</button><button id="pdfCancel" class="btn secondary">Abbrechen</button></div>`;
    document.querySelector("#pdfConfirm")?.addEventListener("click",confirmImport);
    document.querySelector("#pdfCancel")?.addEventListener("click",()=>{preview=null;review.innerHTML="";status("Import abgebrochen. Es wurden keine Daten verändert.");});
  }
  async function confirmImport() {
    if(!preview || preview.warnings.length)return;
    if(!financeSyncBaseline){status("Vor der Übernahme zuerst den zentralen Finanzstand laden und das PDF erneut prüfen.");return;}
    if(financeComparable({state,config})!==preview.basis){status("Der Finanzstand hat sich seit der Vorschau geändert. Bitte das PDF erneut prüfen.");return;}
    const selected=Array.from(document.querySelectorAll("[data-pdf-row]:checked")).map(input=>preview.rows[Number(input.dataset.pdfRow)]).filter(row=>row && !row.duplicate);
    const chosenDues=Array.from(document.querySelectorAll("[data-pdf-due]:checked")).map(input=>preview.matches[Number(input.dataset.pdfDue)]).filter(match=>match && (match.transaction.duplicate || selected.includes(match.transaction)));
    if(!selected.length && !chosenDues.length){status("Keine neuen Buchungen oder Fälligkeitsänderungen ausgewählt. Es wurden keine Daten verändert.");return;}
    const button=document.querySelector("#pdfConfirm");if(button)button.disabled=true;
    try {
      localStorage.setItem("athubFinanceBeforePdfV1",JSON.stringify({state,config,savedAt:new Date().toISOString()}));
      const balanceDate=state.balanceAsOf || "";
      const delta=balanceDate ? selected.filter(row=>row.iso>balanceDate).reduce((sum,row)=>sum+row.amount,0) : 0;
      const fileName=preview.fileName;
      state.transactions=(state.transactions || []).concat(selected.map(row=>({...row,id:"pdf_"+crypto.randomUUID(),date:row.iso,importedFrom:fileName,importedAt:new Date().toISOString(),affectsBalance:Boolean(balanceDate && row.iso>balanceDate)})));
      if(state.balance!=null && balanceDate)state.balance=finance881Round(state.balance+delta);
      for(const match of chosenDues)state.dueActive[match.due.id]=false;
      state.financeImportLog=state.financeImportLog || [];
      state.financeImportLog.push({source:"DKB PDF",fileName,importedAt:new Date().toISOString(),count:selected.length,duplicateCount:preview.rows.filter(x=>x.duplicate).length,balanceDelta:delta});
      preview=null;document.querySelector("#review").innerHTML="";
      render();await saveState();
      status(`${selected.length} neue Buchungen lokal übernommen; ${chosenDues.length} Fälligkeiten als gebucht markiert. ${financeDirty?"Zentrale Speicherung noch offen — bitte AT HUB Sync prüfen.":"Zentral gespeichert und durch Rücklesen bestätigt."}`);
    } catch(error) {status("Übernahme konnte nicht abgeschlossen werden: "+error.message+" Bitte AT HUB Sync prüfen.");}
  }
  function wire() {
    document.querySelector("#pdf")?.addEventListener("change",event=>readFile(event.target.files?.[0]));
    const drop=document.querySelector("#drop");
    drop?.addEventListener("dragover",event=>{event.preventDefault();});
    drop?.addEventListener("drop",event=>{event.preventDefault();event.stopPropagation();const files=event.dataTransfer?.files;if(files?.length!==1){status("Bitte genau eine PDF-Datei ablegen.");return;}readFile(files[0]);});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",wire);else wire();
})(typeof globalThis!=="undefined"?globalThis:this);
