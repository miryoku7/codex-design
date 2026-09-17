(() => {
  'use strict';

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
    constructor(message, status, payload = {}) { super(message); this.status = status; this.payload = payload; }
  }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
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
      if (!response.ok) throw new ApiError(payload.message || `操作に失敗しました（${response.status}）`, response.status, payload);
      return payload;
    } finally { window.clearTimeout(timeout); }
  }
  function notify(message, tone = 'error', retry = true) {
    elements.noticeMessage.textContent = message;
    elements.libraryNotice.dataset.tone = tone;
    elements.retryLoad.hidden = !retry;
    elements.libraryNotice.hidden = false;
  }
  function clearNotice() { elements.libraryNotice.hidden = true; }
  function announce(message) { elements.actionStatus.textContent = message; }
  function kindName(kind) { return kind === 'component' ? 'コンポーネント' : '画面'; }
  function projectName(id) { return id ? app.projects.find(item => item.id === id)?.name || 'プロジェクト' : '未分類'; }
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
    const search = app.search.trim().normalize('NFKC').toLocaleLowerCase('ja');
    return scopedDesigns().filter(design => (!app.favoritesOnly || design.favorite) &&
      (app.kind === 'all' || design.kind === app.kind) &&
      (!search || design.title.normalize('NFKC').toLocaleLowerCase('ja').includes(search)));
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
      frame.title = `${design.title}：${variant.name}のプレビュー`;
      frame.tabIndex = -1;
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('sandbox', '');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.setAttribute('loading', 'lazy');
      frame.srcdoc = window.DesignPreview.frameDocument(variant, app.legacyCss);
      canvas.append(frame); link.append(canvas);
    } else { link.append(node('span', 'preview-unavailable', 'プレビューは作品を開いて確認できます')); }
    const favorite = node('button', 'favorite-button');
    favorite.type = 'button';
    favorite.dataset.focus = `favorite-${design.id}`;
    favorite.setAttribute('aria-pressed', String(design.favorite));
    favorite.setAttribute('aria-label', `${design.title}をお気に入り${design.favorite ? 'から外す' : 'に追加'}`);
    favorite.title = design.favorite ? 'お気に入りから外す' : 'お気に入りに追加';
    favorite.append(icon('star'));
    favorite.addEventListener('click', () => toggleFavorite(design.id));
    surface.append(link, favorite);
    return surface;
  }
  function makeCard(design) {
    const card = node('article', 'design-card');
    card.dataset.id = design.id; card.dataset.kind = design.kind;
    const info = node('div', 'design-info'), classification = node('div', 'design-classification');
    const edit = node('button', 'metadata-button', '所属・種類を変更');
    edit.type = 'button'; edit.dataset.focus = `metadata-${design.id}`;
    edit.setAttribute('aria-label', `${design.title}の所属と種類を変更`);
    edit.addEventListener('click', () => showMetadata(design.id));
    classification.append(node('span','design-kind',kindName(design.kind)), edit);
    const heading = node('h2', 'design-title', design.title), meta = node('p', 'design-meta');
    meta.append(node('span', '', `${design.variantCount}案`));
    const variant = design.preview?.variant;
    if (variant) {
      const adopted = design.selectedId === variant.id;
      const label = node('span', 'preview-label', `${adopted ? '採用' : '表示'}：${variant.id} ${variant.name}`);
      label.dataset.adopted = String(adopted); label.title = label.textContent; meta.append(label);
    }
    info.append(classification, heading, meta);
    const bottom = node('div', 'design-bottom'), date = new Date(design.updatedAt);
    if (Number.isFinite(date.getTime())) {
      const time = node('time', 'updated-at', `${new Intl.DateTimeFormat('ja-JP', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date)} 更新`);
      time.dateTime = date.toISOString();
      time.title = new Intl.DateTimeFormat('ja-JP', {dateStyle:'full',timeStyle:'short'}).format(date);
      bottom.append(time);
    }
    const actions = node('div', 'design-actions'), open = node('a', 'open-design', '開く');
    open.href = designUrl(design); open.dataset.focus = `open-${design.id}`;
    open.setAttribute('aria-label', `${design.title}を開く`); open.append(icon('arrow'));
    open.addEventListener('click', event => { if (app.pending) event.preventDefault(); });
    const duplicate = node('button', 'duplicate-button', '複製して開く');
    duplicate.type = 'button'; duplicate.dataset.focus = `duplicate-${design.id}`;
    duplicate.setAttribute('aria-label', `${design.title}を複製して開く`);
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
    if (unassigned) name.append(node('small', '', 'プロジェクトに振り分けていない作品'));
    else if (!project.designCount) name.append(node('small', '', 'まだ作品がありません'));
    const counts = node('span', 'project-counts');
    for (const [label, count] of [['画面',project.screenCount],['コンポーネント',project.componentCount]]) {
      const item = node('span', 'project-count'); item.append(node('span','',label),node('strong','',String(count || 0))); counts.append(item);
    }
    const arrow = icon('arrow'); arrow.classList.add('project-arrow');
    link.append(symbol,name,counts,arrow); row.append(link);
    if (!unassigned) {
      const rename = node('button', 'icon-button rename-button'); rename.type = 'button';
      rename.dataset.focus = `rename-${project.id}`;
      rename.setAttribute('aria-label', `${project.name}の名前を変更`); rename.title = '名前を変更';
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
      card.querySelector('.duplicate-button').textContent = pendingHere && app.pending.action === 'duplicate' ? '複製中…' : '複製して開く';
    });
  }
  function render(fallbackFocus = null) {
    const focus = document.activeElement?.dataset.focus || (document.activeElement === document.body ? fallbackFocus : null);
    const project = currentProject(), name = overview ? 'プロジェクト' : projectName(projectId);
    elements.libraryTitle.textContent = projectId && app.loaded && !project ? 'プロジェクトが見つかりません' : name;
    document.title = `${name} | デザインライブラリ`;
    elements.breadcrumb.hidden = overview; elements.breadcrumbCurrent.textContent = name;
    elements.projectOverview.hidden = !overview; elements.projectGallery.hidden = overview || (app.loaded && Boolean(projectId) && !project);
    elements.createProject.hidden = !overview; elements.renameProject.hidden = overview || !project;
    elements.projectSummary.hidden = overview || !app.loaded || Boolean(projectId && !project);
    if (!overview) {
      const works = scopedDesigns();
      elements.projectSummary.textContent = `画面 ${works.filter(d => d.kind === 'screen').length}　コンポーネント ${works.filter(d => d.kind === 'component').length}`;
    }
    previewObserver.disconnect();
    if (overview) {
      const works = app.designs.filter(design => !design.projectId);
      const unassigned = {id:null,name:'未分類',designCount:works.length,screenCount:works.filter(d => d.kind === 'screen').length,componentCount:works.filter(d => d.kind === 'component').length};
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
      elements.resultContext.textContent = app.loaded && designs.length ? `${designs.length}件の作品　更新が新しい順` : '';
      elements.emptyState.hidden = !app.loaded || designs.length > 0;
      if (app.loaded && !designs.length) {
        const emptyProject = !scopedDesigns().length;
        elements.emptyTitle.textContent = emptyProject ? '作品はまだありません' : '条件に合う作品がありません';
        elements.emptyDescription.textContent = emptyProject
          ? `Codexに画面やコンポーネントの制作を依頼し、「${name}」に保存してください。`
          : '作品名や種類、お気に入りの絞り込みを変えて探してください。';
        elements.emptyAction.textContent = emptyProject ? '作品の追加方法' : '検索と絞り込みを解除';
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
      if (!Array.isArray(projects.projects) || !Array.isArray(designs.designs)) throw new Error('一覧の形式を読み取れませんでした');
      app.projects = projects.projects;
      app.designs = designs.designs.map(design => ({...design,projectId:design.projectId || null,kind:design.kind === 'component' ? 'component' : 'screen'}));
      document.dispatchEvent(new CustomEvent('design-library:loaded', {detail:{projects:app.projects}}));
      app.loaded = true; succeeded = true;
      if (!overview && projectId && !currentProject()) notify('このプロジェクトは見つかりませんでした。プロジェクト一覧から開き直してください。','info',false);
    } catch (_error) {
      notify('ライブラリを読み込めませんでした。サーバーの起動を確認して、一覧を再読み込みしてください。');
    } finally { app.loading = false; elements.loadingState.hidden = true; render(); }
    return succeeded;
  }
  async function recoverConflict(title) {
    app.pending = null;
    if (await loadLibrary({keepNotice:true})) notify(`「${title}」は別の場所で更新されています。最新の一覧に更新しました。内容を確認して、もう一度操作してください。`, 'info', false);
  }
  async function toggleFavorite(id) {
    if (app.pending || app.loading) return;
    const design = app.designs.find(item => item.id === id); if (!design) return;
    app.pending = {id,action:'favorite'}; clearNotice(); renderPending();
    try {
      const payload = await request(`/api/designs/${encodeURIComponent(id)}/favorite`, {favorite:!design.favorite,revision:design.revision});
      if (typeof payload.favorite !== 'boolean' || !payload.revision) throw new Error('保存結果を読み取れませんでした');
      announce(`「${design.title}」をお気に入り${payload.favorite ? 'に追加しました' : 'から外しました'}`);
      app.pending = null; await loadLibrary({keepNotice:true});
    } catch (error) {
      if (error.status === 409) await recoverConflict(design.title);
      else notify('お気に入りの保存結果を確認できませんでした。一覧を再読み込みして、星の状態を確認してください。');
    } finally { app.pending = null; render(`favorite-${id}`); }
  }
  async function duplicateDesign(id) {
    if (app.pending || app.loading) return;
    const design = app.designs.find(item => item.id === id); if (!design) return;
    app.pending = {id,action:'duplicate'}; clearNotice(); renderPending();
    let navigating = false;
    try {
      const payload = await request(`/api/designs/${encodeURIComponent(id)}/duplicate`, {revision:design.revision});
      if (typeof payload.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.id)) throw new Error('複製結果を読み取れませんでした');
      announce('複製した作品を開きます'); navigating = true;
      window.location.assign(designUrl({...payload,projectId:design.projectId}));
    } catch (error) {
      if (error.status === 409) await recoverConflict(design.title);
      else notify('複製の結果を確認できませんでした。もう一度複製する前に、一覧を再読み込みして作品を確認してください。');
    } finally { if (!navigating) { app.pending = null; render(); } }
  }
  function showDialog(dialog) {
    dialogOpeners.set(dialog, {element:document.activeElement,key:document.activeElement?.dataset.focus});
    dialog.showModal();
  }
  function setFormMessage(element, message, tone = 'error') { element.textContent = message; element.dataset.tone = tone; element.hidden = !message; }
  function setFormBusy(form, busy) {
    form.dataset.busy = String(busy);
    form.querySelectorAll('button,input,select').forEach(input => input.disabled = busy);
  }
  function showAddHelp() {
    const name = overview ? '読書アプリ' : projectName(projectId);
    elements.addRequestExample.textContent = `読書アプリの本のカードを3案考えたい。コンポーネントとして比較できるようにして、「${name}」${name === '未分類' ? '' : 'プロジェクト'}に保存して。`;
    showDialog(elements.addDialog);
  }
  function showProjectDialog(id = null) {
    const project = id ? app.projects.find(item => item.id === id) : null;
    if (id && !project) return;
    app.projectDraft = {id,revision:project?.revision,current:null};
    elements.projectDialogTitle.textContent = id ? 'プロジェクト名を変更' : 'プロジェクトを作成';
    elements.projectName.value = project?.name || '';
    elements.saveProject.textContent = id ? '変更を保存' : '作成';
    elements.projectConflict.hidden = true;
    setFormMessage(elements.projectError,'');
    showDialog(elements.projectDialog);
    elements.projectName.focus();
  }
  async function saveProject(event) {
    event.preventDefault();
    const draft = app.projectDraft, name = elements.projectName.value.trim();
    if (!draft || elements.projectForm.dataset.busy === 'true') return;
    if (!name) { setFormMessage(elements.projectError,'プロジェクト名を入力してください。'); elements.projectName.focus(); return; }
    setFormBusy(elements.projectForm,true); setFormMessage(elements.projectError,'');
    let saved = null;
    try {
      const path = draft.id ? `/api/projects/${encodeURIComponent(draft.id)}` : '/api/projects';
      saved = await request(path,{name,...(draft.id ? {revision:draft.revision} : {})},draft.id ? 'PATCH' : 'POST');
      if (!saved.id || !saved.revision) throw new Error('保存結果を読み取れませんでした');
      announce(`「${saved.name}」を${draft.id ? '変更' : '作成'}しました`);
      await loadLibrary({keepNotice:true});
    } catch (error) {
      saved = null;
      if (error.status === 409) {
        const current = error.payload.project || error.payload;
        if (current.revision && typeof current.name === 'string') {
          draft.revision = current.revision; draft.current = current;
          elements.projectConflictCurrent.textContent = `現在の名前：${current.name}`;
          elements.projectConflict.hidden = false;
          elements.saveProject.textContent = 'この名前で保存';
          setFormMessage(elements.projectError,'別の場所で名前が変更されています。入力は残しています。現在の名前を確認してから保存してください。','info');
        } else setFormMessage(elements.projectError,'最新の名前を読み込めませんでした。入力を控えて、一覧を再読み込みしてください。');
      } else setFormMessage(elements.projectError, error.status === 400 ? 'プロジェクト名を確認してください。300文字まで入力できます。' : '保存結果を確認できませんでした。入力は残しています。もう一度保存すると、現在の保存内容を確認します。');
    } finally {
      setFormBusy(elements.projectForm,false);
      if (saved) {
        dialogOpeners.set(elements.projectDialog,{key:overview ? `project-${saved.id}` : null});
        elements.projectDialog.close();
      }
    }
  }
  function fillProjectOptions(value) {
    const unassigned = node('option','','未分類'); unassigned.value = '';
    elements.metadataProject.replaceChildren(unassigned,...app.projects.map(project => { const option=node('option','',project.name); option.value=project.id; return option; }));
    if (value && !app.projects.some(project => project.id === value)) {
      const unknown = node('option','','現在のプロジェクト'); unknown.value = value; elements.metadataProject.append(unknown);
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
    elements.metadataDesignTitle.textContent = design.title;
    setMetadataValues(design); elements.metadataConflict.hidden = true;
    elements.saveMetadata.textContent = '変更を保存'; setFormMessage(elements.metadataError,'');
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
      if (!payload.revision) throw new Error('保存結果を読み取れませんでした');
      saved = true;
      const refreshed = await loadLibrary({keepNotice:true});
      announce('作品の所属と種類を保存しました');
      if (refreshed && project !== projectId) notify(`「${elements.metadataDesignTitle.textContent}」を「${projectName(project)}」に移しました。`, 'info', false);
    } catch (error) {
      if (error.status === 409) {
        let current = error.payload;
        if (!current.library || !current.revision) {
          try { current = await request(`/api/designs/${encodeURIComponent(draft.id)}/state`); } catch (_error) {}
        }
        if (current.library && current.revision) {
          draft.revision = current.revision; draft.current = current.library;
          elements.metadataConflictCurrent.textContent = `現在の保存内容：${projectName(current.library.projectId)} ／ ${kindName(current.library.kind)}`;
          elements.metadataConflict.hidden = false;
          elements.saveMetadata.textContent = 'この入力で保存';
          setFormMessage(elements.metadataError,'別の場所で作品が更新されています。入力は残しています。現在の保存内容を確認してから保存してください。','info');
        } else setFormMessage(elements.metadataError,'最新の保存内容を読み込めませんでした。入力を控えて、一覧を再読み込みしてください。');
      } else setFormMessage(elements.metadataError, error.status === 400 || error.status === 404
        ? '作品または保存先が見つかりません。入力を控えて、一覧を再読み込みしてください。'
        : '保存結果を確認できませんでした。入力は残しています。もう一度保存すると、現在の保存内容を確認します。');
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
