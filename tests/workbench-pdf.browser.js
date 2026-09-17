/* Isolated, in-memory browser checks; no workspace/D1 access. */
(() => {
  'use strict';
  const tokens = {accent:'#4051ac',background:'#f2eee5',text:'#252833',spacing:24,fontSize:16,radius:8};
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAAA8CAIAAAB+RarbAAAAdUlEQVR4nOXOMQEAMAyAMIZ/z52L9iAK8oYWiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYiZEYrwPbPrwcAXdMf1N5AAAAAElFTkSuQmCC';
  const variant = id => ({id,name:`案${id} <title>`,rationale:'PDF fixture',notes:'keep notes',tokens:{...tokens},baselineTokens:{...tokens},
    html:`<main><h1>${id} PDF fixture</h1><img loading="lazy" src="${image}" alt="red fixture"><div class="spacer"></div><p class="bottom">BOTTOM-MARKER-${id}</p><script>parent.authoredScriptExecuted=true</script><img src="https://example.invalid/blocked.png" onerror="parent.authoredScriptExecuted=true"></main>`,
    css:'main{padding:var(--spacing);background:var(--background)}h1{font-size:var(--heading-size);color:var(--accent)}.spacer{height:1800px}.bottom{color:#111}@media(min-width:700px){h1{letter-spacing:7px}}',
    tweaks:[{id:'heading',type:'range',label:'見出し',cssVar:'--heading-size',default:32,min:24,max:48,step:1,unit:'px'}],tweakValues:{heading:32},baselineTweakValues:{heading:32}});
  let stored={id:'pdf-regression',version:1,title:'PDF <unsafe> & title',sample:true,brief:{purpose:'PDF export regression',audience:'QA',platform:'browser',mood:'',avoid:''},selectedId:'A',view:{mode:'focus',activeId:'B'},viewport:{preset:'desktop',width:1280,height:900},variants:['A','B','C'].map(variant)};
  // External images are deliberately excluded from readiness success fixture;
  // retain a CSS external request to check deny-network policy without broken img.
  stored.variants.forEach(v=>{v.html=v.html.replace(/<img src="https:.*?>/,'');v.css+='main{background-image:url(https://example.invalid/blocked.png)}';});
  let revision=1;
  const result=window.pdfRegression={status:'running',checks:[],requests:[],error:null};
  const originalFetch=window.fetch.bind(window);
  window.fetch=async (input,options={})=>{
    const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
    if(path==='/api/designs/pdf-regression/state'){
      result.requests.push(options.method||'GET');
      if(options.method==='POST'){stored=JSON.parse(options.body).state;revision++;}
      return new Response(JSON.stringify({state:structuredClone(stored),revision:String(revision)}),{headers:{'Content-Type':'application/json'}});
    }
    if(path==='/api/projects')return new Response('{"projects":[]}');
    if(path==='/workbench/legacy-v1.css')return originalFetch(input,options);
    throw new Error(`Unexpected request ${path}`);
  };
  const $=selector=>document.querySelector(selector);
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function until(predicate,label){for(let i=0;i<250;i++){if(predicate())return;await wait(20);}throw new Error(`Timeout: ${label}`);}
  function check(ok,label){if(!ok)throw new Error(label);result.checks.push(label);}
  const originalOpen=window.open;
  const windows=[];
  // Test the real shell/iframe rendering without relying on popup permissions.
  function fakeOpen(){
    const host=document.createElement('iframe');host.style.cssText='position:fixed;left:-10000px;width:1400px;height:1000px';document.body.append(host);
    const native=host.contentWindow;
    const popup={document:native.document,closed:false,opener:null,focus(){},print(){result.printCalls=(result.printCalls||0)+1;native.dispatchEvent(new Event('afterprint'));},close(){this.closed=true;host.remove();},requestAnimationFrame:native.requestAnimationFrame.bind(native),addEventListener:native.addEventListener.bind(native)};
    windows.push(popup);return popup;
  }
  async function run(){
    await until(()=>$('#inspectorTitle')?.textContent.includes('案B'),'load active B');
    const heading=$('#tweak-heading');heading.value=44;heading.dispatchEvent(new Event('input',{bubbles:true}));
    const color=$('#token-accent');color.value='#aa2244';color.dispatchEvent(new Event('input',{bubbles:true}));
    const frame=$('.variant-card[data-id="B"] iframe'),source=frame.srcdoc;
    const baseline=localStorage.getItem('design-workbench:baseline:pdf-regression:B');
    window.open=fakeOpen;
    $('#exportPdf').click();$('#exportPdfCurrent').click();
    const current=windows.at(-1);await until(()=>current.document.body.dataset.printReady==='true','current print ready');
    check(current.document.querySelectorAll('article').length===1&&current.document.querySelector('article').dataset.variant==='B','current uses active B, not adopted A');
    const exported=current.document.querySelector('iframe'),inner=exported.contentDocument;
    check(inner.defaultView.getComputedStyle(inner.querySelector('h1')).fontSize==='44px','live tweak value included');
    check(inner.defaultView.getComputedStyle(inner.querySelector('h1')).color==='rgb(170, 34, 68)','live token value included');
    check(inner.defaultView.getComputedStyle(inner.querySelector('h1')).letterSpacing==='7px','desktop media query retained at viewport width');
    check(inner.images[0].naturalWidth===80,'embedded image decoded');
    check(exported.clientHeight>1800&&inner.querySelector('.bottom').getBoundingClientRect().bottom<=exported.clientHeight,'long page bottom included in print frame');
    check(exported.sandbox.value==='allow-same-origin'&&!inner.querySelector('script')&&inner.querySelector('meta[http-equiv]').content.includes("default-src 'none'"),'print frame forbids scripts and external resources');
    check(frame.sandbox.value===''&&frame.srcdoc===source,'original preview sandbox and source retained');
    check(current.document.title.includes('<unsafe>')&&!current.document.querySelector('unsafe'),'title inserted as text');
    current.document.querySelector('button').click();
    check(result.printCalls===1&&current.document.querySelector('[role=status]').textContent.includes('再度印刷'),'print cancellation supports retry');
    $('#exportPdf').click();$('#exportPdfAll').click();
    const all=windows.at(-1);await until(()=>all.document.body.dataset.printReady==='true','all print ready');
    check(current.closed,'repeat export releases previous snapshot');
    check([...all.document.querySelectorAll('article')].map(v=>v.dataset.variant).join(',')==='A,B,C','all variants remain in source order');
    check([...all.document.querySelectorAll('h2')].map(v=>v.textContent).join('|').includes('C · 案C'),'all variants have labels');
    check(frame===$('.variant-card[data-id="B"] iframe')&&frame.srcdoc===source,'export preserves existing preview node');
    check($('#adoptionStatus').textContent.startsWith('A ')&&$('#notesInput').value==='keep notes'&&baseline===localStorage.getItem('design-workbench:baseline:pdf-regression:B'),'export preserves adoption notes and reset baseline');
    window.open=()=>null;
    $('#exportPdf').click();$('#exportPdfCurrent').click();
    check($('#pdfDialog').open&&$('#pdfStatus').textContent.includes('ポップアップ'),'popup blocked has retry instruction');
    $('#exportPdfCurrent').textContent='表示中の案 · B '+ '長い案の名前'.repeat(40);
    check($('#pdfDialog').scrollWidth<=$('#pdfDialog').clientWidth,'long variant name stays within export dialog');
    $('#closePdf').click();
    window.open=fakeOpen;
    const broken=structuredClone(stored.variants[0]);broken.html='<img src="data:image/png;base64,invalid" alt="broken fixture">';
    window.DesignPreview.openPrintView({title:stored.title,viewport:stored.viewport,variants:[broken],legacyCss:''});
    const failed=windows.at(-1);
    await until(()=>failed.document.querySelector('[role=status]')?.textContent.includes('もう一度'),'broken image error');
    check(failed.document.querySelector('button').disabled&&failed.document.body.dataset.printReady!=='true','broken image prevents incomplete PDF and reports retry');
    check(!window.authoredScriptExecuted,'authored scripts never execute');
    window.open=originalOpen;
    windows.forEach(popup=>popup.close());
    result.status='passed';
  }
  document.addEventListener('DOMContentLoaded',()=>run().catch(error=>{window.open=originalOpen;windows.forEach(popup=>popup.close());result.status='failed';result.error=error.stack;}),{once:true});
})();
