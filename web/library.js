(() => {
  'use strict';
  const I = window.DesignI18n;

  const elements = {};
  ['mainContent','libraryTitle','projectSummary','breadcrumb','breadcrumbCurrent',
   'projectOverview','projectList','noProjects','projectGallery','createProject','renameProject',
   'designGrid','designSearch','allFilter','screenFilter','componentFilter','favoriteFilter',
   'libraryNotice','noticeMessage','retryLoad','dismissNotice','resultContext','loadingState',
   'emptyState','emptyTitle','emptyDescription','emptyAction','actionStatus','openAddHelp','addDialog',
   'addRequestExample','projectDialog','projectForm','projectDialogTitle','projectName','projectError',
   'projectConflict','projectConflictCurrent','useCurrentProject','saveProject','metadataDialog',
   'metadataForm','metadataDesignTitle','metadataProject','metadataError','metadataConflict',
   'metadataConflictCurrent','useCurrentMetadata','saveMetadata'].forEach(id => elements[id] = document.getElementById(id));
  const query = new URLSearchParams(window.location.search);
  const projectRoute = window.location.pathname.match(/^\/projects\/([^/]+)\/?$/);
  const overview = !projectRoute && !/^\/unassigned\/?$/.test(window.location.pathname);
  const projectId = projectRoute ? decodeURIComponent(projectRoute[1]) : null;
  const app = {
    projects: [], designs: [], loaded: false, loading: false, pending: null, legacyCss: '',
    projectDraft: null, metadataDraft: null,
    search: query.get('q') || '', favoritesOnly: query.get('favorite') === '1',
    kind: ['screen','component'].includes(query.get('kind')) ? query.get('kind') : 'all'
  };
  const dialogOpeners = new Map();
  const previewObserver = new ResizeObserver(entries => entries.forEach(entry => fitPreview(entry.target)));

  class ApiError extends Error {
    constructor(message, status, payload = {}) { super(String(message)); this.localized = message; this.status = status; this.payload = payload; }
  }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) I.text(element, text);
    return element;
  }
  function icon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    const paths = {
      star:'m10 2.8 2.15 4.35 4.8.7-3.48 3.38.82 4.78L10 13.75l-4.29 2.26.82-4.78L3.05 7.85l4.8-.7L10 2.8Z',
      folder:'M2.5 5.2c0-.7.5-1.2 1.2-1.2H8l1.7 2H16.3c.7 0 1.2.5 1.2 1.2v7.6c0 .7-.5 1.2-1.2 1.2H3.7c-.7 0-1.2-.5-1.2-1.2Z',
      rename:'m12.5 4 3.5 3.5M4 16l3.6-.8 9-9a1.3 1.3 0 0 0 0-1.8l-1-1a1.3 1.3 0 0 0-1.8 0l-9 9L4 16Z',
      arrow:'M4 10h12m-5-5 5 5-5 5'
    };
    path.setAttribute('d', paths[kind] || paths.arrow);
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.4');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    return svg;
  }
  async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(path, {
        method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        ...(body === undefined ? {} : {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new ApiError(I.msg("action.failed", {p0: response.status}), response.status, payload);
      return payload;
    } finally { window.clearTimeout(timeout); }
  }
  function notify(message, tone = 'error', retry = true) {
    I.text(elements.noticeMessage, message);
    elements.libraryNotice.dataset.tone = tone;
    elements.retryLoad.hidden = !retry;
    elements.libraryNotice.hidden = false;
  }
  function clearNotice() { elements.libraryNotice.hidden = true; }
  function announce(message) { I.text(elements.actionStatus, message); }
  function kindName(kind) { return kind === 'component' ? I.msg("component") : I.msg("screen"); }
  function projectName(id) { return id ? app.projects.find(item => item.id === id)?.name || I.msg("projects") : I.msg("unassigned"); }
  function projectPath(id) { return id ? `/projects/${encodeURIComponent(id)}` : '/unassigned'; }
  function currentProject() { return app.projects.find(item => item.id === projectId); }
  function scopedDesigns() { return app.designs.filter(design => (design.projectId || null) === projectId); }
  function rememberFilters() {
    const url = new URL(window.location.href);
    if (app.search) url.searchParams.set('q', app.search); else url.searchParams.delete('q');
    if (app.favoritesOnly) url.searchParams.set('favorite', '1'); else url.searchParams.delete('favorite');
    if (app.kind !== 'all') url.searchParams.set('kind', app.kind); else url.searchParams.delete('kind');
    window.history.replaceState(null, '', url.pathname + url.search);
  }
  function filteredDesigns() {
    const search = app.search.trim().normalize('NFKC').toLocaleLowerCase(I.getLocale());
    return scopedDesigns().filter(design => (!app.favoritesOnly || design.favorite) &&
      (app.kind === 'all' || design.kind === app.kind) &&
      (!search || design.title.normalize('NFKC').toLocaleLowerCase(I.getLocale()).includes(search)));
  }
  function designUrl(design) {
    const owner = Object.hasOwn(design, 'projectId') ? design.projectId : projectId;
    const context = new URL(projectPath(owner), window.location.origin);
    for (const key of ['q','favorite','kind']) {
      const value = new URLSearchParams(window.location.search).get(key);
      if (value) context.searchParams.set(key, value);
    }
    return `/designs/${encodeURIComponent(design.id)}?from=${encodeURIComponent(context.pathname + context.search)}`;
  }
  function fitPreview(link) {
    const canvas = link.querySelector('.thumbnail-canvas');
    if (!canvas) return;
    const frame = canvas.querySelector('iframe');
    const width = Number(canvas.dataset.width), height = Number(canvas.dataset.height);
    const style = getComputedStyle(link);
    const availableWidth = link.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const availableHeight = link.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const component = link.closest('.design-card').dataset.kind === 'component';
    const isPortrait = height > width * 1.2;
    // A component thumbnail fits the complete saved canvas. Neither its authored
    // source nor its responsive viewport is changed by the library classification.
    const scale = Math.max(.01, component
      ? Math.min(1, availableWidth / width, availableHeight / height)
      : Math.min(1, availableWidth * (isPortrait ? .88 : 1) / width));
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    frame.style.transform = `scale(${scale})`;
    canvas.style.width = `${width * scale}px`;
    canvas.style.height = `${height * scale}px`;
  }
  function makePreview(design) {
    const surface = node('div', 'preview-surface'), link = node('a', 'preview-link');
    link.href = designUrl(design);
    link.tabIndex = -1;
    link.setAttribute('aria-hidden', 'true');
    link.addEventListener('click', event => { if (app.pending) event.preventDefault(); });
    const variant = design.preview?.variant;
    if (variant) {
      const canvas = node('div', 'thumbnail-canvas');
      canvas.dataset.width = String(Math.min(2560, Math.max(240, Number(design.preview.viewport?.width) || 390)));
      canvas.dataset.height = String(Math.min(2160, Math.max(320, Number(design.preview.viewport?.height) || 760)));
      const frame = node('iframe', 'thumbnail-frame');
      I.attr(frame, 'title', I.msg("preview.of", {p0: design.title, p1: variant.name}));
      frame.tabIndex = -1;
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('sandbox', '');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.setAttribute('loading', 'lazy');
      frame.srcdoc = window.DesignPreview.frameDocument(variant, app.legacyCss);
      canvas.append(frame); link.append(canvas);
    } else { link.append(node('span', 'preview-unavailable', I.msg("open.the.design.to.see.its.preview"))); }
    const favorite = node('button', 'favorite-button');
    favorite.type = 'button';
    favorite.dataset.focus = `favorite-${design.id}`;
    favorite.setAttribute('aria-pressed', String(design.favorite));
    I.attr(favorite, 'aria-label', I.msg("favorites", {p0: design.title, p1: design.favorite ? I.msg("remove.from") : I.msg("add.to")}));
    I.attr(favorite, 'title', design.favorite ? I.msg("remove.from.favorites") : I.msg("add.to.favorites"));
    favorite.append(icon('star'));
    favorite.addEventListener('click', () => toggleFavorite(design.id));
    surface.append(link, favorite);
    return surface;
  }
  function makeCard(design) {
    const card = node('article', 'design-card');
    card.dataset.id = design.id; card.dataset.kind = design.kind;
    const info = node('div', 'design-info'), classification = node('div', 'design-classification');
    const edit = node('button', 'metadata-button', I.msg("change.project.type"));
    edit.type = 'button'; edit.dataset.focus = `metadata-${design.id}`;
    I.attr(edit, 'aria-label', I.msg("change.project.and.type.for", {p0: design.title}));
    edit.addEventListener('click', () => showMetadata(design.id));
    classification.append(node('span','design-kind',kindName(design.kind)), edit);
    const heading = node('h2', 'design-title', design.title), meta = node('p', 'design-meta');
    meta.append(node('span', '', I.msg("directions", {p0: design.variantCount})));
    const variant = design.preview?.variant;
    if (variant) {
      const adopted = design.selectedId === variant.id;
      const label = node('span', 'preview-label', I.msg("direction.preview.caption", {p0: adopted ? I.msg("adopted") : I.msg("viewing"), p1: variant.id, p2: variant.name}));
      label.dataset.adopted = String(adopted); I.attr(label, 'title', I.msg("direction.preview.caption", {p0: adopted ? I.msg("adopted") : I.msg("viewing"), p1: variant.id, p2: variant.name})); meta.append(label);
    }
    info.append(classification, heading, meta);
    const bottom = node('div', 'design-bottom'), date = new Date(design.updatedAt);
    if (Number.isFinite(date.getTime())) {
      const time = node('time', 'updated-at', I.msg("updated", {p0: I.dateText(date, {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}));
      time.dateTime = date.toISOString();
      I.attr(time, 'title', () => I.date(date, {dateStyle:'full',timeStyle:'short'}));
      bottom.append(time);
    }
    const actions = node('div', 'design-actions'), open = node('a', 'open-design', I.msg("open"));
    open.href = designUrl(design); open.dataset.focus = `open-${design.id}`;
    I.attr(open, 'aria-label', I.msg("open.2", {p0: design.title})); open.append(icon('arrow'));
    open.addEventListener('click', event => { if (app.pending) event.preventDefault(); });
    const duplicate = node('button', 'duplicate-button', I.msg("duplicate.and.open"));
    duplicate.type = 'button'; duplicate.dataset.focus = `duplicate-${design.id}`;
    I.attr(duplicate, 'aria-label', I.msg("duplicate.and.open.2", {p0: design.title}));
    duplicate.addEventListener('click', () => duplicateDesign(design.id));
    actions.append(open, duplicate); bottom.append(actions);
    card.append(makePreview(design), info, bottom);
    return card;
  }
  function makeProjectRow(project) {
    const unassigned = project.id === null, row = node('li', 'project-row'), link = node('a', 'project-link');
    row.dataset.id = project.id || 'unassigned'; row.dataset.unassigned = String(unassigned);
    link.href = projectPath(project.id); link.dataset.focus = `project-${project.id || 'unassigned'}`;
    const symbol = node('span', 'project-symbol'); symbol.append(icon('folder'));
    const name = node('span', 'project-name', project.name);
    if (unassigned) name.append(node('small', '', I.msg("designs.without.a.project")));
    else if (!project.designCount) name.append(node('small', '', I.msg("no.designs.yet")));
    const counts = node('span', 'project-counts');
    for (const [label, count] of [[I.msg("screen"),project.screenCount],[I.msg("component"),project.componentCount]]) {
      const item = node('span', 'project-count'); item.append(node('span','',label),node('strong','',String(count || 0))); counts.append(item);
    }
    const arrow = icon('arrow'); arrow.classList.add('project-arrow');
    link.append(symbol,name,counts,arrow); row.append(link);
    if (!unassigned) {
      const rename = node('button', 'icon-button rename-button'); rename.type = 'button';
      rename.dataset.focus = `rename-${project.id}`;
      I.attr(rename, 'aria-label', I.msg("rename", {p0: project.name})); I.attr(rename, 'title', I.msg("rename.2"));
      const mark = icon('rename'); mark.setAttribute('width','17'); mark.setAttribute('height','17'); rename.append(mark);
      rename.addEventListener('click', () => showProjectDialog(project.id)); row.append(rename);
    }
    return row;
  }
  function renderPending() {
    const busy = app.loading || Boolean(app.pending);
    elements.retryLoad.disabled = busy;
    elements.createProject.disabled = busy;
    elements.renameProject.disabled = busy;
    elements.projectList.querySelectorAll('button').forEach(button => button.disabled = busy);
    elements.designGrid.querySelectorAll('.design-card').forEach(card => {
      const pendingHere = app.pending?.id === card.dataset.id;
      card.dataset.pending = String(pendingHere);
      card.querySelectorAll('button').forEach(button => button.disabled = busy);
      card.querySelector('.open-design').setAttribute('aria-disabled', String(Boolean(app.pending)));
      I.text(card.querySelector('.duplicate-button'), pendingHere && app.pending.action === 'duplicate' ? I.msg("duplicating") : I.msg("duplicate.and.open"));
    });
  }
  function render(fallbackFocus = null) {
    const focus = document.activeElement?.dataset.focus || (document.activeElement === document.body ? fallbackFocus : null);
    const project = currentProject(), name = overview ? I.msg("projects") : projectName(projectId);
    I.text(elements.libraryTitle, projectId && app.loaded && !project ? I.msg("project.not.found") : name);
    I.attr(document, 'title', I.msg("design.library", {p0: name}));
    elements.breadcrumb.hidden = overview; I.text(elements.breadcrumbCurrent, name);
    elements.projectOverview.hidden = !overview; elements.projectGallery.hidden = overview || (app.loaded && Boolean(projectId) && !project);
    elements.createProject.hidden = !overview; elements.renameProject.hidden = overview || !project;
    elements.projectSummary.hidden = overview || !app.loaded || Boolean(projectId && !project);
    if (!overview) {
      const works = scopedDesigns();
      I.text(elements.projectSummary, I.msg("screens.components", {p0: works.filter(d => d.kind === 'screen').length, p1: works.filter(d => d.kind === 'component').length}));
    }
    previewObserver.disconnect();
    if (overview) {
      const works = app.designs.filter(design => !design.projectId);
      const unassigned = {id:null,name:I.msg("unassigned"),designCount:works.length,screenCount:works.filter(d => d.kind === 'screen').length,componentCount:works.filter(d => d.kind === 'component').length};
      elements.projectList.replaceChildren(...(app.loaded ? [...app.projects,unassigned].map(makeProjectRow) : []));
      elements.noProjects.hidden = !app.loaded || app.projects.length > 0;
      elements.projectOverview.setAttribute('aria-busy', String(app.loading));
    } else {
      [elements.allFilter,elements.screenFilter,elements.componentFilter].forEach(button => button.setAttribute('aria-pressed', String(app.kind === button.dataset.kind)));
      elements.favoriteFilter.setAttribute('aria-pressed', String(app.favoritesOnly));
      const designs = filteredDesigns();
      elements.designGrid.replaceChildren(...designs.map(makeCard));
      elements.designGrid.querySelectorAll('.preview-link').forEach(link => previewObserver.observe(link));
      elements.designGrid.setAttribute('aria-busy', String(app.loading));
      I.text(elements.resultContext, app.loaded && designs.length ? I.msg("designs.most.recently.updated", {p0: designs.length}) : '');
      elements.emptyState.hidden = !app.loaded || designs.length > 0;
      if (app.loaded && !designs.length) {
        const emptyProject = !scopedDesigns().length;
        I.text(elements.emptyTitle, emptyProject ? I.msg("no.designs.yet.2") : I.msg("no.matching.designs"));
        I.text(elements.emptyDescription, emptyProject
          ? I.msg("ask.codex.to.create.a.screen.or", {p0: name})
          : I.msg("try.changing.the.name.type.or.favorites"));
        I.text(elements.emptyAction, emptyProject ? I.msg("how.to.add.designs") : I.msg("clear.search.and.filters"));
      }
    }
    renderPending();
    if (focus && !document.querySelector('dialog[open]')) {
      const next = document.querySelector(`[data-focus="${CSS.escape(focus)}"]`);
      if (next && !next.disabled) next.focus({preventScroll:true});
      else elements.libraryTitle.focus({preventScroll:true});
    }
  }
  async function loadLibrary({keepNotice = false} = {}) {
    if (app.loading || app.pending) return false;
    app.loading = true;
    if (!keepNotice) clearNotice();
    elements.loadingState.hidden = app.loaded; renderPending();
    let succeeded = false;
    try {
      const [projects, designs] = await Promise.all([request('/api/projects'),request('/api/designs')]);
      if (!Array.isArray(projects.projects) || !Array.isArray(designs.designs)) throw I.error(I.msg("could.not.read.the.list"));
      app.projects = projects.projects;
      app.designs = designs.designs.map(design => ({...design,projectId:design.projectId || null,kind:design.kind === 'component' ? 'component' : 'screen'}));
      document.dispatchEvent(new CustomEvent('design-library:loaded', {detail:{projects:app.projects}}));
      app.loaded = true; succeeded = true;
      if (!overview && projectId && !currentProject()) notify(I.msg("this.project.was.not.found.open.it"),'info',false);
    } catch (_error) {
      notify(I.msg("could.not.load.the.library.check.that"));
    } finally { app.loading = false; elements.loadingState.hidden = true; render(); }
    return succeeded;
  }
  async function recoverConflict(title) {
    app.pending = null;
    if (await loadLibrary({keepNotice:true})) notify(I.msg("was.updated.elsewhere.the.list.is.now", {p0: title}), 'info', false);
  }
  async function toggleFavorite(id) {
    if (app.pending || app.loading) return;
    const design = app.designs.find(item => item.id === id); if (!design) return;
    app.pending = {id,action:'favorite'}; clearNotice(); renderPending();
    try {
      const payload = await request(`/api/designs/${encodeURIComponent(id)}/favorite`, {favorite:!design.favorite,revision:design.revision});
      if (typeof payload.favorite !== 'boolean' || !payload.revision) throw I.error(I.msg("could.not.read.the.save.result"));
      announce(I.msg("favorites.2", {p0: design.title, p1: payload.favorite ? I.msg("added.to") : I.msg("removed.from")}));
      app.pending = null; await loadLibrary({keepNotice:true});
    } catch (error) {
      if (error.status === 409) await recoverConflict(design.title);
      else notify(I.msg("could.not.confirm.the.favorite.update.reload"));
    } finally { app.pending = null; render(`favorite-${id}`); }
  }
  async function duplicateDesign(id) {
    if (app.pending || app.loading) return;
    const design = app.designs.find(item => item.id === id); if (!design) return;
    app.pending = {id,action:'duplicate'}; clearNotice(); renderPending();
    let navigating = false;
    try {
      const payload = await request(`/api/designs/${encodeURIComponent(id)}/duplicate`, {revision:design.revision,title:I.t("duplicate.title",{name:design.title})});
      if (typeof payload.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.id)) throw I.error(I.msg("could.not.read.the.duplicate.result"));
      announce(I.msg("opening.the.duplicated.design")); navigating = true;
      window.location.assign(designUrl({...payload,projectId:design.projectId}));
    } catch (error) {
      if (error.status === 409) await recoverConflict(design.title);
      else notify(I.msg("could.not.confirm.duplication.reload.the.list"));
    } finally { if (!navigating) { app.pending = null; render(); } }
  }
  function showDialog(dialog) {
    dialogOpeners.set(dialog, {element:document.activeElement,key:document.activeElement?.dataset.focus});
    dialog.showModal();
  }
  function setFormMessage(element, message, tone = 'error') { I.text(element, message); element.dataset.tone = tone; element.hidden = !message; }
  function setFormBusy(form, busy) {
    form.dataset.busy = String(busy);
    form.querySelectorAll('button,input,select').forEach(input => input.disabled = busy);
  }
  function showAddHelp() {
    const name = overview ? I.msg("reading.app") : projectName(projectId);
    I.text(elements.addRequestExample, I.msg("create.three.book.card.directions.for.a", {p0: name, p1: !overview && !projectId ? '' : I.msg("projects")}));
    showDialog(elements.addDialog);
  }
  function showProjectDialog(id = null) {
    const project = id ? app.projects.find(item => item.id === id) : null;
    if (id && !project) return;
    app.projectDraft = {id,revision:project?.revision,current:null};
    I.text(elements.projectDialogTitle, id ? I.msg("rename.project") : I.msg("create.project"));
    elements.projectName.value = project?.name || '';
    I.text(elements.saveProject, id ? I.msg("save.changes") : I.msg("create"));
    elements.projectConflict.hidden = true;
    setFormMessage(elements.projectError,'');
    showDialog(elements.projectDialog);
    elements.projectName.focus();
  }
  async function saveProject(event) {
    event.preventDefault();
    const draft = app.projectDraft, name = elements.projectName.value.trim();
    if (!draft || elements.projectForm.dataset.busy === 'true') return;
    if (!name) { setFormMessage(elements.projectError,I.msg("enter.a.project.name")); elements.projectName.focus(); return; }
    setFormBusy(elements.projectForm,true); setFormMessage(elements.projectError,'');
    let saved = null;
    try {
      const path = draft.id ? `/api/projects/${encodeURIComponent(draft.id)}` : '/api/projects';
      saved = await request(path,{name,...(draft.id ? {revision:draft.revision} : {})},draft.id ? 'PATCH' : 'POST');
      if (!saved.id || !saved.revision) throw I.error(I.msg("could.not.read.the.save.result"));
      announce(I.msg("project.saved.announcement", {p0: saved.name, p1: draft.id ? I.msg("updated.2") : I.msg("create")}));
      await loadLibrary({keepNotice:true});
    } catch (error) {
      saved = null;
      if (error.status === 409) {
        const current = error.payload.project || error.payload;
        if (current.revision && typeof current.name === 'string') {
          draft.revision = current.revision; draft.current = current;
          I.text(elements.projectConflictCurrent, I.msg("current.name", {p0: current.name}));
          elements.projectConflict.hidden = false;
          I.text(elements.saveProject, I.msg("save.this.name"));
          setFormMessage(elements.projectError,I.msg("the.name.changed.elsewhere.your.input.is"),'info');
        } else setFormMessage(elements.projectError,I.msg("could.not.load.the.latest.name.copy"));
      } else setFormMessage(elements.projectError, error.status === 400 ? I.msg("check.the.project.name.use.up.to") : I.msg("could.not.confirm.saving.your.input.is"));
    } finally {
      setFormBusy(elements.projectForm,false);
      if (saved) {
        dialogOpeners.set(elements.projectDialog,{key:overview ? `project-${saved.id}` : null});
        elements.projectDialog.close();
      }
    }
  }
  function fillProjectOptions(value) {
    const unassigned = node('option','',I.msg("unassigned")); unassigned.value = '';
    elements.metadataProject.replaceChildren(unassigned,...app.projects.map(project => { const option=node('option','',project.name); option.value=project.id; return option; }));
    if (value && !app.projects.some(project => project.id === value)) {
      const unknown = node('option','',I.msg("current.project")); unknown.value = value; elements.metadataProject.append(unknown);
    }
    elements.metadataProject.value = value || '';
  }
  function setMetadataValues(library) {
    fillProjectOptions(library.projectId);
    elements.metadataForm.querySelector(`input[name="kind"][value="${library.kind === 'component' ? 'component' : 'screen'}"]`).checked = true;
  }
  function showMetadata(id) {
    const design = app.designs.find(item => item.id === id); if (!design) return;
    app.metadataDraft = {id,revision:design.revision,current:null};
    I.text(elements.metadataDesignTitle, design.title);
    setMetadataValues(design); elements.metadataConflict.hidden = true;
    I.text(elements.saveMetadata, I.msg("save.changes")); setFormMessage(elements.metadataError,'');
    showDialog(elements.metadataDialog); elements.metadataProject.focus();
  }
  async function saveMetadata(event) {
    event.preventDefault();
    const draft = app.metadataDraft;
    if (!draft || elements.metadataForm.dataset.busy === 'true') return;
    const project = elements.metadataProject.value || null;
    const kind = elements.metadataForm.querySelector('input[name="kind"]:checked').value;
    setFormBusy(elements.metadataForm,true); setFormMessage(elements.metadataError,'');
    let saved = false;
    try {
      const payload = await request(`/api/designs/${encodeURIComponent(draft.id)}/metadata`, {revision:draft.revision,projectId:project,kind},'PATCH');
      if (!payload.revision) throw I.error(I.msg("could.not.read.the.save.result"));
      saved = true;
      const refreshed = await loadLibrary({keepNotice:true});
      announce(I.msg("project.and.type.saved"));
      if (refreshed && project !== projectId) notify(I.msg("moved.to", {p0: elements.metadataDesignTitle.textContent, p1: projectName(project)}), 'info', false);
    } catch (error) {
      if (error.status === 409) {
        let current = error.payload;
        if (!current.library || !current.revision) {
          try { current = await request(`/api/designs/${encodeURIComponent(draft.id)}/state`); } catch (_error) {}
        }
        if (current.library && current.revision) {
          draft.revision = current.revision; draft.current = current.library;
          I.text(elements.metadataConflictCurrent, I.msg("currently.saved", {p0: projectName(current.library.projectId), p1: kindName(current.library.kind)}));
          elements.metadataConflict.hidden = false;
          I.text(elements.saveMetadata, I.msg("save.this.input"));
          setFormMessage(elements.metadataError,I.msg("this.design.changed.elsewhere.your.input.is"),'info');
        } else setFormMessage(elements.metadataError,I.msg("could.not.load.the.saved.version.copy"));
      } else setFormMessage(elements.metadataError, error.status === 400 || error.status === 404
        ? I.msg("the.design.or.destination.was.not.found")
        : I.msg("could.not.confirm.saving.your.input.is"));
    } finally { setFormBusy(elements.metadataForm,false); if (saved) elements.metadataDialog.close(); }
  }
  function bindEvents() {
    elements.designSearch.value = app.search;
    elements.designSearch.addEventListener('input', () => { app.search=elements.designSearch.value; rememberFilters(); render(); });
    [elements.allFilter,elements.screenFilter,elements.componentFilter].forEach(button => button.addEventListener('click', () => { app.kind=button.dataset.kind; rememberFilters(); render(); }));
    elements.favoriteFilter.addEventListener('click', () => { app.favoritesOnly=!app.favoritesOnly; rememberFilters(); render(); });
    elements.retryLoad.addEventListener('click', () => loadLibrary());
    elements.dismissNotice.addEventListener('click', clearNotice);
    elements.openAddHelp.addEventListener('click', showAddHelp);
    elements.createProject.addEventListener('click', () => showProjectDialog());
    elements.renameProject.addEventListener('click', () => showProjectDialog(projectId));
    elements.projectForm.addEventListener('submit', saveProject);
    elements.metadataForm.addEventListener('submit', saveMetadata);
    elements.useCurrentProject.addEventListener('click', () => {
      if (app.projectDraft?.current) { elements.projectName.value=app.projectDraft.current.name; elements.projectName.focus(); }
    });
    elements.useCurrentMetadata.addEventListener('click', () => {
      if (app.metadataDraft?.current) { setMetadataValues(app.metadataDraft.current); elements.metadataProject.focus(); }
    });
    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => elements[button.dataset.close].close()));
    [elements.addDialog,elements.projectDialog,elements.metadataDialog].forEach(dialog => {
      dialog.addEventListener('cancel', event => { if (dialog.querySelector('form[data-busy="true"]')) event.preventDefault(); });
      dialog.addEventListener('click', event => {
        if (event.target !== dialog || dialog.querySelector('form[data-busy="true"]')) return;
        const bounds=dialog.getBoundingClientRect();
        if (event.clientX<bounds.left || event.clientX>bounds.right || event.clientY<bounds.top || event.clientY>bounds.bottom) dialog.close();
      });
      dialog.addEventListener('close', () => {
        const opener=dialogOpeners.get(dialog);
        const target = opener?.element?.isConnected ? opener.element : opener?.key ? document.querySelector(`[data-focus="${CSS.escape(opener.key)}"]`) : null;
        (target && !target.disabled && !target.closest('[hidden]') ? target : elements.libraryTitle).focus({preventScroll:true});
      });
    });
    elements.emptyAction.addEventListener('click', () => {
      if (!scopedDesigns().length) { showAddHelp(); return; }
      app.search=''; app.favoritesOnly=false; app.kind='all'; elements.designSearch.value=''; rememberFilters(); render(); elements.allFilter.focus();
    });
    window.addEventListener('pageshow', event => { if (event.persisted) { app.pending=null; loadLibrary(); } });
    document.addEventListener('design-library:refresh', () => loadLibrary({keepNotice:true}));
  }
  async function start() {
    bindEvents(); render();
    try { const response=await fetch('/workbench/legacy-v1.css',{credentials:'same-origin'}); if(response.ok)app.legacyCss=await response.text(); } catch (_error) {}
    await loadLibrary();
  }
  start();
})();
