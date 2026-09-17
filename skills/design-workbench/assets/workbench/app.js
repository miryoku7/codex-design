(() => {
  'use strict';
  const SAVE_DELAY = 500, POLL_DELAY = 2500;
  const libraryRoute = window.location.pathname.match(/^\/designs\/([^/]+)\/?$/);
  const libraryMode = Boolean(libraryRoute);
  const stateUrl = libraryMode ? `/api/designs/${libraryRoute[1]}/state` : '/api/state';
  const assetRoot = libraryMode ? '/workbench/' : '/';
  const Preview = window.DesignPreview;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const clone = value => JSON.parse(JSON.stringify(value));
  const app = {state:null,revision:null,dirty:false,saving:false,loaded:false,saveTimer:null,pollTimer:null,changeSeq:0,baselines:new Map(),conflict:null,legacyCss:'',zoom:'fit',library:null,projects:[]};
  const els = {};
  ['saveStatus','saveCluster','retrySave','briefForm','variantGrid','inspectorForm','inspectorTitle','selectedRationale','resetVariant','notesInput','conflictBanner','conflictMessage','keepDraft','useServer','exportPdf','pdfDialog','closePdf','exportPdfCurrent','exportPdfAll','pdfStatus','exportJson','exportHandoff','exportHtml','exportCss','workspace','inspector','projectTitle','projectContext','sampleLabel','briefSummary','adoptionStatus','variantTabs','viewNav','viewportPreset','viewportWidth','viewportHeight','zoomMode','tweakControls','tokenControls','baseControls','adoptVariant','clearAdoption','adoptHint','briefDialog','editBrief','closeBrief','doneBrief'].forEach(id => els[id] = document.getElementById(id));
  els.status = els.saveStatus; els.statusCluster = els.saveCluster;
  const {TOKEN_DEFS,tweakValue,authoredDocument,frameAttributes} = Preview;
  const PRESETS = {mobile:{width:390,height:760},tablet:{width:768,height:1024},desktop:{width:1280,height:900}};
  function getVariant(id = app.state?.view?.activeId) {return app.state?.variants.find(v => v.id === id) || null;}
  function viewport() {return app.state?.viewport || {...PRESETS.mobile,preset:'mobile'};}
  function normalizeView() {
    if(!app.state.view)app.state.view={mode:'compare',activeId:app.state.variants[0].id};
    if(!getVariant(app.state.view.activeId))app.state.view.activeId=app.state.variants[0].id;
  }
  function frameStyles(variant, authored=authoredDocument(variant)) {return Preview.frameStyles(variant,app.legacyCss,authored);}
  function frameDocument(variant) {return Preview.frameDocument(variant,app.legacyCss);}
  function node(tag, className, text) {const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
  function preserveFocus(render) {
    const active=document.activeElement,key=active?.dataset?.focus,id=active?.id,selection=typeof active?.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null;
    render();
    const next=key?$(`[data-focus="${CSS.escape(key)}"]`):id?document.getElementById(id):null;
    if(next && next!==document.activeElement && !next.closest('[hidden]')){next.focus({preventScroll:true});if(selection&&next.setSelectionRange)next.setSelectionRange(...selection);}
  }
  function setStatus(message,state='') {els.status.textContent=message;els.statusCluster.dataset.state=state;els.retrySave.hidden=state!=='error';}
  function responseError(payload,status,action) {
    if(!libraryMode)return payload.message||`${action}に失敗しました（${status}）`;
    if(status===404)return '作品が見つかりません。ライブラリに戻って確認してください。';
    if(status===400)return '保存する内容に不正な値があります。入力を確認してください。';
    return `${action}に失敗しました。再試行してください（${status}）。`;
  }
  function rememberBaselines(state) {
    state.variants.forEach(v=>{
      const key=`design-workbench:baseline:${state.id}:${v.id}`;let stored=null;
      try{stored=JSON.parse(localStorage.getItem(key)||'null');}catch(_error){}
      const previous=app.baselines.get(v.id),legacy=stored?.accent?{tokens:stored,tweakValues:{}}:stored;
      const baseline={tokens:clone(v.baselineTokens||previous?.tokens||legacy?.tokens||v.tokens),tweakValues:clone(v.baselineTweakValues||previous?.tweakValues||legacy?.tweakValues||Object.fromEntries((v.tweaks||[]).map(d=>[d.id,tweakValue(v,d)])))};
      app.baselines.set(v.id,baseline);try{localStorage.setItem(key,JSON.stringify(baseline));}catch(_error){}
    });
  }
  function renderBrief() {if(!app.state)return;els.projectTitle.textContent=app.state.title;els.briefSummary.textContent=app.state.brief.purpose;els.sampleLabel.hidden=!app.state.sample;els.projectContext.textContent=`${app.state.variants.length}つのデザイン方向`;$$('[data-brief]',els.briefForm).forEach(field=>field.value=app.state.brief[field.dataset.brief]||'');document.title=`${app.state.title} | Design Workbench`;renderLibraryContext();}
  function updateLibraryMetadata(library) {
    if(!libraryMode || !library)return;
    app.library={projectId:typeof library.projectId==='string'?library.projectId:null,kind:library.kind==='component'?'component':'screen'};
    renderLibraryContext();
  }
  function renderLibraryContext() {
    if(!libraryMode || !app.library)return;
    const component=app.library.kind==='component';
    document.body.dataset.kind=app.library.kind;
    const path=app.library.projectId?`/projects/${encodeURIComponent(app.library.projectId)}`:'/unassigned';
    const destination=new URL(path,window.location.origin);
    const from=new URLSearchParams(window.location.search).get('from');
    if(from){
      try{
        const previous=new URL(from,window.location.origin);
        // A return hint can retain filters only for this work's current owner.
        if(previous.origin===destination.origin && previous.pathname===destination.pathname){
          for(const key of ['q','favorite','kind']){const value=previous.searchParams.get(key);if(value)destination.searchParams.set(key,value);}
        }
      }catch(_error){}
    }
    const name=app.library.projectId?app.projects.find(project=>project.id===app.library.projectId)?.name||'プロジェクト':'未分類';
    const back=document.getElementById('libraryBack');
    back.href=destination.pathname+destination.search;
    back.setAttribute('aria-label',`${name}の作品一覧に戻る`);
    back.title=`${name}に戻る`;
    document.getElementById('libraryBackLabel').textContent=name;
    if(app.state)els.projectContext.textContent=`${component?'コンポーネント':'画面'} · ${app.state.variants.length}つのデザイン方向`;
    document.getElementById('stageCaption').textContent=component?'保存した表示サイズでコンポーネントを比較しています。各案を開いて細部を調整できます。':'同じ画面サイズで比較しています。各案を開いて細部を調整できます。';
    els.exportHtml.textContent=component?'コンポーネントHTML':'画面HTML';
    document.getElementById('briefPurposeLabel').textContent=component?'このコンポーネントの目的':'この画面の目的';
  }
  function renderNav() {
    $('[data-view="compare"]',els.viewNav).textContent=`${app.state.variants.length}案を比較`;
    els.variantTabs.replaceChildren();
    app.state.variants.forEach(v=>{const button=node('button','view-button');button.type='button';button.dataset.view=v.id;button.dataset.focus=`view-${v.id}`;button.append(node('span','tab-letter',v.id),node('span','tab-name',v.name));els.variantTabs.append(button);});
    updateAdoption();
  }
  function updateAdoption() {
    const adopted=getVariant(app.state.selectedId),active=getVariant();
    els.adoptionStatus.textContent=adopted?`${adopted.id} ${adopted.name}を採用`:'採用は未定';els.adoptionStatus.dataset.adopted=String(!!adopted);els.exportHandoff.disabled=!adopted;
    $$('[data-view]',els.viewNav).forEach(button=>{const isActive=button.dataset.view==='compare'?app.state.view.mode==='compare':app.state.view.mode==='focus'&&button.dataset.view===app.state.view.activeId;button.classList.toggle('active',isActive);button.setAttribute('aria-pressed',String(isActive));button.setAttribute('aria-label',button.dataset.view==='compare'?'全案を比較':`${getVariant(button.dataset.view)?.name}を表示・調整`);});
    $$('.variant-state',els.variantGrid).forEach(mark=>mark.textContent=mark.dataset.variant===app.state.selectedId?'採用中':'');
    const isAdopted=active?.id===app.state.selectedId;els.adoptVariant.textContent=isAdopted?'この案を採用中':'この案を採用する';els.adoptVariant.dataset.adopted=String(isAdopted);els.adoptVariant.disabled=!!isAdopted;els.clearAdoption.hidden=!isAdopted;els.adoptHint.textContent=isAdopted?'採用案として引き継ぎに含まれます。':'表示や調整だけでは採用されません。';
  }
  function renderVariants() {
    if(!app.state){els.variantGrid.textContent=libraryMode?'作品を読み込めません。再試行するか、ライブラリに戻って確認してください。':'セッションを読み込めません。保存ファイルとサーバーを確認してください。';els.variantGrid.setAttribute('aria-busy','false');return;}
    const focused=app.state.view.mode==='focus';els.workspace.dataset.mode=focused?'focus':'compare';els.workspace.dataset.zoom=app.zoom;els.inspector.hidden=!focused;
    Array.from(els.variantGrid.childNodes).filter(child=>!child.classList?.contains('variant-card')).forEach(child=>child.remove());
    const cards=new Map($$('.variant-card',els.variantGrid).map(card=>[card.dataset.id,card]));
    const ids=new Set(app.state.variants.map(v=>v.id));
    cards.forEach((card,id)=>{if(!ids.has(id)){card.remove();cards.delete(id);}});
    // Keep loaded frames connected, including the other directions while focused.
    // Re-appending even an unchanged iframe would reset its browsing context.
    let previous=null;
    app.state.variants.forEach(v=>{
      let card=cards.get(v.id);
      const visible=!focused||v.id===app.state.view.activeId;
      if(!card&&!visible)return;
      const next=previous?previous.nextElementSibling:els.variantGrid.firstElementChild;
      if(!card){card=createVariantCard(v);els.variantGrid.insertBefore(card,next);}
      else if(card!==next){
        if(els.variantGrid.moveBefore)els.variantGrid.moveBefore(card,next);
        else{
          // Older browsers cannot reorder connected frames without reloading them.
          // Recreate only a direction whose source order actually changed.
          card.remove();card=createVariantCard(v);els.variantGrid.insertBefore(card,next);
        }
      }
      previous=card;card.hidden=!visible;
      $('h3',card).textContent=v.name;
      $('.open-variant',card).hidden=focused;
      const rationale=$('.variant-rationale',card);rationale.textContent=v.summary||'';rationale.hidden=focused;
      const frame=$('iframe',card);frame.title=`${v.id} ${v.name} プレビュー`;updatePreview(frame,v);
    });
    els.variantGrid.setAttribute('aria-busy','false');updateAdoption();requestAnimationFrame(fitAllPreviews);
  }
  function createVariantCard(v) {
    const card=node('article','variant-card');card.dataset.id=v.id;
    const header=node('div','variant-header'),title=node('div','variant-title');title.append(node('span','variant-letter',v.id),node('h3'));
    const mark=node('span','variant-state');mark.dataset.variant=v.id;title.append(mark);header.append(title);
    const button=node('button','open-variant','詳しく見る');button.type='button';button.dataset.focus=`open-${v.id}`;button.addEventListener('click',()=>changeView(v.id,true));header.append(button);
    const mat=node('div','preview-mat'),box=node('div','preview-viewport'),frame=node('iframe','preview-frame');frame.setAttribute('sandbox','');frame.setAttribute('referrerpolicy','no-referrer');updatePreview(frame,v);box.append(frame);mat.append(box);
    const footer=node('div','variant-footer');footer.append(node('span','variant-rationale'),node('span','preview-scale'));card.append(header,mat,footer);
    return card;
  }
  function updatePreview(frame,variant) {const source=frameDocument(variant);if(frame.srcdoc!==source)frame.srcdoc=source;}
  function fitAllPreviews() {
    const vp=viewport(),focused=app.state?.view?.mode==='focus';
    $$('.variant-card:not([hidden])',els.variantGrid).forEach(card=>{const mat=$('.preview-mat',card),box=$('.preview-viewport',card),frame=$('iframe',card);let scale=app.zoom==='actual'?1:Math.min(1,mat.clientWidth/vp.width);
      if(app.zoom!=='actual'&&window.innerWidth>760){const available=Math.max(420,window.innerHeight-mat.getBoundingClientRect().top-55);scale=Math.min(scale,available/vp.height);}
      frame.style.width=`${vp.width}px`;frame.style.height=`${vp.height}px`;frame.style.transform=`scale(${scale})`;box.style.width=`${vp.width*scale}px`;box.style.height=`${vp.height*scale}px`;
      $('.preview-scale',card).textContent=`${vp.width} × ${vp.height}　${Math.round(scale*100)}%${app.zoom==='actual'?' 原寸':scale<.999?' フィット':' 原寸'}`;
    });
    els.zoomMode.textContent=app.zoom==='actual'?'原寸で表示':'画面に収める';els.zoomMode.setAttribute('aria-pressed',String(app.zoom==='actual'));
  }
  function refreshPreview(id) {const v=getVariant(id),frame=$(`.variant-card[data-id="${CSS.escape(id)}"] iframe`,els.variantGrid);if(v&&frame)updatePreview(frame,v);}
  function makeControl(def, value, group) {
    const key=`${group}-${def.id}`,field=node(def.type==='select'?'fieldset':'label',def.type==='toggle'?'toggle-field':def.type==='color'?'color-field':'control-field');
    const update=input=>{const v=getVariant();if(!v)return;const next=def.type==='toggle'?input.checked:def.type==='range'?Number(input.value):input.value;if(group==='token')v.tokens[def.id]=next;else{v.tweakValues=v.tweakValues||{};v.tweakValues[def.id]=next;}const output=$('output',field);if(output)output.textContent=`${next}${def.unit||''}`;refreshPreview(v.id);markDirty();};
    if(def.type==='select'){
      const legend=node('legend','control-heading',def.label);field.append(legend);const choices=node('div','choice-options');
      def.options.forEach(option=>{const label=node('label'),input=node('input');input.type='radio';input.name=key;input.value=option.value;input.checked=value===option.value;input.dataset.focus=`${key}-${option.value}`;input.addEventListener('change',()=>update(input));label.append(input,node('span','',option.label));choices.append(label);});field.append(choices);
    }else{
      const input=node('input');input.type=def.type==='toggle'?'checkbox':def.type;input.dataset.focus=key;input.id=key;
      if(def.type==='toggle'){input.checked=!!value;field.append(node('span','',def.label),input);}
      else if(def.type==='color'){input.value=value;const output=node('output','',String(value).toUpperCase());output.htmlFor=key;field.append(node('span','',def.label),output,input);}
      else{input.min=def.min;input.max=def.max;input.step=def.step||1;input.value=value;const heading=node('span','control-heading');const output=node('output','',`${value}${def.unit||''}`);output.htmlFor=key;heading.append(node('span','',def.label),output);field.append(heading,input);}
      input.addEventListener('input',()=>update(input));
    }
    return field;
  }
  function renderInspector() {
    const v=getVariant();if(!v)return;els.inspectorTitle.textContent=`${v.id}　${v.name}`;els.selectedRationale.textContent=v.rationale;els.notesInput.value=v.notes||'';
    els.tweakControls.replaceChildren(...(v.tweaks||[]).map(d=>makeControl(d,tweakValue(v,d),'tweak')));els.tokenControls.replaceChildren(...TOKEN_DEFS.map(d=>makeControl(d,v.tokens[d.id],'token')));els.baseControls.open=!(v.tweaks||[]).length;updateAdoption();
  }
  function renderAll() {if(!app.state)return;normalizeView();preserveFocus(()=>{renderBrief();renderNav();renderVariants();renderInspector();const vp=viewport();els.viewportPreset.value=vp.preset||'custom';els.viewportWidth.value=vp.width;els.viewportHeight.value=vp.height;});}
  function refreshOpenFocus(){normalizeView();}
  function markDirty(){if(!app.state)return;app.dirty=true;app.changeSeq++;if(app.conflict){setStatus('競合あり・下書きを保持中','conflict');return;}setStatus('保存待ち','saving');clearTimeout(app.saveTimer);app.saveTimer=setTimeout(()=>{app.saveTimer=null;saveState();},SAVE_DELAY);}
  function changeView(id,moveFocus=false){app.state.view.mode=id==='compare'?'compare':'focus';if(id!=='compare')app.state.view.activeId=id;preserveFocus(()=>{renderVariants();renderInspector();});if(moveFocus)$(`[data-view="${CSS.escape(id)}"]`,els.viewNav)?.focus({preventScroll:true});markDirty();}
  function changeViewport(preset,width,height){if(!app.state)return;app.state.viewport={preset,width,height};els.viewportPreset.value=preset;els.viewportWidth.value=width;els.viewportHeight.value=height;fitAllPreviews();markDirty();}
  function resetVariant(){const v=getVariant(),base=v&&app.baselines.get(v.id);if(!base)return;v.tokens=clone(base.tokens);v.tweakValues=clone(base.tweakValues);preserveFocus(renderInspector);refreshPreview(v.id);markDirty();}
  function showConflict(payload) {
    updateLibraryMetadata(payload.library);
    app.conflict = {
      state: payload.state || null,
      revision: payload.revision || null,
      invalidCurrent: Boolean(payload.invalidCurrent),
    };
    els.conflictMessage.textContent = payload.invalidCurrent
      ? '保存ファイルが不正なため、下書きを保持しています。ファイルを直してから再試行してください。'
      : '下書きを保持しています。サーバー版を取り込むか、下書きで再保存できます。';
    els.keepDraft.textContent = payload.invalidCurrent ? '下書きを保持中' : '下書きで再保存';
    els.keepDraft.disabled = Boolean(payload.invalidCurrent);
    els.useServer.disabled = !payload.state;
    els.conflictBanner.hidden = false;
    setStatus('競合あり・下書きを保持中', 'conflict');
  }

  function hideConflict() {
    app.conflict = null;
    els.conflictBanner.hidden = true;
    els.keepDraft.disabled = false;
    els.useServer.disabled = false;
  }

  async function saveState() {
    if (!app.state || app.saving || app.conflict) return;
    app.saving = true;
    const sequence = app.changeSeq;
    const outgoing = clone(app.state);
    setStatus('保存中…', 'saving');
    try {
      const response = await fetch(stateUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: outgoing, revision: app.revision }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409) {
        showConflict(payload);
        return;
      }
      if (!response.ok) {
        throw new Error(responseError(payload,response.status,'保存'));
      }
      app.revision = payload.revision || app.revision;
      updateLibraryMetadata(payload.library);
      if (sequence === app.changeSeq) {
        if(payload.state){app.state=payload.state;rememberBaselines(app.state);renderAll();}
        app.dirty = false;
        setStatus('保存済み', 'saved');
      } else {
        app.dirty = true;
        setStatus('追加の変更を保存待ち…', 'saving');
        if (!app.saveTimer) {
          app.saveTimer = window.setTimeout(() => {
            app.saveTimer = null;
            saveState();
          }, SAVE_DELAY);
        }
      }
    } catch (error) {
      setStatus(error.message || '保存に失敗しました', 'error');
    } finally {
      app.saving = false;
    }
  }

  async function fetchState(background = false) {
    try {
      const response = await fetch(stateUrl, { credentials: 'same-origin', cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(payload,response.status,'読み込み'));
      updateLibraryMetadata(payload.library);
      if (!app.loaded) {
        app.state = payload.state;
        app.revision = payload.revision;
        app.loaded = true;
        rememberBaselines(app.state);
        renderAll();
        setStatus(payload.warning ? '保存ファイルが不正・有効な状態を表示中' : '保存済み', payload.warning ? 'invalid' : 'saved');
        return;
      }
      if (background && !app.dirty && !app.saving && !app.conflict && payload.revision !== app.revision) {
        app.state = payload.state;
        app.revision = payload.revision;
        rememberBaselines(app.state);
        renderAll();
        refreshOpenFocus();
        setStatus(payload.warning ? '保存ファイルが不正・有効な状態を表示中' : '外部更新を読み込みました', payload.warning ? 'invalid' : 'saved');
      } else if (payload.warning && !app.dirty && !app.saving && !app.conflict) {
        setStatus('保存ファイルが不正・有効な状態を表示中', 'invalid');
      }
    } catch (error) {
      if (!app.loaded) renderVariants();
      setStatus(error.message || '読み込みに失敗しました', 'error');
    }
  }

  function schedulePoll() {
    if (app.pollTimer) window.clearTimeout(app.pollTimer);
    app.pollTimer = window.setTimeout(async () => {
      app.pollTimer = null;
      if (!app.dirty && !app.saving && !app.conflict) await fetchState(true);
      schedulePoll();
    }, POLL_DELAY);
  }

  function useServerVersion() {
    if (!app.conflict || !app.conflict.state) return;
    app.state = clone(app.conflict.state);
    app.revision = app.conflict.revision;
    app.dirty = false;
    app.changeSeq += 1;
    hideConflict();
    rememberBaselines(app.state);
    renderAll();
    setStatus('サーバー版を取り込みました', 'saved');
  }

  function retryDraft() {
    if (!app.conflict || app.conflict.invalidCurrent || !app.conflict.revision) return;
    if(app.conflict.state && (libraryMode || app.conflict.state.version===2)){
      const draft=app.state,latest=clone(app.conflict.state);
      ['title','brief','selectedId','viewport','view'].forEach(key=>{if(Object.hasOwn(draft,key))latest[key]=clone(draft[key]);});
      latest.variants.forEach(variant=>{const previous=draft.variants.find(v=>v.id===variant.id);if(previous)['tokens','tweakValues','notes'].forEach(key=>{if(Object.hasOwn(previous,key))variant[key]=clone(previous[key]);});});
      app.state=latest;rememberBaselines(app.state);renderAll();
    }
    app.revision = app.conflict.revision;
    hideConflict();
    app.dirty = true;
    app.changeSeq += 1;
    setStatus('下書きを再保存待ち…', 'saving');
    if (app.saveTimer) window.clearTimeout(app.saveTimer);
    app.saveTimer = window.setTimeout(() => {
      app.saveTimer = null;
      saveState();
    }, 80);
  }

  function download(filename, contents, type) {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function portableSession(){const state=clone(app.state);state.version=1;state.variants.forEach(variant=>delete variant.sources);return state;}
  function exportPdf(all) {
    if(!app.state)return;
    const variants=all?app.state.variants:[getVariant()].filter(Boolean);
    const snapshot={title:app.state.title,viewport:clone(viewport()),variants:clone(variants),legacyCss:app.legacyCss};
    const opened=Preview.openPrintView(snapshot);
    els.pdfStatus.textContent=opened?'':'印刷用の画面を開けませんでした。ポップアップを許可して、もう一度お試しください。';
    if(opened)els.pdfDialog.close();
  }
  function exportJson(){if(app.state)download(`${app.state.id}-session.json`,JSON.stringify(portableSession(),null,2)+'\n','application/json;charset=utf-8');}
  function exportCss(variant){const authored=authoredDocument(variant);return `/* Apply these attributes to <html>: ${JSON.stringify({...authored.htmlAttrs,...frameAttributes(variant)})}; <body>: ${JSON.stringify(authored.bodyAttrs)} */\n${frameStyles(variant,authored)}`;}
  function exportHandoff(){
    const selected=getVariant(app.state?.selectedId);if(!selected)return;
    const lines=[`# ${app.state.title}`,'',`採用案: ${selected.id} ${selected.name}`,'',selected.rationale,'','## ブリーフ','```json',JSON.stringify(app.state.brief,null,2),'```','','## 画面サイズ・作者・調整','```json',JSON.stringify({viewport:viewport(),designer:selected.designer||app.state.designer||null,tokens:selected.tokens,tweaks:selected.tweaks||[],tweakValues:selected.tweakValues||{},rootAttributes:frameAttributes(selected)},null,2),'```','','## 再現用 CSS','```css',frameStyles(selected),'```','','## そのまま開ける画面 HTML','```html',frameDocument(selected),'```','','## この案のメモ',selected.notes||'（なし）','','メモはローカルの作業記録です。次の会話で「メモを反映して」と伝えてください。',''];
    download(`${app.state.id}-handoff.md`,lines.join('\n'),'text/markdown;charset=utf-8');
  }
  function bindEvents(){
    $$('[data-brief]',els.briefForm).forEach(field=>field.addEventListener('input',()=>{if(!app.state)return;app.state.brief[field.dataset.brief]=field.value;els.briefSummary.textContent=app.state.brief.purpose;markDirty();}));
    els.briefForm.addEventListener('submit',e=>e.preventDefault());els.inspectorForm.addEventListener('submit',e=>e.preventDefault());
    els.editBrief.addEventListener('click',()=>els.briefDialog.showModal());els.closeBrief.addEventListener('click',()=>els.briefDialog.close());els.doneBrief.addEventListener('click',()=>els.briefDialog.close());els.briefDialog.addEventListener('click',e=>{if(e.target===els.briefDialog){const r=els.briefDialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)els.briefDialog.close();}});
    els.viewNav.addEventListener('click',e=>{const button=e.target.closest('[data-view]');if(button&&app.state)changeView(button.dataset.view);});
    els.notesInput.addEventListener('input',()=>{const v=getVariant();if(v){v.notes=els.notesInput.value;markDirty();}});
    els.exportPdf.addEventListener('click',()=>{if(!app.state)return;const v=getVariant();els.exportPdfCurrent.textContent=`表示中の案 · ${v.id} ${v.name}`;els.exportPdfAll.textContent=`全${app.state.variants.length}案を比較`;els.pdfStatus.textContent='';els.pdfDialog.showModal();});
    els.closePdf.addEventListener('click',()=>els.pdfDialog.close());els.exportPdfCurrent.addEventListener('click',()=>exportPdf(false));els.exportPdfAll.addEventListener('click',()=>exportPdf(true));
    els.resetVariant.addEventListener('click',resetVariant);els.adoptVariant.addEventListener('click',()=>{const v=getVariant();if(v){app.state.selectedId=v.id;updateAdoption();markDirty();}});els.clearAdoption.addEventListener('click',()=>{app.state.selectedId=null;updateAdoption();markDirty();});
    els.viewportPreset.addEventListener('change',()=>{const key=els.viewportPreset.value;if(PRESETS[key])changeViewport(key,PRESETS[key].width,PRESETS[key].height);else changeViewport('custom',viewport().width,viewport().height);});
    [els.viewportWidth,els.viewportHeight].forEach(input=>input.addEventListener('change',()=>{const w=Math.round(Number(els.viewportWidth.value)),h=Math.round(Number(els.viewportHeight.value));if(w>=240&&w<=2560&&h>=320&&h<=2160)changeViewport('custom',w,h);else{els.viewportWidth.value=viewport().width;els.viewportHeight.value=viewport().height;}}));
    els.zoomMode.addEventListener('click',()=>{app.zoom=app.zoom==='fit'?'actual':'fit';els.workspace.dataset.zoom=app.zoom;fitAllPreviews();});
    els.keepDraft.addEventListener('click',retryDraft);els.useServer.addEventListener('click',useServerVersion);els.retrySave.addEventListener('click',()=>{if(app.dirty)saveState();else fetchState(true);});els.exportJson.addEventListener('click',exportJson);els.exportHandoff.addEventListener('click',exportHandoff);
    els.exportHtml.addEventListener('click',()=>{const v=getVariant();if(v)download(`${app.state.id}-${v.id}.html`,frameDocument(v),'text/html;charset=utf-8');});els.exportCss.addEventListener('click',()=>{const v=getVariant();if(v)download(`${app.state.id}-${v.id}.css`,exportCss(v),'text/css;charset=utf-8');});
    window.addEventListener('beforeunload',event=>{if(app.dirty||app.conflict){event.preventDefault();event.returnValue='';}});window.addEventListener('resize',fitAllPreviews);
    new ResizeObserver(()=>fitAllPreviews()).observe(els.variantGrid);
  }
  async function start(){
    if(libraryMode){
      document.body.dataset.library='true';
      els.sampleLabel.textContent='サンプル作品';
      document.getElementById('libraryBack').hidden=false;
      document.getElementById('briefSaveHint').textContent='入力はライブラリに自動保存されます。';
      fetch('/api/projects',{credentials:'same-origin',cache:'no-store'}).then(response=>response.ok?response.json():null).then(payload=>{if(Array.isArray(payload?.projects)){app.projects=payload.projects;renderLibraryContext();}}).catch(()=>{});
    }
    bindEvents();try{const r=await fetch(`${assetRoot}legacy-v1.css`);if(r.ok)app.legacyCss=await r.text();}catch(_error){}await fetchState();schedulePoll();}
  start();
})();
