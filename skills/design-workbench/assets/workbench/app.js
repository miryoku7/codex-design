(() => {
  'use strict';
  const I = window.DesignI18n;
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
  function node(tag, className, text) {const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)I.text(el, text);return el;}
  function preserveFocus(render) {
    const active=document.activeElement,key=active?.dataset?.focus,id=active?.id,selection=typeof active?.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null;
    render();
    const next=key?$(`[data-focus="${CSS.escape(key)}"]`):id?document.getElementById(id):null;
    if(next && next!==document.activeElement && !next.closest('[hidden]')){next.focus({preventScroll:true});if(selection&&next.setSelectionRange)next.setSelectionRange(...selection);}
  }
  function setStatus(message,state='') {I.text(els.status, message);els.statusCluster.dataset.state=state;els.retrySave.hidden=state!=='error';}
  function responseError(payload,status,action) {
    if(!libraryMode)return I.msg("failed", {p0: action, p1: status});
    if(status===404)return I.msg("design.not.found.return.to.the.library");
    if(status===400)return I.msg("some.values.are.invalid.check.your.input");
    return I.msg("failed.please.retry", {p0: action, p1: status});
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
  function renderBrief() {if(!app.state)return;I.text(els.projectTitle, app.state.title);I.text(els.briefSummary, app.state.brief.purpose);els.sampleLabel.hidden=!app.state.sample;I.text(els.projectContext, I.msg("design.directions", {p0: app.state.variants.length}));$$('[data-brief]',els.briefForm).forEach(field=>field.value=app.state.brief[field.dataset.brief]||'');I.attr(document, 'title', `${app.state.title} | Design Workbench`);renderLibraryContext();}
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
    const name=app.library.projectId?app.projects.find(project=>project.id===app.library.projectId)?.name||I.msg("projects"):I.msg("unassigned");
    const back=document.getElementById('libraryBack');
    back.href=destination.pathname+destination.search;
    I.attr(back, 'aria-label', I.msg("back.to.designs.in", {p0: name}));
    I.attr(back, 'title', I.msg("back.to", {p0: name}));
    I.text(document.getElementById('libraryBackLabel'), name);
    if(app.state)I.text(els.projectContext, I.msg("directions.2", {p0: component?I.msg("component"):I.msg("screen"), p1: app.state.variants.length}));
    I.text(document.getElementById('stageCaption'), component?I.msg("comparing.components.at.their.saved.size.open"):I.msg("comparing.at.the.same.screen.size.open"));
    I.text(els.exportHtml, component?I.msg("component.html"):I.msg("screen.html"));
    I.text(document.getElementById('briefPurposeLabel'), component?I.msg("purpose.of.this.component"):I.msg("purpose.of.this.screen"));
  }
  function renderNav() {
    I.text($('[data-view="compare"]',els.viewNav), I.msg("compare.directions", {p0: app.state.variants.length}));
    els.variantTabs.replaceChildren();
    app.state.variants.forEach(v=>{const button=node('button','view-button');button.type='button';button.dataset.view=v.id;button.dataset.focus=`view-${v.id}`;button.append(node('span','tab-letter',v.id),node('span','tab-name',v.name));els.variantTabs.append(button);});
    updateAdoption();
  }
  function updateAdoption() {
    const adopted=getVariant(app.state.selectedId),active=getVariant();
    I.text(els.adoptionStatus, adopted?I.msg("adopted.3", {p0: adopted.id, p1: adopted.name}):I.msg("no.direction.adopted"));els.adoptionStatus.dataset.adopted=String(!!adopted);els.exportHandoff.disabled=!adopted;
    $$('[data-view]',els.viewNav).forEach(button=>{const isActive=button.dataset.view==='compare'?app.state.view.mode==='compare':app.state.view.mode==='focus'&&button.dataset.view===app.state.view.activeId;button.classList.toggle('active',isActive);button.setAttribute('aria-pressed',String(isActive));I.attr(button, 'aria-label', button.dataset.view==='compare'?I.msg("compare.all.directions"):I.msg("view.and.adjust", {p0: getVariant(button.dataset.view)?.name}));});
    $$('.variant-state',els.variantGrid).forEach(mark=>I.text(mark, mark.dataset.variant===app.state.selectedId?I.msg("adopted.4"):''));
    const isAdopted=active?.id===app.state.selectedId;I.text(els.adoptVariant, isAdopted?I.msg("this.direction.is.adopted"):I.msg("adopt.this.direction"));els.adoptVariant.dataset.adopted=String(isAdopted);els.adoptVariant.disabled=!!isAdopted;els.clearAdoption.hidden=!isAdopted;I.text(els.adoptHint, isAdopted?I.msg("included.in.the.handoff.as.the.adopted"):I.msg("viewing.or.adjusting.does.not.adopt.a"));
  }
  function renderVariants() {
    if(!app.state){I.text(els.variantGrid, libraryMode?I.msg("could.not.load.this.design.retry.or"):I.msg("could.not.load.the.session.check.the"));els.variantGrid.setAttribute('aria-busy','false');return;}
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
      I.text($('h3',card), v.name);
      $('.open-variant',card).hidden=focused;
      const rationale=$('.variant-rationale',card);I.text(rationale, v.summary||'');rationale.hidden=focused;
      const frame=$('iframe',card);I.attr(frame, 'title', I.msg("preview", {p0: v.id, p1: v.name}));updatePreview(frame,v);
    });
    els.variantGrid.setAttribute('aria-busy','false');updateAdoption();requestAnimationFrame(fitAllPreviews);
  }
  function createVariantCard(v) {
    const card=node('article','variant-card');card.dataset.id=v.id;
    const header=node('div','variant-header'),title=node('div','variant-title');title.append(node('span','variant-letter',v.id),node('h3'));
    const mark=node('span','variant-state');mark.dataset.variant=v.id;title.append(mark);header.append(title);
    const button=node('button','open-variant',I.msg("view.details"));button.type='button';button.dataset.focus=`open-${v.id}`;button.addEventListener('click',()=>changeView(v.id,true));header.append(button);
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
      I.text($('.preview-scale',card), I.msg("preview.dimensions.scale", {p0: vp.width, p1: vp.height, p2: Math.round(scale*100), p3: app.zoom==='actual'?I.msg("actual.size"):scale<.999?I.msg("fit"):I.msg("actual.size")}));
    });
    I.text(els.zoomMode, app.zoom==='actual'?I.msg("actual.size.2"):I.msg("fit.to.screen"));els.zoomMode.setAttribute('aria-pressed',String(app.zoom==='actual'));
  }
  function refreshPreview(id) {const v=getVariant(id),frame=$(`.variant-card[data-id="${CSS.escape(id)}"] iframe`,els.variantGrid);if(v&&frame)updatePreview(frame,v);}
  function makeControl(def, value, group) {
    const key=`${group}-${def.id}`,field=node(def.type==='select'?'fieldset':'label',def.type==='toggle'?'toggle-field':def.type==='color'?'color-field':'control-field');
    const update=input=>{const v=getVariant();if(!v)return;const next=def.type==='toggle'?input.checked:def.type==='range'?Number(input.value):input.value;if(group==='token')v.tokens[def.id]=next;else{v.tweakValues=v.tweakValues||{};v.tweakValues[def.id]=next;}const output=$('output',field);if(output)I.text(output, `${next}${def.unit||''}`);refreshPreview(v.id);markDirty();};
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
    const v=getVariant();if(!v)return;I.text(els.inspectorTitle, `${v.id}　${v.name}`);I.text(els.selectedRationale, v.rationale);els.notesInput.value=v.notes||'';
    els.tweakControls.replaceChildren(...(v.tweaks||[]).map(d=>makeControl(d,tweakValue(v,d),'tweak')));els.tokenControls.replaceChildren(...TOKEN_DEFS.map(d=>makeControl(d,v.tokens[d.id],'token')));if(els.baseControls.dataset.variant!==v.id){els.baseControls.dataset.variant=v.id;els.baseControls.open=!(v.tweaks||[]).length;}updateAdoption();
  }
  function renderAll() {if(!app.state)return;normalizeView();preserveFocus(()=>{renderBrief();renderNav();renderVariants();renderInspector();const vp=viewport();els.viewportPreset.value=vp.preset||'custom';els.viewportWidth.value=vp.width;els.viewportHeight.value=vp.height;});}
  function refreshOpenFocus(){normalizeView();}
  function markDirty(){if(!app.state)return;app.dirty=true;app.changeSeq++;if(app.conflict){setStatus(I.msg("conflict.draft.preserved"),'conflict');return;}setStatus(I.msg("waiting.to.save"),'saving');clearTimeout(app.saveTimer);app.saveTimer=setTimeout(()=>{app.saveTimer=null;saveState();},SAVE_DELAY);}
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
    I.text(els.conflictMessage, payload.invalidCurrent
      ? I.msg("the.saved.file.is.invalid.your.draft")
      : I.msg("your.draft.is.preserved.load.the.server"));
    I.text(els.keepDraft, payload.invalidCurrent ? I.msg("draft.preserved") : I.msg("save.draft.again"));
    els.keepDraft.disabled = Boolean(payload.invalidCurrent);
    els.useServer.disabled = !payload.state;
    els.conflictBanner.hidden = false;
    setStatus(I.msg("conflict.draft.preserved"), 'conflict');
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
    setStatus(I.msg("saving"), 'saving');
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
        throw I.error(responseError(payload,response.status,I.msg("save")));
      }
      app.revision = payload.revision || app.revision;
      updateLibraryMetadata(payload.library);
      if (sequence === app.changeSeq) {
        if(payload.state){app.state=payload.state;rememberBaselines(app.state);renderAll();}
        app.dirty = false;
        setStatus(I.msg("saved.2"), 'saved');
      } else {
        app.dirty = true;
        setStatus(I.msg("waiting.to.save.more.changes"), 'saving');
        if (!app.saveTimer) {
          app.saveTimer = window.setTimeout(() => {
            app.saveTimer = null;
            saveState();
          }, SAVE_DELAY);
        }
      }
    } catch (error) {
      setStatus(I.errorMessage(error) || I.msg("save.failed"), 'error');
    } finally {
      app.saving = false;
    }
  }

  async function fetchState(background = false) {
    try {
      const response = await fetch(stateUrl, { credentials: 'same-origin', cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw I.error(responseError(payload,response.status,I.msg("load")));
      updateLibraryMetadata(payload.library);
      if (!app.loaded) {
        app.state = payload.state;
        app.revision = payload.revision;
        app.loaded = true;
        rememberBaselines(app.state);
        renderAll();
        setStatus(payload.warning ? I.msg("invalid.saved.file.showing.valid.state") : I.msg("saved.2"), payload.warning ? 'invalid' : 'saved');
        return;
      }
      if (background && !app.dirty && !app.saving && !app.conflict && payload.revision !== app.revision) {
        app.state = payload.state;
        app.revision = payload.revision;
        rememberBaselines(app.state);
        renderAll();
        refreshOpenFocus();
        setStatus(payload.warning ? I.msg("invalid.saved.file.showing.valid.state") : I.msg("loaded.external.changes"), payload.warning ? 'invalid' : 'saved');
      } else if (payload.warning && !app.dirty && !app.saving && !app.conflict) {
        setStatus(I.msg("invalid.saved.file.showing.valid.state"), 'invalid');
      }
    } catch (error) {
      if (!app.loaded) renderVariants();
      setStatus(I.errorMessage(error) || I.msg("load.failed"), 'error');
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
    setStatus(I.msg("loaded.server.version"), 'saved');
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
    setStatus(I.msg("waiting.to.save.draft.again"), 'saving');
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
    I.text(els.pdfStatus, opened?'':I.msg("could.not.open.the.print.view.allow"));
    if(opened)els.pdfDialog.close();
  }
  function exportJson(){if(app.state)download(`${app.state.id}-session.json`,JSON.stringify(portableSession(),null,2)+'\n','application/json;charset=utf-8');}
  function exportCss(variant){const authored=authoredDocument(variant);return `/* Apply these attributes to <html>: ${JSON.stringify({...authored.htmlAttrs,...frameAttributes(variant)})}; <body>: ${JSON.stringify(authored.bodyAttrs)} */\n${frameStyles(variant,authored)}`;}
  function exportHandoff(){
    const selected=getVariant(app.state?.selectedId);if(!selected)return;
    const lines=[`# ${app.state.title}`,'',I.msg("adopted.direction", {p0: selected.id, p1: selected.name}),'',selected.rationale,'',I.msg("brief"),'```json',JSON.stringify(app.state.brief,null,2),'```','',I.msg("viewport.designer.and.adjustments"),'```json',JSON.stringify({viewport:viewport(),designer:selected.designer||app.state.designer||null,tokens:selected.tokens,tweaks:selected.tweaks||[],tweakValues:selected.tweakValues||{},rootAttributes:frameAttributes(selected)},null,2),'```','',I.msg("css.for.reproduction"),'```css',frameStyles(selected),'```','',I.msg("standalone.html"),'```html',frameDocument(selected),'```','',I.msg("notes.for.this.direction"),selected.notes||I.msg("none.2"),'',I.msg("notes.are.local.working.records.ask.codex"),''];
    download(`${app.state.id}-handoff.md`,lines.join('\n'),'text/markdown;charset=utf-8');
  }
  function bindEvents(){
    $$('[data-brief]',els.briefForm).forEach(field=>field.addEventListener('input',()=>{if(!app.state)return;app.state.brief[field.dataset.brief]=field.value;I.text(els.briefSummary, app.state.brief.purpose);markDirty();}));
    els.briefForm.addEventListener('submit',e=>e.preventDefault());els.inspectorForm.addEventListener('submit',e=>e.preventDefault());
    els.editBrief.addEventListener('click',()=>els.briefDialog.showModal());els.closeBrief.addEventListener('click',()=>els.briefDialog.close());els.doneBrief.addEventListener('click',()=>els.briefDialog.close());els.briefDialog.addEventListener('click',e=>{if(e.target===els.briefDialog){const r=els.briefDialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)els.briefDialog.close();}});
    els.viewNav.addEventListener('click',e=>{const button=e.target.closest('[data-view]');if(button&&app.state)changeView(button.dataset.view);});
    els.notesInput.addEventListener('input',()=>{const v=getVariant();if(v){v.notes=els.notesInput.value;markDirty();}});
    els.exportPdf.addEventListener('click',()=>{if(!app.state)return;const v=getVariant();I.text(els.exportPdfCurrent, I.msg("current.direction", {p0: v.id, p1: v.name}));I.text(els.exportPdfAll, I.msg("compare.all.directions.2", {p0: app.state.variants.length}));I.text(els.pdfStatus, '');els.pdfDialog.showModal();});
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
      I.text(els.sampleLabel, I.msg("sample.design"));
      document.getElementById('libraryBack').hidden=false;
      I.text(document.getElementById('briefSaveHint'), I.msg("your.input.is.saved.automatically.to.the"));
      fetch('/api/projects',{credentials:'same-origin',cache:'no-store'}).then(response=>response.ok?response.json():null).then(payload=>{if(Array.isArray(payload?.projects)){app.projects=payload.projects;renderLibraryContext();}}).catch(()=>{});
    }
    bindEvents();try{const r=await fetch(`${assetRoot}legacy-v1.css`);if(r.ok)app.legacyCss=await r.text();}catch(_error){}await fetchState();schedulePoll();}
  start();
})();
