(function () {
  "use strict";

  const STORAGE_KEY = "sop-manager:data:v4";
  const TRANSITION_MS = 150;

  const state = {
    mode: "viewer",
    data: null,
    dataSource: "",
    selectedFlowId: "",
    activePageType: "node",
    activePageId: "",
    dirty: false
  };

  const dom = {};
  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheDom();
    bindShellEvents();
    const loaded = await loadData();
    state.data = loaded.data;
    state.dataSource = loaded.source;
    normalizeData(state.data);
    state.selectedFlowId = getInitialFlowId(state.data);
    state.activePageId = getFirstNodeId(state.selectedFlowId) || getFirstModuleId() || "";
    state.activePageType = getNode(state.activePageId) ? "node" : "module";
    render();
  }

  function cacheDom() {
    dom.body = document.body;
    dom.appTitle = document.getElementById("appTitle");
    dom.appSubtitle = document.getElementById("appSubtitle");
    dom.modeToggle = document.getElementById("modeToggle");
    dom.devToolbar = document.getElementById("devToolbar");
    dom.saveLocalBtn = document.getElementById("saveLocalBtn");
    dom.exportJsonBtn = document.getElementById("exportJsonBtn");
    dom.importJsonInput = document.getElementById("importJsonInput");
    dom.exportViewerHtmlBtn = document.getElementById("exportViewerHtmlBtn");
    dom.exportManagerHtmlBtn = document.getElementById("exportManagerHtmlBtn");
    dom.clearLocalBtn = document.getElementById("clearLocalBtn");
    dom.flowNav = document.getElementById("flowNav");
    dom.app = document.getElementById("app");
    dom.toast = document.getElementById("toast");
    dom.lightbox = document.getElementById("lightbox");
    dom.lightboxImage = document.getElementById("lightboxImage");
    dom.lightboxCaption = document.getElementById("lightboxCaption");
    dom.lightboxClose = document.getElementById("lightboxClose");
  }

  function bindShellEvents() {
    dom.modeToggle.addEventListener("click", () => {
      state.mode = state.mode === "viewer" ? "dev" : "viewer";
      render(true);
    });

    dom.flowNav.addEventListener("click", handleNavClick);
    dom.app.addEventListener("click", handleAppClick);
    dom.app.addEventListener("input", handleAppInput);
    dom.app.addEventListener("change", handleAppChange);

    dom.saveLocalBtn.addEventListener("click", () => {
      saveLocal();
      toast("已保存到本机浏览器。");
    });

    dom.exportJsonBtn.addEventListener("click", () => {
      downloadText(fileStamp("sop-data", "json"), JSON.stringify(state.data, null, 2), "application/json;charset=utf-8");
      toast("已导出 JSON。");
    });

    dom.importJsonInput.addEventListener("change", importJson);

    dom.exportViewerHtmlBtn.addEventListener("click", () => {
      downloadText(fileStamp("sop-viewer", "html"), buildViewerHtml(state.data), "text/html;charset=utf-8");
      toast("已导出新人观看版 HTML。");
    });

    dom.exportManagerHtmlBtn.addEventListener("click", () => {
      downloadText(fileStamp("sop-manager", "html"), buildManagerHtml(state.data), "text/html;charset=utf-8");
      toast("已导出维护版 HTML。请与 app.js / style.css / assets 一起保存。");
    });

    dom.clearLocalBtn.addEventListener("click", async () => {
      if (!confirm("确定清空本机保存记录，并恢复到项目数据吗？")) return;
      localStorage.removeItem(STORAGE_KEY);
      const loaded = await loadData({ ignoreLocal: true });
      state.data = loaded.data;
      state.dataSource = loaded.source;
      normalizeData(state.data);
      state.selectedFlowId = getInitialFlowId(state.data);
      state.activePageId = getFirstNodeId(state.selectedFlowId) || getFirstModuleId() || "";
      state.activePageType = getNode(state.activePageId) ? "node" : "module";
      state.dirty = false;
      render();
      toast("已清空本机记录。");
    });

    dom.lightboxClose.addEventListener("click", closeLightbox);
    dom.lightbox.addEventListener("click", (event) => {
      if (event.target === dom.lightbox) closeLightbox();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeLightbox();
      if (event.target && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
      if (state.mode === "viewer" && event.key === "ArrowRight") goRelative(1);
      if (state.mode === "viewer" && event.key === "ArrowLeft") goRelative(-1);
    });
  }

  async function loadData(options = {}) {
    if (!options.ignoreLocal) {
      const local = parseJson(localStorage.getItem(STORAGE_KEY));
      if (local && isValidData(local)) return { data: local, source: "localStorage" };
    }

    try {
      const response = await fetch("data.json", { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        if (isValidData(data)) return { data, source: "data.json" };
      }
    } catch (error) {
      // 本地 file:// 打开时 Chrome 可能阻止 fetch(data.json)，因此保留内嵌快照兜底。
    }

    const embedded = parseJson((document.getElementById("initial-data") || {}).textContent || "");
    if (embedded && isValidData(embedded)) return { data: embedded, source: "embedded" };
    throw new Error("没有找到可用的 SOP 数据。");
  }

  function isValidData(data) {
    return data && Array.isArray(data.flows) && Array.isArray(data.nodes) && Array.isArray(data.branches);
  }

  function normalizeData(data) {
    data.meta = data.meta || {};
    data.flows = data.flows || [];
    data.nodes = data.nodes || [];
    data.branches = data.branches || [];
    data.exceptions = data.exceptions || [];
    data.exceptionModules = data.exceptionModules || [];
    data.screenshots = data.screenshots || [];
    data.versionRecords = data.versionRecords || [];

    data.nodes.forEach((node) => {
      node.belongsToFlows = node.belongsToFlows || [];
      node.shortTitle = node.shortTitle || node.navTitle || node.viewerTitle || node.title || node.id;
      node.viewerSummary = node.viewerSummary || {};
      node.input = node.input || [];
      node.actions = node.actions || [];
      node.passCriteria = node.passCriteria || [];
      node.output = node.output || [];
      node.referenceTables = node.referenceTables || [];
      node.toolPaths = node.toolPaths || [];
      node.branchIds = node.branchIds || [];
      node.exceptionIds = node.exceptionIds || [];
      node.status = node.status || "active";
      node.type = node.type || "normal";
      node.visibleInViewer = node.visibleInViewer !== false;
    });

    data.screenshots.forEach((shot, index) => {
      shot.id = shot.id || uniqueId("shot");
      shot.sortOrder = Number.isFinite(Number(shot.sortOrder)) ? Number(shot.sortOrder) : index + 1;
      shot.displayMode = shot.displayMode || "full";
      shot.visibleInViewer = true;
    });

    data.branches.forEach((branch) => {
      branch.visibleInViewer = branch.visibleInViewer !== false;
      branch.linkEnabled = branch.linkEnabled === true;
    });
  }

  function render(keepPage = false) {
    if (!state.data) return;
    if (!state.selectedFlowId) state.selectedFlowId = getInitialFlowId(state.data);
    ensureActivePage();

    dom.body.dataset.mode = state.mode;
    dom.devToolbar.hidden = state.mode !== "dev";
    dom.modeToggle.textContent = state.mode === "viewer" ? "开发模式" : "观看模式";
    dom.appTitle.textContent = state.data.meta.title || "SOP 流程管理器";
    dom.appSubtitle.textContent = state.mode === "viewer" ? "观看模式：分页演示，图片为主" : `开发模式 · 数据来源：${state.dataSource || "当前内存"}`;

    renderNav();
    renderPage(keepPage);
    requestAnimationFrame(centerActiveNav);
  }

  function renderPage(animate = true) {
    const content = state.activePageType === "module" ? renderExceptionModulePage(getModule(state.activePageId)) : renderNodePage(getNode(state.activePageId));
    dom.app.innerHTML = `<div class="page-shell ${animate ? "page-enter" : ""}">${content || "<section class=\"flow-header\"><h2>没有可显示内容</h2></section>"}</div>`;
    if (animate) requestAnimationFrame(() => dom.app.querySelector(".page-shell")?.classList.remove("page-enter"));
  }

  function renderNodePage(node) {
    if (!node) return "";
    const pages = getNodePages();
    const index = pages.findIndex((page) => page.id === node.id);
    return [
      renderNodeHeader(node, index, pages.length),
      `<section class="node node-page" id="${attr(node.id)}" data-node-id="${attr(node.id)}">`,
      `<div class="node-body">${state.mode === "viewer" ? renderViewerNode(node) : renderDevNode(node)}</div>`,
      "</section>",
      renderPager(index, pages.length)
    ].join("");
  }

  function renderNodeHeader(node, index, total) {
    const title = node.title || node.id;
    return [
      "<section class=\"flow-header page-heading\">",
      "<div class=\"page-title-row\">",
      `<span class="node-no">${index >= 0 ? index + 1 : "?"}</span>`,
      "<div>",
      `<h2>${escapeHtml(title)}</h2>`,
      `<p>${escapeHtml(getFlow(state.selectedFlowId)?.title || "")}${total ? ` · ${index + 1}/${total}` : ""}</p>`,
      "</div>",
      "</div>",
      renderPager(index, total, "compact"),
      "</section>"
    ].join("");
  }

  function renderPager(index, total, extraClass = "") {
    if (index < 0 || !total) return "";
    const prevDisabled = index <= 0 ? "disabled" : "";
    const nextDisabled = index >= total - 1 ? "disabled" : "";
    return [
      `<div class="pager ${attr(extraClass)}">`,
      `<button class="btn" type="button" data-page-prev ${prevDisabled}>上一步</button>`,
      `<span class="pager-index">${index + 1} / ${total}</span>`,
      `<button class="btn primary" type="button" data-page-next ${nextDisabled}>下一步</button>`,
      "</div>"
    ].join("");
  }

  function renderViewerNode(node, data = state.data) {
    const summary = node.viewerSummary || {};
    const lead = summary.oneLineGoal || node.goal || "";
    const keyPoints = summary.keyPoints && summary.keyPoints.length ? summary.keyPoints : compactActions(node.actions);
    const doneSignal = summary.doneSignal || firstUseful(node.passCriteria) || "";
    const branches = getBranchesFor(node, true, data);

    return [
      lead ? `<div class="viewer-lead">${escapeHtml(lead)}</div>` : "",
      keyPoints && keyPoints.length ? renderViewerBlock("重点提示", renderList(keyPoints), "viewer-block-key") : "",
      renderScreenshots(node.id, true, data),
      doneSignal ? renderViewerBlock("完成标志", `<p class="done-signal">${escapeHtml(doneSignal)}</p>`, "viewer-block-done") : "",
      branches.length ? renderBranches(branches) : "",
      renderFullDetails(node)
    ].filter(Boolean).join("");
  }

  function renderFullDetails(node) {
    const parts = [
      node.input && node.input.length ? `<h4>输入</h4>${renderList(node.input)}` : "",
      node.actions && node.actions.length ? `<h4>处理过程</h4>${renderList(node.actions)}` : "",
      renderReferenceTables(node.referenceTables || []),
      node.output && node.output.length ? `<h4>输出</h4>${renderList(node.output)}` : ""
    ].filter(Boolean).join("");
    if (!parts) return "";
    return `<details class="full-detail"><summary>展开完整说明</summary><div class="full-detail-body">${parts}</div></details>`;
  }

  function renderBranches(branches) {
    const rows = branches.map((branch) => {
      return `<tr><td>${escapeHtml(branch.condition || "")}</td><td>${escapeHtml(branch.action || "")}</td></tr>`;
    }).join("");
    return renderViewerBlock("异常 / 分支", `<table class="branch-table"><thead><tr><th>遇到情况</th><th>处理动作</th></tr></thead><tbody>${rows}</tbody></table>`, "viewer-block-branch");
  }

  function renderDevNode(node) {
    const branches = getBranchesFor(node, false);
    return [
      "<div class=\"dev-grid\">",
      "<div class=\"dev-panel full dev-priority\"><h3>图片维护</h3>",
      renderScreenshotEditor(node.id),
      "</div>",
      "<div class=\"dev-panel\"><h3>步骤核心</h3>",
      renderField("步骤标题", "input", node.title || "", { "data-edit-node": node.id, "data-field": "title" }),
      renderField("目录短名（可选）", "input", node.shortTitle || "", { "data-edit-node": node.id, "data-field": "shortTitle" }),
      renderSelectField("状态（仅开发模式显示）", node.status || "active", [["active", "正常"], ["draft", "待完善"], ["deprecated", "废弃"], ["merged", "合并到其他节点"]], { "data-edit-node": node.id, "data-field": "status" }),
      "<div class=\"dev-actions step-manage-actions\">",
      `<button class="btn small" type="button" data-add-node-before="${attr(node.id)}">前面新增一步</button>`,
      `<button class="btn small" type="button" data-add-node-after="${attr(node.id)}">后面新增一步</button>`,
      `<button class="btn small" type="button" data-copy-node="${attr(node.id)}">复制当前步骤</button>`,
      `<button class="btn small danger" type="button" data-delete-node="${attr(node.id)}">删除当前步骤</button>`,
      "</div>",
      "</div>",
      "<div class=\"dev-panel\"><h3>观看模式摘要</h3>",
      renderField("一句话目标", "textarea", (node.viewerSummary || {}).oneLineGoal || "", { "data-edit-node": node.id, "data-summary-field": "oneLineGoal" }, "small-textarea"),
      renderField("重点提示（每行一个）", "textarea", lines((node.viewerSummary || {}).keyPoints || []), { "data-edit-node": node.id, "data-summary-list": "keyPoints" }),
      renderField("完成标志", "textarea", (node.viewerSummary || {}).doneSignal || "", { "data-edit-node": node.id, "data-summary-field": "doneSignal" }, "small-textarea"),
      "</div>",
      "<div class=\"dev-panel\"><h3>完整说明：输入</h3>",
      renderField("输入（每行一个）", "textarea", lines(node.input), { "data-edit-node": node.id, "data-list-field": "input" }),
      "</div>",
      "<div class=\"dev-panel\"><h3>完整说明：处理过程</h3>",
      renderField("处理过程（每行一个）", "textarea", lines(node.actions), { "data-edit-node": node.id, "data-list-field": "actions" }),
      "</div>",
      "<div class=\"dev-panel\"><h3>完整说明：输出</h3>",
      renderField("输出（每行一个）", "textarea", lines(node.output), { "data-edit-node": node.id, "data-list-field": "output" }),
      renderField("工具路径（每行一个）", "textarea", lines(node.toolPaths), { "data-edit-node": node.id, "data-list-field": "toolPaths" }, "small-textarea"),
      "</div>",
      "<div class=\"dev-panel full\"><h3>异常 / 分支</h3>",
      renderBranchEditor(node, branches),
      "</div>",
      "<div class=\"dev-panel full\"><h3>参考表和开发备注</h3>",
      renderField("参考表 JSON", "textarea", JSON.stringify(node.referenceTables || [], null, 2), { "data-edit-node": node.id, "data-json-field": "referenceTables" }),
      renderField("开发备注", "textarea", node.devNotes || "", { "data-edit-node": node.id, "data-field": "devNotes" }),
      "</div>",
      "</div>"
    ].join("");
  }

  function renderBranchEditor(node, branches) {
    const rows = branches.map((branch) => [
      "<tr>",
      `<td><textarea data-edit-branch="${attr(branch.id)}" data-field="condition">${escapeHtml(branch.condition || "")}</textarea></td>`,
      `<td><textarea data-edit-branch="${attr(branch.id)}" data-field="action">${escapeHtml(branch.action || "")}</textarea></td>`,
      `<td><input data-edit-branch="${attr(branch.id)}" data-field="targetNodeId" value="${attr(branch.targetNodeId || "")}" placeholder="可选：人工引用 ID"></td>`,
      `<td><label class="inline-check"><input type="checkbox" data-edit-branch="${attr(branch.id)}" data-field="linkEnabled" ${branch.linkEnabled === true ? "checked" : ""}>启用跳转</label><button class="btn small danger" type="button" data-delete-branch="${attr(branch.id)}" data-node-id="${attr(node.id)}">删除</button></td>`,
      "</tr>"
    ].join("")).join("");
    return `<button class="btn small" type="button" data-add-branch="${attr(node.id)}">新增分支</button><table class="branch-table"><thead><tr><th>遇到情况</th><th>处理动作</th><th>引用 ID（可选）</th><th>维护</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderScreenshotEditor(ownerId) {
    const shots = getScreenshotsFor(ownerId, false);
    const upload = `<label class="upload-box">上传截图到当前节点<input type="file" accept="image/*" multiple hidden data-upload-shot="${attr(ownerId)}"></label>`;
    if (!shots.length) return `${upload}<div class="empty-dev">当前节点还没有截图。上传后可编辑标题、备注、展示方式。</div>`;
    const list = shots.map((shot, index) => [
      `<div class="shot-dev" data-shot-id="${attr(shot.id)}">`,
      `<img src="${attr(shot.src)}" alt="${attr(shot.title || "")}">`,
      "<div>",
      renderField("标题", "input", shot.title || "", { "data-edit-shot": shot.id, "data-field": "title" }),
      renderField("备注（围绕该图说明）", "textarea", shot.note || "", { "data-edit-shot": shot.id, "data-field": "note" }, "small-textarea"),
      renderField("图片路径 / base64", "input", shot.src || "", { "data-edit-shot": shot.id, "data-field": "src" }),
      renderSelectField("展示方式", shot.displayMode || "full", [["full", "整行大图"], ["half", "半宽图"], ["detail", "细节图"], ["compare", "对照图"]], { "data-edit-shot": shot.id, "data-field": "displayMode" }),
      "<div class=\"shot-actions\">",
      `<button class="btn small" type="button" data-move-shot="${attr(shot.id)}" data-direction="up" ${index === 0 ? "disabled" : ""}>上移</button>`,
      `<button class="btn small" type="button" data-move-shot="${attr(shot.id)}" data-direction="down" ${index === shots.length - 1 ? "disabled" : ""}>下移</button>`,
      `<button class="btn small danger" type="button" data-delete-shot="${attr(shot.id)}">删除</button>`,
      "</div></div></div>"
    ].join("")).join("");
    return `${upload}<div class="shot-dev-list">${list}</div>`;
  }

  function renderExceptionModulePage(module) {
    if (!module) return "";
    const exceptions = (module.exceptionIds || []).map((id) => getException(id)).filter(Boolean);
    const rows = exceptions.map((item) => {
      const refs = findExceptionReferences(item.id).map((ref) => `${escapeHtml(ref.nodeTitle)}${ref.condition ? `：${escapeHtml(ref.condition)}` : ""}`).join("；");
      return `<tr><td>${escapeHtml(item.condition || item.title)}</td><td>${escapeHtml(item.action || "")}</td><td>${refs || "—"}</td></tr>`;
    }).join("");
    const dev = state.mode === "dev" ? [
      "<div class=\"dev-grid\"><div class=\"dev-panel full dev-priority\"><h3>异常模块图片维护</h3>",
      renderScreenshotEditor(module.id),
      "</div><div class=\"dev-panel full\"><h3>异常模块维护</h3>",
      renderField("标题", "input", module.title || "", { "data-edit-module": module.id, "data-field": "title" }),
      renderField("说明", "textarea", module.description || "", { "data-edit-module": module.id, "data-field": "description" }),
      renderField("异常 ID（每行一个）", "textarea", lines(module.exceptionIds), { "data-edit-module": module.id, "data-list-field": "exceptionIds" }),
      renderField("开发备注", "textarea", module.devNotes || "", { "data-edit-module": module.id, "data-field": "devNotes" }),
      "</div></div>"
    ].join("") : "";
    return [
      "<section class=\"flow-header page-heading\"><div class=\"page-title-row\"><span class=\"node-no\">!</span><div>",
      `<h2>${escapeHtml(module.title || "异常处理规则")}</h2>`,
      module.description ? `<p>${escapeHtml(module.description)}</p>` : "",
      "</div></div></section>",
      `<section class="exception-module" id="${attr(module.id)}">`,
      rows ? `<table class="branch-table exception-reference-table"><thead><tr><th>异常情况</th><th>处理方式</th><th>引用位置</th></tr></thead><tbody>${rows}</tbody></table>` : "",
      state.mode === "viewer" ? renderScreenshots(module.id, true) : "",
      dev,
      "</section>"
    ].join("");
  }

  function renderNav() {
    dom.flowNav.innerHTML = buildFlowTree(state.data);
  }

  function buildFlowTree(data) {
    const flows = data.flows || [];
    const flowHtml = flows.map((flow) => renderFlowTree(flow, data)).join("");
    const exceptionHtml = renderExceptionTree(data);
    return `<div class="tree-title">流程目录</div>${flowHtml}${exceptionHtml}`;
  }

  function renderFlowTree(flow, data) {
    const isSelected = flow.id === state.selectedFlowId;
    const hasTree = Array.isArray(flow.tree) && flow.tree.length;
    const content = hasTree ? renderOutlineTree(flow, data) : renderFlatNodeList(flow, data);
    return [
      `<details class="tree-flow ${isSelected ? "is-current" : ""}" ${isSelected ? "open" : ""}>`,
      `<summary class="tree-flow-title" data-select-flow="${attr(flow.id)}"><span class="tree-badge">主线</span><span>${escapeHtml(flow.title || flow.id)}</span></summary>`,
      `<div class="tree-children">${content}</div>`,
      "</details>"
    ].join("");
  }

  function renderOutlineTree(flow, data) {
    return (flow.tree || []).map((item) => renderOutlineItem(flow, item, data, 1)).join("");
  }

  function renderOutlineItem(flow, item, data, level) {
    if (typeof item === "string") return renderNavNode(flow, getNode(item, data), flow.nodeIds.indexOf(item));
    const children = (item.children || []).map((child) => renderOutlineItem(flow, child, data, level + 1)).join("");
    const childIds = collectOutlineNodeIds(item);
    const isOpen = childIds.includes(state.activePageId);
    return `<details class="tree-group level-${level}" ${isOpen ? "open" : ""}><summary>${escapeHtml(item.title || item.id || "分组")}</summary><div class="tree-children">${children}</div></details>`;
  }

  function renderFlatNodeList(flow, data) {
    return (flow.nodeIds || []).map((nodeId, index) => renderNavNode(flow, getNode(nodeId, data), index)).join("");
  }

  function renderNavNode(flow, node, index) {
    if (!node || (state.mode === "viewer" && node.visibleInViewer === false)) return "";
    const shotCount = getScreenshotsFor(node.id, true).length;
    const active = state.activePageType === "node" && state.activePageId === node.id;
    return [
      `<a class="nav-item ${active ? "is-active" : ""}" href="#" data-select-flow="${attr(flow.id)}" data-page-type="node" data-page-id="${attr(node.id)}">`,
      `<span class="nav-no">${index + 1}</span>`,
      "<span>",
      `<span class="nav-title">${escapeHtml(node.shortTitle || node.title)}</span>`,
      `<span class="nav-meta">${shotCount ? `截图 ${shotCount} 张` : "无截图"}</span>`,
      "</span></a>"
    ].join("");
  }

  function renderExceptionTree(data) {
    const modules = data.exceptionModules || [];
    if (!modules.length) return "";
    const moduleItems = modules.map((module) => {
      const active = state.activePageType === "module" && state.activePageId === module.id;
      const count = (module.exceptionIds || []).length;
      return `<a class="nav-item nav-exception ${active ? "is-active" : ""}" href="#" data-page-type="module" data-page-id="${attr(module.id)}"><span class="nav-no">!</span><span><span class="nav-title">${escapeHtml(module.title || "异常处理规则")}</span><span class="nav-meta">${count} 条规则</span></span></a>`;
    }).join("");
    return `<details class="tree-flow tree-exception"><summary class="tree-flow-title"><span class="tree-badge">全局</span><span>异常处理</span></summary><div class="tree-children">${moduleItems}</div></details>`;
  }

  function handleNavClick(event) {
    const selectFlow = event.target.closest("[data-select-flow]");
    const pageLink = event.target.closest("[data-page-id]");
    if (pageLink) {
      event.preventDefault();
      const flowId = pageLink.dataset.selectFlow;
      if (flowId) state.selectedFlowId = flowId;
      state.activePageType = pageLink.dataset.pageType || "node";
      state.activePageId = pageLink.dataset.pageId;
      render(true);
      return;
    }
    if (selectFlow && selectFlow.dataset.selectFlow) {
      const flowId = selectFlow.dataset.selectFlow;
      if (flowId !== state.selectedFlowId) {
        state.selectedFlowId = flowId;
        state.activePageId = getFirstNodeId(flowId) || getFirstModuleId() || "";
        state.activePageType = getNode(state.activePageId) ? "node" : "module";
        render(true);
      }
    }
  }

  function handleAppClick(event) {
    const image = event.target.closest(".shot-image");
    if (image) {
      openLightbox(image.dataset.shotSrc || image.src, image.dataset.shotCaption || image.alt || "");
      return;
    }
    if (event.target.closest("[data-page-prev]")) { goRelative(-1); return; }
    if (event.target.closest("[data-page-next]")) { goRelative(1); return; }

    const addBranch = event.target.closest("[data-add-branch]");
    if (addBranch) { createBranch(addBranch.dataset.addBranch); return; }
    const deleteBranch = event.target.closest("[data-delete-branch]");
    if (deleteBranch) { removeBranch(deleteBranch.dataset.deleteBranch, deleteBranch.dataset.nodeId); return; }
    const deleteShot = event.target.closest("[data-delete-shot]");
    if (deleteShot) { removeScreenshot(deleteShot.dataset.deleteShot); return; }
    const moveShot = event.target.closest("[data-move-shot]");
    if (moveShot) { moveScreenshot(moveShot.dataset.moveShot, moveShot.dataset.direction); return; }
    const addNodeBefore = event.target.closest("[data-add-node-before]");
    if (addNodeBefore) { createNodeNear(addNodeBefore.dataset.addNodeBefore, "before"); return; }
    const addNodeAfter = event.target.closest("[data-add-node-after]");
    if (addNodeAfter) { createNodeNear(addNodeAfter.dataset.addNodeAfter, "after"); return; }
    const copyNodeButton = event.target.closest("[data-copy-node]");
    if (copyNodeButton) { copyNode(copyNodeButton.dataset.copyNode); return; }
    const addNode = event.target.closest("[data-add-node]");
    if (addNode) { createNode(addNode.dataset.addNode); return; }
    const deleteNode = event.target.closest("[data-delete-node]");
    if (deleteNode) { removeNode(deleteNode.dataset.deleteNode); return; }
  }

  function goRelative(delta) {
    if (state.activePageType !== "node") return;
    const pages = getNodePages();
    const currentIndex = pages.findIndex((page) => page.id === state.activePageId);
    const nextIndex = currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= pages.length) return;
    state.activePageType = "node";
    state.activePageId = pages[nextIndex].id;
    render(true);
  }

  function handleAppInput(event) {
    const target = event.target;
    const nodeId = target.dataset.editNode;
    const flowId = target.dataset.editFlow;
    const moduleId = target.dataset.editModule;
    const branchId = target.dataset.editBranch;
    const shotId = target.dataset.editShot;

    if (nodeId) {
      const node = getNode(nodeId);
      if (!node) return;
      node.viewerSummary = node.viewerSummary || {};
      if (target.dataset.field) node[target.dataset.field] = target.type === "checkbox" ? target.checked : target.value;
      if (target.dataset.listField) node[target.dataset.listField] = toLines(target.value);
      if (target.dataset.summaryField) node.viewerSummary[target.dataset.summaryField] = target.value;
      if (target.dataset.summaryList) node.viewerSummary[target.dataset.summaryList] = toLines(target.value);
      markDirty();
      updateNavLightly();
      return;
    }
    if (flowId) {
      const flow = getFlow(flowId);
      if (!flow) return;
      flow[target.dataset.field] = target.value;
      markDirty();
      updateNavLightly();
      return;
    }
    if (moduleId) {
      const module = getModule(moduleId);
      if (!module) return;
      if (target.dataset.field) module[target.dataset.field] = target.value;
      if (target.dataset.listField) module[target.dataset.listField] = toLines(target.value);
      markDirty();
      updateNavLightly();
      return;
    }
    if (branchId) {
      const branch = getBranch(branchId);
      if (!branch) return;
      branch[target.dataset.field] = target.type === "checkbox" ? target.checked : target.value;
      markDirty();
      return;
    }
    if (shotId) {
      const shot = getScreenshot(shotId);
      if (!shot) return;
      shot[target.dataset.field] = target.value;
      shot.visibleInViewer = true;
      markDirty();
    }
  }

  function handleAppChange(event) {
    const target = event.target;
    if (target.dataset.uploadShot) {
      uploadScreenshots(target.dataset.uploadShot, Array.from(target.files || []));
      target.value = "";
      return;
    }
    if (target.dataset.editNode && target.dataset.jsonField) {
      const node = getNode(target.dataset.editNode);
      if (!node) return;
      const parsed = parseJson(target.value);
      if (!Array.isArray(parsed)) { toast("参考表 JSON 格式不正确，未保存。"); return; }
      node[target.dataset.jsonField] = parsed;
      markDirty();
    }
  }

  function updateNavLightly() {
    // 输入框编辑时只刷新目录文字，不移动页面或侧栏位置。
    // v0.4 的 centerActiveNav() 会触发 scrollIntoView，导致输入过程中主页面被动上滚。
    clearTimeout(updateNavLightly.timer);
    const savedTop = dom.flowNav ? dom.flowNav.scrollTop : 0;
    updateNavLightly.timer = setTimeout(() => {
      renderNav();
      if (dom.flowNav) dom.flowNav.scrollTop = savedTop;
    }, 220);
  }

  function getNodePages() {
    const flow = getFlow(state.selectedFlowId);
    if (!flow) return [];
    return (flow.nodeIds || []).map((id) => getNode(id)).filter(Boolean).filter((node) => state.mode === "dev" || node.visibleInViewer !== false).map((node) => ({ type: "node", id: node.id }));
  }

  function ensureActivePage() {
    if (state.activePageType === "node" && getNode(state.activePageId)) return;
    if (state.activePageType === "module" && getModule(state.activePageId)) return;
    state.activePageType = "node";
    state.activePageId = getFirstNodeId(state.selectedFlowId) || getFirstModuleId() || "";
    if (!getNode(state.activePageId)) state.activePageType = "module";
  }

  function centerActiveNav() {
    const active = dom.flowNav.querySelector(".is-active");
    if (!active) return;
    active.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }

  function renderViewerBlock(title, body, extraClass = "") {
    if (!body || !stripTags(body).trim()) return "";
    return `<div class="viewer-block ${attr(extraClass)}"><h3 class="section-title">${escapeHtml(title)}</h3>${body}</div>`;
  }

  function renderList(items) {
    return `<ul class="compact-list">${(items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function renderScreenshots(ownerId, viewerOnly, data = state.data) {
    const screenshots = getScreenshotsFor(ownerId, viewerOnly, data);
    if (!screenshots.length) return "";
    return renderViewerBlock("操作截图", [
      "<div class=\"shot-grid\">",
      screenshots.map((shot) => {
        const mode = shot.displayMode || "full";
        return [
          `<figure class="shot-view shot-${attr(mode)}">`,
          `<img class="shot-image" src="${attr(shot.src)}" alt="${attr(shot.title || "")}" data-shot-src="${attr(shot.src)}" data-shot-caption="${attr([shot.title, shot.note].filter(Boolean).join("："))}">`,
          "<figcaption class=\"shot-caption\">",
          shot.title ? `<strong>${escapeHtml(shot.title)}</strong>` : "",
          shot.note ? `<p>${escapeHtml(shot.note)}</p>` : "",
          "</figcaption></figure>"
        ].join("");
      }).join(""),
      "</div>"
    ].join(""), "viewer-block-shot");
  }

  function renderReferenceTables(tables) {
    if (!tables || !tables.length) return "";
    return tables.map((table) => {
      const head = (table.columns || []).map((column) => `<th>${escapeHtml(column)}</th>`).join("");
      const rows = (table.rows || []).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
      return `<div class="reference-table"><h4>${escapeHtml(table.title || "参考规则")}</h4><table class="data-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join("");
  }

  function renderField(label, type, value, attrs = {}, extraClass = "") {
    const attrString = attrsToString(attrs);
    if (type === "textarea") return `<label class="field"><span>${escapeHtml(label)}</span><textarea class="${attr(extraClass)}" ${attrString}>${escapeHtml(value || "")}</textarea></label>`;
    return `<label class="field"><span>${escapeHtml(label)}</span><input type="${attr(type)}" value="${attr(value || "")}" ${attrString}></label>`;
  }

  function renderSelectField(label, value, options, attrs = {}) {
    const optionHtml = options.map(([optionValue, optionLabel]) => `<option value="${attr(optionValue)}" ${optionValue === value ? "selected" : ""}>${escapeHtml(optionLabel)}</option>`).join("");
    return `<label class="field"><span>${escapeHtml(label)}</span><select ${attrsToString(attrs)}>${optionHtml}</select></label>`;
  }

  function uploadScreenshots(ownerId, files) {
    if (!files.length) return;
    const currentMax = Math.max(0, ...getScreenshotsFor(ownerId, false).map((shot) => Number(shot.sortOrder) || 0));
    files.forEach((file, fileIndex) => {
      const reader = new FileReader();
      reader.onload = () => {
        state.data.screenshots.push({
          id: uniqueId("shot"),
          nodeId: ownerId,
          src: reader.result,
          title: file.name.replace(/\.[^.]+$/, ""),
          note: "",
          sortOrder: currentMax + fileIndex + 1,
          displayMode: "full",
          visibleInViewer: true
        });
        markDirty();
        render(true);
      };
      reader.readAsDataURL(file);
    });
  }

  function removeScreenshot(shotId) {
    const shot = getScreenshot(shotId);
    if (!shot) return;
    if (!confirm("确定删除这张截图？")) return;
    state.data.screenshots = state.data.screenshots.filter((item) => item.id !== shotId);
    markDirty();
    render(true);
  }

  function moveScreenshot(shotId, direction) {
    const shot = getScreenshot(shotId);
    if (!shot) return;
    const ownerId = shot.nodeId || shot.ownerId;
    const shots = getScreenshotsFor(ownerId, false);
    const index = shots.findIndex((item) => item.id === shotId);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= shots.length) return;
    const a = shots[index];
    const b = shots[targetIndex];
    const temp = a.sortOrder;
    a.sortOrder = b.sortOrder;
    b.sortOrder = temp;
    markDirty();
    render(true);
  }

  function createNode(flowId) {
    const flow = getFlow(flowId);
    if (!flow) return;
    const node = makeBlankNode(flowId);
    state.data.nodes.push(node);
    flow.nodeIds.push(node.id);
    state.activePageType = "node";
    state.activePageId = node.id;
    markDirty();
    render(true);
  }

  function createNodeNear(referenceNodeId, position) {
    const flow = getFlow(state.selectedFlowId);
    if (!flow) return;
    const refIndex = (flow.nodeIds || []).indexOf(referenceNodeId);
    const insertIndex = refIndex < 0 ? (flow.nodeIds || []).length : refIndex + (position === "before" ? 0 : 1);
    const node = makeBlankNode(flow.id);
    state.data.nodes.push(node);
    flow.nodeIds = flow.nodeIds || [];
    flow.nodeIds.splice(insertIndex, 0, node.id);
    if (Array.isArray(flow.tree)) {
      const inserted = insertNodeInOutline(flow.tree, referenceNodeId, node.id, position);
      if (!inserted) flow.tree.push(node.id);
    }
    state.activePageType = "node";
    state.activePageId = node.id;
    markDirty();
    render(true);
    toast(position === "before" ? "已在当前步骤前新增一步。" : "已在当前步骤后新增一步。");
  }

  function copyNode(nodeId) {
    const source = getNode(nodeId);
    const flow = getFlow(state.selectedFlowId);
    if (!source || !flow) return;
    const copy = JSON.parse(JSON.stringify(source));
    copy.id = uniqueId("node_copy");
    copy.title = `${source.title || "步骤"} - 副本`;
    copy.shortTitle = `${source.shortTitle || source.title || "步骤"}副本`;
    copy.status = "draft";
    copy.branchIds = [];
    copy.exceptionIds = Array.isArray(source.exceptionIds) ? [...source.exceptionIds] : [];
    copy.referenceTables = Array.isArray(source.referenceTables) ? JSON.parse(JSON.stringify(source.referenceTables)) : [];
    copy.devNotes = source.devNotes ? `${source.devNotes}\n复制自：${source.id}` : `复制自：${source.id}`;
    copy.belongsToFlows = Array.from(new Set([...(copy.belongsToFlows || []), flow.id]));
    state.data.nodes.push(copy);

    const refIndex = (flow.nodeIds || []).indexOf(nodeId);
    const insertIndex = refIndex < 0 ? (flow.nodeIds || []).length : refIndex + 1;
    flow.nodeIds = flow.nodeIds || [];
    flow.nodeIds.splice(insertIndex, 0, copy.id);
    if (Array.isArray(flow.tree)) {
      const inserted = insertNodeInOutline(flow.tree, nodeId, copy.id, "after");
      if (!inserted) flow.tree.push(copy.id);
    }

    const sourceShots = getScreenshotsFor(nodeId, false);
    sourceShots.forEach((shot, index) => {
      const newShot = JSON.parse(JSON.stringify(shot));
      newShot.id = uniqueId("shot_copy");
      newShot.nodeId = copy.id;
      newShot.sortOrder = index + 1;
      state.data.screenshots.push(newShot);
    });

    state.activePageType = "node";
    state.activePageId = copy.id;
    markDirty();
    render(true);
    toast("已复制当前步骤。截图记录也已复制，图片文件仍引用原路径。 ");
  }

  function makeBlankNode(flowId) {
    const id = uniqueId("node_new");
    return {
      id,
      title: "新步骤",
      shortTitle: "新步骤",
      type: "normal",
      status: "draft",
      visibleInViewer: true,
      belongsToFlows: [flowId],
      viewerSummary: { oneLineGoal: "", keyPoints: [], doneSignal: "" },
      goal: "",
      input: [],
      actions: [],
      passCriteria: [],
      output: [],
      referenceTables: [],
      branchIds: [],
      exceptionIds: [],
      devNotes: ""
    };
  }

  function insertNodeInOutline(items, referenceNodeId, newNodeId, position) {
    if (!Array.isArray(items)) return false;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (typeof item === "string") {
        if (item === referenceNodeId) {
          items.splice(i + (position === "before" ? 0 : 1), 0, newNodeId);
          return true;
        }
      } else if (item && Array.isArray(item.children)) {
        if (insertNodeInOutline(item.children, referenceNodeId, newNodeId, position)) return true;
      }
    }
    return false;
  }

  function removeNode(nodeId) {
    const node = getNode(nodeId);
    if (!node) return;
    const flow = getFlow(state.selectedFlowId);
    const pagesBefore = getNodePages();
    const currentIndex = pagesBefore.findIndex((page) => page.id === nodeId);
    const label = node.title || node.shortTitle || node.id;
    if (!confirm(`确定删除步骤「${label}」？

会同时删除该步骤下的截图和从该步骤发出的分支。历史版本请以你本地备份为准。`)) return;

    // 删除节点本体
    state.data.nodes = (state.data.nodes || []).filter((item) => item.id !== nodeId);

    // 从所有主线线性顺序中移除
    (state.data.flows || []).forEach((item) => {
      item.nodeIds = (item.nodeIds || []).filter((id) => id !== nodeId);
      if (Array.isArray(item.tree)) item.tree = removeNodeFromOutline(item.tree, nodeId);
    });

    // 删除该节点关联截图
    state.data.screenshots = (state.data.screenshots || []).filter((shot) => (shot.nodeId || shot.ownerId) !== nodeId);

    // 删除该节点发出的分支，并清理其他节点 branchIds 中的残留引用
    const outgoingIds = new Set((node.branchIds || []));
    (state.data.branches || []).forEach((branch) => {
      if (branch.fromNodeId === nodeId) outgoingIds.add(branch.id);
    });
    state.data.branches = (state.data.branches || []).filter((branch) => branch.fromNodeId !== nodeId && !outgoingIds.has(branch.id));
    (state.data.nodes || []).forEach((item) => {
      item.branchIds = (item.branchIds || []).filter((id) => !outgoingIds.has(id));
    });

    // 选择删除后要展示的步骤：优先下一步，其次上一步。
    const pagesAfter = getNodePages();
    const fallback = pagesAfter[Math.min(currentIndex, pagesAfter.length - 1)] || pagesAfter[currentIndex - 1] || pagesAfter[0];
    if (fallback) {
      state.activePageType = fallback.type || "node";
      state.activePageId = fallback.id;
    } else {
      state.activePageType = "module";
      state.activePageId = getFirstModuleId() || "";
    }
    markDirty();
    render(true);
    toast("已删除当前步骤。记得保存到本机或导出 JSON。");
  }

  function removeNodeFromOutline(items, nodeId) {
    return (items || []).map((item) => {
      if (typeof item === "string") return item === nodeId ? null : item;
      const next = { ...item, children: removeNodeFromOutline(item.children || [], nodeId) };
      return next.children.length ? next : null;
    }).filter(Boolean);
  }

  function createBranch(nodeId) {
    const node = getNode(nodeId);
    if (!node) return;
    const id = uniqueId("branch_new");
    const branch = { id, fromNodeId: nodeId, condition: "新情况", action: "处理动作", targetNodeId: "", linkEnabled: false, visibleInViewer: true };
    state.data.branches.push(branch);
    node.branchIds.push(id);
    markDirty();
    render(true);
  }

  function removeBranch(branchId, nodeId) {
    if (!confirm("确定删除这条分支？")) return;
    state.data.branches = state.data.branches.filter((branch) => branch.id !== branchId);
    const node = getNode(nodeId);
    if (node) node.branchIds = (node.branchIds || []).filter((id) => id !== branchId);
    markDirty();
    render(true);
  }

  function getFlow(flowId, data = state.data) { return (data.flows || []).find((flow) => flow.id === flowId); }
  function getNode(nodeId, data = state.data) { return (data.nodes || []).find((node) => node.id === nodeId); }
  function getBranch(branchId, data = state.data) { return (data.branches || []).find((branch) => branch.id === branchId); }
  function getException(exceptionId, data = state.data) { return (data.exceptions || []).find((item) => item.id === exceptionId); }
  function getModule(moduleId, data = state.data) { return (data.exceptionModules || []).find((item) => item.id === moduleId); }
  function getScreenshot(shotId, data = state.data) { return (data.screenshots || []).find((shot) => shot.id === shotId); }

  function getInitialFlowId(data) {
    const active = (data.flows || []).find((flow) => flow.status !== "deprecated");
    return (active || (data.flows || [])[0] || {}).id || "";
  }

  function getFirstNodeId(flowId) {
    const flow = getFlow(flowId);
    return (flow && flow.nodeIds && flow.nodeIds[0]) || "";
  }

  function getFirstModuleId(data = state.data) {
    return ((data.exceptionModules || [])[0] || {}).id || "";
  }

  function getScreenshotsFor(ownerId, viewerOnly, data = state.data) {
    return (data.screenshots || [])
      .filter((shot) => (shot.nodeId || shot.ownerId) === ownerId)
      .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
  }

  function getBranchesFor(node, viewerOnly, data = state.data) {
    const ids = new Set(node.branchIds || []);
    return (data.branches || []).filter((branch) => branch.fromNodeId === node.id || ids.has(branch.id));
  }

  function collectOutlineNodeIds(item) {
    const result = [];
    (item.children || []).forEach((child) => {
      if (typeof child === "string") result.push(child);
      else result.push(...collectOutlineNodeIds(child));
    });
    return result;
  }

  function findExceptionReferences(exceptionId, data = state.data) {
    const refs = [];
    (data.nodes || []).forEach((node) => {
      if ((node.exceptionIds || []).includes(exceptionId)) refs.push({ nodeId: node.id, nodeTitle: node.shortTitle || node.title, condition: "" });
      getBranchesFor(node, false, data).forEach((branch) => {
        if (branch.targetNodeId === exceptionId) refs.push({ nodeId: node.id, nodeTitle: node.shortTitle || node.title, condition: branch.condition || "" });
      });
    });
    return refs;
  }

  function targetTitle(id, data = state.data) {
    const node = getNode(id, data);
    if (node) return node.shortTitle || node.title || id;
    const exception = getException(id, data);
    if (exception) return exception.title || exception.condition || id;
    const module = getModule(id, data);
    if (module) return module.title || id;
    return id || "未设置";
  }

  async function importJson(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!isValidData(data)) throw new Error("JSON 数据结构缺少 flows / nodes / branches。");
      normalizeData(data);
      state.data = data;
      state.dataSource = "imported JSON";
      state.selectedFlowId = getInitialFlowId(data);
      state.activePageId = getFirstNodeId(state.selectedFlowId) || getFirstModuleId() || "";
      state.activePageType = getNode(state.activePageId) ? "node" : "module";
      state.dirty = false;
      saveLocal();
      render();
      toast("JSON 已导入并保存到本机。");
    } catch (error) {
      toast(`导入失败：${error.message}`);
    } finally {
      event.target.value = "";
    }
  }

  function openLightbox(src, caption) {
    dom.lightboxImage.src = src;
    dom.lightboxCaption.textContent = caption || "";
    dom.lightbox.classList.add("show");
    dom.lightbox.setAttribute("aria-hidden", "false");
  }

  function closeLightbox() {
    dom.lightbox.classList.remove("show");
    dom.lightbox.setAttribute("aria-hidden", "true");
    dom.lightboxImage.removeAttribute("src");
  }

  function buildViewerHtml(data) {
    const safeData = JSON.parse(JSON.stringify(data));
    normalizeData(safeData);
    const flow = (safeData.flows || []).find((item) => item.status !== "deprecated") || (safeData.flows || [])[0];
    const nav = flow ? (flow.nodeIds || []).map((nodeId, index) => {
      const node = getNode(nodeId, safeData);
      if (!node || node.visibleInViewer === false) return "";
      return `<a class="nav-item" href="#${attr(node.id)}"><span class="nav-no">${index + 1}</span><span><span class="nav-title">${escapeHtml(node.shortTitle || node.title)}</span></span></a>`;
    }).join("") : "";
    const body = flow ? (flow.nodeIds || []).map((nodeId, index) => {
      const node = getNode(nodeId, safeData);
      if (!node || node.visibleInViewer === false) return "";
      return [
        `<section class="flow-header page-heading" id="${attr(node.id)}"><div class="page-title-row"><span class="node-no">${index + 1}</span><div><h2>${escapeHtml(node.title || node.id)}</h2><p>${escapeHtml(flow.title || "")}</p></div></div></section>`,
        `<section class="node node-page"><div class="node-body">${renderViewerNode(node, safeData)}</div></section>`
      ].join("");
    }).join("") : "";
    return [
      "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
      `<title>${escapeHtml(safeData.meta.title || "SOP 新人观看版")}</title><style>${collectCss()}</style></head><body data-mode="viewer" data-export-viewer="true">`,
      `<header class="topbar"><div class="topbar-main"><div class="title-area"><h1>${escapeHtml(flow?.title || safeData.meta.title || "SOP 新人观看版")}</h1><p>新人观看版</p></div></div></header>`,
      `<div class="layout"><aside class="sidebar"><nav class="flow-nav"><div class="tree-title">流程目录</div>${nav}</nav></aside><main class="main">${body}</main></div>`,
      "<div class=\"lightbox\" id=\"lightbox\" aria-hidden=\"true\"><button class=\"lightbox-close\" id=\"lightboxClose\" type=\"button\">关闭</button><img id=\"lightboxImage\" alt=\"\"><p id=\"lightboxCaption\"></p></div>",
      `<script>${viewerOnlyRuntime()}</script></body></html>`
    ].join("");
  }

  function buildManagerHtml(data) {
    return [
      "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
      `<title>${escapeHtml(data.meta.title || "SOP 维护版")}</title><link rel="stylesheet" href="style.css"></head><body data-mode="viewer">`,
      baseHtmlShell(true),
      `<script id="initial-data" type="application/json">${escapeScriptJson(data)}</script><script src="app.js"></script></body></html>`
    ].join("");
  }

  function baseHtmlShell(includeDev) {
    return `<header class="topbar"><div class="topbar-main"><div class="title-area"><h1 id="appTitle">SOP 流程管理器</h1><p id="appSubtitle">本地静态版 · 默认观看模式</p></div>${includeDev ? '<div class="mode-area"><button class="btn mode-toggle" id="modeToggle" type="button">开发模式</button></div>' : ''}</div>${includeDev ? '<div class="dev-toolbar" id="devToolbar" hidden><button class="btn" id="saveLocalBtn" type="button">保存到本机</button><button class="btn" id="exportJsonBtn" type="button">导出 JSON</button><label class="btn file-btn" for="importJsonInput">导入 JSON</label><input id="importJsonInput" type="file" accept="application/json" hidden><button class="btn" id="exportViewerHtmlBtn" type="button">导出新人观看版 HTML</button><button class="btn" id="exportManagerHtmlBtn" type="button">导出维护版 HTML</button><button class="btn danger" id="clearLocalBtn" type="button">清空本机记录</button></div>' : ''}</header><div class="layout"><aside class="sidebar"><nav class="flow-nav" id="flowNav" aria-label="流程目录"></nav></aside><main class="main" id="app" tabindex="-1"></main></div><div class="toast" id="toast" role="status" aria-live="polite"></div><div class="lightbox" id="lightbox" aria-hidden="true"><button class="lightbox-close" id="lightboxClose" type="button">关闭</button><img id="lightboxImage" alt=""><p id="lightboxCaption"></p></div>`;
  }

  function viewerOnlyRuntime() {
    return "(function(){var lb=document.getElementById('lightbox');document.addEventListener('click',function(e){var img=e.target.closest('.shot-image');if(img){document.getElementById('lightboxImage').src=img.dataset.shotSrc||img.src;document.getElementById('lightboxCaption').textContent=img.dataset.shotCaption||img.alt||'';lb.classList.add('show');lb.setAttribute('aria-hidden','false');return}if(e.target.id==='lightbox'||e.target.id==='lightboxClose'){lb.classList.remove('show');lb.setAttribute('aria-hidden','true');document.getElementById('lightboxImage').removeAttribute('src')}})})();";
  }

  function collectCss() {
    try {
      return Array.from(document.styleSheets).map((sheet) => Array.from(sheet.cssRules || []).map((rule) => rule.cssText).join("\n")).join("\n");
    } catch (error) {
      return "body{font-family:Arial,sans-serif;margin:0;background:#f4f6f5;color:#1f2a27}.layout{display:grid;grid-template-columns:280px 1fr;gap:16px;margin:16px}.sidebar,.node,.flow-header,.exception-module{background:#fff;border:1px solid #d7dedb}.shot-image{max-width:100%}";
    }
  }

  function parseJson(value) {
    if (!value || !String(value).trim()) return null;
    try { return JSON.parse(value); } catch (error) { return null; }
  }
  function saveLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); state.dirty = false; }
  function markDirty() { state.dirty = true; }
  function compactActions(actions) { return (actions || []).slice(0, 3); }
  function firstUseful(items) { return (items || []).find(Boolean) || ""; }
  function lines(value) { return (value || []).join("\n"); }
  function toLines(value) { return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }
  function uniqueId(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function attrsToString(attrs) { return Object.entries(attrs || {}).map(([key, value]) => `${key}="${attr(value)}"`).join(" "); }
  function stripTags(value) { const div = document.createElement("div"); div.innerHTML = value; return div.textContent || div.innerText || ""; }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char])); }
  function attr(value) { return escapeHtml(value); }
  function escapeScriptJson(data) { return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026"); }
  function fileStamp(prefix, ext) { const now = new Date(); const pad = (n) => String(n).padStart(2, "0"); return `${prefix}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.${ext}`; }
  function downloadText(fileName, text, type) { const blob = new Blob([text], { type: type || "text/plain;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function toast(message) { dom.toast.textContent = message; dom.toast.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => dom.toast.classList.remove("show"), 2200); }

  window.SOPManager = {
    getDataSnapshot() { return JSON.parse(JSON.stringify(state.data)); },
    buildJsonSnapshot() { return JSON.stringify(state.data, null, 2); }
  };
})();
