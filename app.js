"use strict";
/* MOZLYT Inventory — one-owner stock, sales, money and savings app.
   Sign-in: Neon Auth. Records: Neon Data API, protected by row-level security. */

const AUTH="https://ep-jolly-fire-bc7cxdj3.neonauth.c-16.us-east-1.aws.neon.tech/mozlyt/auth";
const REST="https://ep-jolly-fire-bc7cxdj3.apirest.c-16.us-east-1.aws.neon.tech/mozlyt/rest/v1";
const TZ="Africa/Accra";

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cedi=n=>{const v=Math.round((Number(n)||0)*100)/100;return (v<0?"−":"")+"GH₵"+Math.abs(v).toLocaleString(undefined,{maximumFractionDigits:2})};
const todayISO=()=>new Date().toLocaleDateString("en-CA",{timeZone:TZ});
const fmtDay=(d,o={day:"numeric",month:"short"})=>new Date(d+"T12:00").toLocaleDateString("en-GB",o);
const addDays=(d,n)=>{const x=new Date(d+"T12:00");x.setDate(x.getDate()+n);return x.toISOString().slice(0,10)};
const prevMonth=mo=>{const [y,m]=mo.split("-").map(Number);return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,"0")}`};
const newId=()=>Array.from(crypto.getRandomValues(new Uint8Array(10)),b=>"abcdefghijklmnopqrstuvwxyz0123456789"[b%36]).join("");
const initials=n=>String(n||"?").trim().split(/\s+/).slice(0,2).map(w=>w[0]).join("").toUpperCase();
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}}};
const enc=encodeURIComponent;

/* =================== SIGN-IN =================== */
let session=store.get("inv-session"), jwt=null, jwtExp=0, me=null;
class HttpError extends Error{constructor(m,s){super(m);this.status=s}}
async function authFetch(path,opts={}){
  const headers={"Content-Type":"application/json"};
  if(session) headers.Authorization="Bearer "+session;
  const res=await fetch(AUTH+path,{method:opts.method||"GET",headers,credentials:"include",body:opts.body?JSON.stringify(opts.body):undefined});
  const tok=res.headers.get("set-auth-token"); if(tok){session=tok;store.set("inv-session",tok)}
  let data=null; try{data=await res.json()}catch(e){}
  if(!res.ok) throw new HttpError(data?.message||data?.code||("HTTP "+res.status),res.status);
  return {data,res};
}
const decodeJwt=t=>{try{return JSON.parse(atob(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")))}catch(e){return null}};
async function getJwt(force){
  if(!force&&jwt&&Date.now()<jwtExp-60000) return jwt;
  let t=null;
  try{const {data}=await authFetch("/token");t=data?.token||null}catch(e){if(e.status===401)throw e}
  if(!t){const {data,res}=await authFetch("/get-session");t=res.headers.get("set-auth-jwt")||data?.session?.token||null;if(data?.user)me=data.user}
  if(!t) throw new HttpError("Not signed in",401);
  const p=decodeJwt(t); jwt=t; jwtExp=(p?.exp||0)*1000||Date.now()+600000;
  if(p&&!me) me={email:p.email,name:p.name,id:p.sub};
  return jwt;
}
async function signIn(email,password){
  const {data}=await authFetch("/sign-in/email",{method:"POST",body:{email,password}});
  if(data?.token){session=data.token;store.set("inv-session",data.token)}
  me=data?.user||null; jwt=null; return getJwt(true);
}
async function signOut(){
  try{await authFetch("/sign-out",{method:"POST",body:{}})}catch(e){}
  session=null;store.set("inv-session",null);jwt=null;me=null;location.reload();
}

/* =================== DATA API =================== */
async function api(path,{method="GET",body,prefer}={}){
  let token=await getJwt();
  const go=t=>fetch(REST+path,{method,headers:{"Authorization":"Bearer "+t,"Content-Type":"application/json",...(prefer?{"Prefer":prefer}:{})},body:body!==undefined?JSON.stringify(body):undefined});
  let res=await go(token);
  if(res.status===401){token=await getJwt(true);res=await go(token)}
  const text=await res.text(); let data=null; try{data=text?JSON.parse(text):null}catch(e){data=text}
  if(!res.ok) throw new HttpError((data&&data.message)||("HTTP "+res.status),res.status);
  return data;
}
const ins=(table,row)=>api("/"+table,{method:"POST",prefer:"return=minimal",body:row});
const upd=(table,id,row)=>api(`/${table}?id=eq.${enc(id)}`,{method:"PATCH",prefer:"return=minimal",body:row});
const del=(table,id)=>api(`/${table}?id=eq.${enc(id)}`,{method:"DELETE",prefer:"return=minimal"});

/* =================== STATE =================== */
let S=null;                 // last loaded state
let day=todayISO();
let screen=store.get("inv-screen")||"home";
let moneyTab="overview", teamQuery="", reportPeriod="month", showRemoved=false;

const months=()=>{const m=day.slice(0,7);const t=todayISO().slice(0,7);return [...new Set([m,prevMonth(m),t,prevMonth(t)])]};
const P=id=>S.products.find(p=>p.id===id);
const M=id=>S.marketers.find(m=>m.id===id);
const mName=id=>M(id)?.name||"Removed marketer";
const pName=s=>P(s.product_id)?.name||s.product_name||"Product";
const liveProducts=()=>S.products.filter(p=>p.active!==false);
const liveMarketers=()=>S.marketers.filter(m=>m.active!==false&&!m.removed_at);
const teamMarketers=()=>S.marketers.filter(m=>!m.removed_at);
const removedPill=m=>m.removed_at?' <span class="pill off">removed</span>':"";
const methodLabel=s=>s.method==="credit"?`Pay later${s.customer?" · "+esc(s.customer):""}${s.due_date?" · due "+fmtDay(s.due_date,{weekday:"short",day:"numeric",month:"short"}):""}`:(s.method==="momo"?"MoMo":"Cash")+(s.customer?" · "+esc(s.customer):"");
const unpaidCredit=()=>(S.credit||[]).filter(s=>s.method==="credit");
const salesOn=d=>S.sales.filter(s=>s.day===d);
const salesIn=(from,to)=>S.sales.filter(s=>s.day>=from&&s.day<=to);
const sumQty=a=>a.reduce((t,s)=>t+Number(s.qty),0);
const sumVal=a=>a.reduce((t,s)=>t+Number(s.qty)*Number(s.price),0);
const unitCost=s=>Number(s.cost)||Number(S.products.find(p=>p.id===s.product_id)?.cost)||0;
const sumCost=a=>a.reduce((t,s)=>t+Number(s.qty)*unitCost(s),0);
const marginText=(price,cost)=>{price=Number(price)||0;cost=Number(cost)||0;if(!cost)return "Set your cost to see the margin";const p=price-cost;return `${cedi(p)} profit per item · ${price?Math.round(p/price*100):0}% margin · ${Math.round(p/cost*100)}% markup`};
function stockOf(pid){
  const r=S.stock.find(x=>x.product_id===pid)||{inn:0,adj:0,outt:0,ret:0,sold:0};
  const total=Number(r.inn)+Number(r.adj)-Number(r.sold);
  const withM=S.holdings.filter(h=>h.product_id===pid).reduce((t,h)=>t+Math.max(0,Number(h.gave)-Number(h.back)-Number(h.sold)),0);
  const tracked=Number(r.inn)+Number(r.adj)+Number(r.outt)>0;
  return {total,withM,store:Math.max(0,total-withM),tracked,sold:Number(r.sold)};
}
const holding=(mid,pid)=>{const h=S.holdings.find(x=>x.marketer_id===mid&&x.product_id===pid);return h?Number(h.gave)-Number(h.back)-Number(h.sold):0};
const holdingsOf=mid=>S.products.map(p=>({p,n:holding(mid,p.id)})).filter(x=>x.n>0);
const moneyOf=mid=>{const r=S.money.find(x=>x.marketer_id===mid)||{};const n=k=>Number(r[k]||0);return{owes:n("sold_value")-n("paid")-n("expenses"),saved:n("saved"),soldValue:n("sold_value"),paid:n("paid"),credit:n("credit_value"),allSales:n("all_sales"),profit:n("profit"),unitsGiven:n("units_given")}};
function period(kind){
  if(kind==="today") return [day,day];
  if(kind==="week"){const d=new Date(day+"T12:00");const wd=(d.getDay()+6)%7;const from=addDays(day,-wd);return [from,addDays(from,6)]}
  const m=day.slice(0,7);const [y,mm]=m.split("-").map(Number);const last=new Date(y,mm,0).getDate();return [m+"-01",`${m}-${String(last).padStart(2,"0")}`];
}


/* =================== UI HELPERS =================== */
let toastT;
function toast(msg,bad){const t=$("toast");t.textContent=msg;t.className="toast"+(bad?" bad":"");t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,2600)}
function banner(msg,retry){$("banner").hidden=!msg;$("bannerText").textContent=msg||"";$("bannerBtn").onclick=retry||null;$("bannerBtn").hidden=!retry}
function explain(e,what){
  if(e instanceof TypeError) return `No connection. Couldn't ${what}. Check your internet and try again.`;
  if(e?.status===401){setTimeout(()=>showGate("login"),1200);return "You were signed out. Please sign in again."}
  if(e?.status===403) return `This account isn't allowed to ${what}.`;
  return `Couldn't ${what}: ${e?.message||"error"}`;
}
const sheet=$("sheet");
function openSheet(title,html,mount){
  $("sheetTitle").textContent=title;$("sheetBody").innerHTML=html;
  if(!sheet.open) sheet.showModal();
  $("sheetBody").scrollTop=0;
  if(mount) mount($("sheetBody"));
}
function closeSheet(){if(sheet.open) sheet.close()}
$("sheetClose").onclick=closeSheet;
sheet.addEventListener("click",e=>{if(e.target===sheet)closeSheet()});
async function run(btn,what,fn,okMsg){
  if(btn){btn.disabled=true}
  try{await fn();if(okMsg)toast(okMsg);closeSheet();await load();return true}
  catch(e){toast(explain(e,what),true);return false}
  finally{if(btn)btn.disabled=false}
}
const marketerOptions=(sel,onlyLive=true)=>(onlyLive?liveMarketers():S.marketers).map(m=>`<option value="${m.id}" ${m.id===sel?"selected":""}>${esc(m.no+". "+m.name)}</option>`).join("");
const productChips=(sel,name="prod")=>liveProducts().map(p=>`<button type="button" class="chip" data-chip="${name}" data-v="${p.id}" aria-pressed="${p.id===sel}">${esc(p.name)} <small>${cedi(p.price)}</small></button>`).join("");
function wireChips(root,name,onPick){root.querySelectorAll(`[data-chip="${name}"]`).forEach(b=>b.onclick=()=>{root.querySelectorAll(`[data-chip="${name}"]`).forEach(x=>x.setAttribute("aria-pressed",x===b));onPick(b.dataset.v)})}
function wireSeg(root,name,onPick){root.querySelectorAll(`[data-seg="${name}"]`).forEach(b=>b.onclick=()=>{root.querySelectorAll(`[data-seg="${name}"]`).forEach(x=>x.setAttribute("aria-pressed",x===b));onPick(b.dataset.v)})}
function stepper(root,id,min=1,onChange){const o=root.querySelector("#"+id);root.querySelectorAll(`[data-step="${id}"]`).forEach(b=>b.onclick=()=>{o.value=Math.max(min,Number(o.value)+Number(b.dataset.d));o.textContent=o.value;onChange&&onChange(Number(o.value))})}
const stepperHTML=(id,v=1)=>`<div class="stepper"><button type="button" data-step="${id}" data-d="-1" aria-label="Less">−</button><output id="${id}" value="${v}">${v}</output><button type="button" data-step="${id}" data-d="1" aria-label="More">+</button></div>`;
const icon={
  sale:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  box:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
  cash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.5"/></svg>',
  person:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/><path d="M19 3v4M17 5h4"/></svg>',
  give:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h12M13 6l6 6-6 6"/></svg>',
  back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H7M11 6l-6 6 6 6"/></svg>',
  piggy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 11a7 6 0 0 1 13-2h2l1 3-2 1v3h-2v2h-3v-2H9v2H6v-3a6 6 0 0 1-2-4z"/></svg>'
};

/* =================== LOAD =================== */
let loading=null;
/* The record starts yesterday (RECORD_START). Everything older is hidden from the app, not deleted.
   Stock, holdings, money owed and the expenses taken from sellers are worked out from what is shown. */
function windowState(d){
  const inWin=x=>String(x.day||"")>=RECORD_START;
  const sum=(a,f)=>a.reduce((t,x)=>t+Number(f(x)||0),0);
  const o={...d,sales:(d.sales||[]).filter(inWin),payments:(d.payments||[]).filter(inWin),savings:(d.savings||[]).filter(inWin),
    expenses:(d.expenses||[]).filter(inWin),moves:(d.moves||[]).filter(inWin),credit:(d.credit||[]).filter(inWin)};
  const products=d.products||[];
  o.stock=products.map(p=>{const mv=o.moves.filter(m=>m.product_id===p.id),sl=o.sales.filter(s=>s.product_id===p.id);
    return{product_id:p.id,inn:sum(mv.filter(m=>m.kind==="in"),m=>m.qty),adj:sum(mv.filter(m=>m.kind==="adjust"),m=>m.qty),outt:sum(mv.filter(m=>m.kind==="out"),m=>m.qty),ret:sum(mv.filter(m=>m.kind==="return"),m=>m.qty),sold:sum(sl,s=>s.qty)}});
  const H={};
  const hit=(mid,pid,f)=>{const k=mid+"|"+pid;H[k]=H[k]||{marketer_id:mid,product_id:pid,gave:0,back:0,sold:0};f(H[k])};
  o.moves.filter(m=>m.marketer_id).forEach(m=>hit(m.marketer_id,m.product_id,h=>{if(m.kind==="out")h.gave+=Number(m.qty);if(m.kind==="return")h.back+=Number(m.qty)}));
  o.sales.filter(s=>s.marketer_id).forEach(s=>hit(s.marketer_id,s.product_id,h=>{h.sold+=Number(s.qty)}));
  o.holdings=Object.values(H);
  const expensesTotal=sum(o.expenses,e=>e.amount);
  const sv=a=>sum(a,s=>Number(s.qty)*Number(s.price));
  o.money=(d.marketers||[]).map(m=>{const ss=o.sales.filter(s=>s.marketer_id===m.id);
    return{marketer_id:m.id,sold_value:sv(ss.filter(s=>s.method!=="credit")),credit_value:sv(ss.filter(s=>s.method==="credit")),all_sales:sv(ss),
      profit:sum(ss,s=>Number(s.qty)*(Number(s.price)-(Number(s.cost)||Number(products.find(p=>p.id===s.product_id)?.cost)||0))),
      units_given:sum(o.moves.filter(x=>x.marketer_id===m.id&&x.kind==="out"),x=>x.qty),
      paid:sum(o.payments.filter(p=>p.marketer_id===m.id),p=>p.amount),saved:sum(o.savings.filter(v=>v.marketer_id===m.id),v=>v.amount),expenses:expensesTotal}});
  return o;
}
async function load(){
  if(loading) return loading;
  loading=(async()=>{
    $("refreshBtn").disabled=true;
    try{
      const d=await api("/rpc/get_state",{method:"POST",body:{months:months()}});
      if(!d||d.owner!==true){$("lockedEmail").textContent=me?.email||"this account";showGate("locked");return}
      S=windowState(d); await loadMassage(); banner(""); showGate("app"); render();
    }catch(e){
      if(e?.status===401){showGate("login");return}
      if(!S){showGate("boot");$("bootMsg").textContent=explain(e,"load your records")}
      else banner(explain(e,"refresh your records"),()=>load());
    }finally{$("refreshBtn").disabled=false;loading=null}
  })();
  return loading;
}
function showGate(v){
  const ids={login:"loginView",locked:"lockedView",boot:"bootView",app:"appView"};
  Object.values(ids).forEach(id=>$(id).hidden=true);
  $(ids[v]).hidden=false;
}

/* =================== NAVIGATION =================== */
const titles={home:"Home",sell:"Sell",stock:"Stock",sessions:"Sessions",team:"Team",money:"Money"};
function go(s){screen=s;store.set("inv-screen",s);render();window.scrollTo({top:0})}
document.querySelectorAll(".nav [data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
function render(){
  if(!S) return;
  $("screenTitle").textContent=titles[screen];
  document.querySelectorAll(".nav [data-go]").forEach(b=>b.setAttribute("aria-current",b.dataset.go===screen?"page":"false"));
  Object.keys(titles).forEach(k=>$("scr-"+k).hidden=k!==screen);
  $("day").value=day;
  $("dateLabel").textContent=day===todayISO()?"Today":fmtDay(day,{weekday:"short",day:"numeric",month:"short"});
  ({home:renderHome,sell:renderSell,stock:renderStock,sessions:renderSessions,team:renderTeam,money:renderMoney})[screen]();
}

/* =================== HOME =================== */
function renderHome(){
  const today=salesOn(day), pays=S.payments.filter(p=>p.day===day);
  const stockTotal=liveProducts().reduce((t,p)=>t+Math.max(0,stockOf(p.id).total),0);
  const tracked=liveProducts().some(p=>stockOf(p.id).tracked);
  const untracked=liveProducts().filter(p=>{const s=stockOf(p.id);return !s.tracked&&s.sold>0});
  const [f,t]=period("month"), mo=salesIn(f,t);
  const low=liveProducts().filter(p=>{const s=stockOf(p.id);return s.tracked&&s.total<=Number(p.low_stock||0)});
  const owing=S.marketers.map(m=>({m,o:moneyOf(m.id).owes})).filter(x=>x.o>0.009).sort((a,b)=>b.o-a.o);
  const credDue=unpaidCredit().filter(s=>s.due_date&&s.due_date<=addDays(todayISO(),1));
  const target=Number(S.settings?.target||5);
  const prog=liveMarketers().map(m=>({m,n:sumQty(today.filter(s=>s.marketer_id===m.id))})).sort((a,b)=>b.n-a.n);
  const best=(arr,key)=>{const g={};arr.forEach(s=>{g[s[key]]=(g[s[key]]||0)+Number(s.qty)});const k=Object.keys(g).sort((a,b)=>g[b]-g[a])[0];return k?{k,n:g[k]}:null};
  const bm=best(mo,"marketer_id"), bp=best(mo,"product_id");
  const greet=(()=>{const h=Number(new Date().toLocaleTimeString("en-GB",{hour:"2-digit",hour12:false,timeZone:TZ}));return h<12?"Good morning":h<17?"Good afternoon":"Good evening"})();
  const isToday=day===todayISO();
  $("scr-home").innerHTML=`
    <div><div class="eyebrow">${greet}</div><h2 style="font-size:1.4rem">${isToday?"Here's today":"Here's "+fmtDay(day,{weekday:"long",day:"numeric",month:"long"})}</h2></div>
    <div class="grid2 kpis">
      <div class="tile accent"><b>${sumQty(today)}</b><span>items sold</span></div>
      <div class="tile"><b>${cedi(sumVal(today))}</b><span>sales value</span></div>
      <div class="tile"><b>${cedi(pays.reduce((a,p)=>a+Number(p.amount),0))}</b><span>money received</span></div>
      <div class="tile"><b>${tracked?stockTotal:"–"}</b><span>${tracked?"items in stock":"stock not set up"}</span></div>
    </div>
    <div class="fab-row">
      <button class="qa" data-qa="sale">${icon.sale}Record sale</button>
      <button class="qa" data-qa="stockin">${icon.box}Stock in</button>
      <button class="qa" data-qa="pay">${icon.cash}Receive money</button>
      <button class="qa" data-qa="addm">${icon.person}Add marketer</button>
    </div>
    <div class="wide">
      ${(low.length||owing.length||!tracked||credDue.length||untracked.length)?`<div class="card"><h2>Needs attention</h2><div class="stack">
        ${!tracked?`<div class="alert info"><span>📦</span><span><b>Set up your stock.</b> Tap <b>Stock in</b> and enter how many of each product you have, so the app can count what's left.</span></div>`:""}
        ${credDue.map(s=>`<button class="alert" style="width:100%;text-align:left;border:0;font-weight:400;min-height:0" data-credit="${s.id}"><span>🧾</span><span><b>${esc(s.customer||"A customer")}</b> ${s.due_date<todayISO()?"was due to pay":"is due to pay"} ${cedi(s.qty*s.price)} ${s.due_date===todayISO()?"today":fmtDay(s.due_date,{weekday:"long"})}. Tap when paid.</span></button>`).join("")}
        ${tracked?untracked.map(p=>`<div class="alert info"><span>📦</span><span><b>${esc(p.name)}</b> has ${stockOf(p.id).sold} sold but no stock recorded. In Stock, tap <b>Correct count</b> and enter how many you have.</span></div>`).join(""):""}
        ${low.map(p=>`<div class="alert"><span>⚠️</span><span><b>${esc(p.name)}</b> is low: ${Math.max(0,stockOf(p.id).total)} left.</span></div>`).join("")}
        ${owing.slice(0,3).map(x=>`<div class="alert info"><span>💰</span><span><b>${esc(x.m.name)}</b> owes ${cedi(x.o)}.</span></div>`).join("")}
      </div></div>`:""}
      ${(()=>{const ex=expensesOn(day),t=ex.reduce((a,e)=>a+Number(e.amount),0),usual=usualDaily().reduce((a,l)=>a+(Number(l.amount)||0),0);
        return `<button class="card" id="homeExp" style="text-align:left;font-weight:400"><div class="row between"><h2>Expenses ${isToday?"today":""}</h2>${ex.length?`<span class="pill good">recorded</span>`:`<span class="pill warn">not recorded</span>`}</div>
          <div class="row between" style="align-items:flex-end"><div><div class="money-big">${ex.length?cedi(t):"–"}</div><span class="small muted">${ex.length?ex.length+" item"+(ex.length===1?"":"s"):"your usual day is "+cedi(usual)}</span></div><span class="btn-primary" style="display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:12px;font-weight:700">${ex.length?"Add more":"Record"}</span></div></button>`})()}
      <div class="card"><div class="row between"><h2>Targets ${isToday?"today":""}</h2><span class="pill">${target} each</span></div>
        ${prog.length?`<ul class="list">${prog.map(x=>`<li><button class="item" data-open-m="${x.m.id}"><span class="avatar">${esc(initials(x.m.name))}</span><span class="grow"><span class="t">${esc(x.m.name)}</span><span class="bar ${x.n>=target?"done":""}" style="margin-top:6px"><i style="width:${Math.min(100,x.n/target*100)}%"></i></span></span><span class="r"><b>${x.n}</b>/${target}</span></button></li>`).join("")}</ul>`:`<p class="empty">No marketers yet.</p>`}
      </div>
      <div class="card"><h2>${fmtDay(day,{month:"long"})} so far</h2>
        <div class="grid2">
          <div><div class="money-big">${cedi(sumVal(mo))}</div><span class="small muted">sales · ${sumQty(mo)} items</span></div>
          <div><div class="money-big" style="color:var(--good)">${cedi(sumVal(mo)-sumCost(mo))}</div><span class="small muted">gross profit</span></div>
        </div>
        <ul class="list">
          <li><div class="item"><span class="grow"><span class="s">Best marketer</span><span class="t">${bm?esc(mName(bm.k)):"–"}</span></span><span class="r">${bm?bm.n+" items":""}</span></div></li>
          <li><div class="item"><span class="grow"><span class="s">Best product</span><span class="t">${bp?esc(P(bp.k)?.name||"Product"):"–"}</span></span><span class="r">${bp?bp.n+" sold":""}</span></div></li>
        </ul>
        <button class="btn-ghost" data-go2="money" data-tab="reports">See full report</button>
      </div>
    </div>`;
  const r=$("scr-home");
  r.querySelector('[data-qa="sale"]').onclick=()=>go("sell");
  r.querySelector('[data-qa="stockin"]').onclick=()=>stockSheet("in");
  r.querySelector('[data-qa="pay"]').onclick=()=>paymentSheet();
  r.querySelector('[data-qa="addm"]').onclick=()=>marketerForm();
  $("homeExp").onclick=()=>dailyExpenseSheet();
  r.querySelectorAll("[data-open-m]").forEach(b=>b.onclick=()=>marketerPage(b.dataset.openM));
  r.querySelectorAll("[data-credit]").forEach(b=>b.onclick=()=>creditPaidSheet(unpaidCredit().find(s=>String(s.id)===b.dataset.credit)));
  r.querySelectorAll("[data-go2]").forEach(b=>b.onclick=()=>{moneyTab=b.dataset.tab;go(b.dataset.go2)});
}

/* =================== SELL =================== */
let sellForm={mid:store.get("inv-sell-m")||"",pid:store.get("inv-sell-p")||"",qty:1,price:null,method:"cash",customer:"",due:""};
function renderSell(){
  const ms=liveMarketers(), ps=liveProducts();
  if(!ms.find(m=>m.id===sellForm.mid)) sellForm.mid=ms[0]?.id||"";
  if(!ps.find(p=>p.id===sellForm.pid)) sellForm.pid=ps[0]?.id||"";
  const p=P(sellForm.pid); if(sellForm.price==null&&p) sellForm.price=Number(p.price);
  const list=salesOn(day).slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  const r=$("scr-sell");
  if(!ms.length||!ps.length){
    r.innerHTML=`<div class="card"><h2>Before you record sales</h2><p class="muted">${!ms.length?"Add at least one marketer":"Add at least one product"} first.</p><button class="btn-primary" id="sellSetup">${!ms.length?"Add a marketer":"Add a product"}</button></div>`;
    $("sellSetup").onclick=()=>!ms.length?marketerForm():productForm();return;
  }
  const h=holding(sellForm.mid,sellForm.pid);
  r.innerHTML=`<div class="wide">
    <form class="card" id="saleForm">
      <h2>Record a sale</h2>
      <label class="f">Who sold it?<select id="sfM">${marketerOptions(sellForm.mid)}</select></label>
      <div class="f" style="display:flex;flex-direction:column;gap:6px"><span style="font-weight:700;font-size:.9rem">Product</span><div class="chips">${productChips(sellForm.pid)}</div></div>
      <div class="row between"><div><span style="font-weight:700;font-size:.9rem">How many?</span>${stepperHTML("sfQ",sellForm.qty)}</div>
        <label class="f" style="flex:0 1 160px">Price each (GH₵)<input id="sfPrice" type="number" min="0" step="0.5" inputmode="decimal" value="${sellForm.price??""}"></label></div>
      <div><span style="font-weight:700;font-size:.9rem">Customer paid by</span><div class="seg" style="margin-top:6px"><button type="button" data-seg="meth" data-v="cash" aria-pressed="${sellForm.method==="cash"}">Cash</button><button type="button" data-seg="meth" data-v="momo" aria-pressed="${sellForm.method==="momo"}">MoMo</button><button type="button" data-seg="meth" data-v="credit" aria-pressed="${sellForm.method==="credit"}">Pay later</button></div></div>
      <div class="stack" id="sfCredit" ${sellForm.method==="credit"?"":"hidden"}>
        <label class="f">Customer's name and phone<input id="sfCust" value="${esc(sellForm.customer)}" placeholder="e.g. Police officer, Amasaman station, 024…"></label>
        <label class="f">Promised to pay on<input id="sfDue" type="date" value="${sellForm.due||addDays(day,5)}"></label>
      </div>
      <label class="f">Note (optional)<input id="sfNote" placeholder="e.g. place of sale"></label>
      <div class="row between"><span class="muted">Total</span><span class="money-big" id="sfTotal">${cedi(sellForm.qty*(sellForm.price||0))}</span></div>
      <p class="small muted" id="sfProfit"></p>
      ${h>0?`<p class="small muted">${esc(mName(sellForm.mid))} is holding ${h} of this product.</p>`:""}
      <button class="btn-primary btn-block" type="submit" id="sfBtn" style="min-height:54px;font-size:1.05rem">Record sale</button>
      <p class="small muted">Saves on ${day===todayISO()?"today's date":fmtDay(day,{day:"numeric",month:"long"})}. Change the date at the top to record an earlier day.</p>
    </form>
    <div class="card"><div class="row between"><h2>Sales ${day===todayISO()?"today":"on "+fmtDay(day)}</h2><span class="pill">${sumQty(list)} items · ${cedi(sumVal(list))}</span></div>
      ${list.length?`<ul class="list">${list.map(s=>`<li><button class="item" data-sale="${s.id}"><span class="avatar">${esc(initials(mName(s.marketer_id)))}</span><span class="grow"><span class="t">${esc(mName(s.marketer_id))}</span><span class="s">${esc(pName(s))} × ${s.qty} · ${methodLabel(s)}${s.note?" · "+esc(s.note):""}</span></span><span class="r"><b>${cedi(s.qty*s.price)}</b><br><span class="small muted">Edit</span></span></button></li>`).join("")}</ul>`:`<p class="empty">No sales recorded yet.</p>`}
    </div></div>`;
  const total=()=>{const pr=Number($("sfPrice").value)||0,c=Number(P(sellForm.pid)?.cost)||0;$("sfTotal").textContent=cedi(sellForm.qty*pr);
    $("sfProfit").textContent=c?`Your profit on this sale: ${cedi(sellForm.qty*(pr-c))} (cost ${cedi(c)} each${pr<c?" · selling below cost":""})`:"Set this product's cost in Settings to see your profit.";};
  total();
  $("sfM").onchange=e=>{sellForm.mid=e.target.value;store.set("inv-sell-m",sellForm.mid);renderSell()};
  wireChips(r,"prod",v=>{sellForm.pid=v;store.set("inv-sell-p",v);sellForm.price=Number(P(v).price);renderSell()});
  stepper(r,"sfQ",1,v=>{sellForm.qty=v;total()});
  $("sfPrice").oninput=e=>{sellForm.price=Number(e.target.value);total()};
  wireSeg(r,"meth",v=>{sellForm.method=v;$("sfCredit").hidden=v!=="credit"});
  $("sfCust").oninput=e=>sellForm.customer=e.target.value;
  $("sfDue").onchange=e=>sellForm.due=e.target.value;
  $("saleForm").onsubmit=async e=>{
    e.preventDefault();
    const pr=P(sellForm.pid), price=Number($("sfPrice").value);
    if(!(price>=0)){toast("Enter the price.",true);return}
    const credit=sellForm.method==="credit", cust=$("sfCust").value.trim();
    if(credit&&!cust){toast("Enter the customer's name for a pay-later sale.",true);$("sfCust").focus();return}
    const ok=await run($("sfBtn"),"record the sale",()=>ins("sales",{day,marketer_id:sellForm.mid,product_id:pr.id,product_name:pr.name,qty:sellForm.qty,price,cost:Number(pr.cost||0),method:sellForm.method,customer:credit?cust:"",due_date:credit?($("sfDue").value||null):null,note:$("sfNote").value.trim()}),credit?`Pay-later sale saved for ${cust}`:`Sale recorded: ${sellForm.qty} × ${pr.name}`);
    if(ok){sellForm.qty=1;sellForm.price=null;sellForm.customer="";sellForm.due="";sellForm.method="cash"}
  };
  r.querySelectorAll("[data-sale]").forEach(b=>b.onclick=()=>saleEdit(S.sales.find(s=>String(s.id)===b.dataset.sale)));
}
function saleEdit(s){
  openSheet("Edit sale",`
    <p class="muted">${esc(mName(s.marketer_id))} · ${esc(pName(s))} · ${fmtDay(s.day,{day:"numeric",month:"long"})}</p>
    <div class="row between"><div><span style="font-weight:700;font-size:.9rem">How many?</span>${stepperHTML("seQ",s.qty)}</div>
      <label class="f" style="flex:0 1 160px">Price each (GH₵)<input id="sePrice" type="number" min="0" step="0.5" value="${Number(s.price)}"></label></div>
    <div class="seg"><button type="button" data-seg="sm" data-v="cash" aria-pressed="${s.method==="cash"}">Cash</button><button type="button" data-seg="sm" data-v="momo" aria-pressed="${s.method==="momo"}">MoMo</button><button type="button" data-seg="sm" data-v="credit" aria-pressed="${s.method==="credit"}">Pay later</button></div>
    <div class="stack" id="seCredit" ${s.method==="credit"?"":"hidden"}>
      <label class="f">Customer's name and phone<input id="seCust" value="${esc(s.customer)}"></label>
      <label class="f">Promised to pay on<input id="seDue" type="date" value="${s.due_date||""}"></label>
    </div>
    <label class="f">Note<input id="seNote" value="${esc(s.note)}"></label>
    <button class="btn-primary btn-block" id="seSave">Save changes</button>
    <button class="btn-danger btn-block" id="seDel">Delete this sale</button>`,root=>{
    let method=s.method; stepper(root,"seQ",1); wireSeg(root,"sm",v=>{method=v;$("seCredit").hidden=v!=="credit"});
    $("seSave").onclick=()=>{const credit=method==="credit";if(credit&&!$("seCust").value.trim()){toast("Enter the customer's name.",true);return}
      run($("seSave"),"save the sale",()=>upd("sales",s.id,{qty:Number($("seQ").value),price:Number($("sePrice").value)||0,method,customer:$("seCust").value.trim(),due_date:credit?($("seDue").value||null):s.due_date,paid_at:credit?null:(s.method==="credit"?new Date().toISOString():s.paid_at),note:$("seNote").value.trim()}),"Sale updated")};
    confirmBtn($("seDel"),"Tap again to delete",()=>run($("seDel"),"delete the sale",()=>del("sales",s.id),"Sale deleted"));
  });
}
function confirmBtn(btn,ask,fn){let armed=false;btn.onclick=()=>{if(!armed){armed=true;const t=btn.textContent;btn.textContent=ask;setTimeout(()=>{armed=false;btn.textContent=t},3500);return}fn()}}

/* =================== STOCK =================== */
/* Cash in your hand for restocking. Starts from the amount you type as "in hand" (the starting point).
   Sales received add to it, restocks take from it. Anything from before the starting point is not counted. */
const fundOpen=()=>(S.stockFunds||[]).filter(x=>x.kind==="open").sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0]||null;
const afterOpen=(x,o)=>!o||String(x.created_at)>String(o.created_at);
function stockMoney(){
  const o=fundOpen();
  const base=o?Number(o.amount):0;
  const added=(S.stockFunds||[]).filter(x=>x.kind!=="open"&&afterOpen(x,o)).reduce((a,x)=>a+Number(x.amount),0);
  const sold=S.sales.filter(s=>(s.method!=="credit"||s.paid_at)&&afterOpen(s,o)).reduce((a,s)=>a+Number(s.qty)*Number(s.price),0);
  const spent=S.moves.filter(m=>m.kind==="in"&&afterOpen(m,o)).reduce((a,m)=>a+Number(m.qty)*Number(m.unit_cost||0),0);
  return base+added+sold-spent;
}
const stockOnHandCost=()=>liveProducts().reduce((a,p)=>a+Math.max(0,stockOf(p.id).total)*Number(p.cost||0),0);
function fundSheet(mode){ // "open" = type what is in your hand now; "add" = you put more money in
  const isOpen=mode==="open";
  openSheet(isOpen?"Cash in your hand":"Add money for stock",`
    <p class="muted">${isOpen?"Type exactly the cash you have in your hand for restocking now. From here, sales add to it and restocks take from it. Older money is not counted.":"Money you put in from your own pocket. Sales add to the cash on their own."}</p>
    <label class="f">${isOpen?"Cash in your hand now (GH₵)":"How much you put in (GH₵)"}<input id="fdA" type="number" min="0" step="0.5" inputmode="decimal" placeholder="e.g. 900"></label>
    <label class="f">Note (optional)<input id="fdN" placeholder="${isOpen?"e.g. starting point":"e.g. from my own money"}"></label>
    <button class="btn-primary btn-block" id="fdBtn">Save</button>`,()=>{
    $("fdBtn").onclick=()=>{const v=$("fdA").value,a=Number(v);
      if(v===""||a<0||(!isOpen&&a===0)){toast("Enter how much.",true);return}
      run($("fdBtn"),"save the money",()=>ins("stock_funds",{day,amount:a,note:$("fdN").value.trim(),kind:isOpen?"open":"add"}),isOpen?"Cash in hand saved":"Money added")};
  });
}
function renderStock(){
  const ps=liveProducts();
  const money=stockMoney(), onHand=stockOnHandCost();
  const holders=S.marketers.map(m=>({m,h:holdingsOf(m.id)})).filter(x=>x.h.length);
  const r=$("scr-stock");
  r.innerHTML=`
    <div class="fab-row" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <button class="qa" data-sk="in">${icon.box}Stock in</button>
      <button class="qa" data-sk="out">${icon.give}Give to marketer</button>
      <button class="qa" data-sk="return">${icon.back}Return from marketer</button>
    </div>
    <div class="card">
      <span class="small muted">Cash in your hand for restocking</span>
      <div class="money-big" style="color:${money<0?"var(--bad)":"inherit"}">${cedi(money)}</div>
      <p class="small muted" style="margin:6px 0 12px">Sales add to this. Restocks take from it. Keep it equal to the cash you actually have.${onHand?` Stock on hand is worth ${cedi(onHand)} at cost.`:""}</p>
      ${!fundOpen()?`<p class="small" style="color:var(--warn)">Tap <b>Set cash in hand</b> and type what you have now. That is the starting point.</p>`:""}
      <div class="fab-row" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <button class="qa" id="sfRestock">${icon.box}Restock</button>
        <button class="qa" id="sfAdd">${icon.cash}Add money</button>
        <button class="qa" id="sfSet">${icon.person}Set cash in hand</button>
      </div>
    </div>
    <button class="btn-primary btn-block" id="stAddProd" style="margin-bottom:14px">+ Add product</button>
    <div class="wide">
      ${ps.map(p=>{const s=stockOf(p.id);const low=s.tracked&&s.total<=Number(p.low_stock||0);return `
      <div class="card">
        <div class="row between"><h2>${esc(p.name)}</h2>${!s.tracked?`<span class="pill off">not set up</span>`:low?`<span class="pill warn">low</span>`:`<span class="pill good">ok</span>`}</div>
        <div class="row between" style="align-items:flex-end"><div><div class="money-big">${s.tracked?Math.max(0,s.total):"–"}</div><span class="small muted">in stock</span></div>
        <div class="r small muted" style="text-align:right">In your store: <b class="num" style="color:var(--fg)">${s.tracked?s.store:"–"}</b><br>With marketers: <b class="num" style="color:var(--fg)">${s.withM}</b><br>Sold so far: <b class="num" style="color:var(--fg)">${s.sold}</b></div></div>
        ${!s.tracked?`<p class="small muted">Tap Correct count and enter how many you have.</p>`:s.total<0?`<p class="small" style="color:var(--warn)">More sales than stock recorded. Tap Correct count.</p>`:""}
        <div class="grid2"><button class="btn-primary" data-count="${p.id}">Correct count</button><button data-prod-edit="${p.id}">Edit product</button></div>
      </div>`}).join("")||`<div class="card"><p class="empty">No products yet. Tap + Add product.</p></div>`}
      <div class="card"><h2>Who's holding stock</h2>
        ${holders.length?`<ul class="list">${holders.map(x=>`<li><button class="item" data-open-m="${x.m.id}"><span class="avatar">${esc(initials(x.m.name))}</span><span class="grow"><span class="t">${esc(x.m.name)}</span><span class="s">${x.h.map(h=>esc(h.p.name)+" × "+h.n).join(" · ")}</span></span><span class="r"><b>${x.h.reduce((t,h)=>t+h.n,0)}</b></span></button></li>`).join("")}</ul>`:`<p class="empty">No marketer is holding stock. Use "Give to marketer" when you hand over items.</p>`}
      </div>
      <div class="card"><h2>Recent stock movements</h2>
        ${S.moves.length?`<ul class="list">${S.moves.slice(0,25).map(mv=>`<li><button class="item" data-move="${mv.id}"><span class="grow"><span class="t">${{in:"Stock in",out:"Given to "+esc(mName(mv.marketer_id)),return:"Returned by "+esc(mName(mv.marketer_id)),adjust:"Count corrected"}[mv.kind]}</span><span class="s">${esc(P(mv.product_id)?.name||"Product")} · ${fmtDay(mv.day)}${mv.note?" · "+esc(mv.note):""}</span></span><span class="r"><b>${mv.kind==="out"?"→ ":mv.kind==="return"?"← ":mv.qty>0?"+":""}${mv.qty}</b></span></button></li>`).join("")}</ul>`:`<p class="empty">Nothing yet.</p>`}
      </div>
    </div>`;
  r.querySelectorAll("[data-sk]").forEach(b=>b.onclick=()=>stockSheet(b.dataset.sk));
  $("stAddProd").onclick=()=>productForm(null);
  $("sfRestock").onclick=()=>stockSheet("in");
  $("sfAdd").onclick=()=>fundSheet("add");
  $("sfSet").onclick=()=>fundSheet("open");
  r.querySelectorAll("[data-open-m]").forEach(b=>b.onclick=()=>marketerPage(b.dataset.openM));
  r.querySelectorAll("[data-prod-edit]").forEach(b=>b.onclick=()=>productForm(P(b.dataset.prodEdit)));
  r.querySelectorAll("[data-count]").forEach(b=>b.onclick=()=>countSheet(P(b.dataset.count)));
  r.querySelectorAll("[data-move]").forEach(b=>b.onclick=()=>moveSheet(S.moves.find(m=>String(m.id)===b.dataset.move)));
  massageStockBlock(r);
}
function stockSheet(kind,mid){
  const ps=liveProducts(); if(!ps.length){productForm();return}
  if((kind==="out"||kind==="return")&&!liveMarketers().length){marketerForm();return}
  let pid=ps[0].id;
  const t={in:"Stock in",out:"Give stock to a marketer",return:"Stock returned by a marketer",adjust:"Correct the count"}[kind];
  openSheet(t,`
    ${kind==="in"?`<p class="muted">New items arriving in your store, for example a shipment from China.</p>`:""}
    ${kind==="out"||kind==="return"?`<label class="f">Marketer<select id="ssM">${marketerOptions(mid)}</select></label>`:""}
    <div class="chips">${productChips(pid,"ssp")}</div>
    <div><span style="font-weight:700;font-size:.9rem">How many?</span>${stepperHTML("ssQ",1)}</div>
    <label class="f">Or type the number<input id="ssQn" type="number" min="1" step="1" inputmode="numeric" placeholder="e.g. 100"></label>
    ${kind==="in"?`<label class="f">What you paid for each (GH₵, optional)<input id="ssCost" type="number" min="0" step="0.5" inputmode="decimal"></label>`:""}
    <p class="small muted" id="ssHint"></p>
    <label class="f">Note (optional)<input id="ssNote" placeholder="${kind==="in"?"e.g. China order, November":""}"></label>
    <button class="btn-primary btn-block" id="ssBtn">Save</button>`,root=>{
    const hint=()=>{const s=stockOf(pid);const m=root.querySelector("#ssM")?.value;
      $("ssHint").textContent=kind==="in"?`Stock money you have: ${cedi(stockMoney())}. A restock takes its cost from this.`:kind==="out"?`In your store now: ${s.tracked?s.store:"not set up"}.`:kind==="return"&&m?`${mName(m)} is holding ${Math.max(0,holding(m,pid))}.`:s.tracked?`In stock now: ${Math.max(0,s.total)}.`:""};
    wireChips(root,"ssp",v=>{pid=v;hint()}); stepper(root,"ssQ",1); root.querySelector("#ssM")?.addEventListener("change",hint); hint();
    $("ssBtn").onclick=()=>{
      const q=Number($("ssQn").value)||Number($("ssQ").value);
      if(!(q>0)){toast("Enter how many.",true);return}
      const cost=kind==="in"?Number($("ssCost").value)||null:null;
      if(kind==="in"&&cost&&Math.round(q)*cost>stockMoney()+0.001){toast(`Not enough stock money: ${cedi(stockMoney())}. This restock costs ${cedi(Math.round(q)*cost)}. Add money first.`,true);return}
      const row={day,product_id:pid,kind,marketer_id:(kind==="out"||kind==="return")?$("ssM").value:null,qty:Math.round(q),unit_cost:cost,note:$("ssNote").value.trim()};
      run($("ssBtn"),"save the stock",async()=>{await ins("stock_moves",row);if(cost&&cost!==Number(P(pid).cost)){await upd("products",pid,{cost});await api(`/sales?product_id=eq.${enc(pid)}&cost=eq.0`,{method:"PATCH",prefer:"return=minimal",body:{cost}})}},{in:"Stock added",out:"Stock given out",return:"Return saved"}[kind]);
    };
  });
}
function countSheet(p){
  const s=stockOf(p.id);
  openSheet("Correct the count",`
    <p><b>${esc(p.name)}</b>: the app thinks you have <b>${s.tracked?s.total:"no stock recorded"}</b>${s.withM?` (including ${s.withM} with marketers)`:""}.</p>
    <label class="f">How many do you actually have right now? (store + with marketers)<input id="ccN" type="number" min="0" step="1" inputmode="numeric" placeholder="e.g. 10"></label>
    <p class="small" id="ccDiff"></p>
    <label class="f">Reason (optional)<input id="ccNote" placeholder="e.g. counted at home, 2 missing"></label>
    <button class="btn-primary btn-block" id="ccBtn">Save count</button>
    <p class="small muted">This adds a correction entry. Sales and other entries stay as they are.</p>`,()=>{
    const diff=()=>{const v=$("ccN").value;if(v===""){$("ccDiff").textContent="";return null}const d=Math.round(Number(v))-s.total;$("ccDiff").textContent=d===0?"That matches. Nothing to change.":d>0?`${d} more than recorded. The app will add ${d}.`:`${-d} fewer than recorded. The app will take off ${-d}.`;return d};
    $("ccN").oninput=diff; $("ccN").focus();
    $("ccBtn").onclick=()=>{const d=diff();if(d==null){toast("Enter how many you have.",true);return}if(d===0){closeSheet();return}
      run($("ccBtn"),"save the count",()=>ins("stock_moves",{day,product_id:p.id,kind:"adjust",marketer_id:null,qty:d,unit_cost:null,note:$("ccNote").value.trim()||("Counted "+$("ccN").value+" in hand")}),"Count corrected")};
  });
}
function moveSheet(mv){
  const label={in:"Stock in",out:"Given to "+esc(mName(mv.marketer_id)),return:"Returned by "+esc(mName(mv.marketer_id)),adjust:"Count correction"}[mv.kind];
  openSheet("Edit stock entry",`
    <p><b>${label}</b> · ${esc(P(mv.product_id)?.name||"Product")} · ${fmtDay(mv.day,{day:"numeric",month:"long",year:"numeric"})}</p>
    <label class="f">${mv.kind==="adjust"?"Change (use minus for fewer, e.g. -2)":"How many"}<input id="mvQ" type="number" step="1" inputmode="numeric" value="${mv.qty}"></label>
    ${mv.kind==="in"?`<label class="f">Cost each (GH₵, optional)<input id="mvC" type="number" min="0" step="0.5" value="${mv.unit_cost??""}"></label>`:""}
    <label class="f">Note<input id="mvN" value="${esc(mv.note)}"></label>
    <button class="btn-primary btn-block" id="mvSave">Save changes</button>
    <button class="btn-danger btn-block" id="mvDel">Delete this entry</button>`,()=>{
    $("mvSave").onclick=()=>{const q=Math.round(Number($("mvQ").value));if(!q||(mv.kind!=="adjust"&&q<0)){toast("Enter a valid number.",true);return}
      const row={qty:q,note:$("mvN").value.trim()};if(mv.kind==="in")row.unit_cost=Number($("mvC").value)||null;
      run($("mvSave"),"save the entry",()=>upd("stock_moves",mv.id,row),"Entry updated")};
    confirmBtn($("mvDel"),"Tap again to delete",()=>run($("mvDel"),"delete the entry",()=>del("stock_moves",mv.id),"Entry deleted"));
  });
}

/* =================== TEAM =================== */
function renderTeam(){
  if(teamTab==="therapists"){renderTherapists();return}
  const q=teamQuery.trim().toLowerCase();
  const removedCount=S.marketers.filter(m=>m.removed_at).length;
  if(!removedCount) showRemoved=false;
  const list=S.marketers.filter(m=>showRemoved?!!m.removed_at:!m.removed_at).filter(m=>!q||m.name.toLowerCase().includes(q)||(m.phone||"").includes(q)||String(m.no)===q)
    .sort((a,b)=>(a.active===false)-(b.active===false)||a.no-b.no);
  const r=$("scr-team");
  r.innerHTML=`
    ${teamSeg()}
    <div class="row"><input id="tq" type="search" placeholder="Search name, phone or number" value="${esc(teamQuery)}" style="flex:1 1 200px"><button class="btn-primary" id="tAdd">+ Add</button><button class="btn-ghost" id="tMany">Add many</button></div>
    <div class="card" style="padding:4px 16px">
      ${list.length?`<ul class="list">${list.map(m=>{const mo=moneyOf(m.id);const h=holdingsOf(m.id).reduce((t,x)=>t+x.n,0);const td=sumQty(salesOn(day).filter(s=>s.marketer_id===m.id));return `<li><button class="item" data-open-m="${m.id}">
        <span class="avatar">${esc(initials(m.name))}</span>
        <span class="grow"><span class="t">${esc(m.name)} ${m.removed_at?'<span class="pill off">removed</span>':m.active===false?'<span class="pill off">paused</span>':""}</span><span class="s">${esc([m.phone,m.area].filter(Boolean).join(" · ")||"No phone yet")}</span>
          <span class="row" style="gap:6px;margin-top:4px">${td?`<span class="pill good">${td} sold today</span>`:""}${h?`<span class="pill">holding ${h}</span>`:""}${mo.owes>0.009?`<span class="pill warn">owes ${cedi(mo.owes)}</span>`:""}${mo.saved?`<span class="pill">saved ${cedi(mo.saved)}</span>`:""}</span></span>
        <span class="r muted">›</span></button></li>`}).join("")}</ul>`:`<p class="empty">${q?"No marketer matches.":"No marketers yet. Tap + Add."}</p>`}
    </div>
    ${showRemoved?`<div class="row between"><p class="small muted">Removed marketers. Their past sales stay in your reports.</p><button class="btn-ghost" id="tShowRem">Back to team</button></div>`
      :`<div class="row between"><p class="small muted">${teamMarketers().length} on your team. Tap one to see their stock, money and savings, or to edit or remove them.</p>${removedCount?`<button class="btn-ghost" id="tShowRem">Removed (${removedCount})</button>`:""}</div>`}`;
  $("tShowRem")&&($("tShowRem").onclick=()=>{showRemoved=!showRemoved;renderTeam()});
  const tq=$("tq"); tq.oninput=e=>{teamQuery=e.target.value;const pos=tq.selectionStart;renderTeam();const n=$("tq");n.focus();n.setSelectionRange(pos,pos)};
  $("tAdd").onclick=()=>marketerForm(); $("tMany").onclick=()=>addManySheet();
  wireTeamSeg(r);
  r.querySelectorAll("[data-open-m]").forEach(b=>b.onclick=()=>marketerPage(b.dataset.openM));
}
function marketerForm(m){
  openSheet(m?"Edit marketer":"Add a marketer",`
    <label class="f">Name<input id="mfName" value="${esc(m?.name)}" autocomplete="off" required></label>
    <label class="f">Phone<input id="mfPhone" value="${esc(m?.phone)}" inputmode="tel"></label>
    <label class="f">Area<input id="mfArea" value="${esc(m?.area)}" placeholder="e.g. Amasaman"></label>
    <button class="btn-primary btn-block" id="mfSave">${m?"Save changes":"Add marketer"}</button>
    ${m&&!m.removed_at?`<button class="btn-ghost btn-block" id="mfPause">${m.active===false?"Resume this marketer":"Pause this marketer"}</button>
    <p class="small muted">Pause: for a short break. They stay on your team list.</p>
    <button class="btn-danger btn-block" id="mfRemove">Remove from team</button>
    <p class="small muted">Remove: for someone who no longer works with you.</p>`:""}
    ${m&&m.removed_at?`<button class="btn-primary btn-block" id="mfBack">Bring back to the team</button>`:""}`,()=>{
    $("mfName").focus();
    $("mfSave").onclick=()=>{const name=$("mfName").value.trim();if(!name){toast("Enter a name.",true);return}
      const row={name,phone:$("mfPhone").value.trim(),area:$("mfArea").value.trim()};
      if(m) run($("mfSave"),"save the marketer",()=>upd("marketers",m.id,row),"Saved");
      else run($("mfSave"),"add the marketer",()=>ins("marketers",{id:newId(),no:S.marketers.reduce((a,x)=>Math.max(a,x.no||0),0)+1,...row,active:true,joined:todayISO()}),"Marketer added");
    };
    if(m&&!m.removed_at){
      $("mfPause").onclick=()=>run($("mfPause"),"change the marketer",()=>upd("marketers",m.id,{active:m.active===false}),m.active===false?"Resumed":"Paused");
      $("mfRemove").onclick=()=>removeSheet(m);
    }
    if(m&&m.removed_at) $("mfBack").onclick=()=>run($("mfBack"),"bring the marketer back",()=>upd("marketers",m.id,{removed_at:null,active:true}),"Back on the team");
  });
}
function removeSheet(m){
  const mo=moneyOf(m.id), held=holdingsOf(m.id);
  const warn=[
    held.length?`is still holding <b>${held.map(h=>h.n+" × "+esc(h.p.name)).join(", ")}</b>. Use <b>Return stock</b> first if they gave it back.`:"",
    mo.owes>0.009?`still owes you <b>${cedi(mo.owes)}</b>.`:"",
    mo.saved>0.009?`has <b>${cedi(mo.saved)}</b> in savings with you. Use <b>Pay out savings</b> if you've given it back.`:""
  ].filter(Boolean);
  openSheet("Remove "+m.name+"?",`
    ${warn.length?`<div class="alert"><span>⚠️</span><span>${esc(m.name)} ${warn.join("<br>"+esc(m.name)+" ")}</span></div>`:""}
    <p>${esc(m.name)} will disappear from Team, Sell, Home and targets.</p>
    <p class="muted">If they have no records yet, they're deleted completely. If they have past sales, payments, stock or savings, those stay in your reports, and you can find them later under <b>Removed</b> on the Team screen.</p>
    <button class="btn-danger btn-block" id="rmGo">Remove ${esc(m.name)}</button>
    <button class="btn-ghost btn-block" id="rmNo">Keep them</button>`,()=>{
    $("rmNo").onclick=()=>marketerPage(m.id);
    confirmBtn($("rmGo"),"Tap again to confirm",()=>run($("rmGo"),"remove the marketer",async()=>{
      try{await del("marketers",m.id)}                       // no records: delete completely
      catch(e){if(e instanceof TypeError||e.status===401||e.status===403)throw e;await upd("marketers",m.id,{removed_at:new Date().toISOString(),active:false})} // has records: remove from team, keep history
    },m.name+" removed"));
  });
}
function addManySheet(){
  openSheet("Add many marketers",`<p class="muted">One per line. Add a phone after a comma: <i>Kofi Mensah, 0241234567</i></p><textarea id="amT" placeholder="Ama Owusu, 0541112233&#10;Yaw Boateng"></textarea><p class="small muted" id="amC">0 names</p><button class="btn-primary btn-block" id="amBtn">Add all</button>`,()=>{
    const parse=()=>$("amT").value.split("\n").map(l=>l.trim()).filter(Boolean).map(l=>{const [n,...r]=l.split(",");return{name:n.trim(),phone:r.join(",").trim()}}).filter(x=>x.name);
    $("amT").oninput=()=>{const n=parse().length;$("amC").textContent=n+(n===1?" name":" names")};
    $("amBtn").onclick=()=>{const l=parse();if(!l.length)return;let no=S.marketers.reduce((a,x)=>Math.max(a,x.no||0),0)+1;
      run($("amBtn"),"add the marketers",()=>ins("marketers",l.map(x=>({id:newId(),no:no++,name:x.name,phone:x.phone,area:"",active:true,joined:todayISO()}))),`Added ${l.length} marketers`)};
  });
}
function marketerPage(mid){
  const m=M(mid); if(!m) return;
  const mo=moneyOf(mid), hs=holdingsOf(mid), [f,t]=period("month");
  const monthSales=S.sales.filter(s=>s.marketer_id===mid&&s.day>=f&&s.day<=t);
  const units=hs.reduce((a,x)=>a+x.n,0);
  const unsoldPrice=hs.reduce((a,x)=>a+x.n*Number(x.p.price),0), unsoldCost=hs.reduce((a,x)=>a+x.n*Number(x.p.cost||0),0);
  const line=(label,val,sub,strong)=>`<li><div class="item"><span class="grow"><span class="${strong?"t":""}">${label}</span>${sub?`<span class="s" style="white-space:normal">${sub}</span>`:""}</span><span class="r">${strong?`<b>${val}</b>`:val}</span></div></li>`;
  openSheet(m.name+(m.removed_at?" (removed)":""),`
    <div class="row between"><span class="muted">${esc([m.phone,m.area].filter(Boolean).join(" · ")||"No phone yet")}${m.active===false&&!m.removed_at?" · paused":""}</span><button class="btn-ghost" id="mpEdit">Edit</button></div>
    <div class="grid2">
      <div class="tile"><b>${cedi(mo.allSales)}</b><span>total sales</span></div>
      <div class="tile"><b>${cedi(mo.paid)}</b><span>money handed to you</span></div>
      <div class="tile"><b>${units}</b><span>stock remaining with them</span></div>
      <div class="tile ${mo.owes>0.009?"accent":""}"><b>${cedi(Math.max(0,mo.owes))}</b><span>${mo.owes<-0.009?"paid ahead by "+cedi(-mo.owes):"cash still to hand in"}</span></div>
    </div>
    <div class="grid2">
      <button class="btn-primary" id="mpPay">Receive money</button>
      <button id="mpSale">Record sale</button>
      <button id="mpGive">Give stock</button>
      <button id="mpRet">Return stock</button>
      <button id="mpSave">Add savings</button>
      <button id="mpOut">Pay out savings</button>
    </div>
    <div class="card" style="padding:4px 14px">
      <div class="eyebrow" style="padding-top:12px">Settlement</div>
      <ul class="list">
        ${line("Stock given to them",mo.unitsGiven+" items")}
        ${line("Sales recorded",cedi(mo.allSales))}
        ${line("Paid by customers (cash or MoMo)",cedi(mo.soldValue))}
        ${line("Handed over to you","− "+cedi(mo.paid))}
        ${line(mo.owes<-0.009?"Paid ahead":"Cash still with them",cedi(Math.abs(mo.owes)),mo.owes<-0.009?"handed in more than their cash and MoMo sales: check for savings or pay-later money inside a payment":"collected from customers, not yet handed in",true)}
        ${line("Customers owe through them",cedi(mo.credit),"pay-later sales not paid yet")}
        ${line("Unsold stock with them",units+" items",units?`worth ${cedi(unsoldPrice)} at selling price${unsoldCost?` · ${cedi(unsoldCost)} at cost`:""}`:"")}
        ${line("Profit from their sales",cedi(mo.profit),"selling price − your cost")}
        ${line("Their pay (savings with you)",cedi(mo.saved),"what you owe them: pay it out with Pay out savings",true)}
      </ul>
      <p class="small muted" style="padding-bottom:12px">Each line is a separate amount. They are never added together.</p>
    </div>
    ${hs.length?`<div><div class="eyebrow">Holding now</div><ul class="list">${hs.map(x=>`<li><div class="item"><span class="grow t">${esc(x.p.name)}</span><span class="r"><b>${x.n}</b></span></div></li>`).join("")}</ul></div>`:""}
    <div><div class="eyebrow">Full history</div><div id="mpHist"><p class="empty">Loading history…</p></div></div>
    ${m.removed_at?`<button class="btn-primary btn-block" id="mpBack">Bring back to the team</button>`:`<button class="btn-danger btn-block" id="mpRemove">Remove ${esc(m.name)} from team</button>`}`,()=>{
    $("mpEdit").onclick=()=>marketerForm(m);
    $("mpRemove")&&($("mpRemove").onclick=()=>removeSheet(m));
    $("mpBack")&&($("mpBack").onclick=()=>run($("mpBack"),"bring the marketer back",()=>upd("marketers",m.id,{removed_at:null,active:true}),"Back on the team"));
    $("mpSale").onclick=()=>{closeSheet();sellForm.mid=mid;store.set("inv-sell-m",mid);go("sell")};
    $("mpPay").onclick=()=>paymentSheet(mid);
    $("mpGive").onclick=()=>stockSheet("out",mid);
    $("mpRet").onclick=()=>stockSheet("return",mid);
    $("mpSave").onclick=()=>savingsSheet(mid,false);
    $("mpOut").onclick=()=>savingsSheet(mid,true);
    loadHistory(mid);
  });
}
async function loadHistory(mid){
  const q=`marketer_id=eq.${enc(mid)}&order=created_at.desc&limit=40`;
  try{
    const [sales,pays,savs,moves]=await Promise.all([api("/sales?"+q),api("/payments?"+q),api("/savings?"+q),api("/stock_moves?"+q)]);
    const rows=[
      ...sales.map(s=>({d:s.day,c:s.created_at,t:`Sold ${esc(pName(s))} × ${s.qty}`,s:methodLabel(s),v:cedi(s.qty*s.price),col:""})),
      ...pays.map(p=>({d:p.day,c:p.created_at,t:"Handed money to you",s:(p.method==="momo"?"MoMo":"Cash")+(p.note?" · "+esc(p.note):""),v:"+"+cedi(p.amount),col:"var(--good)"})),
      ...savs.map(v=>({d:v.day,c:v.created_at,t:v.amount<0?"Savings paid out":"Saved with you",s:esc(v.note||""),v:(v.amount<0?"−":"+")+cedi(Math.abs(v.amount)),col:v.amount<0?"var(--warn)":""})),
      ...moves.map(mv=>({d:mv.day,c:mv.created_at,t:mv.kind==="out"?`Received ${esc(P(mv.product_id)?.name||"stock")}`:`Returned ${esc(P(mv.product_id)?.name||"stock")}`,s:esc(mv.note||""),v:(mv.kind==="out"?"→ ":"← ")+mv.qty,col:""}))
    ].filter(x=>x.d>=RECORD_START).sort((a,b)=>b.d.localeCompare(a.d)||String(b.c).localeCompare(String(a.c))).slice(0,40);
    const el=$("mpHist"); if(!el) return;
    el.innerHTML=rows.length?`<ul class="list">${rows.map(x=>`<li><div class="item"><span class="grow"><span class="t">${x.t}</span><span class="s">${fmtDay(x.d)}${x.s?" · "+x.s:""}</span></span><span class="r" style="${x.col?"color:"+x.col:""}">${x.v}</span></div></li>`).join("")}</ul>`:`<p class="empty">Nothing recorded yet.</p>`;
  }catch(e){const el=$("mpHist");if(el)el.innerHTML=`<p class="empty">${esc(explain(e,"load the history"))}</p>`}
}

/* =================== MONEY =================== */
function paymentSheet(mid){
  if(!liveMarketers().length){marketerForm();return}
  let method="cash";
  openSheet("Receive money from a marketer",`
    <p class="muted">Money a marketer hands to you for the items they sold.</p>
    <label class="f">Marketer<select id="pyM">${marketerOptions(mid,false)}</select></label>
    <p class="small" id="pyOwe"></p>
    <label class="f">Amount (GH₵)<input id="pyAmt" type="number" min="0" step="0.5" inputmode="decimal"></label>
    <div class="seg"><button type="button" data-seg="pm" data-v="cash" aria-pressed="true">Cash</button><button type="button" data-seg="pm" data-v="momo" aria-pressed="false">MoMo</button></div>
    <label class="f">Note (optional)<input id="pyNote"></label>
    <button class="btn-primary btn-block" id="pyBtn">Save payment</button>`,root=>{
    const owe=()=>{const o=moneyOf($("pyM").value).owes;$("pyOwe").textContent=o>0.009?`Owes ${cedi(o)}.`:"Owes nothing right now.";if(o>0)$("pyAmt").placeholder=String(Math.round(o*100)/100)};
    $("pyM").onchange=owe; owe(); wireSeg(root,"pm",v=>method=v);
    $("pyBtn").onclick=()=>{const a=Number($("pyAmt").value);if(!(a>0)){toast("Enter the amount.",true);return}
      run($("pyBtn"),"save the payment",()=>ins("payments",{day,marketer_id:$("pyM").value,amount:a,method,note:$("pyNote").value.trim()}),"Payment saved")};
  });
}
function savingsSheet(mid,out){
  if(!liveMarketers().length){marketerForm();return}
  openSheet(out?"Pay out savings":"Add savings",`
    <label class="f">Marketer<select id="svM">${marketerOptions(mid,false)}</select></label>
    <p class="small" id="svBal"></p>
    <label class="f">Amount (GH₵)<input id="svAmt" type="number" min="0" step="0.5" inputmode="decimal"></label>
    <label class="f">Note (optional)<input id="svNote" placeholder="${out?"e.g. collected end of month":"e.g. daily savings"}"></label>
    <button class="btn-primary btn-block" id="svBtn">${out?"Pay out":"Save"}</button>`,()=>{
    const bal=()=>$("svBal").textContent="Balance: "+cedi(moneyOf($("svM").value).saved); $("svM").onchange=bal; bal();
    $("svBtn").onclick=()=>{const a=Number($("svAmt").value);const mm=$("svM").value;if(!(a>0)){toast("Enter the amount.",true);return}
      if(out&&a>moneyOf(mm).saved+0.001){toast("That's more than their savings balance.",true);return}
      run($("svBtn"),"save the savings",()=>ins("savings",{day,marketer_id:mm,amount:out?-a:a,note:$("svNote").value.trim()}),out?"Savings paid out":"Savings added")};
  });
}
const EXPENSE_CATS=["Transport","Shipping","Rent","Airtime & data","Food","Marketing","Platform fee","Other"];
const DEFAULT_DAILY=[{label:"Transport: Adjeman → Amasaman",cat:"Transport",amount:10},{label:"Transport: Amasaman → Seku",cat:"Transport",amount:10},{label:"Transport back home",cat:"Transport",amount:20},{label:"Extra fare (coming late)",cat:"Transport",amount:0},{label:"Food when out",cat:"Food",amount:50},{label:"Food at night",cat:"Food",amount:20}];
const usualDaily=()=>{const d=S.settings?.daily_expenses;return Array.isArray(d)&&d.length?d:DEFAULT_DAILY};
const expensesOn=d=>(S.expenses||[]).filter(e=>e.day===d);
function dailyExpenseSheet(){
  const done=expensesOn(day), doneTotal=done.reduce((a,e)=>a+Number(e.amount),0);
  let lines=done.length?[]:usualDaily().map(l=>({...l,amount:Number(l.amount)||0}));  // already recorded: start empty, only extras
  const when=day===todayISO()?"today":fmtDay(day,{weekday:"long",day:"numeric",month:"short"});
  const draw=()=>{
    $("deLines").innerHTML=lines.map((l,i)=>`<li><div class="item" style="gap:8px">
      <span class="grow"><span class="t" style="white-space:normal">${esc(l.label)}</span><span class="s">${esc(l.cat)}</span></span>
      <input data-de-amt="${i}" type="number" min="0" step="0.5" inputmode="decimal" value="${l.amount||""}" placeholder="0" aria-label="Amount GH₵ for ${esc(l.label)}" style="width:84px;text-align:right">
      <button type="button" class="btn-icon btn-ghost" data-de-del="${i}" aria-label="Remove line">✕</button></div></li>`).join("");
    const tot=()=>{$("deTotal").textContent=cedi(lines.reduce((a,l)=>a+(Number(l.amount)||0),0))};
    document.querySelectorAll("[data-de-amt]").forEach(x=>x.oninput=()=>{lines[x.dataset.deAmt].amount=Number(x.value)||0;tot()});
    document.querySelectorAll("[data-de-del]").forEach(x=>x.onclick=()=>{lines.splice(Number(x.dataset.deDel),1);draw()});
    tot();
  };
  openSheet("Daily expenses",`
    ${done.length?`<div class="alert info"><span>✓</span><span>Already saved for ${when}: <b>${cedi(doneTotal)}</b> (${done.map(e=>esc(e.note||e.category)).join(", ")}). Add only the extras below.</span></div>`:`<p class="muted">Your usual day is filled in. Change any amount that was different ${when}, add anything extra, then save.</p>`}
    <ul class="list" id="deLines"></ul>
    <div class="card" style="padding:12px;gap:8px;background:var(--raised)">
      <span style="font-weight:700;font-size:.9rem">Add another expense</span>
      <div class="chips">${EXPENSE_CATS.map(c=>`<button type="button" class="chip" data-chip="decat" data-v="${c}" aria-pressed="${c==="Other"}">${c}</button>`).join("")}</div>
      <div class="row"><input id="deNewL" placeholder="What for, e.g. airtime" style="flex:2 1 160px"><input id="deNewA" type="number" min="0" step="0.5" inputmode="decimal" placeholder="GH₵" style="flex:1 1 80px"><button type="button" id="deAdd">Add</button></div>
    </div>
    <div class="row between"><span class="muted">Total for ${when}</span><span class="money-big" id="deTotal">GH₵0</span></div>
    ${done.length?"":`<label class="row" style="gap:10px;font-weight:400"><input type="checkbox" id="deUsual" style="width:22px;min-height:22px"> Make this list my usual day</label>`}
    <button class="btn-primary btn-block" id="deSave" style="min-height:54px">Save expenses for ${when}</button>
    <p class="small muted">Lines left at 0 aren't saved. To record a different day, change the date at the top first.</p>`,root=>{
    let newCat="Other"; wireChips(root,"decat",v=>newCat=v); draw();
    $("deAdd").onclick=()=>{const l=$("deNewL").value.trim()||newCat,a=Number($("deNewA").value)||0;lines.push({label:l,cat:newCat,amount:a});$("deNewL").value="";$("deNewA").value="";draw()};
    $("deSave").onclick=()=>{
      const rows=lines.filter(l=>Number(l.amount)>0).map(l=>({day,category:l.cat,amount:Number(l.amount),note:l.label.trim()||l.cat}));
      const keep=!!$("deUsual")?.checked;
      if(!rows.length&&!keep){toast("Enter at least one amount.",true);return}
      run($("deSave"),"save the expenses",async()=>{
        if(rows.length) await ins("expenses",rows);
        if(keep) await api("/settings?id=eq.1",{method:"PATCH",prefer:"return=minimal",body:{daily_expenses:lines.map(l=>({label:l.label.trim()||l.cat,cat:l.cat,amount:Number(l.amount)||0}))}});
      },rows.length?`Saved ${cedi(rows.reduce((a,r)=>a+r.amount,0))} of expenses`:"Usual day updated");
    };
  });
}
let txFilter="all";
function expenseSheet(e){
  let cat=e?.category||"Transport";
  openSheet(e?"Edit expense":"Record an expense",`
    <p class="muted">Money spent running the business: transport, shipping, rent, airtime and so on. Buying stock is recorded with Stock in instead.</p>
    <label class="f">Amount (GH₵)<input id="exAmt" type="number" min="0" step="0.5" inputmode="decimal" value="${e?Number(e.amount):""}"></label>
    <div><span style="font-weight:700;font-size:.9rem">What for?</span><div class="chips" style="margin-top:6px">${EXPENSE_CATS.map(c=>`<button type="button" class="chip" data-chip="excat" data-v="${c}" aria-pressed="${c===cat}">${c}</button>`).join("")}</div></div>
    <label class="f">Note (optional)<input id="exNote" value="${esc(e?.note)}" placeholder="e.g. trotro to Kaneshie market"></label>
    <button class="btn-primary btn-block" id="exBtn">${e?"Save changes":"Save expense"}</button>
    ${e?`<button class="btn-danger btn-block" id="exDel">Delete this expense</button>`:`<p class="small muted">Saves on ${day===todayISO()?"today's date":fmtDay(day,{day:"numeric",month:"long"})}.</p>`}`,root=>{
    wireChips(root,"excat",v=>cat=v);
    $("exBtn").onclick=()=>{const a=Number($("exAmt").value);if(!(a>0)){toast("Enter the amount.",true);return}
      const row={amount:a,category:cat,note:$("exNote").value.trim()};
      if(e) run($("exBtn"),"save the expense",()=>upd("expenses",e.id,row),"Expense updated");
      else run($("exBtn"),"save the expense",()=>ins("expenses",{day,...row}),"Expense saved")};
    if(e) confirmBtn($("exDel"),"Tap again to delete",()=>run($("exDel"),"delete the expense",()=>del("expenses",e.id),"Expense deleted"));
  });
}
function paymentDetail(p){
  openSheet("Money received",`<p>${esc(mName(p.marketer_id))} handed you <b>${cedi(p.amount)}</b> by ${p.method==="momo"?"MoMo":"cash"} on ${fmtDay(p.day,{day:"numeric",month:"long"})}.</p>${p.note?`<p class="muted">${esc(p.note)}</p>`:""}<button class="btn-danger btn-block" id="pdDel">Delete this payment</button>`,()=>confirmBtn($("pdDel"),"Tap again to delete",()=>run($("pdDel"),"delete the payment",()=>del("payments",p.id),"Payment deleted")));
}
function savingDetail(v){
  openSheet(v.amount<0?"Savings paid out":"Savings",`<p>${esc(mName(v.marketer_id))}: <b>${v.amount<0?"paid out ":"saved "}${cedi(Math.abs(v.amount))}</b> on ${fmtDay(v.day,{day:"numeric",month:"long"})}.</p>${v.note?`<p class="muted">${esc(v.note)}</p>`:""}<button class="btn-danger btn-block" id="svDel">Delete this entry</button>`,()=>confirmBtn($("svDel"),"Tap again to delete",()=>run($("svDel"),"delete the entry",()=>del("savings",v.id),"Entry deleted")));
}

/* the figures every Money tab shares */
function moneyFigures(f,t){
  const inP=x=>x.day>=f&&x.day<=t;
  const sales=salesIn(f,t), pays=S.payments.filter(inP), exps=(S.expenses||[]).filter(inP), savs=S.savings.filter(inP);
  const stockBought=S.moves.filter(m=>m.kind==="in"&&inP(m)).reduce((a,m)=>a+Number(m.qty)*Number(m.unit_cost||0),0);
  const received=pays.reduce((a,p)=>a+Number(p.amount),0);
  const expenses=exps.reduce((a,e)=>a+Number(e.amount),0);
  const savIn=savs.filter(v=>v.amount>0).reduce((a,v)=>a+Number(v.amount),0), savOut=-savs.filter(v=>v.amount<0).reduce((a,v)=>a+Number(v.amount),0);
  const mIn=massageIn(f,t), mKit=massageKit(f,t), mTher=therapistPaid(f,t);
  const revenue=sumVal(sales), cost=sumCost(sales), gross=revenue-cost+mIn-mKit, net=0;
  const withMarketers=S.marketers.reduce((a,m)=>a+Math.max(0,moneyOf(m.id).owes),0);
  const customersOwe=unpaidCredit().reduce((a,s)=>a+s.qty*s.price,0);
  let stockUnits=0,stockCost=0,stockPrice=0;
  S.products.forEach(p=>{const n=Math.max(0,stockOf(p.id).total);stockUnits+=n;stockCost+=n*Number(p.cost||0);stockPrice+=n*Number(p.price||0)});
  const savingsHeld=S.marketers.reduce((a,m)=>a+moneyOf(m.id).saved,0);
  const mpay=savIn, profit=gross-expenses;  // profit after expenses. Savings belong to the marketers, so they are not profit
  const split=SPLIT.map(([n,p])=>({n,p,v:profit*p,sub:Math.round(p*100)+"% of profit after expenses"}));
  const pers=split.find(x=>x.n==="Personal income");
  if(pers){pers.v=profit*pers.p-mTher;pers.sub=`${Math.round(pers.p*100)}% of profit, less therapist pay of ${cedi(mTher)}`}
  return {sales,pays,exps,savs,received,expenses,stockBought,spent:stockBought+expenses,savIn,savOut,revenue,cost,gross,mpay,net:profit,split,massageIn:mIn,massageKit:mKit,therapistPaid:mTher,withMarketers,customersOwe,toCollect:withMarketers+customersOwe,stockUnits,stockCost,stockPrice,savingsHeld};
}
const row=(label,val,sub,opts={})=>`<li><div class="item"><span class="grow"><span class="${opts.strong?"t":""}">${label}</span>${sub?`<span class="s" style="white-space:normal">${sub}</span>`:""}</span><span class="r" ${opts.color?`style="color:${opts.color}"`:""}>${opts.strong?`<b>${val}</b>`:val}</span></div></li>`;

const SPLIT=[["Reinvestment",0.4],["Personal income",0.3],["Business reserve",0.2],["Unallocated profit",0.1]];
const splitRows=F=>F.split.map(s=>row(s.n,cedi(s.v),s.sub)).join("");

/* Record lists for the Reports tab. The record starts yesterday; nothing before RECORD_START is shown. */
const RECORD_START="2026-11-19";
const dayRange=(f,t)=>{const out=[];for(let d=f;d<=t&&out.length<400;d=addDays(d,1))out.push(d);return out};
const weekStartOf=d=>{const x=new Date(d+"T12:00");return addDays(d,-((x.getDay()+6)%7))};
const dayTitle=d=>{const today=todayISO();return d===today?"Today":d===addDays(today,-1)?"Yesterday":fmtDay(d,{weekday:"long",day:"numeric",month:"long",year:"numeric"})};
function recordCard(title,sub,f,t){
  const F=moneyFigures(f,t);
  const active=F.revenue||F.massageIn||F.expenses||F.received||F.savIn||F.savOut||F.stockBought;
  return `<div class="card full"><div class="row between" style="align-items:baseline"><h2>${title}</h2>${sub?`<span class="small muted">${sub}</span>`:""}</div>
    ${active?`<ul class="list">${row("Sales",cedi(F.revenue),sumQty(F.sales)+" items")}${row("Massage money in","+ "+cedi(F.massageIn))}${row("Cost of items sold","− "+cedi(F.cost))}${row("Massage kit used","− "+cedi(F.massageKit))}${row("Gross profit",cedi(F.gross),"",{strong:true})}${row("Expenses","− "+cedi(F.expenses))}${row("Profit after expenses",cedi(F.net),"",{strong:true,color:F.net>=0?"var(--good)":"var(--bad)"})}${row("Handed in by marketers",cedi(F.received))}</ul>`:`<p class="empty">Nothing recorded.</p>`}
  </div>`;
}
function recordCards(mode){
  const today=todayISO();
  if(mode==="week"){
    const out=[];
    for(let w=weekStartOf(today);w>=weekStartOf(RECORD_START);w=addDays(w,-7)){
      const we=addDays(w,6), f=w<RECORD_START?RECORD_START:w, t=we>today?today:we;
      out.push(recordCard("Week of "+fmtDay(w,{day:"numeric",month:"long",year:"numeric"}),`${fmtDay(f,{day:"numeric",month:"short"})} – ${fmtDay(t,{day:"numeric",month:"short"})}`,f,t));
    }
    return out.join("")||`<p class="empty">No weeks recorded yet.</p>`;
  }
  let f,t;
  if(mode==="month"){const [mf,mt]=period("month");f=mf<RECORD_START?RECORD_START:mf;t=mt>today?today:mt}
  else{f=RECORD_START;t=today}
  const days=dayRange(f,t).reverse();
  return days.map(d=>recordCard(dayTitle(d),"",d,d)).join("")||`<p class="empty">No days recorded yet.</p>`;
}
/* Revenue: money from sales only, before cost. Profit and cash flow are shown on their own cards. */
function revenueSheet(){
  const f=RECORD_START,t=todayISO(), F=moneyFigures(f,t), rows=F.sales;
  const label="since "+fmtDay(f,{day:"numeric",month:"long",year:"numeric"});
  const byP={};rows.forEach(s=>{const k=pName(s);byP[k]=byP[k]||{u:0,v:0};byP[k].u+=Number(s.qty);byP[k].v+=Number(s.qty)*Number(s.price)});
  const keys=Object.keys(byP).sort((a,b)=>byP[b].v-byP[a].v);
  openSheet("Revenue · "+label,`
    <p class="muted">Money from sales before cost. Profit is on the Profit card, and cash is in Where the money is.</p>
    <ul class="list">${row("Product sales",cedi(F.revenue),sumQty(rows)+" items")}${row("Massage money in",cedi(F.massageIn))}${row("Revenue",cedi(F.revenue+F.massageIn),"all sellers, all products",{strong:true})}</ul>
    <h2 style="margin-top:14px">By product</h2>
    ${keys.length?`<ul class="list">${keys.map(k=>row(esc(k),cedi(byP[k].v),byP[k].u+" sold")).join("")}</ul>`:`<p class="empty">No sales in ${label}.</p>`}`);
}
/* Add a customer who owes: a pay-later sale with the customer's name and an optional due date. */
function owingSheet(){
  const pr=S.products.filter(p=>p.active!==false);
  const opts=pr.map(p=>`<option value="${p.id}">${esc(p.name)} · ${cedi(p.price)}</option>`).join("");
  openSheet("Add customer who owes",`
    <p class="muted">A sale the customer has not paid yet. They stay under Customers who owe until you mark it paid.</p>
    <label class="f">Customer's name<input id="cuN" placeholder="e.g. Ama Mensah"></label>
    <label class="f">What they bought<select id="cuP">${opts}</select></label>
    <label class="f">How many<input id="cuQ" type="number" min="1" step="1" value="1" inputmode="numeric"></label>
    <label class="f">Price each (GH₵)<input id="cuPr" type="number" min="0" step="0.5" inputmode="decimal"></label>
    <label class="f">Due date (optional)<input id="cuD" type="date"></label>
    <label class="f">Note (optional)<input id="cuNo" placeholder="e.g. paying on Friday"></label>
    <button class="btn-primary btn-block" id="cuBtn">Save customer</button>`,()=>{
    const fillPrice=()=>{const p=pr.find(x=>x.id===$("cuP").value);$("cuPr").value=p?Number(p.price):""};
    $("cuP").onchange=fillPrice; fillPrice();
    $("cuBtn").onclick=()=>{
      const name=$("cuN").value.trim(), p=pr.find(x=>x.id===$("cuP").value), q=Math.round(Number($("cuQ").value)), price=Number($("cuPr").value);
      if(!name){toast("Enter the customer's name.",true);return}
      if(!p||!(q>0)){toast("Enter how many.",true);return}
      if(!(price>=0)){toast("Enter the price.",true);return}
      run($("cuBtn"),"save the customer",()=>ins("sales",{day,marketer_id:null,product_id:p.id,product_name:p.name,qty:q,price,cost:Number(p.cost||0),method:"credit",customer:name,due_date:$("cuD").value||null,note:$("cuNo").value.trim()}),`${name} now owes ${cedi(q*price)}`);
    };
  });
}
function renderMoney(){
  const r=$("scr-money");
  if(!["overview","transactions","people","savings","reports"].includes(moneyTab)) moneyTab="overview";
  const tabs=[["overview","Overview"],["transactions","Transactions"],["people","People"],["savings","Savings"],["reports","Reports"]];
  const [mf,mt]=period("month"), monthName=fmtDay(day,{month:"long"});
  let body="";
  if(moneyTab==="overview"){
    const F=moneyFigures(mf,mt);
    const missing=liveProducts().filter(p=>!Number(p.cost));
    body=`
      <div class="grid2 kpis">
        <div class="tile"><b>${cedi((()=>{const A=moneyFigures(RECORD_START,todayISO());return A.revenue+A.massageIn})())}</b><span>revenue · all sellers since 19 Nov</span></div>
        <div class="tile"><b>${cedi(F.gross)}</b><span>gross profit</span></div>
        <div class="tile"><b>${cedi(F.savIn)}</b><span>total savings</span></div>
        <div class="tile accent"><b style="color:${F.net>=0?"var(--good)":"var(--bad)"}">${cedi(F.net)}</b><span>profit after expenses</span></div>
        <div class="tile"><b>${cedi(F.customersOwe)}</b><span>still to collect</span></div>
      </div>
      <div class="fab-row" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
        <button class="qa" id="ovRev">${icon.box}Revenue</button>
        <button class="qa" id="ovPay">${icon.cash}Receive money</button>
        <button class="qa" id="ovExp">${icon.back}Daily expenses</button>
        <button class="qa" id="ovCust">${icon.person}Customers who owe</button>
        <button class="qa" id="ovOwe">${icon.person}Add customer who owes</button>
      </div>
      <div class="wide">
        <div class="card"><h2>Where the money is</h2>
          <ul class="list">
            ${row("Customers owe you",cedi(F.customersOwe),`${unpaidCredit().length} pay-later sale${unpaidCredit().length===1?"":"s"}`,{strong:true})}
          </ul>
          <p class="small muted">Only money customers still owe you is shown here. Everything else is already in your hands or shared.</p>
        </div>
        <div class="card"><h2>Profit in ${monthName}</h2>
          <ul class="list">
            ${row("Sales",cedi(F.revenue),sumQty(F.sales)+" items, including pay-later")}
            ${row("Massage money in","+ "+cedi(F.massageIn),"booking deposits and payments")}
            ${row("Cost of items sold","− "+cedi(F.cost))}
            ${row("Massage kit used","− "+cedi(F.massageKit),"counted when a session is delivered")}
            ${row("Gross profit",cedi(F.gross),"sales − cost",{strong:true})}
            ${row("Expenses","− "+cedi(F.expenses),F.exps.length?`${F.exps.length} recorded this month`:"none recorded yet")}
            ${row("Profit after expenses",cedi(F.net),"gross profit − expenses",{strong:true,color:F.net>=0?"var(--good)":"var(--bad)"})}
          </ul>
          <p class="small muted" style="margin:14px 0 4px">How the profit is shared</p>
          <ul class="list">${splitRows(F)}</ul>
          ${missing.length?`<div class="alert info"><span>ℹ️</span><span>Set the <b>cost price</b> for ${missing.map(p=>esc(p.name)).join(", ")} (Settings ⚙), or profit will look higher than it is.</span></div>`:""}
        </div>
        <div class="card"><div class="row between"><h2>Expenses in ${monthName}</h2><button class="btn-primary" id="ovExp2">+ Record</button></div>
          ${(()=>{const g={};F.exps.forEach(e=>{g[e.category]=(g[e.category]||0)+Number(e.amount)});const k=Object.keys(g).sort((a,b)=>g[b]-g[a]);
            return k.length?`<ul class="list">${k.map(c=>row(esc(c),cedi(g[c]))).join("")}${row("Total",cedi(F.expenses),"",{strong:true})}</ul>`:`<p class="empty">No expenses recorded in ${monthName} yet. Tap <b>+ Record</b> to save today's transport and food.</p>`})()}
        </div>
        <div class="card full"><h2>Money in and out in ${monthName}</h2>
          <ul class="list">
            ${row("Handed in by marketers","+ "+cedi(F.received),"money in",{color:"var(--good)"})}
            ${row("Marketers' pay set aside (savings)","+ "+cedi(F.savIn),"money in, held for them",{color:"var(--good)"})}
            ${row("Stock bought","− "+cedi(F.stockBought),"money out · from Stock in costs")}
            ${row("Expenses","− "+cedi(F.expenses),"money out")}
            ${row("Marketers' pay paid out","− "+cedi(F.savOut),"money out")}
            ${row("Net cash movement",cedi(F.received+F.savIn-F.stockBought-F.expenses-F.savOut),"what came in minus what went out",{strong:true})}
          </ul>
          <p class="small muted">Received money is not profit. Profit is worked out above from sales and costs.</p>
        </div>
      </div>`;
  }else if(moneyTab==="transactions"){
    const F=moneyFigures(mf,mt);
    const tx=[
      ...F.sales.map(s=>({k:"sales",d:s.day,c:s.created_at,t:`${esc(mName(s.marketer_id))} sold ${esc(pName(s))} × ${s.qty}`,s:methodLabel(s),v:cedi(s.qty*s.price),col:"",open:()=>saleEdit(s)})),
      ...F.pays.map(p=>({k:"in",d:p.day,c:p.created_at,t:`${esc(mName(p.marketer_id))} handed in money`,s:p.method==="momo"?"MoMo":"Cash",v:"+"+cedi(p.amount),col:"var(--good)",m:Number(p.amount),use:"Handed in by marketers (sales money)",open:()=>paymentDetail(p)})),
      ...F.exps.map(e=>({k:"exp",d:e.day,c:e.created_at,t:esc(e.category),s:esc(e.note||"Expense"),v:"−"+cedi(e.amount),col:"var(--warn)",m:-Number(e.amount),use:e.category||"Other",open:()=>expenseSheet(e)})),
      ...F.savs.map(v=>({k:"sav",d:v.day,c:v.created_at,t:`${esc(mName(v.marketer_id))} ${v.amount<0?"savings paid out":"saved"}`,s:esc(v.note||""),v:(v.amount<0?"−":"+")+cedi(Math.abs(v.amount)),col:v.amount<0?"var(--warn)":"var(--good)",m:Number(v.amount),use:v.amount<0?"Marketers' pay paid out (savings)":"Savings given to you to keep",open:()=>savingDetail(v)})),
      ...S.moves.filter(m=>m.day>=mf&&m.day<=mt).map(mv=>({k:"stock",d:mv.day,c:mv.created_at,t:{in:"Stock in",out:"Given to "+esc(mName(mv.marketer_id)),return:"Returned by "+esc(mName(mv.marketer_id)),adjust:"Count correction"}[mv.kind]+" · "+esc(P(mv.product_id)?.name||"Product"),s:mv.kind==="in"&&mv.unit_cost?`${mv.qty} × ${cedi(mv.unit_cost)} = ${cedi(mv.qty*mv.unit_cost)}`:esc(mv.note||""),v:(mv.kind==="out"?"→ ":mv.kind==="return"?"← ":mv.qty>0?"+":"")+mv.qty+" items",col:"",m:mv.kind==="in"&&mv.unit_cost?-Number(mv.qty)*Number(mv.unit_cost):0,use:"Stock bought",open:()=>moveSheet(mv)})),
      ...massageTx(mf,mt)
    ].map(x=>(txFilter==="out"&&x.m<0)?{...x,t:x.k==="stock"?"Stock bought · "+x.t.split(" · ").slice(1).join(" · "):x.k==="exp"?esc(x.use):x.t,s:(x.k==="exp"?"Used for: ":"")+(x.s||""),v:cedi(x.m),col:"var(--warn)"}:x)
     .filter(x=>txFilter==="all"||(txFilter==="in"?x.m>0:txFilter==="out"?x.m<0:x.k===txFilter)).sort((a,b)=>b.d.localeCompare(a.d)||String(b.c).localeCompare(String(a.c)));
    const groups={};tx.forEach(x=>(groups[x.d]=groups[x.d]||[]).push(x));
    const filters=[["all","All"],["in","Money in"],["out","Money out"],["sales","Sales"],["exp","Expenses"],["stock","Stock"],["sav","Savings"]];
    const tin=tx.filter(x=>x.m>0).reduce((a,x)=>a+x.m,0), tout=-tx.filter(x=>x.m<0).reduce((a,x)=>a+x.m,0);
    const flowCard=(txFilter==="in"||txFilter==="out"||txFilter==="all")?`<div class="grid2">
      ${txFilter!=="out"?`<div class="tile"><b style="color:var(--good)">+${cedi(tin)}</b><span>money in · ${monthName}</span></div>`:""}
      ${txFilter!=="in"?`<div class="tile"><b style="color:var(--warn)">${cedi(-tout)}</b><span>money out · ${monthName}</span></div>`:""}
    </div>${(txFilter==="out"||txFilter==="in")?(()=>{const g={};tx.filter(x=>txFilter==="out"?x.m<0:x.m>0).forEach(x=>{g[x.use]=(g[x.use]||0)+Math.abs(x.m)});const keys=Object.keys(g).sort((a,b)=>g[b]-g[a]);const tot=keys.reduce((a,k)=>a+g[k],0);
      return keys.length?`<div class="card"><h2>${txFilter==="out"?"What the money was used for":"Where the money came from"}</h2><ul class="list">${keys.map(k=>`<li><div class="item"><span class="grow"><span class="t" style="white-space:normal">${esc(k)}</span><span class="bar" style="margin-top:6px"><i style="width:${Math.round(g[k]/tot*100)}%;${txFilter==="out"?"background:var(--warn)":"background:var(--good)"}"></i></span></span><span class="r"><b>${cedi(g[k])}</b><br><span class="small muted">${Math.round(g[k]/tot*100)}%</span></span></div></li>`).join("")}</ul>
        <p class="small muted">${txFilter==="out"?"Money out = expenses, stock you bought (from Stock in costs) and savings paid out. Each entry below says what it was for.":"Money in = money handed in by marketers and savings they gave you to keep."}</p></div>`:""})():""}`:"";
    body=`<div class="row between"><p class="muted">${monthName} · ${tx.length} entr${tx.length===1?"y":"ies"}</p><button class="btn-primary" id="txExp">+ Expenses</button></div>
      <div class="chips">${filters.map(([k,l])=>`<button class="chip" data-chip="txf" data-v="${k}" aria-pressed="${txFilter===k}">${l}</button>`).join("")}</div>
      ${flowCard}
      ${tx.length?Object.keys(groups).map(d=>`<div class="card" style="padding:4px 16px"><div class="eyebrow" style="padding-top:12px">${fmtDay(d,{weekday:"long",day:"numeric",month:"short"})}</div><ul class="list">${groups[d].map((x,i)=>`<li><button class="item" data-tx="${d}|${i}"><span class="grow"><span class="t">${x.t}</span>${x.s?`<span class="s">${x.s}</span>`:""}</span><span class="r" style="${x.col?"color:"+x.col:""}"><b>${x.v}</b></span></button></li>`).join("")}</ul></div>`).join(""):`<div class="card"><p class="empty">Nothing recorded in ${monthName}${txFilter!=="all"?" for this filter":""}.</p>${(txFilter==="exp"||txFilter==="out")?`<button class="btn-primary" id="txExp2">Record today's expenses</button>`:""}</div>`}
      <p class="small muted">Tap any entry to change or delete it. Change the date at the top to see another month.</p>`;
    r.innerHTML=`<div class="seg">${tabs.map(([k,l])=>`<button data-seg="mt" data-v="${k}" aria-pressed="${moneyTab===k}">${l}</button>`).join("")}</div>${body}`;
    r.querySelectorAll("[data-tx]").forEach(b=>{const [d,i]=b.dataset.tx.split("|");b.onclick=()=>groups[d][Number(i)].open()});
    wireChips(r,"txf",v=>{txFilter=v;renderMoney()});
    $("txExp").onclick=()=>dailyExpenseSheet();
    $("txExp2")&&($("txExp2").onclick=()=>dailyExpenseSheet());
    wireSeg(r,"mt",v=>{moneyTab=v;renderMoney()});
    return;
  }else if(moneyTab==="people"){
    const ms=S.marketers.map(m=>({m,...moneyOf(m.id),units:holdingsOf(m.id).reduce((a,x)=>a+x.n,0)})).filter(x=>!x.m.removed_at||Math.abs(x.owes)>0.009||x.credit>0.009||x.saved>0.009||x.units).sort((a,b)=>b.owes-a.owes);
    const list=unpaidCredit(), today=todayISO();
    body=`<div class="wide">
      <div class="card"><div class="row between"><h2>Marketers</h2><button class="btn-primary" id="mnPay">Receive money</button></div>
        ${ms.length?`<ul class="list">${ms.map(x=>`<li><button class="item" data-open-m="${x.m.id}"><span class="avatar">${esc(initials(x.m.name))}</span><span class="grow"><span class="t">${esc(x.m.name)}${removedPill(x.m)}</span>
          <span class="row" style="gap:6px;margin-top:4px">${x.owes>0.009?`<span class="pill warn">cash to hand in ${cedi(x.owes)}</span>`:x.owes<-0.009?`<span class="pill good">paid ahead ${cedi(-x.owes)}</span>`:`<span class="pill good">settled</span>`}${x.credit>0.009?`<span class="pill">customers owe ${cedi(x.credit)}</span>`:""}${x.units?`<span class="pill">holding ${x.units}</span>`:""}</span></span><span class="r muted">›</span></button></li>`).join("")}</ul>`:`<p class="empty">No marketers yet.</p>`}
        <p class="small muted">Tap a marketer for their full settlement and history.</p>
      </div>
      <div class="card"><div><h2>Customers who owe you</h2><span class="small muted">Pay-later sales · ${cedi(list.reduce((t,s)=>t+s.qty*s.price,0))} in total</span></div>
        ${list.length?`<ul class="list">${list.map(s=>{const late=s.due_date&&s.due_date<today, dueToday=s.due_date===today;return `<li><button class="item" data-credit="${s.id}"><span class="grow"><span class="t">${esc(s.customer||"Customer")}</span><span class="s">${esc(pName(s))} × ${s.qty} · sold ${fmtDay(s.day)} by ${esc(mName(s.marketer_id))}</span>
          ${s.due_date?`<span class="row" style="gap:6px;margin-top:4px"><span class="pill ${late?"warn":dueToday?"good":""}">${late?"late, was due ":dueToday?"due today, ":"due "}${fmtDay(s.due_date,{weekday:"short",day:"numeric",month:"short"})}</span></span>`:""}</span>
          <span class="r"><b>${cedi(s.qty*s.price)}</b><br><span class="small muted">Mark paid</span></span></button></li>`}).join("")}</ul>`:`<p class="empty">No customer owes you. Choose <b>Pay later</b> when you record a sale on credit.</p>`}
      </div></div>`;
  }else if(moneyTab==="savings"){
    const rows=S.marketers.map(m=>({m,s:moneyOf(m.id).saved})).filter(x=>Math.abs(x.s)>0.009).sort((a,b)=>b.s-a.s);
    const total=rows.reduce((t,x)=>t+x.s,0);
    const recent=S.savings.slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,15);
    body=`<div class="wide"><div class="card"><div class="row between"><div><div class="money-big">${cedi(total)}</div><span class="small muted">marketers' pay (savings) you're holding</span></div><div class="row"><button class="btn-primary" id="svAdd">Add savings</button><button id="svOut">Pay out</button></div></div>
      ${rows.length?`<ul class="list">${rows.map(x=>`<li><button class="item" data-open-m="${x.m.id}"><span class="avatar">${esc(initials(x.m.name))}</span><span class="grow"><span class="t">${esc(x.m.name)}${removedPill(x.m)}</span></span><span class="r"><b>${cedi(x.s)}</b></span></button></li>`).join("")}</ul>`:`<p class="empty">No savings yet.</p>`}
      <p class="small muted">This is your marketers' pay. It belongs to them, so pay it out with Pay out when they collect it.</p></div>
      <div class="card"><h2>Recent savings entries</h2>${recent.length?`<ul class="list">${recent.map(v=>`<li><button class="item" data-sav="${v.id}"><span class="grow"><span class="t">${esc(mName(v.marketer_id))}</span><span class="s">${fmtDay(v.day)}${v.note?" · "+esc(v.note):""}</span></span><span class="r" style="color:${v.amount<0?"var(--warn)":"var(--good)"}"><b>${v.amount<0?"−":"+"}${cedi(Math.abs(v.amount))}</b></span></button></li>`).join("")}</ul>`:`<p class="empty">None in these months.</p>`}</div></div>`;
  }else{
    const [f,t]=period(reportPeriod), F=moneyFigures(f,t), rows=F.sales;
    const agg=S.marketers.map(m=>{const r=rows.filter(s=>s.marketer_id===m.id);return{m,u:sumQty(r),v:sumVal(r),pr:sumVal(r)-sumCost(r),d:new Set(r.map(s=>s.day)).size,p:F.pays.filter(p=>p.marketer_id===m.id).reduce((a,p)=>a+Number(p.amount),0),sv:F.savs.filter(v=>v.marketer_id===m.id&&v.amount>0).reduce((a,v)=>a+Number(v.amount),0)}}).filter(x=>x.u||x.p||x.sv).sort((a,b)=>b.u-a.u);
    const byP={};rows.forEach(s=>{const k=pName(s);byP[k]=byP[k]||{u:0,v:0,pr:0};byP[k].u+=Number(s.qty);byP[k].v+=s.qty*s.price;byP[k].pr+=s.qty*(s.price-unitCost(s))});
    const pk=Object.keys(byP).sort((a,b)=>byP[b].u-byP[a].u);
    const byC={};F.exps.forEach(e=>{byC[e.category]=(byC[e.category]||0)+Number(e.amount)});
    body=`<div class="seg"><button data-seg="rp" data-v="today" aria-pressed="${reportPeriod==="today"}">Day</button><button data-seg="rp" data-v="week" aria-pressed="${reportPeriod==="week"}">Week</button><button data-seg="rp" data-v="month" aria-pressed="${reportPeriod==="month"}">Month</button></div>
      <p class="muted">${f===t?fmtDay(f,{weekday:"long",day:"numeric",month:"long"}):fmtDay(f)+" – "+fmtDay(t,{day:"numeric",month:"short",year:"numeric"})}</p>
      <div class="wide">
      <div class="card"><h2>Profit</h2><ul class="list">
        ${row("Sales",cedi(F.revenue),sumQty(rows)+" items")}
        ${row("Massage money in","+ "+cedi(F.massageIn))}
        ${row("Cost of items sold","− "+cedi(F.cost))}
        ${row("Massage kit used","− "+cedi(F.massageKit))}
        ${row("Gross profit",cedi(F.gross),"sales − cost",{strong:true})}
        ${row("Expenses","− "+cedi(F.expenses))}
        ${row("Profit after expenses",cedi(F.net),"gross profit − expenses",{strong:true,color:F.net>=0?"var(--good)":"var(--bad)"})}
      </ul>
      <h2 style="margin-top:14px">How the profit is shared</h2><ul class="list">${splitRows(F)}</ul></div>
      <div class="card"><h2>Expenses</h2>${Object.keys(byC).length?`<ul class="list">${Object.keys(byC).sort((a,b)=>byC[b]-byC[a]).map(c=>row(esc(c),cedi(byC[c]))).join("")}</ul>`:`<p class="empty">No expenses in this period.</p>`}</div>
      <div class="card full"><h2>By marketer</h2><div class="tbl"><table><thead><tr><th>Marketer</th><th class="r">Items</th><th class="r">Days</th><th class="r">Sales</th><th class="r">Profit</th><th class="r">Handed in</th><th class="r">Their pay</th></tr></thead>
        <tbody>${agg.length?agg.map(x=>`<tr><td>${esc(x.m.name)}</td><td class="r">${x.u}</td><td class="r">${x.d}</td><td class="r">${cedi(x.v)}</td><td class="r">${cedi(x.pr)}</td><td class="r">${cedi(x.p)}</td><td class="r">${cedi(x.sv)}</td></tr>`).join(""):`<tr><td colspan="7" class="empty">No sales in this period.</td></tr>`}</tbody>
        ${agg.length?`<tfoot><tr><th>Total</th><th class="r">${sumQty(rows)}</th><th></th><th class="r">${cedi(F.revenue)}</th><th class="r">${cedi(F.gross)}</th><th class="r">${cedi(F.received)}</th><th class="r">${cedi(F.mpay)}</th></tr></tfoot>`:""}</table></div></div>
      <div class="card full"><h2>By product</h2><div class="tbl"><table><thead><tr><th>Product</th><th class="r">Sold</th><th class="r">Sales</th><th class="r">Cost</th><th class="r">Profit</th><th class="r">Margin</th></tr></thead><tbody>${pk.length?pk.map(k=>`<tr><td>${esc(k)}</td><td class="r">${byP[k].u}</td><td class="r">${cedi(byP[k].v)}</td><td class="r">${cedi(byP[k].v-byP[k].pr)}</td><td class="r">${cedi(byP[k].pr)}</td><td class="r">${byP[k].v?Math.round(byP[k].pr/byP[k].v*100):0}%</td></tr>`).join(""):`<tr><td colspan="6" class="empty">Nothing sold.</td></tr>`}</tbody>
        ${pk.length?`<tfoot><tr><th>Total</th><th class="r">${sumQty(rows)}</th><th class="r">${cedi(F.revenue)}</th><th class="r">${cedi(F.cost)}</th><th class="r">${cedi(F.gross)}</th><th class="r">${F.revenue?Math.round(F.gross/F.revenue*100):0}%</th></tr></tfoot>`:""}</table></div></div>
      ${recordCards(reportPeriod)}
      </div>
      </div>`;
  }
  r.innerHTML=`<div class="seg">${tabs.map(([k,l])=>`<button data-seg="mt" data-v="${k}" aria-pressed="${moneyTab===k}">${l}</button>`).join("")}</div>${body}`;
  wireSeg(r,"mt",v=>{moneyTab=v;renderMoney()});
  wireSeg(r,"rp",v=>{reportPeriod=v;renderMoney()});
  $("ovRev")&&($("ovRev").onclick=()=>revenueSheet());
  $("ovPay")&&($("ovPay").onclick=()=>paymentSheet());
  $("ovExp")&&($("ovExp").onclick=()=>dailyExpenseSheet());
  $("ovExp2")&&($("ovExp2").onclick=()=>dailyExpenseSheet());
  $("ovCust")&&($("ovCust").onclick=()=>{moneyTab="people";renderMoney()});
  $("ovOwe")&&($("ovOwe").onclick=()=>owingSheet());
  $("mnPay")&&($("mnPay").onclick=()=>paymentSheet());
  $("svAdd")&&($("svAdd").onclick=()=>savingsSheet(null,false));
  $("svOut")&&($("svOut").onclick=()=>savingsSheet(null,true));
  r.querySelectorAll("[data-credit]").forEach(b=>b.onclick=()=>creditPaidSheet(unpaidCredit().find(s=>String(s.id)===b.dataset.credit)));
  r.querySelectorAll("[data-open-m]").forEach(b=>b.onclick=()=>marketerPage(b.dataset.openM));
  r.querySelectorAll("[data-sav]").forEach(b=>b.onclick=()=>savingDetail(S.savings.find(x=>String(x.id)===b.dataset.sav)));
}

function creditPaidSheet(s){
  let method="cash";
  openSheet("Customer paid?",`
    <p><b>${esc(s.customer||"Customer")}</b> owes <b>${cedi(s.qty*s.price)}</b> for ${esc(pName(s))} × ${s.qty}, sold ${fmtDay(s.day,{day:"numeric",month:"long"})}${s.due_date?`, promised for ${fmtDay(s.due_date,{weekday:"long",day:"numeric",month:"long"})}`:""}.</p>
    <span style="font-weight:700;font-size:.9rem">Paid by</span>
    <div class="seg"><button type="button" data-seg="cp" data-v="cash" aria-pressed="true">Cash</button><button type="button" data-seg="cp" data-v="momo" aria-pressed="false">MoMo</button></div>
    <button class="btn-primary btn-block" id="cpBtn">Mark as paid</button>
    <button class="btn-ghost btn-block" id="cpEdit">Edit this sale</button>
    <p class="small muted">Once paid, the money counts with ${esc(mName(s.marketer_id))}'s sales, to be handed in as usual.</p>`,root=>{
    wireSeg(root,"cp",v=>method=v);
    $("cpBtn").onclick=()=>run($("cpBtn"),"mark the sale as paid",()=>upd("sales",s.id,{method,paid_at:new Date().toISOString()}),`${s.customer||"Customer"} paid`);
    $("cpEdit").onclick=()=>saleEdit(s);
  });
}

/* =================== SETTINGS =================== */
let installEvt=null;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installEvt=e});
const isStandalone=()=>matchMedia("(display-mode: standalone)").matches||navigator.standalone;
function settingsSheet(){
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);
  openSheet("Settings",`
    <div><div class="row between"><h3>Products and prices</h3><button class="btn-primary" id="stAddP">+ Product</button></div>
    <ul class="list">${S.products.map(p=>`<li><button class="item" data-pe="${p.id}"><span class="grow"><span class="t">${esc(p.name)} ${p.active===false?'<span class="pill off">paused</span>':""}</span><span class="s">Sell ${cedi(p.price)} · Cost ${Number(p.cost)?cedi(p.cost):"not set"}</span><span class="s">${esc(marginText(p.price,p.cost))}</span></span><span class="r muted">Edit ›</span></button></li>`).join("")}</ul></div>
    <div class="stack"><h3>Targets</h3>
      <label class="f">Daily target (items)<input id="stT" type="number" min="1" value="${S.settings?.target??5}"></label>
      <p class="small muted">Marketers' pay is their savings: whatever they save with you is what you pay them.</p>
      <button id="stSave">Save target</button></div>
    <div class="stack"><h3>Install on this phone</h3>
      ${isStandalone()?`<p class="muted">Installed. You're using the app.</p>`:installEvt?`<button class="btn-primary" id="stInstall">Install MOZLYT Inventory</button>`:ios?`<p class="muted">In Safari, tap the <b>Share</b> button, then <b>Add to Home Screen</b>.</p>`:`<p class="muted">Open the browser menu (⋮) and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>`}</div>
    <div class="stack"><h3>Account</h3><p class="muted">Signed in as <b>${esc(me?.email||"owner")}</b></p><button class="btn-ghost" id="stOut">Sign out</button></div>`,()=>{
    $("stAddP").onclick=()=>productForm();
    document.querySelectorAll("[data-pe]").forEach(b=>b.onclick=()=>productForm(P(b.dataset.pe)));
    $("stSave").onclick=()=>run($("stSave"),"save the settings",()=>api("/settings?on_conflict=id",{method:"POST",prefer:"resolution=merge-duplicates,return=minimal",body:{id:1,target:Number($("stT").value)||5,pay:0}}),"Saved");
    $("stInstall")&&($("stInstall").onclick=async()=>{installEvt.prompt();await installEvt.userChoice;installEvt=null;closeSheet()});
    $("stOut").onclick=signOut;
  });
}
function productForm(p){
  openSheet(p?"Edit product":"Add a product",`
    <label class="f">Name<input id="pfN" value="${esc(p?.name)}" placeholder="e.g. Massage gun"></label>
    <div class="grid2"><label class="f">Selling price (GH₵)<input id="pfP" type="number" min="0" step="0.5" inputmode="decimal" value="${p?Number(p.price):""}"></label>
    <label class="f">Your cost (GH₵)<input id="pfC" type="number" min="0" step="0.5" inputmode="decimal" value="${p&&Number(p.cost)?Number(p.cost):""}" placeholder="what you paid"></label></div>
    <p class="small" id="pfMargin" style="font-weight:700"></p>
    <label class="f">Warn me when stock is at or below<input id="pfL" type="number" min="0" step="1" value="${p?.low_stock??5}"></label>
    <button class="btn-primary btn-block" id="pfSave">${p?"Save changes":"Add product"}</button>
    ${p?`<button class="btn-ghost btn-block" id="pfPause">${p.active===false?"Resume this product":"Pause this product"}</button>`:""}
    <p class="small muted">Margin = profit as a share of the selling price. Markup = profit as a share of your cost. A new Stock in with a different cost updates the cost here. Changing a price doesn't change sales already recorded, except sales saved with no cost, which take this cost.</p>`,()=>{
    const mg=()=>{$("pfMargin").textContent=$("pfP").value?marginText($("pfP").value,$("pfC").value):""};$("pfP").oninput=mg;$("pfC").oninput=mg;mg();
    $("pfSave").onclick=()=>{const name=$("pfN").value.trim(),price=Number($("pfP").value);if(!name||!(price>=0)||$("pfP").value===""){toast("Enter a name and selling price.",true);return}
      const row={name,price,cost:Number($("pfC").value)||0,low_stock:Number($("pfL").value)||0};
      if(p) run($("pfSave"),"save the product",async()=>{await upd("products",p.id,row);if(row.cost>0)await api(`/sales?product_id=eq.${enc(p.id)}&cost=eq.0`,{method:"PATCH",prefer:"return=minimal",body:{cost:row.cost}})},"Saved");
      else run($("pfSave"),"add the product",()=>ins("products",{id:newId(),no:S.products.reduce((a,x)=>Math.max(a,x.no||0),0)+1,...row,active:true}),"Product added");
    };
    if(p) $("pfPause").onclick=()=>run($("pfPause"),"change the product",()=>upd("products",p.id,{active:p.active===false}),"Saved");
  });
}

/* =================== MASSAGE: sessions, kits, therapists =================== */
let sesFilter="open", teamTab="marketers";
const num=x=>Number(x)||0;
const SRC=[["direct","Direct"],["platform","Booking platform"],["personal","Personal selling"]];
const SRC_NAME=Object.fromEntries(SRC);
const svcById=id=>(S.services||[]).find(s=>s.id===id);
const kitById=id=>(S.kitItems||[]).find(k=>k.id===id);
const bookingById=id=>(S.bookings||[]).find(b=>String(b.id)===String(id));
const therapistById=id=>(S.therapists||[]).find(t=>t.id===id);
const therapistName=id=>therapistById(id)?.name||"No therapist chosen";
const liveTherapists=()=>(S.therapists||[]).filter(t=>!t.removed_at&&t.active!==false).sort((a,b)=>num(a.no)-num(b.no));
const recipeOf=sid=>(S.serviceKit||[]).filter(r=>r.service_id===sid).map(r=>({item:kitById(r.kit_item_id),qty:num(r.qty)})).filter(r=>r.item);
const paidOf=bid=>(S.bookingPayments||[]).filter(p=>String(p.booking_id)===String(bid)).reduce((t,p)=>t+num(p.amount),0);
const balanceOf=b=>Math.max(0,num(b.price)-paidOf(b.id));
const deliveriesOf=bid=>(S.deliveries||[]).filter(d=>String(d.booking_id)===String(bid)).sort((a,b)=>a.session_no-b.session_no);
const kitStockOf=iid=>(S.kitMoves||[]).filter(m=>m.kit_item_id===iid).reduce((t,m)=>t+(m.kind==="issue"?-num(m.qty):num(m.qty)),0);
const kitIssuedOn=bid=>(S.kitMoves||[]).filter(m=>String(m.booking_id)===String(bid)&&m.kind==="issue");
const inRange=(x,f,t)=>x.day>=f&&x.day<=t;
const massageIn=(f,t)=>(S.bookingPayments||[]).filter(p=>inRange(p,f,t)).reduce((a,p)=>a+num(p.amount),0);
const massageKit=(f,t)=>(S.kitMoves||[]).filter(m=>m.kind==="issue"&&inRange(m,f,t)).reduce((a,m)=>a+num(m.qty)*num(m.unit_cost),0);
const therapistPaid=(f,t)=>(S.therapistPay||[]).filter(p=>inRange(p,f,t)).reduce((a,p)=>a+num(p.amount),0);
const owedThisMonth=th=>{const [f,t]=period("month");const paid=(S.therapistPay||[]).filter(p=>p.therapist_id===th.id&&inRange(p,f,t)).reduce((a,p)=>a+num(p.amount),0);return Math.max(0,num(th.monthly_pay)-paid)};
const srcPill=s=>`<span class="pill">${esc(SRC_NAME[s]||s||"Direct")}</span>`;
const bookingLine=b=>`${esc(b.service_name)} · ${esc(b.customer||"No name")}`;

function massageTx(f,t){
  const out=[];
  (S.bookingPayments||[]).filter(p=>inRange(p,f,t)).forEach(p=>{const b=bookingById(p.booking_id);out.push({k:"in",d:p.day,c:p.created_at,t:`${b?bookingLine(b):"Booking"} · ${p.kind==="deposit"?"deposit":"payment"}`,s:p.method==="momo"?"MoMo":"Cash",v:"+"+cedi(p.amount),col:"var(--good)",m:num(p.amount),use:"Massage bookings",open:()=>b&&bookingDetail(b)})});
  (S.kitMoves||[]).filter(m=>m.kind==="issue"&&inRange(m,f,t)).forEach(m=>{const k=kitById(m.kit_item_id);out.push({k:"stock",d:m.day,c:m.created_at,t:`Kit used · ${esc(k?.name||"Kit item")}`,s:`${num(m.qty)} × ${cedi(m.unit_cost)}`,v:cedi(-num(m.qty)*num(m.unit_cost)),col:"var(--warn)",m:-num(m.qty)*num(m.unit_cost),use:"Massage kit used",open:()=>{}})});
  (S.therapistPay||[]).filter(p=>inRange(p,f,t)).forEach(p=>out.push({k:"exp",d:p.day,c:p.created_at,t:`Therapist pay · ${esc(therapistName(p.therapist_id))}`,s:esc(p.note||"Monthly pay"),v:"−"+cedi(p.amount),col:"var(--warn)",m:-num(p.amount),use:"Therapist pay (from personal share)",open:()=>{}}));
  return out;
}

/* ---- loading ---- */
async function loadMassage(){
  const [svc,kit,skit,kmv,th,bk,dl,bp,tp]=await Promise.all([
    api("/services?select=*&order=sort.asc"),api("/kit_items?select=*&order=name.asc"),api("/service_kit?select=*"),
    api("/kit_moves?select=*&order=created_at.desc"),api("/therapists?select=*&order=no.asc"),
    api("/bookings?select=*&order=created_at.desc"),api("/deliveries?select=*&order=created_at.desc"),
    api("/booking_payments?select=*&order=created_at.desc"),api("/therapist_pay?select=*&order=created_at.desc")]);
  const sf=await api("/stock_funds?select=*&order=created_at.desc");
  Object.assign(S,{services:svc||[],kitItems:kit||[],serviceKit:skit||[],kitMoves:kmv||[],therapists:th||[],bookings:bk||[],deliveries:dl||[],bookingPayments:bp||[],therapistPay:tp||[],stockFunds:(sf||[]).filter(x=>String(x.day||"")>=RECORD_START)});
}

/* ---- sessions screen ---- */
function renderSessions(){
  const r=$("scr-sessions");
  const [f,t]=period("month"), monthName=fmtDay(day,{month:"long"});
  const delivered=(S.deliveries||[]).filter(d=>inRange(d,f,t)).length;
  const toDo=(S.bookings||[]).filter(b=>b.status==="open").length;
  const owed=(S.bookings||[]).filter(b=>b.status!=="cancelled").reduce((a,b)=>a+balanceOf(b),0);
  const kitCost=massageKit(f,t);
  const list=(S.bookings||[]).filter(b=>sesFilter==="all"||(sesFilter==="open"&&b.status==="open")||(sesFilter==="owed"&&b.status!=="cancelled"&&balanceOf(b)>0)||(sesFilter==="done"&&b.status==="done")).slice(0,150);
  r.innerHTML=`
    <div class="grid2 kpis">
      <div class="tile"><b>${delivered}</b><span>sessions delivered · ${monthName}</span></div>
      <div class="tile"><b>${toDo}</b><span>booked, not yet delivered</span></div>
      <div class="tile"><b>${cedi(massageIn(f,t))}</b><span>money in · ${monthName}</span></div>
      <div class="tile"><b>${cedi(owed)}</b><span>still owed by clients</span></div>
    </div>
    <button class="btn-primary btn-block" id="sesNew" style="min-height:54px">+ New booking</button>
    <div class="seg" style="margin:12px 0"><button data-seg="ses" data-v="open" aria-pressed="${sesFilter==="open"}">To deliver</button><button data-seg="ses" data-v="owed" aria-pressed="${sesFilter==="owed"}">Still owed</button><button data-seg="ses" data-v="done" aria-pressed="${sesFilter==="done"}">Done</button><button data-seg="ses" data-v="all" aria-pressed="${sesFilter==="all"}">All</button></div>
    <div class="wide">
      ${list.map(b=>{const paid=paidOf(b.id),bal=balanceOf(b),left=num(b.sessions_total)-num(b.sessions_used);const cancelled=b.status==="cancelled";return `
      <div class="card">
        <button class="item" data-bkopen="${b.id}" style="padding:0;width:100%">
          <span class="grow"><span class="t">${esc(b.service_name)} ${srcPill(b.source)} ${cancelled?'<span class="pill off">cancelled</span>':b.status==="done"?'<span class="pill good">all delivered</span>':""}</span>
          <span class="s">${esc(b.customer||"No name")} · booked ${fmtDay(b.day)}</span>
          <span class="s">${num(b.sessions_used)} of ${num(b.sessions_total)} session${num(b.sessions_total)===1?"":"s"} delivered · ${esc(therapistName(b.therapist_id))}</span>
          <span class="s">paid ${cedi(paid)} · ${bal>0?`<span style="color:var(--warn)">owes ${cedi(bal)}</span>`:`<span style="color:var(--good)">fully paid</span>`}</span></span>
          <span class="r"><b>${cedi(b.price)}</b></span>
        </button>
        ${!cancelled&&b.status==="open"&&left>0||(!cancelled&&bal>0)?`<div class="grid2" style="margin-top:10px">
          ${b.status==="open"&&left>0?`<button class="btn-primary" data-deliver="${b.id}">Deliver session</button>`:"<span></span>"}
          ${bal>0?`<button data-pay="${b.id}">Take payment</button>`:"<span></span>"}
        </div>`:""}
      </div>`}).join("")||`<div class="card"><p class="empty">${sesFilter==="open"?"Nothing waiting to be delivered. Tap + New booking.":"No bookings here yet."}</p></div>`}
    </div>
    <p class="small muted">Kit used this month: ${cedi(kitCost)}. It is counted when a session is delivered, and a plan's kit is counted on its first session.</p>`;
  wireSeg(r,"ses",v=>{sesFilter=v;renderSessions()});
  $("sesNew").onclick=()=>bookingForm();
  r.querySelectorAll("[data-bkopen]").forEach(b=>b.onclick=()=>bookingDetail(bookingById(b.dataset.bkopen)));
  r.querySelectorAll("[data-deliver]").forEach(b=>b.onclick=()=>deliverSheet(bookingById(b.dataset.deliver)));
  r.querySelectorAll("[data-pay]").forEach(b=>b.onclick=()=>paySheet(bookingById(b.dataset.pay)));
}

function bookingForm(){
  const svcs=(S.services||[]).filter(s=>s.active!==false).sort((a,b)=>num(a.sort)-num(b.sort));
  if(!svcs.length){toast("Add a service first, in Stock.",true);return}
  let src="direct";
  openSheet("New booking",`
    <label class="f">Service<select id="bkSvc">${svcs.map(s=>`<option value="${esc(s.id)}">${esc(s.name)} · ${cedi(s.price)}</option>`).join("")}</select></label>
    <label class="f">Booking date<input id="bkDay" type="date" value="${day}"></label>
    <label class="f">Client name<input id="bkName" placeholder="e.g. Ama K."></label>
    <label class="f">Client phone (optional)<input id="bkPhone" inputmode="tel"></label>
    <div><span style="font-weight:700;font-size:.9rem">Where did the booking come from?</span><div class="chips" style="margin-top:6px">${SRC.map(([k,l])=>`<button type="button" class="chip" data-chip="bksrc" data-v="${k}" aria-pressed="${k==="direct"}">${l}</button>`).join("")}</div></div>
    <label class="f">Price agreed (GH₵)<input id="bkPrice" type="number" min="0" step="1" inputmode="decimal" value="${num(svcs[0].price)}"></label>
    <label class="f">Deposit paid now (GH₵, 0 for none)<input id="bkDep" type="number" min="0" step="1" inputmode="decimal" value="0"></label>
    <div><span style="font-weight:700;font-size:.9rem">How was the deposit paid?</span><div class="chips" style="margin-top:6px"><button type="button" class="chip" data-chip="bkmeth" data-v="cash" aria-pressed="true">Cash</button><button type="button" class="chip" data-chip="bkmeth" data-v="momo" aria-pressed="false">MoMo</button></div></div>
    <label class="f">Therapist (optional)<select id="bkTher"><option value="">Not chosen yet</option>${liveTherapists().map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></label>
    <label class="f">Note (optional)<input id="bkNote"></label>
    <button class="btn-primary btn-block" id="bkBtn">Save booking</button>`,root=>{
    let meth="cash";
    $("bkSvc").onchange=e=>{const s=svcById(e.target.value);$("bkPrice").value=num(s?.price)};
    wireChips(root,"bksrc",v=>src=v);
    wireChips(root,"bkmeth",v=>meth=v);
    $("bkBtn").onclick=()=>{
      const s=svcById($("bkSvc").value), price=num($("bkPrice").value), dep=num($("bkDep").value);
      if(!s) return;
      if(!$("bkName").value.trim()){toast("Enter the client's name.",true);return}
      if($("bkPrice").value===""||price<0){toast("Enter the price agreed.",true);return}
      if(dep<0||dep>price){toast("The deposit cannot be more than the price.",true);return}
      const row={day:$("bkDay").value||day,service_id:s.id,service_name:s.name,kind:s.kind,customer:$("bkName").value.trim(),phone:$("bkPhone").value.trim(),price,source:src,therapist_id:$("bkTher").value||null,sessions_total:num(s.sessions)||1,sessions_used:0,status:"open",note:$("bkNote").value.trim()};
      run($("bkBtn"),"save the booking",async()=>{
        const [b]=await api("/bookings",{method:"POST",prefer:"return=representation",body:row});
        if(dep>0) await ins("booking_payments",{day:row.day,booking_id:b.id,amount:dep,kind:"deposit",method:meth,note:"Deposit"});
      },"Booking saved");
    };
  });
}

function deliverSheet(b){
  if(!b) return;
  const n=num(b.sessions_used)+1;
  if(n>num(b.sessions_total)){toast("All sessions for this booking are already delivered.",true);return}
  const recipe=recipeOf(b.service_id);
  const first=n===1;
  const kitTotal=recipe.reduce((t,r)=>t+r.qty*num(r.item.cost),0);
  openSheet(`Deliver session ${n} of ${num(b.sessions_total)}`,`
    <p class="muted">${bookingLine(b)}</p>
    <label class="f">Date delivered<input id="dvDay" type="date" value="${day}"></label>
    <label class="f">Therapist<select id="dvTher"><option value="">Not chosen</option>${liveTherapists().map(t=>`<option value="${t.id}" ${t.id===b.therapist_id?"selected":""}>${esc(t.name)}</option>`).join("")}</select></label>
    <div class="card" style="padding:12px 14px"><b>Kit used</b>
      ${!first?`<p class="small muted">Nothing is taken from stock for this session. The kit was given out on session 1 and stays with the client.</p>`
        :recipe.length?`<p class="small muted">Taken from stock now. Kit given out is not taken back, so it counts as this booking's cost.</p>
          ${recipe.map(r=>`<div class="row between"><span>${esc(r.item.name)} × ${r.qty}${kitStockOf(r.item.id)<r.qty?` <span class="pill warn">not enough in stock</span>`:""}</span><span>${cedi(r.qty*num(r.item.cost))}</span></div>`).join("")}
          <div class="row between"><b>Kit cost</b><b>${cedi(kitTotal)}</b></div>`
        :`<p class="small muted">No kit is set up for this service yet. Set it in Stock, under Services.</p>`}
    </div>
    <label class="f">Note (optional)<input id="dvNote"></label>
    <button class="btn-primary btn-block" id="dvBtn">Confirm delivery</button>`,root=>{
    $("dvBtn").onclick=()=>run($("dvBtn"),"record the delivery",async()=>{
      const d={day:$("dvDay").value||day,booking_id:b.id,session_no:n,therapist_id:$("dvTher").value||null,note:$("dvNote").value.trim()};
      await ins("deliveries",d);
      if(first&&recipe.length) await ins("kit_moves",recipe.map(r=>({day:d.day,kit_item_id:r.item.id,kind:"issue",qty:r.qty,unit_cost:num(r.item.cost),booking_id:b.id,note:"Kit for "+b.service_name})));
      await upd("bookings",b.id,{sessions_used:n,status:n>=num(b.sessions_total)?"done":"open",therapist_id:b.therapist_id||d.therapist_id});
    },"Session "+n+" delivered");
  });
}

function paySheet(b){
  if(!b) return;
  const bal=balanceOf(b);
  openSheet("Take payment",`
    <p class="muted">${bookingLine(b)} · price ${cedi(b.price)} · still owed <b>${cedi(bal)}</b></p>
    <label class="f">Amount (GH₵)<input id="pyAmt" type="number" min="0" step="1" inputmode="decimal" value="${bal}"></label>
    <div><span style="font-weight:700;font-size:.9rem">What is it?</span><div class="chips" style="margin-top:6px"><button type="button" class="chip" data-chip="pykind" data-v="deposit" aria-pressed="false">Deposit</button><button type="button" class="chip" data-chip="pykind" data-v="payment" aria-pressed="true">Payment</button></div></div>
    <div><span style="font-weight:700;font-size:.9rem">How was it paid?</span><div class="chips" style="margin-top:6px"><button type="button" class="chip" data-chip="pymeth" data-v="cash" aria-pressed="true">Cash</button><button type="button" class="chip" data-chip="pymeth" data-v="momo" aria-pressed="false">MoMo</button></div></div>
    <label class="f">Note (optional)<input id="pyNote"></label>
    <button class="btn-primary btn-block" id="pyBtn">Save payment</button>`,root=>{
    let kind="payment",meth="cash";
    wireChips(root,"pykind",v=>kind=v);wireChips(root,"pymeth",v=>meth=v);
    $("pyBtn").onclick=()=>{
      const a=num($("pyAmt").value);
      if(!(a>0)){toast("Enter the amount.",true);return}
      if(a>balanceOf(b)){toast("That is more than the amount still owed.",true);return}
      run($("pyBtn"),"save the payment",()=>ins("booking_payments",{day,booking_id:b.id,amount:a,kind,method:meth,note:$("pyNote").value.trim()}),"Payment saved");
    };
  });
}

function bookingDetail(b){
  if(!b) return;
  const paid=paidOf(b.id), bal=balanceOf(b), dl=deliveriesOf(b.id), pays=(S.bookingPayments||[]).filter(p=>String(p.booking_id)===String(b.id)).sort((a,c)=>String(c.created_at).localeCompare(String(a.created_at)));
  const kit=kitIssuedOn(b.id);
  const canDeliver=b.status==="open"&&num(b.sessions_used)<num(b.sessions_total);
  const canCancel=b.status!=="cancelled"&&dl.length===0&&pays.length===0;
  openSheet(b.service_name,`
    <ul class="list">
      ${row("Client",esc(b.customer||"No name")+(b.phone?` · ${esc(b.phone)}`:""))}
      ${row("Booked",fmtDay(b.day,{weekday:"short",day:"numeric",month:"short",year:"numeric"}))}
      ${row("Where it came from",esc(SRC_NAME[b.source]||b.source))}
      ${row("Therapist",esc(therapistName(b.therapist_id)))}
      ${row("Price",cedi(b.price),b.kind==="plan"?"one payment for the whole plan":"")}
      ${row("Paid so far",cedi(paid))}
      ${row("Still owed",cedi(bal),"",{strong:true,color:bal>0?"var(--warn)":"var(--good)"})}
      ${row("Sessions",`${num(b.sessions_used)} of ${num(b.sessions_total)} delivered`)}
    </ul>
    ${b.note?`<p class="muted">${esc(b.note)}</p>`:""}
    <div class="card" style="padding:4px 16px"><h2 style="margin:10px 0 4px">Deliveries</h2>${dl.length?`<ul class="list">${dl.map(d=>`<li><div class="item"><span class="grow"><span class="t">Session ${d.session_no}</span><span class="s">${fmtDay(d.day,{day:"numeric",month:"short",year:"numeric"})} · ${esc(therapistName(d.therapist_id))}</span></span></div></li>`).join("")}</ul>`:`<p class="empty">Nothing delivered yet.</p>`}</div>
    <div class="card" style="padding:4px 16px"><h2 style="margin:10px 0 4px">Money received</h2>${pays.length?`<ul class="list">${pays.map(p=>`<li><div class="item"><span class="grow"><span class="t">${p.kind==="deposit"?"Deposit":"Payment"} · ${p.method==="momo"?"MoMo":"Cash"}</span><span class="s">${fmtDay(p.day,{day:"numeric",month:"short"})}${p.note?" · "+esc(p.note):""}</span></span><span class="r" style="color:var(--good)"><b>+${cedi(p.amount)}</b></span></div></li>`).join("")}</ul>`:`<p class="empty">No money received yet.</p>`}</div>
    ${kit.length?`<div class="card" style="padding:4px 16px"><h2 style="margin:10px 0 4px">Kit given out</h2><ul class="list">${kit.map(m=>`<li><div class="item"><span class="grow"><span class="t">${esc(kitById(m.kit_item_id)?.name||"Kit item")}</span><span class="s">${num(m.qty)} × ${cedi(m.unit_cost)}</span></span><span class="r"><b>${cedi(num(m.qty)*num(m.unit_cost))}</b></span></div></li>`).join("")}</ul></div>`:""}
    ${canDeliver?`<button class="btn-primary btn-block" id="bdDeliver">Deliver session ${num(b.sessions_used)+1}</button>`:""}
    ${bal>0&&b.status!=="cancelled"?`<button class="btn-block" id="bdPay">Take payment</button>`:""}
    ${canCancel?`<button class="btn-danger btn-block" id="bdCancel">Cancel this booking</button>`:""}`,root=>{
    $("bdDeliver")&&($("bdDeliver").onclick=()=>deliverSheet(b));
    $("bdPay")&&($("bdPay").onclick=()=>paySheet(b));
    if($("bdCancel")) confirmBtn($("bdCancel"),"Tap again to cancel",()=>run($("bdCancel"),"cancel the booking",()=>upd("bookings",b.id,{status:"cancelled"}),"Booking cancelled"));
  });
}

/* ---- kits and services (Stock tab) ---- */
function massageStockBlock(r){
  const wide=r.querySelector(".wide");
  if(!wide) return;
  const items=(S.kitItems||[]).filter(k=>k.active!==false);
  const services=(S.services||[]).slice().sort((a,b)=>num(a.sort)-num(b.sort));
  wide.insertAdjacentHTML("beforeend",`
    <div class="card"><div class="row between"><h2>Kit items</h2><button class="btn-primary" data-kit-new>+ Kit item</button></div>
      <p class="small muted">Oil, linen, towels and disposables used in massage. Stock in when you buy; the kit used by each session comes out automatically.</p>
      ${items.length?`<ul class="list">${items.map(k=>{const n=kitStockOf(k.id);return `<li><div class="item"><span class="grow"><span class="t">${esc(k.name)}</span><span class="s">${cedi(k.cost)} per ${esc(k.unit||"piece")}</span></span><span class="r"><b class="num" style="color:${n<=num(k.low_stock)?"var(--warn)":"var(--fg)"}">${n}</b><span class="small muted"> in stock</span><br><button class="btn-ghost small" data-kit-in="${k.id}">Stock in</button> <button class="btn-ghost small" data-kit-count="${k.id}">Correct count</button> <button class="btn-ghost small" data-kit-edit="${k.id}">Edit</button></span></div></li>`}).join("")}</ul>`:`<p class="empty">No kit items yet. Tap + Kit item to add oil, linen and towels.</p>`}
    </div>
    <div class="card"><div class="row between"><h2>Services</h2><button class="btn-primary" data-svc-new>+ Service</button></div>
      <p class="small muted">What each service costs the client and which kit it uses.</p>
      ${services.length?`<ul class="list">${services.map(s=>{const rec=recipeOf(s.id);return `<li><div class="item"><span class="grow"><span class="t">${esc(s.name)} ${s.active===false?'<span class="pill off">off</span>':""}</span><span class="s">${cedi(s.price)} · ${num(s.sessions)>1?num(s.sessions)+" sessions":"single session"}</span><span class="s">Kit: ${rec.length?rec.map(x=>esc(x.item.name)+" × "+x.qty).join(", "):"not set yet"}</span></span><span class="r"><button class="btn-ghost small" data-svc-edit="${s.id}">Edit</button><br><button class="btn-ghost small" data-svc-kit="${s.id}">Kit</button></span></div></li>`}).join("")}</ul>`:`<p class="empty">No services yet.</p>`}
    </div>`);
  wide.querySelector("[data-kit-new]").onclick=()=>kitForm();
  wide.querySelector("[data-svc-new]").onclick=()=>serviceForm();
  wide.querySelectorAll("[data-kit-in]").forEach(b=>b.onclick=()=>kitMoveSheet(kitById(b.dataset.kitIn),"in"));
  wide.querySelectorAll("[data-kit-count]").forEach(b=>b.onclick=()=>kitMoveSheet(kitById(b.dataset.kitCount),"adjust"));
  wide.querySelectorAll("[data-kit-edit]").forEach(b=>b.onclick=()=>kitForm(kitById(b.dataset.kitEdit)));
  wide.querySelectorAll("[data-svc-edit]").forEach(b=>b.onclick=()=>serviceForm(svcById(b.dataset.svcEdit)));
  wide.querySelectorAll("[data-svc-kit]").forEach(b=>b.onclick=()=>recipeSheet(svcById(b.dataset.svcKit)));
}

function kitForm(k){
  openSheet(k?"Edit kit item":"New kit item",`
    <label class="f">Name<input id="kiName" value="${esc(k?.name)}" placeholder="e.g. Essential oil"></label>
    <label class="f">Unit (e.g. bottle, piece, sheet)<input id="kiUnit" value="${esc(k?.unit||"piece")}"></label>
    <label class="f">Cost per unit (GH₵)<input id="kiCost" type="number" min="0" step="0.5" inputmode="decimal" value="${k?num(k.cost):""}"></label>
    <label class="f">Warn me when below (units)<input id="kiLow" type="number" min="0" step="1" inputmode="numeric" value="${k?num(k.low_stock):5}"></label>
    <button class="btn-primary btn-block" id="kiBtn">${k?"Save changes":"Add kit item"}</button>
    ${k?`<button class="btn-danger btn-block" id="kiOff">${k.active===false?"Turn back on":"Turn off (keep history)"}</button>`:""}`,()=>{
    $("kiBtn").onclick=()=>{
      const name=$("kiName").value.trim();if(!name){toast("Enter the name.",true);return}
      const row={name,unit:$("kiUnit").value.trim()||"piece",cost:num($("kiCost").value),low_stock:num($("kiLow").value)};
      if(k) run($("kiBtn"),"save the kit item",()=>upd("kit_items",k.id,row),"Saved");
      else run($("kiBtn"),"add the kit item",()=>ins("kit_items",{id:newId(),...row,active:true}),"Kit item added");
    };
    if(k) $("kiOff").onclick=()=>run($("kiOff"),"change the kit item",()=>upd("kit_items",k.id,{active:k.active===false}),"Saved");
  });
}

function kitMoveSheet(k,mode){
  if(!k) return;
  const now=kitStockOf(k.id);
  openSheet(mode==="in"?`Stock in · ${k.name}`:`Correct count · ${k.name}`,`
    ${mode==="in"?`<label class="f">How many came in?<input id="kmQty" type="number" min="1" step="1" inputmode="numeric"></label>
      <label class="f">Cost per unit (GH₵)<input id="kmCost" type="number" min="0" step="0.5" inputmode="decimal" value="${num(k.cost)}"></label>`
      :`<p class="muted">Right now the app says ${now}. How many do you actually have?</p><label class="f">Counted<input id="kmQty" type="number" min="0" step="1" inputmode="numeric" value="${now}"></label>`}
    <label class="f">Note (optional)<input id="kmNote"></label>
    <button class="btn-primary btn-block" id="kmBtn">Save</button>`,()=>{
    $("kmBtn").onclick=()=>{
      const q=num($("kmQty").value);
      if(mode==="in"){
        if(!(q>0)){toast("Enter how many came in.",true);return}
        run($("kmBtn"),"save the stock in",()=>ins("kit_moves",{day,kit_item_id:k.id,kind:"in",qty:q,unit_cost:num($("kmCost").value),note:$("kmNote").value.trim()}),"Stock in saved");
      }else{
        if($("kmQty").value===""){toast("Enter the count.",true);return}
        const diff=q-now;
        if(!diff){closeSheet();return}
        run($("kmBtn"),"correct the count",()=>ins("kit_moves",{day,kit_item_id:k.id,kind:"adjust",qty:diff,unit_cost:num(k.cost),note:$("kmNote").value.trim()||"Count corrected"}),"Count corrected");
      }
    };
  });
}

function serviceForm(s){
  let kind=s?.kind||"single";
  openSheet(s?"Edit service":"New service",`
    <label class="f">Name<input id="svName" value="${esc(s?.name)}" placeholder="e.g. Shiatsu massage (single)"></label>
    <div><span style="font-weight:700;font-size:.9rem">Kind</span><div class="chips" style="margin-top:6px"><button type="button" class="chip" data-chip="svkind" data-v="single" aria-pressed="${kind==="single"}">Single session</button><button type="button" class="chip" data-chip="svkind" data-v="plan" aria-pressed="${kind==="plan"}">Plan</button></div></div>
    <label class="f">Price (GH₵) — the usual price; each booking can change it<input id="svPrice" type="number" min="0" step="1" inputmode="decimal" value="${s?num(s.price):""}"></label>
    <label class="f">Sessions included<input id="svSess" type="number" min="1" step="1" inputmode="numeric" value="${s?num(s.sessions):1}"></label>
    <button class="btn-primary btn-block" id="svBtn">${s?"Save changes":"Add service"}</button>
    ${s?`<button class="btn-block" id="svOff">${s.active===false?"Turn back on":"Turn off (keep history)"}</button>`:""}`,root=>{
    wireChips(root,"svkind",v=>kind=v);
    $("svBtn").onclick=()=>{
      const name=$("svName").value.trim(),sessions=Math.max(1,num($("svSess").value)||1);
      if(!name){toast("Enter the name.",true);return}
      const row={name,kind,price:num($("svPrice").value),sessions:kind==="plan"?sessions:1};
      if(s) run($("svBtn"),"save the service",()=>upd("services",s.id,row),"Saved");
      else run($("svBtn"),"add the service",()=>ins("services",{id:newId(),sort:(S.services||[]).reduce((a,x)=>Math.max(a,num(x.sort)),0)+10,...row,active:true}),"Service added");
    };
    if(s) $("svOff").onclick=()=>run($("svOff"),"change the service",()=>upd("services",s.id,{active:s.active===false}),"Saved");
  });
}

function recipeSheet(s){
  if(!s) return;
  const items=(S.kitItems||[]).filter(k=>k.active!==false);
  if(!items.length){toast("Add kit items first.",true);return}
  const cur=Object.fromEntries(recipeOf(s.id).map(r=>[r.item.id,r.qty]));
  openSheet(`Kit for ${s.name}`,`
    <p class="muted">Tick what one ${s.kind==="plan"?"plan (given on session 1)":"session"} uses, and how many.</p>
    <ul class="list">${items.map(k=>`<li><div class="item"><label class="grow" style="display:flex;gap:10px;align-items:center"><input type="checkbox" data-rk="${k.id}" ${k.id in cur?"checked":""} style="width:22px;height:22px"><span><span class="t">${esc(k.name)}</span><span class="s">${cedi(k.cost)} per ${esc(k.unit||"piece")}</span></span></label><input type="number" min="1" step="1" inputmode="numeric" data-rq="${k.id}" value="${cur[k.id]||1}" style="width:80px"></div></li>`).join("")}</ul>
    <button class="btn-primary btn-block" id="rkBtn">Save kit</button>`,()=>{
    $("rkBtn").onclick=()=>{
      const rows=items.filter(k=>document.querySelector(`[data-rk="${k.id}"]`).checked).map(k=>({service_id:s.id,kit_item_id:k.id,qty:Math.max(1,num(document.querySelector(`[data-rq="${k.id}"]`).value)||1)}));
      run($("rkBtn"),"save the kit",async()=>{
        await api(`/service_kit?service_id=eq.${enc(s.id)}`,{method:"DELETE",prefer:"return=minimal"});
        if(rows.length) await ins("service_kit",rows);
      },"Kit saved");
    };
  });
}

/* ---- therapists (Team tab) ---- */
function teamSeg(){return `<div class="seg" style="margin-bottom:12px"><button data-tseg="marketers" aria-pressed="${teamTab==="marketers"}">Marketers</button><button data-tseg="therapists" aria-pressed="${teamTab==="therapists"}">Therapists</button></div>`}
function wireTeamSeg(r){r.querySelectorAll("[data-tseg]").forEach(b=>b.onclick=()=>{teamTab=b.dataset.tseg;renderTeam()})}

function renderTherapists(){
  const r=$("scr-team");
  const list=liveTherapists();
  r.innerHTML=`${teamSeg()}
    <div class="row"><button class="btn-primary" id="thAdd">+ Add therapist</button></div>
    <div class="card" style="padding:4px 16px">
      ${list.length?`<ul class="list">${list.map(t=>{const owed=owedThisMonth(t);return `<li><button class="item" data-th="${t.id}"><span class="avatar">${esc(initials(t.name))}</span><span class="grow"><span class="t">${esc(t.name)}</span><span class="s">${esc(t.phone||"No phone yet")} · monthly pay ${cedi(t.monthly_pay)}</span><span class="row" style="gap:6px;margin-top:4px">${owed>0?`<span class="pill warn">owed ${cedi(owed)} this month</span>`:`<span class="pill good">paid this month</span>`}</span></span><span class="r muted">›</span></button></li>`}).join("")}</ul>`:`<p class="empty">No therapists yet. Tap + Add therapist.</p>`}
    </div>
    <p class="small muted">Therapists are paid a fixed agreed amount at month end, out of the personal income share of profit. Tap one to pay them or change their details.</p>`;
  wireTeamSeg(r);
  $("thAdd").onclick=()=>therapistForm();
  r.querySelectorAll("[data-th]").forEach(b=>b.onclick=()=>therapistSheet(therapistById(b.dataset.th)));
}

function therapistForm(t){
  openSheet(t?"Edit therapist":"Add therapist",`
    <label class="f">Name<input id="thName" value="${esc(t?.name)}"></label>
    <label class="f">Phone (optional)<input id="thPhone" inputmode="tel" value="${esc(t?.phone)}"></label>
    <label class="f">Agreed monthly pay (GH₵)<input id="thPay" type="number" min="0" step="50" inputmode="decimal" value="${t?num(t.monthly_pay):""}"></label>
    <button class="btn-primary btn-block" id="thBtn">${t?"Save changes":"Add therapist"}</button>`,()=>{
    $("thBtn").onclick=()=>{
      const name=$("thName").value.trim();if(!name){toast("Enter the name.",true);return}
      const row={name,phone:$("thPhone").value.trim(),monthly_pay:num($("thPay").value)};
      if(t) run($("thBtn"),"save the therapist",()=>upd("therapists",t.id,row),"Saved");
      else run($("thBtn"),"add the therapist",()=>ins("therapists",{id:newId(),no:(S.therapists||[]).reduce((a,x)=>Math.max(a,num(x.no)),0)+1,...row,active:true,joined:todayISO()}),"Therapist added");
    };
  });
}

function therapistSheet(t){
  if(!t) return;
  const owed=owedThisMonth(t);
  openSheet(t.name,`
    <ul class="list">
      ${row("Agreed monthly pay",cedi(t.monthly_pay))}
      ${row("Still owed this month",cedi(owed),"",{strong:true,color:owed>0?"var(--warn)":"var(--good)"})}
      ${row("Phone",esc(t.phone||"not given"))}
    </ul>
    ${owed>0?`<label class="f">Amount paid now (GH₵)<input id="tpAmt" type="number" min="0" step="10" inputmode="decimal" value="${owed}"></label>
      <label class="f">Note (optional)<input id="tpNote" placeholder="e.g. October pay"></label>
      <button class="btn-primary btn-block" id="tpBtn">Record pay</button>`:""}
    <button class="btn-block" id="tpEdit">Edit details</button>
    <button class="btn-danger btn-block" id="tpRemove">Remove therapist</button>`,()=>{
    if($("tpBtn")) $("tpBtn").onclick=()=>{
      const a=num($("tpAmt").value);if(!(a>0)){toast("Enter the amount.",true);return}
      run($("tpBtn"),"record the pay",()=>ins("therapist_pay",{day,therapist_id:t.id,amount:a,note:$("tpNote").value.trim()}),"Pay recorded");
    };
    $("tpEdit").onclick=()=>therapistForm(t);
    confirmBtn($("tpRemove"),"Tap again to remove",()=>run($("tpRemove"),"remove the therapist",()=>upd("therapists",t.id,{removed_at:new Date().toISOString(),active:false}),"Therapist removed"));
  });
}

/* =================== WIRING =================== */
$("settingsBtn").onclick=()=>S&&settingsSheet();
$("refreshBtn").onclick=()=>load().then(()=>S&&toast("Up to date"));
$("day").onchange=e=>{const v=e.target.value||todayISO();const reload=v.slice(0,7)!==day.slice(0,7);day=v;sellForm.price=null;render();if(reload)load()};
$("lockedRetry").onclick=()=>load();
$("lockedOut").onclick=signOut;
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&S&&!sheet.open)load()});
$("loginForm").onsubmit=async e=>{
  e.preventDefault();
  $("lgBtn").disabled=true;$("lgMsg").textContent="Signing in…";
  try{await signIn($("lgEmail").value.trim(),$("lgPass").value);$("lgPass").value="";$("lgMsg").textContent="";showGate("boot");await load()}
  catch(err){$("lgMsg").textContent=err instanceof TypeError?"Couldn't reach the sign-in service. Check your internet.":(err.status===401||/invalid/i.test(err.message))?"That email and password don't match.":"Couldn't sign in: "+err.message}
  finally{$("lgBtn").disabled=false}
};
if("serviceWorker" in navigator && location.protocol==="https:") navigator.serviceWorker.register("sw.js").catch(()=>{});

(async()=>{
  try{await getJwt(true);await load()}
  catch(e){showGate(e instanceof TypeError?"boot":"login");if(e instanceof TypeError)$("bootMsg").textContent="No internet connection. Connect and reopen the app."}
})();
