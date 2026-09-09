"use strict";
let liveProgress=null,progressPending=false;
const conversationDrafts=new Map();
let mainEdit=null,mainSaving=false,mainDrag=null;
let nativeReading=false;
let editorView="working",editorRendered="";
const editorScroll=new Map();
let focusReading=false,outlineOpen=false,historyOpen=false,conversationExpanded=false;
let state={reports:[],csrf:"",codex_available:false}, selectedReport=null, selectedPage=null, viewedRevision=null, toastTimer, outlineDraft=null, lastDrawn="";
const $=s=>document.querySelector(s), esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const date=s=>s?new Date(s).toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}):"";
const reportSignature=r=>JSON.stringify(r?{...r,live_progress:undefined}:r);
const report=()=>state.reports.find(r=>r.id===selectedReport);
const page=()=>report()?.pages.find(p=>p.id===selectedPage);
const jobFor=(r,p)=>[...r.jobs].reverse().find(j=>j.page_id===p);
const active=j=>j&&["queued","running"].includes(j.status);
function navRead(key,fallback){try{return JSON.parse(localStorage.getItem('studio-nav-'+key))??fallback}catch{return fallback}}
function navSave(key,value){try{localStorage.setItem('studio-nav-'+key,JSON.stringify(value))}catch{}}
const navSeen=navRead('seen',{}),navRecent=navRead('recent',{}),navPositions=new Map(),navObserved=new Map(),navFlashes=new Map();
let navLastPage=null;
function replyStamp(r,p){const j=[...r.jobs].reverse().find(j=>j.page_id===p.id&&['completed','failed','interrupted'].includes(j.status));return j?j.id+':'+j.status+':'+(j.completed_at||'')+':'+(p.draft_revision||''):p.draft_revision||''}
function isUnread(r,p){const stamp=replyStamp(r,p);return !!stamp&&navSeen[r.id+'/'+p.id]!==stamp}
function rememberPage(r,p){if(!r||!p)return;const reportItem=state.reports.find(x=>x.id===r),pageItem=reportItem?.pages.find(x=>x.id===p);if(pageItem){navSeen[r+'/'+p]=replyStamp(reportItem,pageItem);navSave('seen',navSeen)}navRecent[r]=[p,...(navRecent[r]||[]).filter(x=>x!==p)].slice(0,5);navSave('recent',navRecent)}
function watchReplies(){for(const r of state.reports)for(const p of r.pages){const key=r.id+'/'+p.id,stamp=replyStamp(r,p),old=navObserved.get(key);if(old!==undefined&&stamp&&stamp!==old)navFlashes.set(key,Date.now());navObserved.set(key,stamp)}paintNav()}
function navBadge(r,p){return `<small class="nav-status">${esc(status(p,r))}${isUnread(r,p)?'<b class="nav-unread">新回复</b>':''}</small>`}
function navAttention(r){const waiting=r.pages.filter(p=>['draft','review'].includes(pageTone(p,r))),writing=r.pages.filter(p=>pageTone(p,r)==='busy'),fresh=r.pages.filter(p=>isUnread(r,p));const recent=(navRecent[r.id]||[]).map(id=>r.pages.find(p=>p.id===id)).filter(Boolean);const shortcuts=[...fresh,...writing,...recent].filter((p,i,a)=>a.findIndex(x=>x.id===p.id)===i).slice(0,3);return `<div class="nav-queues"><button data-nav-queue="fresh" ${fresh.length?'':'disabled'}>新回复 <b>${fresh.length}</b></button><button data-nav-queue="review" ${waiting.length?'':'disabled'}>待审核 <b>${waiting.length}</b></button><button data-nav-queue="busy" ${writing.length?'':'disabled'}>写作中 <b>${writing.length}</b></button></div><div class="nav-shortcuts">${shortcuts.map(p=>`<button data-nav-jump="${p.id}" title="${esc(p.title)}"><span class="nav-shortcut-tag">${isUnread(r,p)?'新回复':pageTone(p,r)==='busy'?'写作中':'最近'}</span><span>${esc(p.title)}</span></button>`).join('')}</div><button class="nav-locate" data-nav-locate>定位当前页</button>`}
function locateCurrent(){const list=$('.main-page-list'),row=list?.querySelector(`[data-main-id="${selectedPage}"]`);if(!row||!list.clientHeight)return;const a=row.getBoundingClientRect(),b=list.getBoundingClientRect();if(a.top<b.top)list.scrollTop-=b.top-a.top+8;else if(a.bottom>b.bottom)list.scrollTop+=a.bottom-b.bottom+8}
function paintNav(){const r=report(),box=$('#nav-attention');if(!r||!box)return;const html=navAttention(r);if(box.innerHTML!==html)box.innerHTML=html;document.querySelectorAll('.main-page-row').forEach(row=>{const p=r.pages.find(p=>p.id===row.dataset.mainId);if(!p)return;const b=row.querySelector('.page-choice');if(!b)return;b.dataset.state=pageTone(p,r);b.classList.toggle('running',pageTone(p,r)==='busy');row.classList.toggle('has-unread',isUnread(r,p));row.classList.toggle('just-returned',Date.now()-(navFlashes.get(r.id+'/'+p.id)||0)<6000);const badge=b.querySelector('small');if(badge&&badge.outerHTML!==navBadge(r,p))badge.outerHTML=navBadge(r,p)});const n=r.pages.filter(p=>isUnread(r,p)).length;const toggle=$('#toggle-outline');if(toggle)toggle.textContent=n?`页面目录 · ${n} 新回复`:'页面目录'}
document.addEventListener('click',e=>{const r=report();if(!r)return;const jump=e.target.closest('[data-nav-jump]'),queue=e.target.closest('[data-nav-queue]');if(jump)navigate(r.id,jump.dataset.navJump);if(queue){const mode=queue.dataset.navQueue,items=r.pages.filter(p=>mode==='fresh'?isUnread(r,p):mode==='busy'?pageTone(p,r)==='busy':['draft','review'].includes(pageTone(p,r)));if(items.length){const i=items.findIndex(p=>p.id===selectedPage);navigate(r.id,items[(i+1)%items.length].id)}}if(e.target.closest('[data-nav-locate]'))locateCurrent()});
function toast(message){$("#toast").textContent=message;$("#toast").hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("#toast").hidden=true,7000)}
async function request(url,body){const res=await fetch(url,{method:body?"POST":"GET",headers:body?{"Content-Type":"application/json","X-Studio-CSRF":state.csrf}:{},body:body?JSON.stringify(body):undefined});const data=await res.json();if(!res.ok)throw Error(data.error||"操作未完成");return data}
async function refresh(draw=true){const editWasReady=state.direct_edit_version;state=await request("/api/state");if(editWasReady!==state.direct_edit_version)lastDrawn="";watchReplies();refreshEditorCompilation();$("#agent-state").textContent=state.codex_available?"本机 Codex 已找到":"可收稿 · Codex 尚未就绪";if(draw)render();}
function navigate(r,p=null){rememberPage(r,p);outlineOpen=false;clearMainDrag();mainEdit=null;selectedReport=r;selectedPage=p;viewedRevision=null;location.hash=r?`${r}/${p||""}`:"";render()}
function progress(r){const n=r.pages.filter(p=>p.approved_revision&&!p.needs_review).length;return `${n} / ${r.pages.length} 页已定稿`}
function status(p,r){const j=jobFor(r,p.id);if(active(j))return j.status==="queued"?"排队准备中":"正在准备";if(j?.status==="failed"||j?.status==="interrupted")return "需要处理";if(p.needs_review)return "大纲已更新 · 待复核";if(p.approved_revision&&p.approved_revision===p.draft_revision)return "已定稿";if(p.approved_revision)return "有新草稿 · 定稿保留";if(p.draft_revision)return "待你审阅";return "待准备"}
function pageTone(p,r){const j=jobFor(r,p.id);if(active(j))return "busy";if(p.needs_review||j?.status==="failed"||j?.status==="interrupted")return "review";if(p.approved_revision===p.draft_revision&&p.approved_revision)return "approved";return p.draft_revision?"draft":"empty"}
function fit(){document.querySelectorAll('.preview-frame').forEach(e=>{const frame=e.querySelector('iframe');if(!frame)return;if(focusReading){const scale=Math.max(.05,Math.min((innerWidth-48)/1280,(innerHeight-120)/720));e.style.width=1280*scale+'px';e.style.height=720*scale+'px';frame.style.transform=`scale(${scale})`}else{e.style.width='';e.style.height='';frame.style.transform=`scale(${e.clientWidth/1280})`}})}
function syncReading(){if(!focusReading&&nativeReading&&document.fullscreenElement===document.documentElement){nativeReading=false;document.exitFullscreen().catch(()=>{})}document.body.classList.toggle('reading-mode',focusReading);$('.workspace')?.classList.toggle('focus-reading',focusReading);const toggle=$('#focus-reading');if(toggle){toggle.textContent=focusReading?'返回写作':'专注阅读';toggle.setAttribute('aria-pressed',String(focusReading))}fit()}
function bindReading(r,p){$('#reading-dock')?.remove();if(!p){focusReading=false;syncReading();return}const i=r.pages.findIndex(x=>x.id===p.id);$('#app').insertAdjacentHTML('beforeend',`<nav id="reading-dock" aria-label="专注阅读工具"><button id="reading-prev" ${i===0?'disabled':''} title="上一页">上一页</button><label class="reading-pages"><span>第 ${i+1} / ${r.pages.length} 页</span><select id="reading-page" aria-label="跳转阅读页面">${r.pages.map((x,n)=>`<option value="${x.id}" ${x.id===p.id?'selected':''}>${n+1} · ${esc(x.title)}</option>`).join('')}</select></label><button id="reading-next" ${i===r.pages.length-1?'disabled':''} title="下一页">下一页</button><span class="reading-divider"></span><button id="reading-fullscreen">全屏</button><button id="reading-exit">返回写作</button></nav>`);$('#reading-prev').onclick=()=>navigate(r.id,r.pages[i-1].id);$('#reading-next').onclick=()=>navigate(r.id,r.pages[i+1].id);$('#reading-page').onchange=e=>navigate(r.id,e.target.value);$('#reading-exit').onclick=()=>{focusReading=false;syncReading();$('#focus-reading')?.focus({preventScroll:true})};$('#reading-fullscreen').onclick=()=>{if(p.draft_revision)openFullscreenPreview(`/preview?report=${r.id}&page=${p.id}&revision=${viewedRevision||p.draft_revision}`,p.title,true);else toast('这一页尚无稿件，完成后可全屏预览')};syncReading()}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&focusReading&&!document.querySelector('dialog[open]')){focusReading=false;syncReading();$('#focus-reading')?.focus({preventScroll:true})}});

function render(){
 if($(".editor-compilation")&&$(".workspace")?.dataset.report)editorScroll.set($(".workspace").dataset.report,$(".page-panel").scrollTop);
 const oldList=$(".main-page-list"),oldReport=$(".workspace")?.dataset.report;if(oldList&&oldReport&&oldList.clientHeight)navPositions.set(oldReport,oldList.scrollTop);
 const root=$("#app"),r=report();lastDrawn=reportSignature(r);
 if(!r){focusReading=false;document.body.classList.remove("reading-mode");selectedReport=null;if(!state.reports.length){root.innerHTML=`<section class="empty"><div class="welcome-head"><div class="welcome-copy"><span class="eyebrow">准备 · 打磨 · 定稿</span><h1>从一份大纲，<br><em>走到一份定稿。</em></h1><p class="lead">你定方向，逐页把关。工作台组织页面、保留版本，把认可的成果收进同一份总稿。</p><button class="primary" id="first-report">准备第一份新汇报</button></div><div class="palette-shelf"><div class="shelf-caption"><span>给思考，留一处喜欢的空间。</span><small>点选配色，切换心情</small></div><div class="palette-books">${window.StudioAppearance.themes.map(t=>`<button type="button" class="palette-book" data-theme-pick="${t.id}" aria-label="切换到${t.name}配色" aria-pressed="${document.documentElement.dataset.theme===t.id}"><span>${t.name}</span><i aria-hidden="true"></i></button>`).join("")}</div><div class="shelf-line"></div><p class="palette-note">当前 · <span class="current-theme">${window.StudioAppearance.themes.find(t=>t.id===document.documentElement.dataset.theme).name}</span></p></div></div><div class="steps"><div><span>01 / 定主线</span><strong>写下大纲和每页判断</strong><p class="muted">背景与共同要求只整理一次，每页都有自己的任务和讨论区。</p></div><div><span>02 / 逐页打磨</span><strong>和 Codex 讨论，接收其他成果</strong><p class="muted">多页可以同时推进。同事或其他 Agent 的页面也能纳入。</p></div><div><span>03 / 收稿成篇</span><strong>确认一页，总稿更新一页</strong><p class="muted">确认各页后自动合稿，下载 HTML 即可分享或离线演示。</p></div></div></section>`;$("#first-report").onclick=openCreate;return}
 root.innerHTML=`<section class="report-list"><span class="eyebrow">你的汇报</span><h1>正在准备的内容</h1>${state.reports.map(x=>`<button class="report-row" data-report="${x.id}"><div><span class="eyebrow">${x.status==="published"?"整稿已确认":"汇报准备中"}</span><h2>${esc(x.title)}</h2><span class="muted">${esc(x.audience)}</span></div><div class="right">${progress(x)}<br>${date(x.updated_at)}</div></button>`).join("")}</section>`;root.querySelectorAll("[data-report]").forEach(b=>b.onclick=()=>navigate(b.dataset.report));return}
 if(!selectedPage||selectedPage!=="editor"&&!r.pages.some(p=>p.id===selectedPage))selectedPage=(navRecent[r.id]||[]).find(id=>id==="editor"||r.pages.some(p=>p.id===id))||r.pages[0].id;
 const p=page(),j=jobFor(r,selectedPage),allReady=r.pages.every(x=>x.approved_revision&&x.approved_revision===x.draft_revision&&!x.needs_review),busy=r.jobs.some(j=>active(j)&&(j.page_id==="editor"||r.pages.some(p=>p.id===j.page_id)));
 if(mainEdit&&!r.pages.some(p=>p.id===mainEdit.id))mainEdit=null;
 const titleChain=renderMainOutline(r);
 root.innerHTML=`<div data-report="${r.id}" class="workspace ${focusReading?"focus-reading":""} ${outlineOpen?"outline-open":""}"><aside class="outline" id="page-outline"><button class="back" id="all-reports">返回全部汇报</button><h2>${esc(r.title)}</h2><div class="small">${progress(r)}</div>${titleChain}<div class="editor-choice"><button class="page-choice ${selectedPage==="editor"?"selected":""}" data-page="editor"><span><strong>总工审稿</strong><small>主线 · 跨页一致性 · 总稿</small></span></button></div></aside><div class="workspace-main"><div class="report-bar"><div class="view-tools"><button id="toggle-outline" aria-controls="page-outline" aria-expanded="${outlineOpen}">页面目录</button><button id="focus-reading" aria-pressed="${focusReading}">${focusReading?"返回写作":"专注阅读"}</button></div><span class="info">${r.status==="published"?`整稿 ${r.published_release} 已确认`:progress(r)}${r.release?` · 当前合稿 ${r.release}`:""}</span><details class="report-actions"><summary>整篇操作</summary><div class="toolbar">${state.desktop_ready?'<button id="codex-open">在 Codex 打开汇报</button>':""}<button id="edit-outline">调整大纲</button><button id="start-all" ${!state.codex_available?"disabled":""}>准备待写页面</button>${r.release?`<button id="fullscreen-report">全屏预览总稿</button><a href="/report?report=${r.id}" target="_blank" rel="noopener">查看总稿</a><a href="/report?report=${r.id}&download=1">下载 HTML</a>`:""}<button id="finalize" class="primary" ${!allReady||busy||r.published_release===r.release?"disabled":""}>确认整稿</button></div></details></div><div class="workbody"><section class="page-panel">${p?renderPage(r,p):renderEditor(r)}</section>${renderConversation(r,p,j)}</div></div></div>`;
 bindMainOutline(r);
 const navList=$(".main-page-list");navList.scrollTop=navPositions.get(r.id)||0;paintNav();if(navLastPage!==r.id+"/"+selectedPage){locateCurrent();navRecent[r.id]=[selectedPage,...(navRecent[r.id]||[]).filter(id=>id!==selectedPage)].slice(0,5);navSave("recent",navRecent);navLastPage=r.id+"/"+selectedPage}navList.onscroll=()=>{if(navList.clientHeight)navPositions.set(r.id,navList.scrollTop)};
 $("#toggle-outline").onclick=()=>{outlineOpen=!outlineOpen;$(".workspace").classList.toggle("outline-open",outlineOpen);$("#toggle-outline").setAttribute("aria-expanded",String(outlineOpen));fit();if(outlineOpen)locateCurrent()};
 $("#focus-reading").onclick=()=>{if(!p){toast('选择一页稿件后进入专注阅读');return}focusReading=!focusReading;syncReading();if(focusReading)$('#reading-exit')?.focus({preventScroll:true})};
 bindReading(r,p);
 $("#expand-conversation").onclick=()=>{conversationExpanded=!conversationExpanded;$(".conversation").classList.toggle("expanded",conversationExpanded);$("#expand-conversation").textContent=conversationExpanded?"收起讨论":"展开讨论";$("#expand-conversation").setAttribute("aria-expanded",String(conversationExpanded))};
 $(".conversation-history").ontoggle=e=>historyOpen=e.target.open;
 $("#all-reports").onclick=()=>navigate(null);root.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>navigate(r.id,b.dataset.page));
 if($("#codex-open"))$("#codex-open").onclick=()=>act("/api/codex-open",{report_id:r.id},"已打开本汇报的 Codex 项目；先读 README 即可查看大纲和派工入口");
 $("#fullscreen-report")?.addEventListener("click",()=>openFullscreenPreview(`/report?report=${r.id}`,r.title,false));
 $("#edit-outline").onclick=openOutline;
 $("#start-all").onclick=()=>act("/api/start-all",{report_id:r.id},"待写页面已进入准备队列");
 $("#finalize").onclick=()=>act("/api/finalize",{report_id:r.id,release:r.release},"整稿已确认，点击下载 HTML 获取文件");
 const draftKey=`${r.id}/${selectedPage}`,messageInput=$("#message-input");messageInput.value=conversationDrafts.get(draftKey)||"";messageInput.oninput=()=>conversationDrafts.set(draftKey,messageInput.value);
 $("#message-form").onsubmit=async e=>{e.preventDefault();const input=$("#message-input"),value=input.value.trim();if(!value)return;try{await request("/api/message",{report_id:r.id,page_id:selectedPage,prompt:value});input.value="";conversationDrafts.delete(draftKey);await refresh();toast(selectedPage==="editor"?"总工开始审阅，其他页可继续工作":"已开始处理这一页，其他页可继续工作")}catch(err){toast(err.message)}};
 if(p){bindPage(r,p)}else{document.querySelectorAll("[data-editor-view]").forEach(b=>b.onclick=()=>{editorView=b.dataset.editorView;render()});$(".page-panel").scrollTop=editorScroll.get(r.id)||0}fit();
 paintProgress();pollProgress();
 const messages=$(".messages");if(messages)messages.scrollTop=messages.scrollHeight;
}
function renderPage(r,p){
 if(!viewedRevision||!p.revisions.some(v=>v.id===viewedRevision))viewedRevision=p.draft_revision;
 const rev=p.revisions.find(v=>v.id===viewedRevision),n=r.pages.findIndex(x=>x.id===p.id)+1;
 return `<div class="page-heading"><div><span class="eyebrow">第 ${n} 页 / 独立打磨</span><h2>${esc(p.title)}</h2></div><span class="status" data-state="${pageTone(p,r)}">${status(p,r)}</span></div><div class="preview-shell">${rev?`<div class="preview-frame"><iframe title="当前页预览" sandbox="allow-scripts allow-popups" src="/preview?report=${r.id}&page=${p.id}&revision=${rev.id}"></iframe></div><div class="preview-footer"><button id="fullscreen-page" class="primary" type="button">全屏预览</button><button id="direct-edit-page" type="button" ${state.direct_edit_version===2?'':'disabled title="等待当前写作任务完成后启用"'}>${state.direct_edit_version===2?"直接编辑":"直接编辑 · 更新待启用"}</button><span>${esc(rev.origin)} · ${date(rev.created_at)}</span><a target="_blank" rel="noopener" href="/preview?report=${r.id}&page=${p.id}&revision=${rev.id}">单独查看</a></div>`:`<div class="preview-empty"><div><strong>先把这一页讲清楚</strong><p>在右侧讨论方向或开始制作。<br>也可以在下方接收已有 HTML 页面。</p></div></div>`}</div><div class="approval"><span>${rev?(p.needs_review?esc(p.review_reason||"请按最新大纲重新核对本页"):p.approved_revision===rev.id?"当前查看的版本已收进总稿":rev.id!==p.draft_revision?"正在查看历史版本":"确认后，这一版会保留并自动合入总稿"):'完成后，页面将在这里预览'}</span>${p.approved_revision?'<button type="button" id="revise-page">继续修改</button>':''}<button class="primary" id="approve-page" ${!rev||rev.id!==p.draft_revision||p.approved_revision===rev.id&&!p.needs_review?"disabled":""}>${p.needs_review?"复核后采用这版":"采用这版，合入总稿"}</button></div>${rev&&p.draft_revision!==rev.id?'<button id="show-latest">查看最新草稿</button>':""}<details class="page-support"><summary>任务、版本与收稿</summary><div class="page-support-content"><details class="task-brief"><summary>本页任务与共同背景</summary><p>${esc(p.brief||"可在右侧补充本页要讲清楚的判断。")}</p><p class="muted">${esc(r.brief||"尚未补充共同背景")}</p><form id="brief-form"><label>本页任务<textarea name="brief" rows="3">${esc(p.brief)}</textarea></label><button type="submit">保存任务</button></form></details><details class="details-row"><summary>历史版本${p.revisions.length?` · ${p.revisions.length}`:""}</summary><div class="details-content">${[...p.revisions].reverse().map((v,i)=>`<div class="version-row"><div class="version-info">版本 ${p.revisions.length-i}${v.id===p.approved_revision?' · <span class="saved-pill">当前定稿</span>':""}<small>${date(v.created_at)} · ${esc(v.origin)}</small></div><button data-view="${v.id}">查看</button>${v.id!==p.approved_revision?`<button data-restore="${v.id}">采用此版</button>`:""}</div>`).join("")||'<p class="hint">页面提交后自动保留版本。</p>'}</div></details><details class="details-row"><summary>接收其他 Agent 或同事的页面</summary><div class="details-content"><form id="import-form"><label>自包含 HTML 文件<input type="file" accept=".html,.htm" name="file" required></label><p class="file-hint">图片、样式和动效应内嵌。接收后仍由你预览、确认。</p><label>来源与交接说明<input name="origin" placeholder="例如：Fable 调研页 / 同事提供"></label><label>本页主要结论<textarea name="summary" rows="2"></textarea></label><label>证据及限制<textarea name="evidence" rows="3"></textarea></label><button type="submit">接收并预览</button></form></div></details>${rev?`<details class="details-row"><summary>本页结论与证据</summary><div class="details-content"><p class="message body">${esc(rev.summary)}</p><p class="message body">${esc(rev.evidence)}</p></div></details>`:""}</div></details>`;
}
function compilationSignature(r){return JSON.stringify([editorView,r.pages.map(p=>[p.id,p.title,p.draft_revision,p.approved_revision,p.needs_review])])}
function refreshEditorCompilation(){const r=report(),panel=$(".page-panel");if(selectedPage!=="editor"||!r||!panel?.querySelector(".editor-compilation")||editorRendered===compilationSignature(r))return;const scroll=panel.scrollTop;panel.innerHTML=renderEditor(r);panel.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>navigate(r.id,b.dataset.page));panel.querySelectorAll("[data-editor-view]").forEach(b=>b.onclick=()=>{editorView=b.dataset.editorView;refreshEditorCompilation()});fit();panel.scrollTop=scroll}
function renderEditor(r){editorRendered=compilationSignature(r);const working=editorView==='working',available=r.pages.filter(p=>working?p.draft_revision:p.approved_revision).length;return `<div class="page-heading"><div><span class="eyebrow">整篇连起来看，再逐页打磨</span><h2>总工审稿</h2></div></div><div class="editor-compile-bar"><div role="group" aria-label="合稿版本"><button data-editor-view="working" aria-pressed="${working}">最新工作合稿</button><button data-editor-view="approved" aria-pressed="${!working}">已确认合稿</button></div><span>${available} / ${r.pages.length} 页已有内容</span></div><p class="compile-explanation">${working?'按当前大纲串起每页最新草稿，收稿后自动更新；未确认的修改也能在这里通读。':'只展示每页已确认版本。继续修改不会覆盖这里，重新确认后才更新。'}</p><div class="editor-compilation">${r.pages.map((p,i)=>{const id=working?p.draft_revision:p.approved_revision;if(!id)return '';return `<article class="compiled-page ${id?'':'compiled-missing'}" data-compiled-page="${p.id}"><header><div><span class="compiled-number">${String(i+1).padStart(2,'0')}</span><strong>${esc(p.title)}</strong></div><span class="status" data-state="${pageTone(p,r)}">${working?esc(status(p,r)):id?(p.needs_review?'已确认 · 待复核':'已确认版本'):'尚未确认'}</span><button data-page="${p.id}">${p.approved_revision?'继续修改':'打开本页'}</button></header>${id?`<div class="preview-shell"><div class="preview-frame"><iframe title="合稿第 ${i+1} 页：${esc(p.title)}" loading="lazy" sandbox="allow-scripts allow-popups" src="/preview?report=${r.id}&page=${p.id}&revision=${id}"></iframe></div></div>`:`<p>${working?'本页尚无草稿，完成后自动出现在此处。':'本页确认后纳入已确认合稿。'}</p>`}</article>`}).join('')}</div>${available<r.pages.length?`<details class="compile-missing-list"><summary>${r.pages.length-available} 页${working?'尚无草稿':'尚未确认'}</summary>${r.pages.map((p,i)=>(working?p.draft_revision:p.approved_revision)?'':`<button data-page="${p.id}">${i+1} · ${esc(p.title)}</button>`).join('')}</details>`:''}${r.release?`<div class="report-links"><a href="/report?report=${r.id}&download=1">下载已确认合稿 HTML</a></div>`:''}${r.published_release?`<p class="hint">已确认整稿版本：${r.published_release}。修订确认后仍需重新发布，旧发布版保留。</p>`:''}`}

function renderConversation(r,p,j){const msgs=p?p.messages:r.editor_messages;return `<aside class="conversation ${conversationExpanded?"expanded":""}"><div class="conversation-head"><button type="button" id="expand-conversation" aria-expanded="${conversationExpanded}">${conversationExpanded?"收起讨论":"展开讨论"}</button><h3>${p?"和 Codex 打磨这一页":"和总工检查整篇"}</h3><p>${p?"本页独立讨论":"收稿不受审稿进度影响。"}</p>${renderTokenUsage(r,j)}</div><div id="page-live" class="page-live"></div><details class="conversation-history" ${historyOpen?"open":""}><summary>讨论记录 · ${msgs.length}</summary><div class="messages">${msgs.map(m=>`<div class="message ${m.role}"><div class="author">${m.role==="user"?"你的要求":"Codex"} · ${date(m.created_at)}</div><div class="body">${esc(m.text)}</div></div>`).join("")||`<p class="hint">${p?"先补充你的判断，或直接要求制作第一版。":"可以要求检查标题链、前后论证、重复信息或证据边界。"}</p>`}</div></details><form class="composer" id="message-form"><textarea id="message-input" aria-label="给这一页的要求" placeholder="${p?"写下本页的修改要求…":"请检查整篇主线，指出具体页面间的矛盾和缺口。"}" ${active(j)?"disabled":""}></textarea><div class="send-row"><span>${active(j)?"当前页处理完成后可继续":"开始处理会使用当前 Codex 账号额度"}</span><button class="primary" type="submit" ${active(j)||!state.codex_available?"disabled":""}>${p?"发送要求":"开始审稿"}</button></div></form></aside>`}
function bindPage(r,p){
 $("#direct-edit-page")?.addEventListener("click",()=>openDirectEditor(r,p));
 $("#revise-page")?.addEventListener("click",()=>{if(active(jobFor(r,p.id))){toast("这一页正在处理修改，原定稿仍保留");return}conversationExpanded=true;$(".conversation").classList.add("expanded");$("#expand-conversation").textContent="收起讨论";$("#expand-conversation").setAttribute("aria-expanded","true");$("#message-input").focus();toast("写下修改要求即可；新稿确认前，原定稿继续保留")});
 $("#fullscreen-page")?.addEventListener("click",()=>openFullscreenPreview(`/preview?report=${r.id}&page=${p.id}&revision=${viewedRevision}`,p.title,true));
 $("#approve-page").onclick=()=>{const rev=p.revisions.find(v=>v.id===viewedRevision);if(rev)act("/api/approve",{report_id:r.id,page_id:p.id,revision_id:rev.id,sha256:rev.sha256,outline_version:r.outline_version||1},"本页已定稿，总稿自动更新")};
 $("#show-latest")?.addEventListener("click",()=>{viewedRevision=p.draft_revision;render()});
 document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{viewedRevision=b.dataset.view;render()});
 document.querySelectorAll("[data-restore]").forEach(b=>b.onclick=()=>act("/api/restore",{report_id:r.id,page_id:p.id,revision_id:b.dataset.restore,outline_version:r.outline_version||1},"总稿已采用所选历史版本，其他页面保持原样"));
 $("#brief-form").onsubmit=e=>{e.preventDefault();act("/api/amend",{report_id:r.id,page_id:p.id,brief:new FormData(e.target).get("brief"),outline_version:r.outline_version||1},"本页任务已保存，后续讨论将采用新要求")};
 $("#import-form").onsubmit=async e=>{e.preventDefault();const form=new FormData(e.target),file=form.get("file");if(!file?.size)return;try{if(file.size>4_000_000)throw Error("单页文件请控制在 4 MB 以内");await request("/api/submit",{report_id:r.id,page_id:p.id,html:await file.text(),origin:form.get("origin")||"外部成果",summary:form.get("summary")||"",evidence:form.get("evidence")||""});viewedRevision=null;await refresh();toast("页面已接收，请预览后决定是否定稿")}catch(err){toast(err.message)}};
}
async function act(url,body,message){try{await request(url,body);await refresh();toast(message)}catch(err){toast(err.message)}}
function openCreate(){$("#create-error").textContent="";$("#create-dialog").showModal();$("[name=title]").focus()}
function openOutline(){const r=report();if(!r)return;const basic=p=>({id:p.id,title:p.title,brief:p.brief});outlineDraft={report:r.id,version:r.outline_version||1,pages:r.pages.map(basic),removed:(r.removed_pages||[]).map(basic)};$("#outline-error").textContent="";$("#outline-sort-status").textContent="";drawOutline();if(!$("#outline-dialog").open)$("#outline-dialog").showModal()}
function drawOutline(){
 $("#outline-version").textContent=`当前大纲第 ${outlineDraft.version} 版 · ${outlineDraft.pages.length} 页`;
 $("#outline-rows").innerHTML=outlineDraft.pages.map((p,i)=>`<section class="outline-edit-row" data-outline-index="${i}"><div class="outline-row-top"><div class="outline-row-position"><button type="button" class="outline-drag-handle" aria-label="拖动第 ${i+1} 页调整顺序" title="按住拖动；也可用上下方向键调整"><span aria-hidden="true">⠿</span> 拖动</button><strong>第 ${i+1} 页</strong></div><div><button type="button" data-outline-action="up" aria-label="第 ${i+1} 页上移" ${i===0?"disabled":""}>上移</button><button type="button" data-outline-action="down" aria-label="第 ${i+1} 页下移" ${i===outlineDraft.pages.length-1?"disabled":""}>下移</button><button type="button" data-outline-action="remove" aria-label="移出第 ${i+1} 页" ${outlineDraft.pages.length===1?"disabled":""}>移出大纲</button></div></div><label>页面标题<input data-outline-field="title" aria-label="第 ${i+1} 页标题" value="${esc(p.title)}" maxlength="180" required></label><label>本页任务<textarea data-outline-field="brief" aria-label="第 ${i+1} 页任务" rows="2">${esc(p.brief)}</textarea></label></section>`).join("");
 $("#outline-add").disabled=outlineDraft.pages.length>=60;
 $("#removed-outline").hidden=!outlineDraft.removed.length;
 $("#outline-removed").innerHTML=outlineDraft.removed.map((p,i)=>`<div class="removed-row"><span>${esc(p.title)}</span><button type="button" data-outline-restore="${i}" ${outlineDraft.pages.length>=60?"disabled":""}>恢复到末尾</button></div>`).join("");
}
function moveOutlinePage(from,to){
 const pages=outlineDraft.pages;
 if(from===to||from<0||to<0||from>=pages.length||to>=pages.length)return;
 const [item]=pages.splice(from,1);pages.splice(to,0,item);drawOutline();
 $("#outline-sort-status").textContent=`「${item.title||"新增页面"}」已从第 ${from+1} 页移到第 ${to+1} 页，保存后更新总稿。`;
 const row=$("#outline-rows").children[to];row.querySelector('.outline-drag-handle').focus({preventScroll:true});row.scrollIntoView({block:"nearest"});
}
let outlineDrag=null;
function clearOutlineDrag(){
 const drag=outlineDrag;if(!drag)return;outlineDrag=null;cancelAnimationFrame(drag.frame);
 drag.ghost?.remove();drag.row.classList.remove('is-dragging');
 $("#outline-dialog").classList.remove('outline-sorting');
 document.querySelectorAll('.outline-drop-before,.outline-drop-after').forEach(row=>row.classList.remove('outline-drop-before','outline-drop-after'));
 if(drag.handle.hasPointerCapture(drag.pointer))drag.handle.releasePointerCapture(drag.pointer);
}
function trackOutlineDrag(){
 const drag=outlineDrag;if(!drag?.started)return;
 const dialog=$("#outline-dialog"),bounds=dialog.getBoundingClientRect();
 const inside=drag.x>=bounds.left&&drag.x<=bounds.right&&drag.y>=bounds.top&&drag.y<=bounds.bottom;
 const edge=64,step=drag.y<bounds.top+edge?-Math.ceil((bounds.top+edge-drag.y)/4):drag.y>bounds.bottom-edge?Math.ceil((drag.y-bounds.bottom+edge)/4):0;
 if(inside&&step)dialog.scrollTop+=Math.max(-22,Math.min(22,step));
 const rows=[...$("#outline-rows").children].filter(row=>row!==drag.row);
 let to=rows.findIndex(row=>{const r=row.getBoundingClientRect();return drag.y<r.top+r.height/2});if(to<0)to=rows.length;
 drag.to=inside?to:null;
 document.querySelectorAll('.outline-drop-before,.outline-drop-after').forEach(row=>row.classList.remove('outline-drop-before','outline-drop-after'));
 if(inside&&rows.length){const row=rows[to]||rows.at(-1);row.classList.add(rows[to]?'outline-drop-before':'outline-drop-after')}
 drag.ghost.textContent=inside?`第 ${drag.from+1} 页 → 放到第 ${to+1} 页`:'移回大纲窗口放置，或松开取消';
 drag.ghost.style.left=Math.max(8,Math.min(innerWidth-260,drag.x+16))+'px';
 drag.ghost.style.top=Math.max(8,Math.min(innerHeight-58,drag.y+18))+'px';
 drag.frame=requestAnimationFrame(trackOutlineDrag);
}
$("#outline-rows").addEventListener('pointerdown',e=>{
 const handle=e.target.closest('.outline-drag-handle');if(!handle||e.button!==0||outlineDraft.pages.length<2)return;
 clearOutlineDrag();e.preventDefault();handle.focus({preventScroll:true});
 const row=handle.closest('[data-outline-index]');
 outlineDrag={handle,row,pointer:e.pointerId,from:Number(row.dataset.outlineIndex),to:null,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,started:false,frame:0};
 handle.setPointerCapture(e.pointerId);
});
$("#outline-rows").addEventListener('pointermove',e=>{
 const drag=outlineDrag;if(!drag||drag.pointer!==e.pointerId)return;drag.x=e.clientX;drag.y=e.clientY;
 if(!drag.started&&Math.hypot(drag.x-drag.startX,drag.y-drag.startY)>=6){
  drag.started=true;drag.row.classList.add('is-dragging');$("#outline-dialog").classList.add('outline-sorting');
  drag.ghost=document.createElement('div');drag.ghost.className='outline-drag-ghost';drag.ghost.setAttribute('aria-hidden','true');$("#outline-dialog").appendChild(drag.ghost);trackOutlineDrag();
 }
 if(drag.started)e.preventDefault();
});
$("#outline-rows").addEventListener('pointerup',e=>{
 const drag=outlineDrag;if(!drag||drag.pointer!==e.pointerId)return;
 if(drag.started){drag.x=e.clientX;drag.y=e.clientY;cancelAnimationFrame(drag.frame);trackOutlineDrag()}
 const {from,to,started}=drag;clearOutlineDrag();if(started&&to!==null)moveOutlinePage(from,to);
});
$("#outline-rows").addEventListener('pointercancel',clearOutlineDrag);
$("#outline-rows").addEventListener('lostpointercapture',clearOutlineDrag);
$("#outline-rows").addEventListener('keydown',e=>{
 const handle=e.target.closest('.outline-drag-handle');if(!handle||!['ArrowUp','ArrowDown'].includes(e.key)||outlineDrag)return;
 e.preventDefault();const from=Number(handle.closest('[data-outline-index]').dataset.outlineIndex);moveOutlinePage(from,from+(e.key==='ArrowUp'?-1:1));
});
$("#outline-dialog").addEventListener('cancel',e=>{if(outlineDrag){e.preventDefault();clearOutlineDrag();$("#outline-sort-status").textContent='已取消拖动，页面顺序保持原样。'}});
$("#outline-dialog").addEventListener('close',clearOutlineDrag);
$("#outline-rows").oninput=e=>{const field=e.target.dataset.outlineField;if(field)outlineDraft.pages[Number(e.target.closest('[data-outline-index]').dataset.outlineIndex)][field]=e.target.value};
$("#outline-rows").onclick=e=>{const b=e.target.closest('[data-outline-action]');if(!b||b.disabled)return;const i=Number(b.closest('[data-outline-index]').dataset.outlineIndex),action=b.dataset.outlineAction,ps=outlineDraft.pages;if(action==="remove"){const [p]=ps.splice(i,1);if(p.id)outlineDraft.removed.push(p)}else{const j=i+(action==="up"?-1:1);[ps[i],ps[j]]=[ps[j],ps[i]]}drawOutline()};
$("#outline-removed").onclick=e=>{const b=e.target.closest('[data-outline-restore]');if(!b||b.disabled)return;outlineDraft.pages.push(...outlineDraft.removed.splice(Number(b.dataset.outlineRestore),1));drawOutline()};
$("#outline-add").onclick=()=>{outlineDraft.pages.push({title:"",brief:""});drawOutline();$("#outline-rows").lastElementChild.querySelector('input').focus()};
$("#close-outline").onclick=()=>$("#outline-dialog").close();
$("#outline-reload").onclick=async()=>{try{await refresh(false);openOutline()}catch(err){$("#outline-error").textContent=err.message}};
$("#outline-form").onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('[type="submit"]');button.disabled=true;try{await request("/api/outline",{report_id:outlineDraft.report,outline_version:outlineDraft.version,pages:outlineDraft.pages});$("#outline-dialog").close();await refresh();toast("大纲与工作总稿已更新；后续任务使用最新大纲")}catch(err){$("#outline-error").textContent=err.message}finally{button.disabled=false}};
$("#new-report").onclick=openCreate;$("#close-dialog").onclick=()=>$("#create-dialog").close();
$("#create-form").onsubmit=async e=>{e.preventDefault();const form=new FormData(e.target),button=e.target.querySelector('[type="submit"]');button.disabled=true;try{const data=await request("/api/create",Object.fromEntries(form));$("#create-dialog").close();selectedReport=data.result.id;selectedPage=data.result.pages[0].id;viewedRevision=null;await refresh();location.hash=`${selectedReport}/${selectedPage}`;e.target.reset();toast(data.result.codex_notice?"汇报已建立；Codex 入口稍后可重试："+data.result.codex_notice:"新汇报与 Codex 项目已建立，每页都有独立工作区");if(form.get("start")==="now"){try{await request("/api/start-all",{report_id:selectedReport});await refresh()}catch(err){toast("汇报已经保存；启动页面任务未完成："+err.message)}}}catch(err){$("#create-error").textContent=err.message}finally{button.disabled=false}};
window.addEventListener("resize",()=>{fit();locateCurrent()});
window.addEventListener("hashchange",()=>{const [r,p]=location.hash.slice(1).split("/");if(r!==selectedReport||p&&p!==selectedPage){clearMainDrag();mainEdit=null;selectedReport=r||null;selectedPage=p||null;viewedRevision=null;render()}});
const initial=location.hash.slice(1).split("/");selectedReport=initial[0]||null;selectedPage=initial[1]||null;
refresh().catch(err=>$("#app").innerHTML=`<div class="error-page">本机工作台连接失败：${esc(err.message)}</div>`);
setInterval(async()=>{try{const focus=document.activeElement,editing=mainSaving||mainDrag||mainEdit||focus&&["TEXTAREA","INPUT","SELECT"].includes(focus.tagName)||$("#create-dialog").open||$("#outline-dialog").open;await refresh(false);if(!editing&&lastDrawn!==reportSignature(report()))render()}catch{}},3500);

function elapsed(job){const end=job.completed_at?new Date(job.completed_at):Date.now(),start=new Date(job.started_at||job.created_at);const seconds=Math.max(0,Math.floor((end-start)/1000));return seconds<60?`${seconds} 秒`:`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`}
function progressText(job){if(job.status==='queued')return '排队中，等待写作位置';if(job.status==='completed')return '已完成，草稿可预览';if(job.status==='failed'||job.status==='interrupted')return job.error||'需要处理';return job.activity||(job.events.length?'已收到作者更新，继续处理中':'正在准备，等待首条公开进展')}
function replaceLive(element,html){if(element&&element.innerHTML!==html)element.innerHTML=html}
function paintProgress(){
 const r=report(),box=$('#page-live');if(!r||!box)return;
 const current=jobFor(r,selectedPage);if(!current){replaceLive(box,'');return}
 const mirror=liveProgress?.report_id===r.id?liveProgress.jobs.find(j=>j.id===current.id):null;
 const j={...current,events:[],...mirror},msgs=selectedPage==='editor'?r.editor_messages:page()?.messages||[];
 const final=[...msgs].reverse().find(m=>m.role==='assistant'&&m.job_id===j.id);
 const latest=final?.text||j.events.at(-1)?.text||'';
 const title=j.status==='completed'?'Codex 最新回复':j.status==='failed'||j.status==='interrupted'?'本次任务需要处理':'Codex 最新进展';
 const wasOpen=box.querySelector('details')?.open;
 const history=j.events.slice(0,final?j.events.length:-1);
 replaceLive(box,`<section class="latest-update"><div class="latest-update-head"><strong>${title}</strong><small>${elapsed(j)}</small></div><div class="latest-update-text" role="status">${esc(j.connection_notice||latest||progressText(j))}</div>${latest&&active(j)?`<small class="latest-activity">${esc(j.activity||'正在继续处理')}</small>`:''}${j.error?`<p class="latest-error">${esc(j.error)}</p>`:''}${history.length?`<details ${wasOpen?'open':''}><summary>较早进展 · ${history.length}</summary><div class="earlier-updates">${history.map(e=>`<p>${esc(e.text)}</p>`).join('')}</div></details>`:''}</section>`);
}

async function pollProgress(){if(progressPending||!report())return;progressPending=true;const rid=selectedReport;try{const result=await request('/api/progress?report='+encodeURIComponent(rid));if(selectedReport===rid){liveProgress=result;paintProgress()}}catch{const mirror=report()?.live_progress;if(mirror?.report_id===selectedReport){liveProgress=mirror;paintProgress()}else{paintProgress()}}finally{progressPending=false}}
setInterval(pollProgress,3000);

function outlineItems(r){return r.pages.map(({id,title,brief})=>({id,title,brief}))}
function renderMainOutline(r){
 const disabled=mainSaving?'disabled':'';
 return `<div id="nav-attention" class="nav-attention">${navAttention(r)}</div><div class="main-outline-tools"><button id="main-add-page" ${disabled} ${r.pages.length>=60?'disabled':''}>＋ 新增页面</button><small role="status">${mainSaving?'正在保存…':'拖动排序 · 更改自动保存'}</small></div><div class="main-page-list">${r.pages.map((p,i)=>`<div class="main-page-row" data-main-id="${p.id}"><div class="main-page-top"><button class="main-drag" aria-label="拖动第 ${i+1} 页排序" title="按住拖动；上下方向键也可排序" ${disabled} ${r.pages.length<2?'disabled':''}>⠿</button>${mainEdit?.id===p.id?`<div class="main-rename"><label>第 ${i+1} 页名称<input id="main-page-name" aria-label="页面名称" maxlength="180" value="${esc(mainEdit.value)}" ${disabled}></label><small>回车或离开输入框保存 · Esc 取消</small></div>`:`<button class="page-choice ${selectedPage===p.id?'selected':''} ${active(jobFor(r,p.id))?'running':''}" data-state="${pageTone(p,r)}" data-page="${p.id}"><span class="num">${String(i+1).padStart(2,'0')}</span><span><strong>${esc(p.title)}</strong>${navBadge(r,p)}</span></button>`}</div><div class="main-page-actions"><button data-main-rename="${p.id}" ${disabled}>改名</button><button data-main-insert="${p.id}" ${disabled} ${r.pages.length>=60?'disabled':''}>下方新增</button><button data-main-remove="${p.id}" ${disabled} ${r.pages.length<2?'disabled':''}>删除</button></div></div>`).join('')}</div>${r.removed_pages?.length?`<details class="main-removed"><summary>已删除页面 · ${r.removed_pages.length}</summary><p>内容与历史版本保留，可恢复。</p>${r.removed_pages.map(p=>`<div><span>${esc(p.title)}</span><button data-main-restore="${p.id}" ${disabled} ${r.pages.length>=60?'disabled':''}>恢复</button></div>`).join('')}</details>`:''}`;
}
async function saveMainOutline(r,items,{select,renameNew=false,message='页面顺序已保存，页码与总稿已更新'}={}){
 if(mainSaving)return false;mainSaving=true;
 document.querySelectorAll('.main-outline-tools button,.main-page-actions button,.main-drag,.main-removed button').forEach(b=>b.disabled=true);
 const indicator=$('.main-outline-tools small');if(indicator)indicator.textContent='正在保存…';
 try{
  const response=await request('/api/outline',{report_id:r.id,outline_version:r.outline_version||1,pages:items});
  const updated=response.result;state.reports=state.reports.map(x=>x.id===r.id?updated:x);
  if(selectedReport===r.id){
   if(renameNew){const added=updated.pages.find(p=>!r.pages.some(old=>old.id===p.id));selectedPage=added.id;viewedRevision=null;mainEdit={id:added.id,value:added.title}}
   else{mainEdit=null;if(select)selectedPage=select}
   if(!updated.pages.some(p=>p.id===selectedPage)&&selectedPage!=='editor')selectedPage=updated.pages[0].id;
   history.replaceState(null,'',`#${r.id}/${selectedPage}`);
  }
  toast(message);return true;
 }catch(error){
  try{await refresh(false)}catch{}
  toast('更改未保存：'+error.message+'。请核对后重试。');return false;
 }finally{mainSaving=false;if(selectedReport===r.id){render();if(mainEdit){$('#main-page-name')?.focus();$('#main-page-name')?.select()}}}
}
function beginMainRename(id){if(mainSaving)return;const p=report().pages.find(p=>p.id===id);mainEdit={id,value:p.title};render();$('#main-page-name').focus();$('#main-page-name').select()}
function commitMainRename(){
 if(!mainEdit||mainSaving)return;const r=report(),edit=mainEdit,title=edit.value.trim();
 if(!title){toast('页面名称不能为空');$('#main-page-name')?.focus();return}
 const old=r.pages.find(p=>p.id===edit.id);if(!old)return;
 if(old.title===title){mainEdit=null;render();return}
 saveMainOutline(r,outlineItems(r).map(p=>p.id===edit.id?{...p,title}:p),{message:'页面名称已保存，大纲与总稿已更新'});
}
function addMainPage(after){if(mainSaving)return;const r=report(),items=outlineItems(r);if(items.length>=60)return;const position=after?items.findIndex(p=>p.id===after)+1:items.length;items.splice(position,0,{title:'新增页面',brief:''});saveMainOutline(r,items,{renameNew:true,message:'新页面已加入，可直接修改名称并拖到所需位置'})}
function bindMainOutline(r){
 $('#main-add-page').onclick=()=>addMainPage();
 document.querySelectorAll('[data-main-rename]').forEach(b=>b.onclick=()=>beginMainRename(b.dataset.mainRename));
 document.querySelectorAll('[data-main-insert]').forEach(b=>b.onclick=()=>addMainPage(b.dataset.mainInsert));
 document.querySelectorAll('[data-main-remove]').forEach(b=>b.onclick=()=>{if(mainSaving)return;const live=report(),i=live.pages.findIndex(p=>p.id===b.dataset.mainRemove),items=outlineItems(live);items.splice(i,1);saveMainOutline(live,items,{select:selectedPage===b.dataset.mainRemove?items[Math.min(i,items.length-1)].id:null,message:'页面已删除，总稿已更新；可在左侧“已删除页面”中恢复'})});
 document.querySelectorAll('[data-main-restore]').forEach(b=>b.onclick=()=>{const live=report(),p=live.removed_pages.find(p=>p.id===b.dataset.mainRestore);saveMainOutline(live,[...outlineItems(live),{id:p.id,title:p.title,brief:p.brief}],{select:p.id,message:'页面与历史版本已恢复'})});
 const input=$('#main-page-name');if(input){input.oninput=()=>{if(mainEdit)mainEdit.value=input.value};input.onblur=commitMainRename;input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commitMainRename()}if(e.key==='Escape'){e.preventDefault();mainEdit=null;render()}}}
 const list=$('.main-page-list');
 list.onpointerdown=e=>{const handle=e.target.closest('.main-drag');if(!handle||handle.disabled||e.button!==0||mainSaving||mainEdit)return;e.preventDefault();handle.focus();const live=report();mainDrag={handle,row:handle.closest('.main-page-row'),pointer:e.pointerId,report:{...live},items:outlineItems(live),from:live.pages.findIndex(p=>p.id===handle.closest('.main-page-row').dataset.mainId),x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,to:null,started:false,frame:0};handle.setPointerCapture(e.pointerId)};
 list.onpointermove=e=>{const d=mainDrag;if(!d||d.pointer!==e.pointerId)return;d.x=e.clientX;d.y=e.clientY;if(!d.started&&Math.hypot(d.x-d.startX,d.y-d.startY)>6){d.started=true;d.row.classList.add('main-dragging');d.ghost=document.createElement('div');d.ghost.className='outline-drag-ghost';document.body.appendChild(d.ghost);trackMainDrag()}if(d.started)e.preventDefault()};
 list.onpointerup=e=>{const d=mainDrag;if(!d||d.pointer!==e.pointerId)return;if(d.started){d.x=e.clientX;d.y=e.clientY;cancelAnimationFrame(d.frame);trackMainDrag()}clearMainDrag();if(d.started&&d.to!==null&&d.to!==d.from){const [p]=d.items.splice(d.from,1);d.items.splice(d.to,0,p);saveMainOutline(d.report,d.items)}};
 list.onpointercancel=clearMainDrag;list.onlostpointercapture=clearMainDrag;
 list.onkeydown=e=>{if(!e.target.closest('.main-drag')||mainSaving||mainDrag||!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const live=report(),items=outlineItems(live),from=items.findIndex(p=>p.id===e.target.closest('.main-page-row').dataset.mainId),to=from+(e.key==='ArrowUp'?-1:1);if(to<0||to>=items.length)return;const [p]=items.splice(from,1);items.splice(to,0,p);saveMainOutline(live,items).then(()=>document.querySelector(`[data-main-id="${p.id}"] .main-drag`)?.focus())};
}
function clearMainDrag(){const d=mainDrag;if(!d)return;mainDrag=null;cancelAnimationFrame(d.frame);d.ghost?.remove();d.row.classList.remove('main-dragging');document.querySelectorAll('.main-drop-before,.main-drop-after').forEach(e=>e.classList.remove('main-drop-before','main-drop-after'));if(d.handle.hasPointerCapture(d.pointer))d.handle.releasePointerCapture(d.pointer)}
function trackMainDrag(){
 const d=mainDrag;if(!d?.started)return;const list=$('.main-page-list'),b=list.getBoundingClientRect(),inside=d.x>=b.left&&d.x<=b.right&&d.y>=b.top&&d.y<=b.bottom;
 const step=d.y<b.top+45?-Math.ceil((b.top+45-d.y)/4):d.y>b.bottom-45?Math.ceil((d.y-b.bottom+45)/4):0;if(inside&&step)list.scrollTop+=Math.max(-18,Math.min(18,step));
 const rows=[...list.children].filter(row=>row!==d.row);let to=rows.findIndex(row=>{const r=row.getBoundingClientRect();return d.y<r.top+r.height/2});if(to<0)to=rows.length;d.to=inside?to:null;
 document.querySelectorAll('.main-drop-before,.main-drop-after').forEach(row=>row.classList.remove('main-drop-before','main-drop-after'));if(inside&&rows.length)(rows[to]||rows.at(-1)).classList.add(rows[to]?'main-drop-before':'main-drop-after');
 d.ghost.textContent=inside?`松开放到第 ${to+1} 页`:'移回页面列表放置，或松开取消';d.ghost.style.left=Math.max(8,Math.min(innerWidth-260,d.x+18))+'px';d.ghost.style.top=Math.max(8,Math.min(innerHeight-55,d.y+16))+'px';d.frame=requestAnimationFrame(trackMainDrag);
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mainDrag){e.preventDefault();clearMainDrag()}});

function renderTokenUsage(r,job){
 const latest=[...r.jobs].reverse().find(x=>x.page_id===selectedPage&&x.usage);
 const usage=latest?.usage,fmt=n=>Number.isFinite(n)?n.toLocaleString('zh-CN'):'未提供';
 const input=usage?.input_tokens,cached=usage?.cached_input_tokens,uncached=Number.isFinite(input)&&Number.isFinite(cached)?Math.max(0,input-cached):null;
 const stats=job?.context_stats;
 return `<details class="token-usage"><summary>上下文与用量</summary><p>${stats?`${stats.mode==='delta'?'本次增量传递':'本次初始化上下文'} · 任务消息 ${fmt(stats.prompt_chars)} 字符（不是 token 总数）`:'按页隔离上下文；实际用量在任务完成后记录。'}</p>${usage?`<p>最近有记录的一次任务：<br>输入 ${fmt(input)} · 其中缓存命中 ${fmt(cached)}<br>未命中缓存 ${fmt(uncached)} · 输出 ${fmt(usage.output_tokens)}</p>`:'<p>尚无已完成任务的用量记录。</p>'}<p class="hint">CLI 记录包含任务内多轮模型调用。缓存命中仍属于输入；这些数字不等同于账号额度扣除或费用。进展刷新、排序、收稿与合稿不调用模型。</p></details>`;
}

let fullscreenPreview=null;
function fitFullscreenPreview(){const d=fullscreenPreview;if(!d||!d.single)return;const b=d.stage.getBoundingClientRect(),scale=Math.min(b.width/1280,b.height/720);d.frame.style.width='1280px';d.frame.style.height='720px';d.frame.style.transform=`scale(${scale})`;d.frame.style.left=(b.width-1280*scale)/2+'px';d.frame.style.top=(b.height-720*scale)/2+'px'}
async function closeFullscreenPreview(){const d=fullscreenPreview;if(!d)return;fullscreenPreview=null;if(document.fullscreenElement===d.dialog){try{await document.exitFullscreen()}catch{}}d.dialog.close();d.dialog.remove();d.trigger?.focus({preventScroll:true})}
function openFullscreenPreview(src,title,single){
 if(single&&page()){focusReading=true;syncReading();const enter=document.documentElement.requestFullscreen;if(enter)enter.call(document.documentElement).then(()=>{nativeReading=document.fullscreenElement===document.documentElement;fit()}).catch(()=>fit());return}
 if(fullscreenPreview)return;const trigger=document.activeElement,dialog=document.createElement('dialog');dialog.className='fullscreen-preview';dialog.setAttribute('aria-label','全屏预览');
 dialog.innerHTML=`<div class="fullscreen-toolbar"><strong>${esc(title)}</strong><span>退出后返回工作台</span><button type="button" id="exit-preview">退出全屏</button></div><div class="fullscreen-stage"><iframe title="全屏成稿预览" sandbox="allow-scripts allow-popups" src="${esc(src)}"></iframe></div>`;
 document.body.appendChild(dialog);fullscreenPreview={dialog,trigger,single,stage:dialog.querySelector('.fullscreen-stage'),frame:dialog.querySelector('iframe')};
 dialog.querySelector('#exit-preview').onclick=closeFullscreenPreview;dialog.addEventListener('cancel',e=>{e.preventDefault();closeFullscreenPreview()});dialog.showModal();fitFullscreenPreview();
 if(dialog.requestFullscreen)dialog.requestFullscreen().then(()=>{if(fullscreenPreview?.dialog===dialog){if(document.fullscreenElement===dialog)dialog.querySelector('.fullscreen-toolbar span').textContent='Esc 退出';fitFullscreenPreview()}}).catch(()=>fitFullscreenPreview());
}
window.addEventListener('resize',fitFullscreenPreview);
document.addEventListener('fullscreenchange',()=>{if(fullscreenPreview){if(document.fullscreenElement===fullscreenPreview.dialog){fullscreenPreview.native=true;fitFullscreenPreview()}else if(fullscreenPreview.native)closeFullscreenPreview()}});

let directEditor=null;
function closeDirectEditor(){if(!directEditor)return;directEditor.dialog.close();directEditor.dialog.remove();directEditor=null}
function openDirectEditor(r,p){if(viewedRevision!==p.draft_revision){toast('先切回最新草稿再编辑');return}if(active(jobFor(r,p.id))){toast('Codex 正在修改这一页，完成后即可直接编辑');return}if(directEditor)return;const dialog=document.createElement('dialog');dialog.className='direct-editor';dialog.setAttribute('aria-label','直接编辑 HTML');dialog.innerHTML=`<header><strong>直接编辑 · ${esc(p.title)}</strong><span id="direct-edit-status">点选对象拖动，双击文字修改</span><button id="direct-add-box">新增文本框</button><button id="direct-add-line">新增连线</button><button id="direct-parent" disabled>选中外框 / 整组</button><button id="direct-text" disabled>修改文字</button><select id="direct-route" aria-label="连线走向" disabled><option value="">连线走向</option><option value="straight">直线</option><option value="horizontal">先横后纵</option><option value="vertical">先纵后横</option></select><button id="direct-browse">交互定位</button><button id="direct-undo" disabled>撤销</button><button id="direct-delete" disabled>删除对象</button><button id="direct-cancel">取消</button><button id="direct-save" class="primary" disabled>保存为新草稿</button></header><div class="direct-edit-stage"><iframe title="可编辑稿件" sandbox="allow-scripts" src="/preview?report=${r.id}&page=${p.id}&revision=${p.draft_revision}&edit=1"></iframe></div><footer>单击选中并拖动 · 双击改字 · 圆点调整大小或连线端点 · 空文字保留框，删除整框请选中外框 · 修改可撤销，原版本保留</footer>`;document.body.appendChild(dialog);directEditor={dialog,frame:dialog.querySelector('iframe'),report:r.id,page:p.id,base:p.draft_revision,changed:false,saving:false};const send=command=>directEditor?.frame.contentWindow.postMessage({channel:'qinfang-direct-edit',command},'*');dialog.querySelector('#direct-browse').onclick=e=>{send('browse');e.target.textContent=e.target.textContent==='交互定位'?'返回对象编辑':'交互定位'};for(const [id,cmd] of [['direct-add-box','box'],['direct-add-line','line'],['direct-parent','parent'],['direct-text','edit']])dialog.querySelector('#'+id).onclick=()=>send(cmd);dialog.querySelector('#direct-route').onchange=e=>{if(e.target.value)send('route-'+e.target.value);e.target.value=''};dialog.querySelector('#direct-undo').onclick=()=>send('undo');dialog.querySelector('#direct-delete').onclick=()=>send('delete');dialog.querySelector('#direct-save').onclick=()=>send('export');const cancel=()=>{if(directEditor.saving)return;if(directEditor.changed&&!confirm('放弃本次尚未保存的页面修改？'))return;closeDirectEditor()};dialog.querySelector('#direct-cancel').onclick=cancel;dialog.addEventListener('cancel',e=>{e.preventDefault();cancel()});dialog.showModal();fitDirectEditor()}
function fitDirectEditor(){if(!directEditor)return;const stage=directEditor.dialog.querySelector('.direct-edit-stage'),rect=stage.getBoundingClientRect(),scale=Math.min((rect.width-32)/1280,(rect.height-24)/720);directEditor.frame.style.transform=`scale(${scale})`;directEditor.frame.style.left=(rect.width-1280*scale)/2+'px';directEditor.frame.style.top=(rect.height-720*scale)/2+'px'}
window.addEventListener('resize',fitDirectEditor);
window.addEventListener('message',async e=>{const d=directEditor;if(!d||e.source!==d.frame.contentWindow||e.data?.channel!=='qinfang-direct-edit')return;const status=d.dialog.querySelector('#direct-edit-status');if(e.data.type==='hint')status.textContent=e.data.text;if(e.data.type==='dirty'){d.changed=true;d.dialog.querySelector('#direct-save').disabled=false;status.textContent='内容已修改，保存后生成新草稿'}if(e.data.type==='selection'){d.changed=e.data.count>0;status.textContent=d.changed?`已有 ${e.data.count} 处修改，尚未保存`:'点选对象拖动，双击文字修改';d.dialog.querySelector('#direct-save').disabled=!d.changed||d.saving;d.dialog.querySelector('#direct-delete').disabled=!e.data.selected;d.dialog.querySelector('#direct-parent').disabled=!e.data.selected;d.dialog.querySelector('#direct-text').disabled=!e.data.selected||e.data.line;d.dialog.querySelector('#direct-route').disabled=!e.data.line;d.dialog.querySelector('#direct-undo').disabled=!e.data.canUndo}if(e.data.type==='export'&&!d.saving){d.saving=true;d.dialog.querySelector('#direct-save').disabled=true;status.textContent='正在保存新草稿…';try{await request('/api/direct-edit',{report_id:d.report,page_id:d.page,base_revision:d.base,patches:e.data.patches});closeDirectEditor();viewedRevision=null;await refresh();toast('直接编辑已保存为新草稿；确认后再替换合入总稿')}catch(error){d.saving=false;status.textContent=error.message;d.dialog.querySelector('#direct-save').disabled=false}}});
