(() => {
  "use strict";

  const VERSION = "1.1.0";
  const FILE_NAME = "AT_HUB_Daten_v1.json";
  const LOCAL_KEY = "athub-central-data-v1";
  const META_KEY = "athub-central-sync-meta-v1";
  const CLIENT_KEY = "athub-google-client-id";
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const SYNC_MS = 60000;

  let tokenClient = null;
  let accessToken = null;
  let driveFileId = null;
  let syncTimer = null;
  let syncing = false;

  const now = () => new Date().toISOString();
  const clone = o => JSON.parse(JSON.stringify(o));

  function defaultData(){
    const t = now();
    return {
      schemaVersion: 1,
      hubVersion: VERSION,
      updatedAt: t,
      sections: {
        translogistik: { updatedAt: t, data: {} },
        privat: { updatedAt: t, data: {} },
        wissen: { updatedAt: t, data: {} },
        dashboard: { updatedAt: t, data: {} },
        settings: { updatedAt: t, data: {} }
      }
    };
  }

  function loadLocal(){
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      return raw ? normalize(JSON.parse(raw)) : defaultData();
    } catch {
      return defaultData();
    }
  }

  function saveLocal(data){
    data = normalize(data);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
    return data;
  }

  function normalize(data){
    const d = data && typeof data === "object" ? data : defaultData();
    d.schemaVersion = 1;
    d.hubVersion = VERSION;
    d.updatedAt ||= now();
    d.sections ||= {};
    for(const k of ["translogistik","privat","wissen","dashboard","settings"]){
      d.sections[k] ||= {updatedAt:d.updatedAt, data:{}};
      d.sections[k].updatedAt ||= d.updatedAt;
      d.sections[k].data ||= {};
    }
    return d;
  }

  function meta(){
    try { return JSON.parse(localStorage.getItem(META_KEY)||"{}"); } catch { return {}; }
  }
  function setMeta(patch){
    const m = {...meta(), ...patch};
    localStorage.setItem(META_KEY, JSON.stringify(m));
    emitStatus();
  }

  function emitStatus(){
    const detail = {
      connected: !!accessToken,
      fileId: driveFileId,
      lastSyncAt: meta().lastSyncAt || null,
      lastError: meta().lastError || null,
      clientId: getClientId(),
      fileName: FILE_NAME
    };
    window.dispatchEvent(new CustomEvent("athub-sync-status",{detail}));
    document.querySelectorAll("[data-athub-sync-status]").forEach(el=>{
      el.textContent = detail.connected ? "Drive verbunden" : "Drive nicht verbunden";
    });
    document.querySelectorAll("[data-athub-last-sync]").forEach(el=>{
      el.textContent = detail.lastSyncAt ? new Date(detail.lastSyncAt).toLocaleString("de-DE") : "–";
    });
  }

  function getClientId(){
    return (localStorage.getItem(CLIENT_KEY)||"").trim();
  }

  async function tryReadFinanceClientId(){
    if(getClientId()) return getClientId();
    try{
      const d = await new Promise((resolve,reject)=>{
        const r=indexedDB.open("athub-fin-v7",1);
        r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
      });
      const state = await new Promise((resolve,reject)=>{
        const t=d.transaction("state","readonly");
        const q=t.objectStore("state").get("main");
        q.onsuccess=()=>resolve(q.result); q.onerror=()=>reject(q.error);
      });
      const cid=(state?.drive?.clientId||"").trim();
      if(cid){ localStorage.setItem(CLIENT_KEY,cid); return cid; }
    }catch{}
    return "";
  }

  async function loadGIS(){
    if(window.google?.accounts?.oauth2) return;
    await new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-athub-gis]');
      if(existing){ existing.addEventListener("load",resolve,{once:true}); existing.addEventListener("error",reject,{once:true}); return; }
      const s=document.createElement("script");
      s.src="https://accounts.google.com/gsi/client";
      s.async=true; s.defer=true; s.dataset.athubGis="1";
      s.onload=resolve; s.onerror=reject; document.head.appendChild(s);
    });
  }

  async function ensureTokenClient(){
    const clientId = await tryReadFinanceClientId();
    if(!clientId) throw new Error("Google OAuth Client-ID fehlt.");
    await loadGIS();
    if(!tokenClient){
      tokenClient=google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: () => {}
      });
    }
  }

  async function requestToken(prompt=""){
    await ensureTokenClient();
    return await new Promise((resolve,reject)=>{
      tokenClient.callback=(resp)=>{
        if(resp?.error) return reject(new Error(resp.error_description||resp.error));
        accessToken=resp.access_token;
        setMeta({lastError:null});
        emitStatus();
        resolve(accessToken);
      };
      tokenClient.requestAccessToken({prompt});
    });
  }

  async function api(url, options={}){
    if(!accessToken) await requestToken("");
    const headers = new Headers(options.headers||{});
    headers.set("Authorization","Bearer "+accessToken);
    let r=await fetch(url,{...options,headers});
    if(r.status===401){
      accessToken=null;
      await requestToken("");
      headers.set("Authorization","Bearer "+accessToken);
      r=await fetch(url,{...options,headers});
    }
    if(!r.ok) throw new Error(`Drive ${r.status}: ${await r.text()}`);
    if(r.status===204) return null;
    return await r.json();
  }

  async function findDriveFile(){
    if(driveFileId) return driveFileId;
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const res = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&spaces=drive&pageSize=10`);
    const file = res.files?.sort((a,b)=>(b.modifiedTime||"").localeCompare(a.modifiedTime||""))[0];
    driveFileId = file?.id || null;
    return driveFileId;
  }

  async function createDriveFile(data){
    const boundary="athub_"+Math.random().toString(36).slice(2);
    const metaPart=JSON.stringify({name:FILE_NAME,mimeType:"application/json"});
    const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaPart}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
    const res=await api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",{
      method:"POST",
      headers:{"Content-Type":`multipart/related; boundary=${boundary}`},
      body
    });
    driveFileId=res.id;
    return driveFileId;
  }

  async function downloadDrive(){
    const id=await findDriveFile();
    if(!id) return null;
    return await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  }

  async function uploadDrive(data){
    let id=await findDriveFile();
    if(!id) return await createDriveFile(data);
    await api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,{
      method:"PATCH",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(data)
    });
    return id;
  }

  function merge(local, remote){
    local=normalize(local); remote=normalize(remote);
    const result=defaultData();
    for(const k of Object.keys(result.sections)){
      const l=local.sections[k], r=remote.sections[k];
      const lt=Date.parse(l?.updatedAt||0)||0, rt=Date.parse(r?.updatedAt||0)||0;
      result.sections[k]=clone(rt>lt ? r : l);
    }
    result.updatedAt = new Date(Math.max(Date.parse(local.updatedAt||0)||0,Date.parse(remote.updatedAt||0)||0,Date.now())).toISOString();
    return normalize(result);
  }

  async function sync({interactive=false}={}){
    if(syncing) return loadLocal();
    syncing=true;
    try{
      if(!accessToken) await requestToken(interactive ? "consent" : "");
      const local=loadLocal();
      const remote=await downloadDrive();
      const merged=remote ? merge(local,remote) : local;
      merged.updatedAt=now();
      saveLocal(merged);
      await uploadDrive(merged);
      setMeta({lastSyncAt:now(),lastError:null});
      window.dispatchEvent(new CustomEvent("athub-data-updated",{detail:{source:"sync",data:clone(merged)}}));
      return merged;
    }catch(err){
      setMeta({lastError:String(err?.message||err)});
      throw err;
    }finally{
      syncing=false;
      emitStatus();
    }
  }

  async function connect(){
    await requestToken("consent");
    return await sync({interactive:false});
  }

  function setClientId(value){
    const v=(value||"").trim();
    if(v) localStorage.setItem(CLIENT_KEY,v); else localStorage.removeItem(CLIENT_KEY);
    tokenClient=null; accessToken=null; driveFileId=null;
    emitStatus();
  }

  function getSection(section){
    return clone(loadLocal().sections[section]?.data || {});
  }

  function setSection(section, data){
    const d=loadLocal(), t=now();
    d.sections[section] = {updatedAt:t,data:clone(data||{})};
    d.updatedAt=t;
    saveLocal(d);
    window.dispatchEvent(new CustomEvent("athub-data-updated",{detail:{source:"local",section,data:clone(data||{})}}));
    if(accessToken) sync().catch(()=>{});
    return clone(d.sections[section].data);
  }

  function patchSection(section, patch){
    return setSection(section,{...getSection(section),...(patch||{})});
  }

  function startAutoSync(){
    stopAutoSync();
    syncTimer=setInterval(()=>{ if(accessToken) sync().catch(()=>{}); },SYNC_MS);
  }
  function stopAutoSync(){ if(syncTimer){clearInterval(syncTimer);syncTimer=null;} }

  window.ATHubData={
    version:VERSION,fileName:FILE_NAME,
    connect,sync,getSection,setSection,patchSection,
    getAll:()=>clone(loadLocal()),
    getClientId,setClientId,
    status:()=>({connected:!!accessToken,fileId:driveFileId,...meta()}),
    startAutoSync,stopAutoSync
  };

  document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible" && accessToken) sync().catch(()=>{}); });
  window.addEventListener("online",()=>{ if(accessToken) sync().catch(()=>{}); });
  tryReadFinanceClientId().finally(()=>emitStatus());
  startAutoSync();
})();
