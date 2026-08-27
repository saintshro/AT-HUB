// AT HUB Finanzcockpit v8 – Prognose- und Migrationslogik
(function(){
  const MIGRATION='8.0.0';
  const settledIds=['tel_ins','tel_o2','creditplus','nuernberger','fitness','fitness_2'];

  function ensureV8State(){
    if(!state.planActive) state.planActive={emergencyBuffer:true,vacationSavings:false,plannedPaydown:false};
    if(state.migratedTo!==MIGRATION){
      state.balance=config.currentSnapshot?.balance ?? state.balance;
      settledIds.forEach(id=>{ if(id in state.dueActive) state.dueActive[id]=false; });
      state.migratedTo=MIGRATION;
      saveState(false).catch(()=>{});
    }
  }

  function reserveRows(){
    const p=config.plan||{};
    return [
      ['emergencyBuffer','Puffer für Unvorhergesehenes',Number(p.emergencyBuffer||0),'monatlich reservieren'],
      ['vacationSavings','Urlaubssparen',Number(p.vacationSavings||0),'in 900 € Daniela enthalten – nur aktivieren, wenn noch nicht bezahlt'],
      ['plannedPaydown','Dispo-/Schuldenabbau',Number(p.plannedPaydown||0),'optionales Monatsziel']
    ];
  }

  function activeReserveSum(){
    return reserveRows().reduce((s,[k,,v])=>s+(state.planActive?.[k]?v:0),0);
  }

  function injectPlanPanel(){
    if($('#v8Plan')) return;
    const dashboard=$('#dashboard');
    const duesPanel=dashboard?.querySelector('.panel:nth-of-type(2)');
    if(!dashboard||!duesPanel) return;
    const box=document.createElement('div');
    box.className='panel'; box.id='v8Plan';
    box.innerHTML='<h3>Planung & Rücklagen</h3><p class="muted">Diese Beträge werden nur von der Prognose abgezogen, wenn der Schalter aktiv ist.</p><div id="planRows"></div>';
    dashboard.insertBefore(box,duesPanel);
  }

  window.togglePlan=async function(k){
    state.planActive[k]=!state.planActive[k];
    await saveState();
    render();
  };

  const oldRender=render;
  render=function(){
    ensureV8State();
    oldRender();
    injectPlanPanel();

    const p=financePeriod();
    const open=config.dues.filter(d=>state.dueActive[d.id]!==false);
    const openSum=open.reduce((s,x)=>s+Number(x.amount||0),0);
    const reserves=activeReserveSum();
    const available=state.balance==null?null:state.balance-openSum-reserves;
    const dispoLeft=available==null?null:Math.max(0,config.overdraftLimit-Math.max(0,-available));

    $('#period').textContent=`Finanzmonat ${fmt(p.start)} → ${fmt(p.end)}`;
    $('#current').textContent=state.balance==null?'fehlt':euro.format(state.balance);
    $('#futureSum').textContent=euro.format(openSum);
    $('#forecast').textContent=available==null?'Kontostand eingeben':euro.format(available);
    $('#forecast').classList.toggle('red',available!=null&&available<0);
    $('#forecastText').textContent=available==null?'Bitte aktuellen Kontostand eintragen.':`Kontostand ${euro.format(state.balance)} − offene Abbuchungen ${euro.format(openSum)} − aktiv reserviert ${euro.format(reserves)}.`;
    $('#dispoLeft').textContent=dispoLeft==null?'–':euro.format(dispoLeft);
    $('#saveGoal').textContent=euro.format(config.plan?.plannedPaydown||0);
    $('#vacationValue').textContent=euro.format(config.plan?.vacationSavings||0);
    $('#reserveSum').textContent=euro.format(reserves);

    const pr=$('#planRows');
    if(pr) pr.innerHTML=reserveRows().map(([k,label,val,note])=>`<div class="due"><div><b>${esc(label)}</b><small>${euro.format(val)} · ${esc(note)}</small></div><div class="right"><button class="toggle ${state.planActive[k]?'on':''}" onclick="togglePlan('${k}')">${state.planActive[k]?'aktiv ✓':'aus'}</button></div></div>`).join('');
  };

  const wait=setInterval(()=>{
    if(typeof config!=='undefined'&&config&&typeof state!=='undefined'&&state){
      clearInterval(wait); ensureV8State(); render();
    }
  },50);
})();