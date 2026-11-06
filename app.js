"use strict";
/* MOZLYT Inventory — one-owner stock, sales, money and savings app.
   Sign-in: Neon Auth. Records: Neon Data API, protected by row-level security. */

const AUTH="https://ep-jolly-fire-bc7cxdj3.neonauth.c-16.us-east-1.aws.neon.tech/mozlyt/auth";
const REST="https://ep-jolly-fire-bc7cxdj3.apirest.c-16.us-east-1.aws.neon.tech/mozlyt/rest/v1";
const TZ="Africa/Accra";

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cedi=n=>"GH₵"+(Math.round((Number(n)||0)*100)/100).toLocaleString(undefined,{maximumFractionDigits:2});
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
let moneyTab="owed", teamQuery="", reportPeriod="month", showRemoved=false;

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
const sumCost=a=>a.reduce((t,s)=>t+Number(s.qty)*Number(s.cost||0),0);
function stockOf(pid){
  const r=S.stock.find(x=>x.product_id===pid)||{inn:0,adj:0,outt:0,ret:0,sold:0};
  const total=Number(r.inn)+Number(r.adj)-Number(r.sold);
  const withM=S.holdings.filter(h=>h.product_id===pid).reduce((t,h)=>t+Math.max(0,Number(h.gave)-Number(h.back)-Number(h.sold)),0);
  const tracked=Number(r.inn)+Number(r.adj)+Number(r.outt)>0;
  return {total,withM,store:Math.max(0,total-withM),tracked,sold:Number(r.sold)};
}
const holding=(mid,pid)=>{const h=S.holdings.find(x=>x.marketer_id===mid&&x.product_id===pid);return h?Number(h.gave)-Number(h.back)-Number(h.sold):0};
const holdingsOf=mid=>S.products.map(p=>({p,n:holding(mid,p.id)})).filter(x=>x.n>0);
const moneyOf=mid=>{const r=S.money.find(x=>x.marketer_id===mid)||{sold_value:0,paid:0,saved:0};return{owes:Number(r.sold_value)-Number(r.paid),saved:Number(r.saved),soldValue:Number(r.sold_value),paid:Number(r.paid)}};
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
async function load(){
  if(loading) return loading;
  loading=(async()=>{
    $("refreshBtn").disabled=true;
    try{
      const d=await api("/rpc/get_state",{method:"POST",body:{months:months()}});
      if(!d||d.owner!==true){$("lockedEmail").textContent=me?.email||"this account";showGate("locked");return}
      S=d; banner(""); showGate("app"); render();
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
const titles={home:"Home",sell:"Sell",stock:"Stock",team:"Team",money:"Money"};
function go(s){screen=s;store.set("inv-screen",s);render();window.scrollTo({top:0})}
document.querySelectorAll(".nav [data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
function render(){
  if(!S) return;
  $("screenTitle").textContent=titles[screen];
  document.querySelectorAll(".nav [data-go]").forEach(b=>b.setAttribute("aria-current",b.dataset.go===screen?"page":"false"));
  Object.keys(titles).forEach(k=>$("scr-"+k).hidden=k!==screen);
  $("day").value=day;
  $("dateLabel").textContent=day===todayISO()?"Today":fmtDay(day,{weekday:"short",day:"numeric",month:"short"});
  ({home:renderHome,sell:renderSell,stock:renderStock,team:renderTeam,money:renderMoney})[screen]();
}

/* =================== HOME =================== */
function renderHome(){
  const today=salesOn(day), pays=S.payments.filter(p=>p.day===day);
  const stockTotal=liveProducts().reduce((t,p)=>t+Math.max(0,stockOf(p.id).total),0);
  const tracked=liveProducts().some(p=>stockOf(p.id).tracked);
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
      ${(low.length||owing.length||!tracked||credDue.length)?`<div class="card"><h2>Needs attention</h2><div class="stack">
        ${!tracked?`<div class="alert info"><span>📦</span><span><b>Set up your stock.</b> Tap <b>Stock in</b> and enter how many of each product you have, so the app can count what's left.</span></div>`:""}
        ${credDue.map(s=>`<button class="alert" style="width:100%;text-align:left;border:0;font-weight:400;min-height:0" data-credit="${s.id}"><span>🧾</span><span><b>${esc(s.customer||"A customer")}</b> ${s.due_date<todayISO()?"was due to pay":"is due to pay"} ${cedi(s.qty*s.price)} ${s.due_date===todayISO()?"today":fmtDay(s.due_date,{weekday:"long"})}. Tap when paid.</span></button>`).join("")}
        ${low.map(p=>`<div class="alert"><span>⚠️</span><span><b>${esc(p.name)}</b> is low: ${Math.max(0,stockOf(p.id).total)} left.</span></div>`).join("")}
        ${owing.slice(0,3).map(x=>`<div class="alert info"><span>💰</span><span><b>${esc(x.m.name)}</b> owes ${cedi(x.o)}.</span></div>`).join("")}
      </div></div>`:""}
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
      ${h>0?`<p class="small muted">${esc(mName(sellForm.mid))} is holding ${h} of this product.</p>`:""}
      <button class="btn-primary btn-block" type="submit" id="sfBtn" style="min-height:54px;font-size:1.05rem">Record sale</button>
      <p class="small muted">Saves on ${day===todayISO()?"today's date":fmtDay(day,{day:"numeric",month:"long"})}. Change the date at the top to record an earlier day.</p>
    </form>
    <div class="card"><div class="row between"><h2>Sales ${day===todayISO()?"today":"on "+fmtDay(day)}</h2><span class="pill">${sumQty(list)} items · ${cedi(sumVal(list))}</span></div>
      ${list.length?`<ul class="list">${list.map(s=>`<li><button class="item" data-sale="${s.id}"><span class="avatar">${esc(initials(mName(s.marketer_id)))}</span><span class="grow"><span class="t">${esc(mName(s.marketer_id))}</span><span class="s">${esc(pName(s))} × ${s.qty} · ${methodLabel(s)}${s.note?" · "+esc(s.note):""}</span></span><span class="r"><b>${cedi(s.qty*s.price)}</b><br><span class="small muted">Edit</span></span></button></li>`).join("")}</ul>`:`<p class="empty">No sales recorded yet.</p>`}
    </div></div>`;
  const total=()=>{$("sfTotal").textContent=cedi(sellForm.qty*(Number($("sfPrice").value)||0))};
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
function renderStock(){
  const ps=liveProducts();
  const holders=S.marketers.map(m=>({m,h:holdingsOf(m.id)})).filter(x=>x.h.length);
  const r=$("scr-stock");
  r.innerHTML=`
    <div class="fab-row" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <button class="qa" data-sk="in">${icon.box}Stock in</button>
      <button class="qa" data-sk="out">${icon.give}Give to marketer</button>
      <button class="qa" data-sk="return">${icon.back}Return from marketer</button>
    </div>
    <div class="wide">
      ${ps.map(p=>{const s=stockOf(p.id);const low=s.tracked&&s.total<=Number(p.low_stock||0);return `
      <div class="card">
        <div class="row between"><h2>${esc(p.name)}</h2>${!s.tracked?`<span class="pill off">not set up</span>`:low?`<span class="pill warn">low</span>`:`<span class="pill good">ok</span>`}</div>
        <div class="row between" style="align-items:flex-end"><div><div class="money-big">${s.tracked?Math.max(0,s.total):"–"}</div><span class="small muted">in stock</span></div>
        <div class="r small muted" style="text-align:right">In your store: <b class="num" style="color:var(--fg)">${s.tracked?s.store:"–"}</b><br>With marketers: <b class="num" style="color:var(--fg)">${s.withM}</b><br>Sold so far: <b class="num" style="color:var(--fg)">${s.sold}</b></div></div>
        ${!s.tracked?`<p class="small muted">Tap Correct count and enter how many you have.</p>`:s.total<0?`<p class="small" style="color:var(--warn)">More sales than stock recorded. Tap Correct count.</p>`:""}
        <div class="grid2"><button class="btn-primary" data-count="${p.id}">Correct count</button><button data-prod-edit="${p.id}">Edit product</button></div>
      </div>`}).join("")||`<div class="card"><p class="empty">No products yet. Add one in Settings.</p></div>`}
      <div class="card"><h2>Who's holding stock</h2>
        ${holders.length?`<ul class="list">${holders.map(x=>`<li><button class="item" data-open-m="${x.m.id}"><span class="avatar">${esc(initials(x.m.name))}</span><span class="grow"><span class="t">${esc(x.m.name)}</span><span class="s">${x.h.map(h=>esc(h.p.name)+" × "+h.n).join(" · ")}</span></span><span class="r"><b>${x.h.reduce((t,h)=>t+h.n,0)}</b></span></button></li>`).join("")}</ul>`:`<p class="empty">No marketer is holding stock. Use "Give to marketer" when you hand over items.</p>`}
      </div>
      <div class="card"><h2>Recent stock movements</h2>
        ${S.moves.length?`<ul class="list">${S.moves.slice(0,25).map(mv=>`<li><button class="item" data-move="${mv.id}"><span class="grow"><span class="t">${{in:"Stock in",out:"Given to "+esc(mName(mv.marketer_id)),return:"Returned by "+esc(mName(mv.marketer_id)),adjust:"Count corrected"}[mv.kind]}</span><span class="s">${esc(P(mv.product_id)?.name||"Product")} · ${fmtDay(mv.day)}${mv.note?" · "+esc(mv.note):""}</span></span><span class="r"><b>${mv.kind==="out"?"→ ":mv.kind==="return"?"← ":mv.qty>0?"+":""}${mv.qty}</b></span></button></li>`).join("")}</ul>`:`<p class="empty">Nothing yet.</p>`}
      </div>
    </div>`;
  r.querySelectorAll("[data-sk]").forEach(b=>b.onclick=()=>stockSheet(b.dataset.sk));
  r.querySelectorAll("[data-open-m]").forEach(b=>b.onclick=()=>marketerPage(b.dataset.openM));
  r.querySelectorAll("[data-prod-edit]").forEach(b=>b.onclick=()=>productForm(P(b.dataset.prodEdit)));
  r.querySelectorAll("[data-count]").forEach(b=>b.onclick=()=>countSheet(P(b.dataset.count)));
  r.querySelectorAll("[data-move]").forEach(b=>b.onclick=()=>moveSheet(S.moves.find(m=>String(m.id)===b.dataset.move)));
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
      $("ssHint").textContent=kind==="out"?`In your store now: ${s.tracked?s.store:"not set up"}.`:kind==="return"&&m?`${mName(m)} is holding ${Math.max(0,holding(m,pid))}.`:s.tracked?`In stock now: ${Math.max(0,s.total)}.`:""};
    wireChips(root,"ssp",v=>{pid=v;hint()}); stepper(root,"ssQ",1); root.querySelector("#ssM")?.addEventListener("change",hint); hint();
    $("ssBtn").onclick=()=>{
      const q=Number($("ssQn").value)||Number($("ssQ").value);
      if(!(q>0)){toast("Enter how many.",true);return}
      const cost=kind==="in"?Number($("ssCost").value)||null:null;
      const row={day,product_id:pid,kind,marketer_id:(kind==="out"||kind==="return")?$("ssM").value:null,qty:Math.round(q),unit_cost:cost,note:$("ssNote").value.trim()};
      run($("ssBtn"),"save the stock",async()=>{await ins("stock_moves",row);if(cost&&!Number(P(pid).cost))await upd("products",pid,{cost})},{in:"Stock added",out:"Stock given out",return:"Return saved"}[kind]);
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
  const q=teamQuery.trim().toLowerCase();
  const removedCount=S.marketers.filter(m=>m.removed_at).length;
  if(!removedCount) showRemoved=false;
  const list=S.marketers.filter(m=>showRemoved?!!m.removed_at:!m.removed_at).filter(m=>!q||m.name.toLowerCase().includes(q)||(m.phone||"").includes(q)||String(m.no)===q)
    .sort((a,b)=>(a.active===false)-(b.active===false)||a.no-b.no);
  const r=$("scr-team");
  r.innerHTML=`
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
  const recentSales=S.sales.filter(s=>s.marketer_id===mid).sort((a,b)=>b.day.localeCompare(a.day)||String(b.created_at).localeCompare(String(a.created_at))).slice(0,8);
  const pays=S.recent_payments.filter(p=>p.marketer_id===mid);
  const savs=S.recent_savings.filter(s=>s.marketer_id===mid);
  const pay=Number(S.settings?.pay||0);
  openSheet(m.name+(m.removed_at?" (removed)":""),`
    <div class="row between"><span class="muted">${esc([m.phone,m.area].filter(Boolean).join(" · ")||"No phone yet")}</span><button class="btn-ghost" id="mpEdit">Edit</button></div>
    <div class="grid2">
      <div class="tile"><b>${sumQty(monthSales)}</b><span>sold in ${fmtDay(day,{month:"long"})}</span></div>
      <div class="tile"><b>${hs.reduce((a,x)=>a+x.n,0)}</b><span>items holding</span></div>
      <div class="tile ${mo.owes>0.009?"accent":""}"><b>${cedi(Math.max(0,mo.owes))}</b><span>${mo.owes<-0.009?"paid ahead "+cedi(-mo.owes):"owes you"}</span></div>
      <div class="tile"><b>${cedi(mo.saved)}</b><span>savings</span></div>
    </div>
    ${pay>0?`<p class="small muted">Pay earned this month: <b>${cedi(sumQty(monthSales)*pay)}</b> (${sumQty(monthSales)} × ${cedi(pay)})</p>`:""}
    <div class="grid2">
      <button class="btn-primary" id="mpSale">Record sale</button>
      <button id="mpPay">Receive money</button>
      <button id="mpGive">Give stock</button>
      <button id="mpRet">Return stock</button>
      <button id="mpSave">Add savings</button>
      <button id="mpOut">Pay out savings</button>
    </div>
    ${hs.length?`<div><div class="eyebrow">Holding</div><ul class="list">${hs.map(x=>`<li><div class="item"><span class="grow t">${esc(x.p.name)}</span><span class="r"><b>${x.n}</b></span></div></li>`).join("")}</ul></div>`:""}
    <div><div class="eyebrow">Recent sales</div>${recentSales.length?`<ul class="list">${recentSales.map(s=>`<li><div class="item"><span class="grow"><span class="t">${esc(pName(s))} × ${s.qty}</span><span class="s">${fmtDay(s.day)} · ${methodLabel(s)}</span></span><span class="r">${cedi(s.qty*s.price)}</span></div></li>`).join("")}</ul>`:`<p class="empty">No sales yet.</p>`}</div>
    <div><div class="eyebrow">Money received</div>${pays.length?`<ul class="list">${pays.map(p=>`<li><div class="item"><span class="grow"><span class="t">${cedi(p.amount)}</span><span class="s">${fmtDay(p.day)} · ${p.method==="momo"?"MoMo":"Cash"}${p.note?" · "+esc(p.note):""}</span></span></div></li>`).join("")}</ul>`:`<p class="empty">None yet.</p>`}</div>
    <div><div class="eyebrow">Savings</div>${savs.length?`<ul class="list">${savs.map(s=>`<li><div class="item"><span class="grow"><span class="t">${s.amount<0?"Paid out":"Saved"}</span><span class="s">${fmtDay(s.day)}${s.note?" · "+esc(s.note):""}</span></span><span class="r" style="color:${s.amount<0?"var(--warn)":"var(--good)"}">${s.amount<0?"−":"+"}${cedi(Math.abs(s.amount))}</span></div></li>`).join("")}</ul>`:`<p class="empty">None yet.</p>`}</div>
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
  });
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
function renderMoney(){
  const r=$("scr-money");
  const tabs=[["owed","Marketers"],["customers","Customers"],["savings","Savings"],["profit","Profit"],["reports","Reports"]];
  let body="";
  if(moneyTab==="customers"){
    const list=unpaidCredit(), total=list.reduce((t,s)=>t+s.qty*s.price,0), today=todayISO();
    body=`<div class="card"><div><div class="money-big">${cedi(total)}</div><span class="small muted">customers owe you for pay-later sales</span></div>
      ${list.length?`<ul class="list">${list.map(s=>{const late=s.due_date&&s.due_date<today, dueToday=s.due_date===today;return `<li><button class="item" data-credit="${s.id}"><span class="grow"><span class="t">${esc(s.customer||"Customer")}</span><span class="s">${esc(pName(s))} × ${s.qty} · sold ${fmtDay(s.day)} by ${esc(mName(s.marketer_id))}</span>
        <span class="row" style="gap:6px;margin-top:4px">${s.due_date?`<span class="pill ${late?"warn":dueToday?"good":""}">${late?"late, was due ":dueToday?"due today, ":"due "}${fmtDay(s.due_date,{weekday:"short",day:"numeric",month:"short"})}</span>`:""}</span></span>
        <span class="r"><b>${cedi(s.qty*s.price)}</b><br><span class="small muted">Mark paid</span></span></button></li>`}).join("")}</ul>`:`<p class="empty">No customer owes you. Choose <b>Pay later</b> when you record a sale on credit.</p>`}
    </div>`;
  }else if(moneyTab==="owed"){
    const rows=S.marketers.map(m=>({m,...moneyOf(m.id)})).filter(x=>x.owes>0.009).sort((a,b)=>b.owes-a.owes);
    const total=rows.reduce((t,x)=>t+x.owes,0);
    const recent=S.payments.slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,15);
    body=`<div class="wide">
      <div class="card"><div class="row between"><div><div class="money-big">${cedi(total)}</div><span class="small muted">owed to you by marketers</span></div><button class="btn-primary" id="mnPay">Receive money</button></div>
        ${rows.length?`<ul class="list">${rows.map(x=>`<li><button class="item" data-pay="${x.m.id}"><span class="avatar">${esc(initials(x.m.name))}</span><span class="grow"><span class="t">${esc(x.m.name)}</span><span class="s">sold ${cedi(x.soldValue)} · paid ${cedi(x.paid)}</span></span><span class="r"><b>${cedi(x.owes)}</b><br><span class="small muted">Receive</span></span></button></li>`).join("")}</ul>`:`<p class="empty">Nobody owes you anything.</p>`}
        <p class="small muted">Owed = value of items they sold − money they've handed to you.</p>
      </div>
      <div class="card"><h2>Money received</h2>${recent.length?`<ul class="list">${recent.map(p=>`<li><button class="item" data-paydel="${p.id}"><span class="grow"><span class="t">${esc(mName(p.marketer_id))}</span><span class="s">${fmtDay(p.day)} · ${p.method==="momo"?"MoMo":"Cash"}${p.note?" · "+esc(p.note):""}</span></span><span class="r"><b>${cedi(p.amount)}</b></span></button></li>`).join("")}</ul>`:`<p class="empty">No payments recorded in these months.</p>`}</div></div>`;
  }else if(moneyTab==="savings"){
    const rows=S.marketers.map(m=>({m,s:moneyOf(m.id).saved})).filter(x=>x.s>0.009).sort((a,b)=>b.s-a.s);
    const total=rows.reduce((t,x)=>t+x.s,0);
    body=`<div class="card"><div class="row between"><div><div class="money-big">${cedi(total)}</div><span class="small muted">savings you're holding</span></div><div class="row"><button class="btn-primary" id="svAdd">Add savings</button><button id="svOut">Pay out</button></div></div>
      ${rows.length?`<ul class="list">${rows.map(x=>`<li><button class="item" data-open-m="${x.m.id}"><span class="avatar">${esc(initials(x.m.name))}</span><span class="grow t">${esc(x.m.name)}</span><span class="r"><b>${cedi(x.s)}</b></span></button></li>`).join("")}</ul>`:`<p class="empty">No savings yet.</p>`}</div>`;
  }else if(moneyTab==="profit"){
    const [f,t]=period("month"), mo=salesIn(f,t), pay=Number(S.settings?.pay||0);
    const sales=sumVal(mo), cost=sumCost(mo), gross=sales-cost, mpay=sumQty(mo)*pay, net=gross-mpay;
    const missing=liveProducts().filter(p=>!Number(p.cost));
    body=`<div class="card"><h2>${fmtDay(day,{month:"long",year:"numeric"})}</h2>
      <ul class="list">
        <li><div class="item"><span class="grow">Sales</span><span class="r"><b>${cedi(sales)}</b></span></div></li>
        <li><div class="item"><span class="grow">Cost of items sold</span><span class="r">− ${cedi(cost)}</span></div></li>
        <li><div class="item"><span class="grow"><b>Gross profit</b></span><span class="r"><b>${cedi(gross)}</b></span></div></li>
        ${pay>0?`<li><div class="item"><span class="grow">Marketers' pay (${sumQty(mo)} × ${cedi(pay)})</span><span class="r">− ${cedi(mpay)}</span></div></li>
        <li><div class="item"><span class="grow"><b>What you keep</b></span><span class="r"><span class="money-big" style="font-size:1.6rem;color:${net>=0?"var(--good)":"var(--bad)"}">${cedi(net)}</span></span></div></li>`:""}
      </ul>
      ${missing.length?`<div class="alert info"><span>ℹ️</span><span>Set the <b>cost price</b> for ${missing.map(p=>esc(p.name)).join(", ")} in Settings, so profit is correct. Sales recorded before that count as zero cost.</span></div>`:""}
    </div>`;
  }else{
    const [f,t]=period(reportPeriod), rows=salesIn(f,t), pay=Number(S.settings?.pay||0);
    const pays=S.payments.filter(p=>p.day>=f&&p.day<=t);
    const agg=S.marketers.map(m=>{const r=rows.filter(s=>s.marketer_id===m.id);return{m,u:sumQty(r),v:sumVal(r),d:new Set(r.map(s=>s.day)).size,p:pays.filter(p=>p.marketer_id===m.id).reduce((a,p)=>a+Number(p.amount),0)}}).filter(x=>x.u||x.p).sort((a,b)=>b.u-a.u);
    const byP={};rows.forEach(s=>{const k=pName(s);byP[k]=byP[k]||{u:0,v:0};byP[k].u+=Number(s.qty);byP[k].v+=s.qty*s.price});
    const pk=Object.keys(byP).sort((a,b)=>byP[b].u-byP[a].u);
    body=`<div class="seg"><button data-seg="rp" data-v="today" aria-pressed="${reportPeriod==="today"}">Day</button><button data-seg="rp" data-v="week" aria-pressed="${reportPeriod==="week"}">Week</button><button data-seg="rp" data-v="month" aria-pressed="${reportPeriod==="month"}">Month</button></div>
      <p class="muted">${f===t?fmtDay(f,{weekday:"long",day:"numeric",month:"long"}):fmtDay(f)+" – "+fmtDay(t,{day:"numeric",month:"short",year:"numeric"})}</p>
      <div class="wide">
      <div class="card full"><h2>By marketer</h2><div class="tbl"><table><thead><tr><th>Marketer</th><th class="r">Items</th><th class="r">Days</th><th class="r">Sales</th><th class="r">Paid in</th>${pay>0?'<th class="r">Their pay</th>':""}</tr></thead>
        <tbody>${agg.length?agg.map(x=>`<tr><td>${esc(x.m.name)}</td><td class="r">${x.u}</td><td class="r">${x.d}</td><td class="r">${cedi(x.v)}</td><td class="r">${cedi(x.p)}</td>${pay>0?`<td class="r">${cedi(x.u*pay)}</td>`:""}</tr>`).join(""):`<tr><td colspan="6" class="empty">No sales in this period.</td></tr>`}</tbody>
        ${agg.length?`<tfoot><tr><th>Total</th><th class="r">${sumQty(rows)}</th><th></th><th class="r">${cedi(sumVal(rows))}</th><th class="r">${cedi(pays.reduce((a,p)=>a+Number(p.amount),0))}</th>${pay>0?`<th class="r">${cedi(sumQty(rows)*pay)}</th>`:""}</tr></tfoot>`:""}</table></div></div>
      <div class="card"><h2>By product</h2><div class="tbl"><table><thead><tr><th>Product</th><th class="r">Sold</th><th class="r">Sales</th></tr></thead><tbody>${pk.length?pk.map(k=>`<tr><td>${esc(k)}</td><td class="r">${byP[k].u}</td><td class="r">${cedi(byP[k].v)}</td></tr>`).join(""):`<tr><td colspan="3" class="empty">Nothing sold.</td></tr>`}</tbody></table></div></div>
      </div>`;
  }
  r.innerHTML=`<div class="seg">${tabs.map(([k,l])=>`<button data-seg="mt" data-v="${k}" aria-pressed="${moneyTab===k}">${l}</button>`).join("")}</div>${body}`;
  wireSeg(r,"mt",v=>{moneyTab=v;renderMoney()});
  wireSeg(r,"rp",v=>{reportPeriod=v;renderMoney()});
  $("mnPay")&&($("mnPay").onclick=()=>paymentSheet());
  $("svAdd")&&($("svAdd").onclick=()=>savingsSheet(null,false));
  $("svOut")&&($("svOut").onclick=()=>savingsSheet(null,true));
  r.querySelectorAll("[data-pay]").forEach(b=>b.onclick=()=>paymentSheet(b.dataset.pay));
  r.querySelectorAll("[data-credit]").forEach(b=>b.onclick=()=>creditPaidSheet(unpaidCredit().find(s=>String(s.id)===b.dataset.credit)));
  r.querySelectorAll("[data-open-m]").forEach(b=>b.onclick=()=>marketerPage(b.dataset.openM));
  r.querySelectorAll("[data-paydel]").forEach(b=>b.onclick=()=>{const p=S.payments.find(x=>String(x.id)===b.dataset.paydel);
    openSheet("Payment",`<p>${esc(mName(p.marketer_id))} paid <b>${cedi(p.amount)}</b> by ${p.method==="momo"?"MoMo":"cash"} on ${fmtDay(p.day,{day:"numeric",month:"long"})}.</p>${p.note?`<p class="muted">${esc(p.note)}</p>`:""}<button class="btn-danger btn-block" id="pdDel">Delete this payment</button>`,()=>confirmBtn($("pdDel"),"Tap again to delete",()=>run($("pdDel"),"delete the payment",()=>del("payments",p.id),"Payment deleted")))});
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
    <ul class="list">${S.products.map(p=>`<li><button class="item" data-pe="${p.id}"><span class="grow"><span class="t">${esc(p.name)} ${p.active===false?'<span class="pill off">paused</span>':""}</span><span class="s">Sell ${cedi(p.price)} · Cost ${Number(p.cost)?cedi(p.cost):"not set"} · Low at ${p.low_stock}</span></span><span class="r muted">Edit ›</span></button></li>`).join("")}</ul></div>
    <div class="stack"><h3>Targets and pay</h3>
      <div class="grid2"><label class="f">Daily target (items)<input id="stT" type="number" min="1" value="${S.settings?.target??5}"></label><label class="f">Pay per item (GH₵)<input id="stP" type="number" min="0" step="0.5" value="${S.settings?.pay??0}"></label></div>
      <button id="stSave">Save targets and pay</button></div>
    <div class="stack"><h3>Install on this phone</h3>
      ${isStandalone()?`<p class="muted">Installed. You're using the app.</p>`:installEvt?`<button class="btn-primary" id="stInstall">Install MOZLYT Inventory</button>`:ios?`<p class="muted">In Safari, tap the <b>Share</b> button, then <b>Add to Home Screen</b>.</p>`:`<p class="muted">Open the browser menu (⋮) and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>`}</div>
    <div class="stack"><h3>Account</h3><p class="muted">Signed in as <b>${esc(me?.email||"owner")}</b></p><button class="btn-ghost" id="stOut">Sign out</button></div>`,()=>{
    $("stAddP").onclick=()=>productForm();
    document.querySelectorAll("[data-pe]").forEach(b=>b.onclick=()=>productForm(P(b.dataset.pe)));
    $("stSave").onclick=()=>run($("stSave"),"save the settings",()=>api("/settings?on_conflict=id",{method:"POST",prefer:"resolution=merge-duplicates,return=minimal",body:{id:1,target:Number($("stT").value)||5,pay:Number($("stP").value)||0}}),"Saved");
    $("stInstall")&&($("stInstall").onclick=async()=>{installEvt.prompt();await installEvt.userChoice;installEvt=null;closeSheet()});
    $("stOut").onclick=signOut;
  });
}
function productForm(p){
  openSheet(p?"Edit product":"Add a product",`
    <label class="f">Name<input id="pfN" value="${esc(p?.name)}" placeholder="e.g. Massage gun"></label>
    <div class="grid2"><label class="f">Selling price (GH₵)<input id="pfP" type="number" min="0" step="0.5" inputmode="decimal" value="${p?Number(p.price):""}"></label>
    <label class="f">Your cost (GH₵)<input id="pfC" type="number" min="0" step="0.5" inputmode="decimal" value="${p&&Number(p.cost)?Number(p.cost):""}" placeholder="what you paid"></label></div>
    <label class="f">Warn me when stock is at or below<input id="pfL" type="number" min="0" step="1" value="${p?.low_stock??5}"></label>
    <button class="btn-primary btn-block" id="pfSave">${p?"Save changes":"Add product"}</button>
    ${p?`<button class="btn-ghost btn-block" id="pfPause">${p.active===false?"Resume this product":"Pause this product"}</button>`:""}
    <p class="small muted">Changing a price doesn't change sales already recorded.</p>`,()=>{
    $("pfSave").onclick=()=>{const name=$("pfN").value.trim(),price=Number($("pfP").value);if(!name||!(price>=0)||$("pfP").value===""){toast("Enter a name and selling price.",true);return}
      const row={name,price,cost:Number($("pfC").value)||0,low_stock:Number($("pfL").value)||0};
      if(p) run($("pfSave"),"save the product",()=>upd("products",p.id,row),"Saved");
      else run($("pfSave"),"add the product",()=>ins("products",{id:newId(),no:S.products.reduce((a,x)=>Math.max(a,x.no||0),0)+1,...row,active:true}),"Product added");
    };
    if(p) $("pfPause").onclick=()=>run($("pfPause"),"change the product",()=>upd("products",p.id,{active:p.active===false}),"Saved");
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
