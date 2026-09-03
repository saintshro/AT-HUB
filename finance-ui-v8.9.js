/* AT HUB Finanzcockpit v8.9 – Abschluss-UI
   Der stabile v8.8.1-Kern bleibt unverändert.
   Neu:
   - Feld „Noch verfügbar bis 15.“ statt „Dispo frei nach Planung“.
   - Transparente Fälligkeitsliste mit offen/gebucht, Datum, Betrag und exakter Summe.
   - Klick auf „Noch offen“ springt direkt zur Fälligkeitsliste. */

(function(){
  function money(v){ return euro.format(Number(v)||0); }

  function dueStatusHtml(d){
    const isOpen=state.dueActive[d.id]!==false;
    return `<span style="display:inline-block;padding:3px 8px;border-radius:999px;font-size:12px;font-weight:700;opacity:.9">${isOpen?"OFFEN":"GEBUCHT"}</span>`;
  }

  function dueRowHtml(d){
    const isOpen=state.dueActive[d.id]!==false;
    return `<div class="due" style="align-items:center">
      <div style="min-width:0;flex:1">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <b>${esc(d.name)}</b>${dueStatusHtml(d)}
        </div>
        <small>erwartet ${esc(d.date)} · ${money(d.amount)}${d.note?` · ${esc(d.note)}`:""}</small>
      </div>
      <div class="right" style="display:flex;align-items:center;gap:10px">
        <b>${money(d.amount)}</b>
        <button class="toggle ${isOpen?"on":""}" onclick="toggleDue('${d.id}')">${isOpen?"offen ✓":"gebucht"}</button>
      </div>
    </div>`;
  }

  window.render=function(){
    const {cycle,rows}=ensureCycleState();
    finance881RecalculateBalance();

    const open=rows.filter(d=>state.dueActive[d.id]!==false);
    const booked=rows.filter(d=>state.dueActive[d.id]===false);
    const openSum=open.reduce((s,x)=>s+Number(x.amount||0),0);
    const reserves=activeReserveSum();
    const forecast=state.balance==null?null:finance881Round(state.balance-openSum-reserves);

    // Wirklich noch ausgebbar bis zum nächsten 15., ohne den hinterlegten Dispo zu überschreiten.
    // Beispiel: Prognose -405,55 € bei 500 € Dispo => 94,45 € noch verfügbar.
    const spendable=forecast==null?null:Math.max(0,finance881Round(forecast+Number(config.overdraftLimit||0)));

    $("#period").textContent=`Finanzmonat ${fmt(cycle.start)} → ${fmt(cycle.end)}`;
    $("#current").textContent=state.balance==null?"fehlt":money(state.balance);
    $("#futureSum").textContent=money(openSum);
    $("#reserveSum").textContent=money(reserves);
    $("#forecast").textContent=forecast==null?"Kontostand eingeben":money(forecast);
    $("#forecast").classList.toggle("red",forecast!=null&&forecast<0);
    $("#forecastText").textContent=forecast==null
      ?"Bitte aktuellen Kontostand eintragen."
      :`Kontostand ${money(state.balance)} − noch offen ${money(openSum)} − reserviert ${money(reserves)}.`;

    const spendableEl=$("#dispoLeft");
    if(spendableEl) spendableEl.textContent=spendable==null?"–":money(spendable);
    $("#saveGoal").textContent=money(config.plan?.plannedPaydown||0);
    $("#vacationValue").textContent=money(config.plan?.vacationSavings||0);

    $("#planRows").innerHTML=reserveRows().map(([k,label,val,note])=>
      `<div class="due"><div><b>${esc(label)}</b><small>${money(val)} · ${esc(note)}</small></div>
       <div class="right"><button class="toggle ${state.planActive[k]?"on":""}" onclick="togglePlan('${k}')">${state.planActive[k]?"aktiv ✓":"aus"}</button></div></div>`
    ).join("");

    const duesEl=$("#dues");
    if(duesEl){
      duesEl.innerHTML=rows.length
        ? `<div class="cards" style="margin:10px 0 14px">
             <article><span>Offene Abbuchungen</span><b>${open.length}</b></article>
             <article><span>Summe noch offen</span><b>${money(openSum)}</b></article>
             <article><span>Bereits gebucht</span><b>${booked.length}</b></article>
           </div>
           ${open.length?`<h4 style="margin:12px 0 6px">Noch offen</h4>${open.map(dueRowHtml).join("")}`:'<p class="muted">Bis zum 15. sind keine offenen Abbuchungen mehr eingeplant.</p>'}
           ${booked.length?`<details style="margin-top:16px"><summary style="cursor:pointer;font-weight:700">Bereits gebucht (${booked.length})</summary><div style="margin-top:8px">${booked.map(dueRowHtml).join("")}</div></details>`:""}`
        : '<p class="muted">Für diesen Finanzmonat sind keine wiederkehrenden Abbuchungen hinterlegt.</p>';
    }

    $("#txList").innerHTML=state.transactions.length
      ?state.transactions.slice().sort((a,b)=>b.iso.localeCompare(a.iso)).map(t=>
        `<div class="tx"><div><b>${esc(t.name)}</b><small>${t.date} · ${esc(t.category)}</small></div>
         <b class="${t.amount<0?"red":"good"}">${money(t.amount)}</b></div>`).join("")
      :'<p class="muted">Noch keine importierten Buchungen gespeichert.</p>';

    $("#bal").value=state.balance??"";
    $("#clientId").value=state.drive.clientId||"";
    if($("#autoSync")) $("#autoSync").checked=state.drive.autoSync!==false;
    if($("#autoSyncState")) $("#autoSyncState").textContent=state.drive.autoSync!==false?"aktiv":"aus";
    if($("#lastSync")) $("#lastSync").textContent=state.lastSyncAt?new Date(state.lastSyncAt).toLocaleString("de-DE"):"–";
    if($("#driveStatus")) $("#driveStatus").textContent=driveToken?"verbunden":"nicht verbunden";
  };

  function wireV89(){
    const card=$("#futureCard");
    const panel=$("#duesPanel");
    if(card&&panel){
      card.style.cursor="pointer";
      card.title="Zur Aufschlüsselung der offenen Abbuchungen";
      card.onclick=()=>panel.scrollIntoView({behavior:"smooth",block:"start"});
    }
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",wireV89);
  else wireV89();
})();
