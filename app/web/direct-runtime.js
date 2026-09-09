(()=>{const patches=__PATCH_DATA__;function apply(){if(typeof document==='undefined'||!document.documentElement||window.__qfEditing)return;for(const p of patches)applyOne(p)}
function applyOne(p){
 if(p.kind==='object'){
  let layer=document.getElementById('qf-drawing-layer');if(!layer){layer=document.createElementNS('http://www.w3.org/2000/svg','svg');layer.id='qf-drawing-layer';layer.setAttribute('viewBox','0 0 1280 720');layer.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';document.body.append(layer)}
  let el=document.querySelector(p.selector);if(!el){el=document.createElementNS(layer.namespaceURI,'g');el.id=p.selector.slice(1);layer.append(el)}
  const signature=JSON.stringify(p);if(el.dataset.qfSignature===signature)return;el.dataset.qfSignature=signature;el.replaceChildren();el.style.pointerEvents='all';
  const make=(tag,attrs)=>{const n=document.createElementNS(layer.namespaceURI,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);el.append(n);return n};
  if(p.shape==='box'){make('rect',{x:p.x,y:p.y,width:p.w,height:p.h,rx:8,fill:'#f4f8fc',stroke:'#678da8','stroke-width':2});const t=make('text',{x:p.x+16,y:p.y+28,fill:'#26343d','font-family':'Microsoft YaHei','font-size':18});p.text.split('\n').forEach((line,i)=>{const span=document.createElementNS(layer.namespaceURI,'tspan');span.setAttribute('x',p.x+16);span.setAttribute('dy',i?24:0);span.textContent=line;t.append(span)})}
  else {const pts=p.route==='straight'?[[p.x,p.y],[p.x2,p.y2]]:p.route==='vertical'?[[p.x,p.y],[p.x,p.y2],[p.x2,p.y2]]:[[p.x,p.y],[p.x2,p.y],[p.x2,p.y2]];make('polyline',{points:pts.map(a=>a.join(',')).join(' '),fill:'none',stroke:'#678da8','stroke-width':3});const end=pts.at(-1),prev=pts.at(-2),ang=Math.atan2(end[1]-prev[1],end[0]-prev[0]);make('path',{d:`M ${end[0]-12*Math.cos(ang-.45)} ${end[1]-12*Math.sin(ang-.45)} L ${end} L ${end[0]-12*Math.cos(ang+.45)} ${end[1]-12*Math.sin(ang+.45)}`,fill:'none',stroke:'#678da8','stroke-width':3})}return;
 }
 const el=document.querySelector(p.selector);if(!el)return;
 if(p.kind==='hide'){if(el.style.display!=='none')el.style.setProperty('display','none','important')}
 if(p.kind==='text'&&el.textContent===p.before&&p.before!==p.after)el.textContent=p.after;
 if(p.kind==='attrs')for(const[k,v]of Object.entries(p.values))if(el.getAttribute(k)!==v)el.setAttribute(k,v);
 if(p.kind==='style')for(const[k,v]of Object.entries(p.values))if(el.style.getPropertyValue(k)!==v)el.style.setProperty(k,v);
}
window.QfEditApply=applyOne;apply();new MutationObserver(apply).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true});})();
