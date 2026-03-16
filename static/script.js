// +++++ 新增辅助函数：将 Base64 DataURL 转换为 Blob 对象 +++++
function dataURLtoBlob(dataurl) {
    let arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], {type:mime});
}

// Global state
let workspaces = [];
let currentWorkspaceIndex = 0;
let highestZIndex = 1;
let highestShapeZIndex = 5000;
const SHAPE_Z_INDEX_BASE = 5000;
let highestEmojiZIndex = 5000;
const EMOJI_Z_INDEX_BASE = SHAPE_Z_INDEX_BASE;
let highestPhotoZIndex = 5000;
const PHOTO_Z_INDEX_BASE = SHAPE_Z_INDEX_BASE;
let highestFolderZIndex = 4000;
const FOLDER_Z_INDEX_BASE = 4000;
let openFolderPanel = null; // 当前打开的文件夹面板
let draggedTaskInfo = null;
let isSwitcherVisible = false;
let isWindowDragActive = false;
// +++ 新增：记录当前聚焦的窗口 +++
let focusedWindow = null; 
// +++ 新增：多选窗口集合 +++
let selectedWindows = new Set();
let isMarqueeSelecting = false;
let marqueeStart = null;
let marqueeBox = null;
let lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let lastPhotoMenuPoint = null;
let pasteHandled = false;
let reminderTimer = null;
let reminderTimeout = null;
const THEME_STORAGE_KEY = 'themePreference';

// 全局UI元素变量，在 initialize 中赋值
let addButtonsContainer;
let workspaceControls;

// 全局缩放变量
let currentZoom = 1.0;

// 全局颜色记录变量
let lastTextColor = '#000000';
let lastBgColor = '#fffbe0';
let recentTextColors = [];
let recentBgColors = [];
const MAX_RECENT_COLORS = 6;
const DEBUG_LOGS = false;
const WEBVIEW_PERF_LOG = localStorage.getItem('webviewPerfLog') !== 'false';
let PERF_LOG_THRESHOLD_MS = 50;
const storedPerfThreshold = parseInt(localStorage.getItem('webviewPerfThreshold') || '', 10);
if (!Number.isNaN(storedPerfThreshold) && storedPerfThreshold > 0) {
    PERF_LOG_THRESHOLD_MS = storedPerfThreshold;
}

const getPerfNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

const logPerf = (name, duration, extra = {}) => {
    if (!WEBVIEW_PERF_LOG || duration < PERF_LOG_THRESHOLD_MS) return;
    const data = {
        durationMs: Math.round(duration),
        workspacesCount: Array.isArray(workspaces) ? workspaces.length : 0,
        currentWorkspaceIndex,
        windowsCount: appContainer ? appContainer.children.length : 0,
        ...extra
    };
    if (APP_RUN_MODE === 'WEBVIEW' && window.pywebview?.api?.log_perf) {
        window.pywebview.api.log_perf(name, data).catch(() => {});
        return;
    }
    if (typeof API_LOG_URL !== 'undefined' && API_LOG_URL) {
        fetch(API_LOG_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `[perf] ${name}`, data }),
            keepalive: true
        }).catch(() => {});
        return;
    }
    if (RUN_MODE === 'SERVER' && DEBUG_LOGS) {
        console.debug('[perf]', name, data);
    }
};

const logWebviewEvent = (name, data = {}) => {
    if (APP_RUN_MODE === 'WEBVIEW' && window.pywebview?.api?.log_perf) {
        window.pywebview.api.log_perf(name, data).catch(() => {});
        return;
    }
    if (typeof API_LOG_URL !== 'undefined' && API_LOG_URL) {
        fetch(API_LOG_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: name, data }),
            keepalive: true
        }).catch(() => {});
        return;
    }
    if (RUN_MODE === 'SERVER' && DEBUG_LOGS) {
        console.debug('[event]', name, data);
    }
};

const perfWrap = (name, fn) => function (...args) {
    const start = getPerfNow();
    try {
        const result = fn.apply(this, args);
        if (result && typeof result.then === 'function') {
            return result.then(res => {
                logPerf(name, getPerfNow() - start);
                return res;
            }).catch(err => {
                logPerf(name, getPerfNow() - start, { error: String(err && err.message ? err.message : err) });
                throw err;
            });
        }
        logPerf(name, getPerfNow() - start);
        return result;
    } catch (err) {
        logPerf(name, getPerfNow() - start, { error: String(err && err.message ? err.message : err) });
        throw err;
    }
};
let lastBodyWidth = 0;
let lastBodyHeight = 0;
const prefersReducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
let windowClipboard = null;
let pasteCount = 0;
let resizeLogTimer = null;
let resizeStart = 0;
let resizeCount = 0;
let frameGapRafId = null;
let lastFrameTime = 0;
let FRAME_GAP_THRESHOLD_MS = 500;
const storedFrameGap = parseInt(localStorage.getItem('webviewFrameGapThreshold') || '', 10);
if (!Number.isNaN(storedFrameGap) && storedFrameGap > 0) {
    FRAME_GAP_THRESHOLD_MS = storedFrameGap;
}

const getEffectiveTheme = () => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const applyTheme = (theme) => {
    if (theme === 'dark' || theme === 'light') {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    } else {
        document.documentElement.removeAttribute('data-theme');
        localStorage.removeItem(THEME_STORAGE_KEY);
    }
};

const toggleTheme = () => {
    const current = getEffectiveTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    showToast(`已切换为${next === 'dark' ? '深色' : '浅色'}模式`, 'success', 1200);
};

const getPlainText = (html) => {
    if (!html) return '';
    return String(html)
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const isNoteEmpty = (note) => {
    if (!note) return true;
    return getPlainText(note.content).length === 0;
};

const isProjectEmpty = (project) => {
    if (!project) return true;
    return !(project.todos && project.todos.length > 0);
};

const getWindowDataByElement = (element) => {
    const currentWorkspace = workspaces[currentWorkspaceIndex];
    if (!currentWorkspace || !element) return null;
    const projectId = element.dataset.projectId;
    const noteId = element.dataset.noteId;
    const shapeId = element.dataset.shapeId;
    const emojiId = element.dataset.emojiId;
    const photoId = element.dataset.photoId;
    const folderId = element.dataset.folderId;
    if (projectId && currentWorkspace.projects) return currentWorkspace.projects[projectId];
    if (noteId && currentWorkspace.notes) return currentWorkspace.notes[noteId];
    if (shapeId && currentWorkspace.shapes) return currentWorkspace.shapes[shapeId];
    if (emojiId && currentWorkspace.emojis) return currentWorkspace.emojis[emojiId];
    if (photoId && currentWorkspace.photos) return currentWorkspace.photos[photoId];
    if (folderId && currentWorkspace.folders) return currentWorkspace.folders[folderId];
    return null;
};

const getWindowGroupId = (element) => {
    const data = getWindowDataByElement(element);
    return data && data.groupId ? data.groupId : null;
};

const getWindowType = (element) => {
    if (!element) return null;
    if (element.classList.contains('shape-container')) return 'shape';
    if (element.classList.contains('emoji-container')) return 'emoji';
    if (element.classList.contains('photo-container')) return 'photo';
    if (element.classList.contains('project-container')) return 'project';
    if (element.classList.contains('note-container')) return 'note';
    if (element.classList.contains('folder-container')) return 'folder';
    return null;
};

const getGroupElements = (groupId) => {
    if (!groupId) return [];
    return Array.from(document.querySelectorAll('.project-container, .note-container, .shape-container, .emoji-container, .photo-container, .folder-container'))
        .filter(el => getWindowGroupId(el) === groupId);
};

const clearWindowSelection = () => {
    selectedWindows.forEach(el => el.classList.remove('window-selected'));
    selectedWindows.clear();
};

const deselectWindow = (element) => {
    if (!element) return;
    selectedWindows.delete(element);
    element.classList.remove('window-selected');
};

const selectWindow = (element) => {
    if (!element) return;
    selectedWindows.add(element);
    element.classList.add('window-selected');
};

const selectWindowWithGroup = (element) => {
    if (!element) return;
    selectWindow(element);
    const groupId = getWindowGroupId(element);
    if (groupId) {
        getGroupElements(groupId).forEach(el => selectWindow(el));
    }
};

const isGroupFullySelected = (groupId) => {
    const members = getGroupElements(groupId);
    return members.length > 0 && members.every(el => selectedWindows.has(el));
};

const toggleGroupSelection = (groupId) => {
    if (!groupId) return;
    const members = getGroupElements(groupId);
    if (members.length === 0) return;
    if (members.some(el => selectedWindows.has(el))) {
        members.forEach(deselectWindow);
    } else {
        members.forEach(selectWindow);
    }
};

const toggleWindowSelection = (element) => {
    if (!element) return;
    if (selectedWindows.has(element)) {
        deselectWindow(element);
    } else {
        selectWindow(element);
    }
};

const getSelectableWindows = () => {
    return Array.from(document.querySelectorAll('.project-container, .note-container, .shape-container, .emoji-container, .photo-container, .folder-container'));
};

const updateMarqueeSelection = (rect, additive) => {
    if (!additive) {
        clearWindowSelection();
    }
    const groupsToSelect = new Set();
    getSelectableWindows().forEach(el => {
        const box = el.getBoundingClientRect();
        const isIntersecting = !(
            rect.right < box.left ||
            rect.left > box.right ||
            rect.bottom < box.top ||
            rect.top > box.bottom
        );
        if (isIntersecting) {
            const groupId = getWindowGroupId(el);
            if (groupId) {
                groupsToSelect.add(groupId);
            } else {
                selectWindow(el);
            }
        }
    });
    groupsToSelect.forEach(groupId => getGroupElements(groupId).forEach(el => selectWindow(el)));
};

const expandSelectionByGroups = () => {
    const groupsToSelect = new Set();
    selectedWindows.forEach(el => {
        const groupId = getWindowGroupId(el);
        if (groupId) groupsToSelect.add(groupId);
    });
    groupsToSelect.forEach(groupId => getGroupElements(groupId).forEach(el => selectWindow(el)));
};

const applyGroupToSelection = () => {
    const targets = Array.from(selectedWindows).filter(el => el && el.isConnected);
    if (targets.length < 2) return;
    const newGroupId = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    recordState();
    targets.forEach(el => {
        const data = getWindowDataByElement(el);
        if (data) data.groupId = newGroupId;
    });
    expandSelectionByGroups();
    debouncedSave();
};

const ungroupSelection = () => {
    const groupIds = new Set();
    selectedWindows.forEach(el => {
        const groupId = getWindowGroupId(el);
        if (groupId) groupIds.add(groupId);
    });
    if (groupIds.size === 0) return;
    recordState();
    groupIds.forEach(groupId => {
        getGroupElements(groupId).forEach(el => {
            const data = getWindowDataByElement(el);
            if (data && data.groupId === groupId) {
                delete data.groupId;
            }
        });
    });
    debouncedSave();
};

const getGroupingState = () => {
    const selected = Array.from(selectedWindows);
    const groupIds = selected.map(el => getWindowGroupId(el)).filter(Boolean);
    const uniqueGroupIds = new Set(groupIds);
    const allSelectedGroupedSame = selected.length > 0 &&
        groupIds.length === selected.length &&
        uniqueGroupIds.size === 1 &&
        isGroupFullySelected(Array.from(uniqueGroupIds)[0]);
    return {
        canGroup: selected.length >= 2 && !allSelectedGroupedSame,
        canUngroup: uniqueGroupIds.size > 0
    };
};

const buildGroupMenuHTML = () => {
    const { canGroup, canUngroup } = getGroupingState();
    if (!canGroup && !canUngroup) return '';
    const items = [];
    if (canGroup) items.push('<div class="dropdown-option" data-action="group">组合</div>');
    if (canUngroup) items.push('<div class="dropdown-option" data-action="ungroup">取消组合</div>');
    return `<div class="dropdown-divider"></div>${items.join('')}`;
};

const getMaxLayerZAll = () => {
    const elements = getLayerElementsAll();
    return elements.reduce((maxZ, el) => Math.max(maxZ, parseInt(el.style.zIndex || 0)), SHAPE_Z_INDEX_BASE - 1);
};

const cloneData = (data) => JSON.parse(JSON.stringify(data));

const collectSelectedWindows = () => {
    const items = [];
    selectedWindows.forEach(el => {
        const data = getWindowDataByElement(el);
        const type = getWindowType(el);
        if (data && type) {
            items.push({ type, data: cloneData(data) });
        }
    });
    return items;
};

const copySelectedWindows = () => {
    const items = collectSelectedWindows();
    if (items.length === 0) {
        showToast('没有可复制的窗口', 'info');
        return;
    }
    windowClipboard = items;
    pasteCount = 0;
    showToast(`已复制 ${items.length} 个窗口`, 'success');
};

const pasteClipboardWindows = () => {
    if (!windowClipboard || windowClipboard.length === 0) {
        showToast('剪贴板为空', 'info');
        return;
    }
    const currentWorkspace = workspaces[currentWorkspaceIndex];
    if (!currentWorkspace) return;
    recordState();
    const offset = 24 + pasteCount * 6;
    pasteCount += 1;
    const newSelected = [];
    const groupMap = new Map();
    let layerZ = getMaxLayerZAll() + 1;

    const newIdForType = (type) => {
        if (type === 'project') return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        if (type === 'note') return `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        if (type === 'shape') return `shape_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        if (type === 'emoji') return `emoji_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        if (type === 'photo') return `photo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        if (type === 'folder') return `folder_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        return `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    };

    windowClipboard.forEach((item, index) => {
        const { type } = item;
        const data = cloneData(item.data);
        const newId = newIdForType(type);
        data.id = newId;
        if (data.position) {
            const top = parseFloat(data.position.top || 0);
            const left = parseFloat(data.position.left || 0);
            data.position.top = `${top + offset}px`;
            data.position.left = `${left + offset}px`;
        }
        if (data.groupId) {
            if (!groupMap.has(data.groupId)) {
                groupMap.set(data.groupId, `grp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
            }
            data.groupId = groupMap.get(data.groupId);
        }

        if (type === 'project') {
            data.zIndex = highestZIndex++;
            currentWorkspace.projects[newId] = data;
            const el = createProjectPane(data, currentWorkspace);
            el.style.zIndex = data.zIndex;
            newSelected.push(el);
        } else if (type === 'note') {
            data.zIndex = highestZIndex++;
            currentWorkspace.notes[newId] = data;
            const el = createNotePane(data);
            el.style.zIndex = data.zIndex;
            newSelected.push(el);
        } else if (type === 'shape') {
            data.zIndex = layerZ++;
            currentWorkspace.shapes ??= {};
            currentWorkspace.shapes[newId] = data;
            const el = createShapePane(data);
            el.style.zIndex = data.zIndex;
            newSelected.push(el);
        } else if (type === 'emoji') {
            data.zIndex = layerZ++;
            currentWorkspace.emojis ??= {};
            currentWorkspace.emojis[newId] = data;
            const el = createEmojiPane(data);
            el.style.zIndex = data.zIndex;
            newSelected.push(el);
        } else if (type === 'photo') {
            data.zIndex = layerZ++;
            currentWorkspace.photos ??= {};
            currentWorkspace.photos[newId] = data;
            const el = createPhotoPane(data);
            el.style.zIndex = data.zIndex;
            newSelected.push(el);
        }
    });

    clearWindowSelection();
    newSelected.forEach(selectWindow);
    normalizeLayerAll();
    debouncedSave();
    checkEmptyState(currentWorkspace);
};

const getLayerElements = (type) => {
    if (type === 'shape') return Array.from(document.querySelectorAll('.shape-container'));
    if (type === 'emoji') return Array.from(document.querySelectorAll('.emoji-container'));
    if (type === 'photo') return Array.from(document.querySelectorAll('.photo-container'));
    return [];
};

const getLayerElementsAll = () => {
    return [
        ...Array.from(document.querySelectorAll('.shape-container')),
        ...Array.from(document.querySelectorAll('.emoji-container')),
        ...Array.from(document.querySelectorAll('.photo-container'))
    ];
};

const normalizeLayer = (type) => {
    const elements = getLayerElements(type);
    const base = type === 'emoji' ? EMOJI_Z_INDEX_BASE : type === 'photo' ? PHOTO_Z_INDEX_BASE : SHAPE_Z_INDEX_BASE;
    const sorted = elements.sort((a, b) => (parseInt(a.style.zIndex || 0) - parseInt(b.style.zIndex || 0)));
    sorted.forEach((el, idx) => {
        const z = base + idx;
        el.style.zIndex = z;
        const data = getWindowDataByElement(el);
        if (data) data.zIndex = z;
    });
    if (type === 'shape') highestShapeZIndex = base + sorted.length + 1;
    if (type === 'emoji') highestEmojiZIndex = base + sorted.length + 1;
    if (type === 'photo') highestPhotoZIndex = base + sorted.length + 1;
};

const normalizeLayerAll = () => {
    const elements = getLayerElementsAll();
    const base = SHAPE_Z_INDEX_BASE;
    const sorted = elements.sort((a, b) => (parseInt(a.style.zIndex || 0) - parseInt(b.style.zIndex || 0)));
    sorted.forEach((el, idx) => {
        const z = base + idx;
        el.style.zIndex = z;
        const data = getWindowDataByElement(el);
        if (data) data.zIndex = z;
    });
    highestShapeZIndex = base + sorted.length + 1;
    highestEmojiZIndex = base + sorted.length + 1;
    highestPhotoZIndex = base + sorted.length + 1;
};

const moveSelectionInLayer = (type, action) => {
    const elements = type === 'all' ? getLayerElementsAll() : getLayerElements(type);
    if (elements.length === 0) return;
    const selected = elements.filter(el => selectedWindows.has(el));
    if (selected.length === 0) return;
    const list = elements.sort((a, b) => (parseInt(a.style.zIndex || 0) - parseInt(b.style.zIndex || 0)));
    const selectedSet = new Set(selected);

    if (action === 'up') {
        for (let i = list.length - 2; i >= 0; i--) {
            if (selectedSet.has(list[i]) && !selectedSet.has(list[i + 1])) {
                const tmp = list[i + 1];
                list[i + 1] = list[i];
                list[i] = tmp;
            }
        }
    } else if (action === 'down') {
        for (let i = 1; i < list.length; i++) {
            if (selectedSet.has(list[i]) && !selectedSet.has(list[i - 1])) {
                const tmp = list[i - 1];
                list[i - 1] = list[i];
                list[i] = tmp;
            }
        }
    } else if (action === 'top') {
        const remaining = list.filter(el => !selectedSet.has(el));
        const moved = list.filter(el => selectedSet.has(el));
        list.length = 0;
        list.push(...remaining, ...moved);
    } else if (action === 'bottom') {
        const remaining = list.filter(el => !selectedSet.has(el));
        const moved = list.filter(el => selectedSet.has(el));
        list.length = 0;
        list.push(...moved, ...remaining);
    }

    const base = type === 'emoji' ? EMOJI_Z_INDEX_BASE : type === 'photo' ? PHOTO_Z_INDEX_BASE : SHAPE_Z_INDEX_BASE;
    list.forEach((el, idx) => {
        const z = base + idx;
        el.style.zIndex = z;
        const data = getWindowDataByElement(el);
        if (data) data.zIndex = z;
    });
    if (type === 'shape') highestShapeZIndex = base + list.length + 1;
    if (type === 'emoji') highestEmojiZIndex = base + list.length + 1;
    if (type === 'photo') highestPhotoZIndex = base + list.length + 1;
    if (type === 'all') {
        highestShapeZIndex = base + list.length + 1;
        highestEmojiZIndex = base + list.length + 1;
        highestPhotoZIndex = base + list.length + 1;
    }
    recordState();
    debouncedSave();
};

const deleteSelectedWindows = async () => {
    const currentWorkspace = workspaces[currentWorkspaceIndex];
    if (!currentWorkspace) return;
    const targets = Array.from(selectedWindows).filter(el => el && el.isConnected);
    if (targets.length === 0) return;

    const projectIds = [];
    const noteIds = [];
    const shapeIds = [];
    const emojiIds = [];
    const photoIds = [];
    const folderIds = [];
    targets.forEach(el => {
        if (el.dataset.projectId) projectIds.push(el.dataset.projectId);
        else if (el.dataset.noteId) noteIds.push(el.dataset.noteId);
        else if (el.dataset.shapeId) shapeIds.push(el.dataset.shapeId);
        else if (el.dataset.emojiId) emojiIds.push(el.dataset.emojiId);
        else if (el.dataset.photoId) photoIds.push(el.dataset.photoId);
        else if (el.dataset.folderId) folderIds.push(el.dataset.folderId);
    });

    const nonEmptyProjects = projectIds.filter(id => !isProjectEmpty(currentWorkspace.projects?.[id]));
    const nonEmptyNotes = noteIds.filter(id => !isNoteEmpty(currentWorkspace.notes?.[id]));
    const nonEmptyFolders = folderIds.filter(id => currentWorkspace.folders?.[id]?.items?.length > 0);
    const needConfirm = nonEmptyProjects.length > 0 || nonEmptyNotes.length > 0 || nonEmptyFolders.length > 0;
    if (needConfirm) {
        try {
            await showCustomModal({
                title: '删除选中窗口',
                message: `确定要删除选中的 ${projectIds.length + noteIds.length + shapeIds.length + emojiIds.length + photoIds.length + folderIds.length} 个窗口吗？${nonEmptyFolders.length > 0 ? '文件夹中的项目将被释放到工作区。' : ''}此操作不可恢复！`,
                okText: '删除'
            });
        } catch {
            return;
        }
    }

    recordState();

    // 释放文件夹中的项目
    folderIds.forEach(id => {
        const folder = currentWorkspace.folders?.[id];
        if (folder && folder.items) {
            folder.items.forEach(item => {
                const data = getFolderItemData(item.type, item.id);
                if (data) delete data.folderId;
            });
        }
        delete currentWorkspace.folders?.[id];
        const el = document.querySelector(`[data-folder-id="${id}"]`);
        if (el) {
            el.classList.add('fade-out-folder');
            setTimeout(() => el.remove(), 300);
        }
    });

    projectIds.forEach(id => {
        delete currentWorkspace.projects[id];
        const el = document.querySelector(`[data-project-id="${id}"]`);
        if (el) {
            el.classList.add('fade-out-project');
            setTimeout(() => el.remove(), 300);
        }
    });

    noteIds.forEach(id => {
        delete currentWorkspace.notes[id];
        const el = document.querySelector(`[data-note-id="${id}"]`);
        if (el) {
            el.classList.add('fade-out-note');
            setTimeout(() => el.remove(), 300);
        }
    });

    shapeIds.forEach(id => {
        delete currentWorkspace.shapes?.[id];
        const el = document.querySelector(`[data-shape-id="${id}"]`);
        if (el) {
            el.classList.add('fade-out-shape');
            setTimeout(() => el.remove(), 300);
        }
    });

    emojiIds.forEach(id => {
        delete currentWorkspace.emojis?.[id];
        const el = document.querySelector(`[data-emoji-id="${id}"]`);
        if (el) {
            el.classList.add('fade-out-emoji');
            setTimeout(() => el.remove(), 300);
        }
    });

    photoIds.forEach(id => {
        delete currentWorkspace.photos?.[id];
        const el = document.querySelector(`[data-photo-id="${id}"]`);
        if (el) {
            el.classList.add('fade-out-photo');
            setTimeout(() => el.remove(), 300);
        }
    });

    clearWindowSelection();
    debouncedSave();
    // 如果删除了文件夹，需要重新渲染以显示被释放的项目
    if (folderIds.length > 0) {
        setTimeout(() => renderCurrentWorkspace(), 350);
    } else {
        checkEmptyState(currentWorkspace);
    }
};

// --- UNDO FUNCTIONALITY ---
let undoStack = [];
let redoStack = [];
let lastStateSerialized = '';
let allowSameStateOnce = false;
const MAX_HISTORY_SIZE = 30;

const getWorkspaceSignature = (items) => {
    if (!Array.isArray(items)) return '';
    return items.map(ws => `${ws.id}:${(ws.name || '').trim()}`).join('|');
};

function recordState() {
    const currentState = { workspaces, currentWorkspaceIndex };
    const serialized = JSON.stringify(currentState);
    if (serialized === lastStateSerialized && !allowSameStateOnce) return;
    lastStateSerialized = serialized;
    allowSameStateOnce = false;
    undoStack.push(JSON.parse(serialized));
    redoStack = [];
    if (undoStack.length > MAX_HISTORY_SIZE) {
        undoStack.shift();
    }
}

function performUndo() {
    if (undoStack.length === 0) { 
        showToast('没有更多可撤销的操作', 'info'); // <--- 可选：当无法撤销时提示
        return; 
    }
    const prevSignature = getWorkspaceSignature(workspaces);
    const prevIndex = currentWorkspaceIndex;
    redoStack.push(JSON.parse(JSON.stringify({ workspaces, currentWorkspaceIndex })));
    if (redoStack.length > MAX_HISTORY_SIZE) {
        redoStack.shift();
    }
    const lastState = undoStack.pop();
    workspaces = lastState.workspaces;
    currentWorkspaceIndex = lastState.currentWorkspaceIndex;
    lastStateSerialized = JSON.stringify({ workspaces, currentWorkspaceIndex });
    allowSameStateOnce = true;
    renderCurrentWorkspace();
    saveWorkspaces();
    const nextSignature = getWorkspaceSignature(workspaces);
    if (prevSignature !== nextSignature || prevIndex !== currentWorkspaceIndex) {
        scheduleRenderWorkspaceSwitcher();
    } else {
        updateWorkspaceSwitcherActive();
    }
    showToast('操作已撤销', 'info'); // <--- 添加这一行
}

function performRedo() {
    if (redoStack.length === 0) { 
        showToast('没有更多可恢复的操作', 'info');
        return; 
    }
    const prevSignature = getWorkspaceSignature(workspaces);
    const prevIndex = currentWorkspaceIndex;
    undoStack.push(JSON.parse(JSON.stringify({ workspaces, currentWorkspaceIndex })));
    if (undoStack.length > MAX_HISTORY_SIZE) {
        undoStack.shift();
    }
    const nextState = redoStack.pop();
    workspaces = nextState.workspaces;
    currentWorkspaceIndex = nextState.currentWorkspaceIndex;
    lastStateSerialized = JSON.stringify({ workspaces, currentWorkspaceIndex });
    allowSameStateOnce = true;
    renderCurrentWorkspace();
    saveWorkspaces();
    const nextSignature = getWorkspaceSignature(workspaces);
    if (prevSignature !== nextSignature || prevIndex !== currentWorkspaceIndex) {
        scheduleRenderWorkspaceSwitcher();
    } else {
        updateWorkspaceSwitcherActive();
    }
    showToast('操作已恢复', 'info');
}

function resetHistory() {
    undoStack = [];
    redoStack = [];
    lastStateSerialized = JSON.stringify({ workspaces, currentWorkspaceIndex });
}

// DOM Element selections (这些在脚本加载时就可以安全获取)
const CATEGORY_COLORS = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE', '#5856D6', '#FFCC00', '#A2845E', '#5AC8FA'];
const appContainer = document.getElementById('app-container');
const addProjectBtn = document.getElementById('add-project-btn');
const addNoteBtn = document.getElementById('add-note-btn');
const addShapeBtn = document.getElementById('add-shape-btn');
const addEmojiBtn = document.getElementById('add-emoji-btn');
const addPhotoBtn = document.getElementById('add-photo-btn');
const addPhotoInput = document.getElementById('add-photo-input');
const addFolderBtn = document.getElementById('add-folder-btn');
const workspaceNameEl = document.getElementById('workspace-name');
const addWorkspaceBtn = document.getElementById('add-workspace-btn');
const statsBtn = document.getElementById('stats-btn');
const statsModal = document.getElementById('stats-modal');
const importBtn = document.getElementById('import-btn');
const exportBtn = document.getElementById('export-btn');
const moreWsBtn = document.getElementById('more-ws-btn');
const importFileInput = document.getElementById('import-file-input');
const workspaceSwitcher = document.getElementById('workspace-switcher');
const workspaceSwitcherContainer = document.querySelector('.workspace-switcher-container');
const imageResizer = document.getElementById('image-resizer');
const helpModal = document.getElementById('help-modal');

// +++ 新增：搜索相关 DOM 元素 +++
const searchModal = document.getElementById('search-modal');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
// +++ 结束 +++

// +++ Emoji Picker DOM +++
const emojiPickerModal = document.getElementById('emoji-picker-modal');
const emojiPickerSearch = document.getElementById('emoji-picker-search');
const emojiPickerTabs = document.getElementById('emoji-picker-tabs');
const emojiPickerGrid = document.getElementById('emoji-picker-grid');
const emojiPickerSelected = document.getElementById('emoji-picker-selected');
const emojiPickerCancel = document.getElementById('emoji-picker-cancel');
const emojiPickerConfirm = document.getElementById('emoji-picker-confirm');
const photoCropModal = document.getElementById('photo-crop-modal');
const photoCropCanvas = document.getElementById('photo-crop-canvas');
const photoCropOverlay = document.getElementById('photo-crop-overlay');
const photoCropCancel = document.getElementById('photo-crop-cancel');
const photoCropConfirm = document.getElementById('photo-crop-confirm');
const settingsModal = document.getElementById('settings-modal');
const settingsNoteFontSize = document.getElementById('settings-note-font-size');
const settingsProjectFontSize = document.getElementById('settings-project-font-size');
const settingsBgColor = document.getElementById('settings-bg-color');
const settingsShortcutProject = document.getElementById('settings-shortcut-project');
const settingsShortcutNote = document.getElementById('settings-shortcut-note');
const settingsShortcutShape = document.getElementById('settings-shortcut-shape');
const settingsShortcutEmoji = document.getElementById('settings-shortcut-emoji');
const settingsShortcutToggle = document.getElementById('settings-shortcut-toggle');
const settingsShortcutStats = document.getElementById('settings-shortcut-stats');
const settingsShortcuts = document.getElementById('settings-shortcuts');
const settingsShapes = document.getElementById('settings-shapes');
const settingsEmojis = document.getElementById('settings-emojis');
const settingsReset = document.getElementById('settings-reset');
const settingsSave = document.getElementById('settings-save');
// +++ 结束 +++

// Custom Modal DOM Elements
const customModal = document.getElementById('custom-modal');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalInput = document.getElementById('modal-input');
const modalOkBtn = document.getElementById('modal-ok-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');

// --- START: 添加 Toast 函数 ---
function showToast(message, type = 'info', duration = 1000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-message ${type}`;

    let icon = 'info';
    if (type === 'success') {
        icon = 'check_circle';
    } else if (type === 'error') {
        icon = 'error';
    } else if (type === 'info') {
        icon = 'info';
    }

    toast.innerHTML = `<span class="toast-icon material-symbols-rounded">${icon}</span><span class="toast-text">${escapeHTML(message)}</span>`;

    // 1. 将 Toast 添加到容器中
    container.appendChild(toast);

    // 2. 触发淡入动画
    // requestAnimationFrame 确保元素已渲染，动画可以正常播放
    requestAnimationFrame(() => {
        toast.style.animation = `toast-in 0.4s cubic-bezier(0.25, 1, 0.5, 1) forwards`;
    });
    
    // 3. 设置计时器，在指定时间后触发淡出动画
    setTimeout(() => {
        toast.style.animation = `toast-out 0.4s cubic-bezier(0.5, 0, 0.75, 0) forwards`;
        
        // 4. 监听淡出动画结束事件，然后移除元素
        toast.addEventListener('animationend', () => {
            // 确保只有在淡出动画结束后才移除
            if (toast.style.animation.includes('toast-out')) {
                toast.remove();
            }
        }, { once: true }); // 使用 once: true 确保事件监听器自动移除

    }, duration);
}


// --- Custom Promise-based Modal Function ---
function showCustomModal({ title, message = '', type = 'confirm', placeholder = '', okText = '确认', initialValue = '', inputType = 'text' }) {
    return new Promise((resolve, reject) => {
        modalTitle.textContent = title;
        modalMessage.textContent = message;
        modalMessage.style.display = message ? 'block' : 'none';
        modalOkBtn.textContent = okText;
        if (type === 'prompt') {
            modalInput.style.display = 'block';
            modalInput.type = inputType;
            modalInput.value = initialValue;
            modalInput.placeholder = placeholder;
        } else {
            modalInput.style.display = 'none';
        }
        customModal.classList.add('visible');
        if (type === 'prompt') {
            setTimeout(() => modalInput.focus(), 50);
        }
        let isResolved = false;
        const cleanup = () => {
            customModal.classList.remove('visible');
            window.removeEventListener('keydown', handleKeydown);
            modalOkBtn.onclick = null;
            modalCancelBtn.onclick = null;
            customModal.onclick = null;
        };
        const handleResolve = () => {
            if (isResolved) return;
            isResolved = true;
            cleanup();
            resolve(type === 'prompt' ? modalInput.value : true);
        };
        const handleReject = () => {
            if (isResolved) return;
            isResolved = true;
            cleanup();
            reject(new Error('User cancelled'));
        };
        const handleKeydown = (e) => {
            if (e.key === 'Enter' && type === 'prompt' && document.activeElement === modalInput) {
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                handleResolve();
            } else if (e.key === 'Escape') {
                handleReject();
            }
        };
        modalOkBtn.onclick = handleResolve;
        modalCancelBtn.onclick = handleReject;
        customModal.onclick = (e) => { if (e.target === customModal) handleReject(); };
        window.addEventListener('keydown', handleKeydown);
    });
}

// --- UTILITY FUNCTIONS ---
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => { clearTimeout(timeout); func(...args); };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

const runWhenIdle = (cb, { timeout = 1000 } = {}) => {
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => cb(), { timeout });
        return;
    }
    setTimeout(cb, 50);
};

const trackWindowResize = () => {
    if (!resizeStart) {
        resizeStart = Date.now();
        resizeCount = 0;
    }
    resizeCount += 1;
    if (resizeLogTimer) clearTimeout(resizeLogTimer);
    resizeLogTimer = setTimeout(() => {
        const durationMs = Date.now() - resizeStart;
        logWebviewEvent('window_resize', {
            durationMs,
            events: resizeCount,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            zoom: currentZoom
        });
        resizeStart = 0;
        resizeCount = 0;
        resizeLogTimer = null;
    }, 250);
};

const startFrameGapMonitor = () => {
    if (APP_RUN_MODE !== 'WEBVIEW') return;
    lastFrameTime = getPerfNow();
    const tick = () => {
        const now = getPerfNow();
        const gap = now - lastFrameTime;
        if (gap >= FRAME_GAP_THRESHOLD_MS) {
            logWebviewEvent('frame_gap', {
                gapMs: Math.round(gap),
                thresholdMs: FRAME_GAP_THRESHOLD_MS
            });
        }
        lastFrameTime = now;
        frameGapRafId = requestAnimationFrame(tick);
    };
    frameGapRafId = requestAnimationFrame(tick);
};

// ===================== 关键改动 1: 数据保存 =====================
/**
 * 异步函数，将当前工作区状态发送到 Flask 后端进行保存。
 */
let lastSavedPayload = '';
let saveInFlight = false;
let currentSavePromise = null;
let pendingPayloadString = null;
const buildPayloadString = () => JSON.stringify({ workspaces, currentWorkspaceIndex });

const performSave = async (payloadString, { detailedErrors = false, logPrefix = '' } = {}) => {
    if (RUN_MODE === 'SERVER') {
        try {
            const response = await fetch(API_SAVE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payloadString
            });

            if (!response.ok) {
                console.error(`${logPrefix}保存失败! 服务器响应:`, response.status, response.statusText);
                if (detailedErrors) {
                    const errorText = await response.text();
                    try {
                        const errorJson = JSON.parse(errorText);
                        console.error("Server error details:", errorJson.message);
                    } catch (e) {
                        console.error("Server raw error:", errorText);
                    }
                }
                return false;
            }

            if (logPrefix) {
                console.log(`数据已${logPrefix}保存到服务器。`);
            }
            return true;
        } catch (error) {
            console.error(`${logPrefix}保存数据时发生网络错误:`, error);
            return false;
        }
    } else {
        localStorage.setItem('todoWorkspaces', payloadString);
        console.log(`数据已${logPrefix || ''}保存到 localStorage。`);
        return true;
    }
};

const savePayloadString = async (payloadString, { force = false } = {}) => {
    if (!force && payloadString === lastSavedPayload) return true;

    if (saveInFlight) {
        pendingPayloadString = payloadString;
        if (!force) return true;
        if (currentSavePromise) await currentSavePromise;
        const pending = pendingPayloadString;
        pendingPayloadString = null;
        if (pending && pending !== lastSavedPayload) {
            return await savePayloadString(pending, { force: true });
        }
        return true;
    }

    saveInFlight = true;
    currentSavePromise = performSave(payloadString, { detailedErrors: force, logPrefix: force ? '强制' : '' });
    const ok = await currentSavePromise;
    saveInFlight = false;
    currentSavePromise = null;

    if (ok) lastSavedPayload = payloadString;

    if (pendingPayloadString && pendingPayloadString !== lastSavedPayload) {
        const pending = pendingPayloadString;
        pendingPayloadString = null;
        return await savePayloadString(pending);
    }
    return ok;
};

// 新增：一个立即执行的、返回 Promise 的保存函数
const forceSaveWorkspaces = async () => {
    const payloadString = buildPayloadString();
    return await savePayloadString(payloadString, { force: true });
};

let saveWorkspaces = async () => {
    const payloadString = buildPayloadString();
    return await savePayloadString(payloadString);
};

// 使用 debounce 包装异步的 saveWorkspaces 函数，防止过于频繁地向服务器发送请求
// 优化：将防抖时间从 500ms 增加到 3000ms，显著减少 Webview 模式下的卡顿
const saveDebounceMs = APP_RUN_MODE === 'WEBVIEW' ? 5000 : 3000;
const debouncedSave = debounce(() => runWhenIdle(() => saveWorkspaces()), saveDebounceMs);
// ==========================================================

const escapeHTML = (str) => String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
const getContrastColor = (hex) => { if (!hex) return 'var(--primary-text-color)'; hex = hex.replace("#", ""); const r = parseInt(hex.substr(0, 2), 16), g = parseInt(hex.substr(2, 2), 16), b = parseInt(hex.substr(4, 2), 16); return (((r * 299) + (g * 587) + (b * 114)) / 1000 >= 128) ? '#1d1d1f' : '#f2f2f7'; };
const closeAllDropdowns = () => document.querySelectorAll('.custom-dropdown-menu').forEach(menu => menu.remove());

function positionContextMenu(menu, event) {
    document.body.appendChild(menu);
    
    // 初始位置
    let top = event.pageY;
    let left = event.pageX;
    
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    
    // 强制浏览器渲染以获取尺寸，但保持不可见
    menu.style.visibility = 'hidden';
    requestAnimationFrame(() => {
        menu.classList.add('visible'); // 添加 visible 类以应用 transform
        
        const menuRect = menu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // 检查并调整位置
        if (menuRect.right > viewportWidth) {
            left = event.pageX - menuRect.width;
        }
        if (menuRect.bottom > viewportHeight) {
            top = event.pageY - menuRect.height;
        }
        
        menu.style.top = `${Math.max(0, top)}px`;
        menu.style.left = `${Math.max(0, left)}px`;
        
        // 恢复可见性并开始动画
        menu.style.visibility = 'visible';
    });
}

function positionContextMenuAt(menu, pageX, pageY) {
    document.body.appendChild(menu);
    let top = pageY;
    let left = pageX;
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.visibility = 'hidden';
    requestAnimationFrame(() => {
        menu.classList.add('visible');
        const menuRect = menu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        if (menuRect.right > viewportWidth) {
            left = pageX - menuRect.width;
        }
        if (menuRect.bottom > viewportHeight) {
            top = pageY - menuRect.height;
        }
        menu.style.top = `${Math.max(0, top)}px`;
        menu.style.left = `${Math.max(0, left)}px`;
        menu.style.visibility = 'visible';
    });
}

const SHAPE_TYPES = [
    { id: 'rect', label: '矩形' },
    { id: 'circle', label: '圆形' },
    { id: 'triangle', label: '三角形' },
    { id: 'star', label: '五角星' },
    { id: 'line', label: '线条' }
];

const EMOJI_PRESETS = ['❌', '⭕', '🚫', '❓', '💯', '❗', '⚠', '✅', '⏹', '⏺', '🔴', '🟢', '🔵', '🚗', '⭐', '⚡', '🍉', '🌻', '🔔', '⏰', '📌', '📍', '🔍', '💀', '💡', '🎯'];
const EMOJI_RECENT_STORAGE_KEY = 'recentEmojis';
const MAX_RECENT_EMOJIS = 12;
const EMOJI_COMMON_STORAGE_KEY = 'commonEmojis';
const MAX_COMMON_EMOJIS = 24;
const EMOJI_HIDDEN_STORAGE_KEY = 'hiddenEmojis';
const MAX_RECENT_DISPLAY = 8;
let lastEmojiMenuPoint = null;

const splitEmojiInput = (value) => {
    const text = String(value || '').trim();
    if (!text) return [];
    const segments = typeof Intl !== 'undefined' && Intl.Segmenter
        ? Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text), s => s.segment)
        : Array.from(text);
    return segments.map(s => s.trim()).filter(Boolean);
};

const EMOJI_LIBRARY = {
    people: ['😀','😁','😄','😃','😊','😉','😍','😘','😜','🤪','😎','🥳','🤩','😇','🤓','😅','😂','🤣','🙂','🙃','😉','😊','😇','🥰','😍','🤗','🤔','🤐','😐','😑','😶','😶‍🌫️','😏','😒','🙄','😬','😮','😯','😲','😳','🥺','😢','😭','😱','😤','😡','🤬','🤯','🥱','😴','🤢','🤮','🥵','🥶','😷','🤒','🤕','😈','👿','👻','💀','☠','👽','🤖','🎃','👋','🤚','✋','🖖','👌','✌️','🤞','🤟','🤘','👍','👎','🙏','💪','🦾','🦿','🧠','👀','👂','👃','👅','👄','💋'],
    symbols: ['✅','❌','⭕','🚫','❗','❓','⚠','💯','🔔','🔕','⏰','⌛','⏳','✔','✖','➕','➖','➗','➰','➿','♻','🔁','🔂','🔃','🔄','🔚','🔙','🔛','🔜','🔝','📌','📍','🔍','🔎','💡','🎯','📎','📁','📂','🧭','🛑','🚷','🔒','🔓','🔐','🔑','🧨','💣','🧲','📣','📢','🆗','🆘','🆒','🆕','🔺','🔻','⬆','⬇','⬅','➡','↗','↘','↙','↖','☮️','☯️','✝️','☪️','☸️','✡️','♈️','♉️','♊️','♋️','♌️','♍️','♎️','♏️','♐️','♑️','♒️','♓️','♾️','‼️','⁉️','™️','©️','®️','🅰️','🆎','🅱️','🆔','🆚','🆙','🆖','🆓','🆕','🆗','🆘'],
    nature: ['🌞','🌝','🌚','⭐','🌟','✨','⚡','🔥','🌈','☁','🌧','⛈','🌪','❄','💧','🌊','🌻','🌹','🌷','🌼','🍀','🌲','🌳','🌴','🍃','🍂','🍁','🪴','🌵','🌸','🌾','🍄','🌋','🌍','🌎','🌏','🌕','🌖','🌗','🌘','🌑','🌒','🌓','🌔','🌙','☀️','🌤️','🌦️','🌧️','🌨️','🌩️','🌪️','🌫️','🐶','🐱','🐼','🐨','🐸','🦊','🐯','🦁','🐮','🐷','🐵','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🐺','🦄','🐝','🦋','🐞','🐢','🐍','🐠','🐟','🐬','🐳','🐙','🦈','🐋','🦀','🦞','🦐','🦑','🐌','🦗','🦂','🐊','🦎','🦥','🦦','🦨','🦘','🐘'],
    objects: ['📌','📍','📎','🧷','🧲','🧯','🔧','🔨','🧰','💾','💿','📷','🎥','📺','🔋','🔌','💻','🖥','📱','🕹','🎮','📖','📚','✏','🖊','🖍','📦','🧱','🧪','🧫','🧬','🛠','⚙','🔩','🧮','💰','💵','💳','🧾','🧳','🎒','👓','🕶','⌚','📅','📆','📇','📊','📈','📉','📋','📁','📂','🗂️','🗃️','🗄️','🗑️','🔑','🔐','🔒','🔓','📣','📢','📯','🔔','🔕','🧷','🧵','🧶','🧹','🧺','🧻','🧼','🧽','🧴'],
    food: ['🍎','🍊','🍉','🍇','🍓','🍒','🍍','🥝','🍅','🥑','🥦','🥕','🌽','🍞','🥐','🥨','🍕','🍔','🌭','🍟','🍣','🍜','🍰','🍩','🍪','🍫','☕','🥤','🍔','🍟','🍕','🌮','🌯','🥗','🍛','🍚','🍙','🍘','🍣','🍤','🥟','🍱','🍢','🍡','🍧','🍦','🍨','🍮','🍯','🧁','🍭','🍬','🍮','🍯','🍩','🍪','🥤','🍺','🍻','🍷','🍸','🍹','🥂','🥃'],
    travel: ['🚗','🚕','🚌','🚎','🚓','🚑','🚒','🚚','🚜','🚲','🛴','✈','🚀','🛸','🚢','⛵','🗺','🧭','🏳','🏁','🏴','🚩','🎒','🧳','🏖','🏕','🏟','🏛','🏝','🏜','🏞','🗻','🗽','🗼','🏰','🎡','🎢','🎠','🛫','🛬','🛳','🛥','🚤','🚁','🚂','🚆','🚇','🚊','🚉','🚞','🚋','🚍','🚔','🚘','🚙','🏍','🛵','🦼','🦽','🛺','🛣️','🛤️','⛽️','🚦','🚥','🛑','⚓️','🛶','🛬','🛰️','🛩️'],
    flags: ['🏁','🚩','🏳','🏴','🏳️‍🌈','🏳️‍⚧️','🏴‍☠️']
};

const EMOJI_TABS = [
    { id: 'recent', label: '最近' },
    { id: 'common', label: '常用' },
    { id: 'people', label: '表情' },
    { id: 'symbols', label: '符号' },
    { id: 'nature', label: '自然' },
    { id: 'objects', label: '物品' },
    { id: 'food', label: '食物' },
    { id: 'travel', label: '出行' },
    { id: 'flags', label: '旗帜' }
];

const SETTINGS_STORAGE_KEY = 'appSettings';
const DEFAULT_SETTINGS = {
    noteFontSize: 20,
    projectFontSize: 20,
    workspaceBg: '',
    shortcutsEnabled: true,
    shapesEnabled: true,
    emojisEnabled: true,
    shortcutMap: {
        project: 'q',
        note: 'w',
        shape: 'x',
        emoji: 'z',
        toggle: 'e',
        stats: 's'
    }
};
let appSettings = { ...DEFAULT_SETTINGS };

const loadSettings = () => {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        appSettings = { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
        appSettings = { ...DEFAULT_SETTINGS };
    }
};

const saveSettings = () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(appSettings));
};

const normalizeShortcutKey = (val, fallback) => {
    if (!val) return fallback;
    const ch = String(val).trim().toLowerCase();
    return ch.length === 1 ? ch : fallback;
};

const updateHelpShortcuts = () => {
    const map = appSettings.shortcutMap;
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value.toUpperCase();
    };
    setText('shortcut-project', map.project);
    setText('shortcut-note', map.note);
    setText('shortcut-shape', map.shape);
    setText('shortcut-emoji', map.emoji);
    setText('shortcut-toggle', map.toggle);
    setText('shortcut-stats', map.stats);
};

const applySettings = () => {
    document.documentElement.style.setProperty('--note-font-size', `${appSettings.noteFontSize}px`);
    document.documentElement.style.setProperty('--project-font-size', `${appSettings.projectFontSize}px`);
    if (appSettings.workspaceBg) {
        document.documentElement.style.setProperty('--bg-color', appSettings.workspaceBg);
    } else {
        document.documentElement.style.removeProperty('--bg-color');
    }
    if (addShapeBtn) addShapeBtn.style.display = appSettings.shapesEnabled ? '' : 'none';
    if (addEmojiBtn) addEmojiBtn.style.display = appSettings.emojisEnabled ? '' : 'none';
    updateHelpShortcuts();
};

const openSettings = () => {
    if (!settingsModal) return;
    settingsNoteFontSize.value = appSettings.noteFontSize;
    settingsProjectFontSize.value = appSettings.projectFontSize;
    settingsBgColor.value = appSettings.workspaceBg || getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim() || '#202124';
    settingsShortcutProject.value = appSettings.shortcutMap.project.toUpperCase();
    settingsShortcutNote.value = appSettings.shortcutMap.note.toUpperCase();
    settingsShortcutShape.value = appSettings.shortcutMap.shape.toUpperCase();
    settingsShortcutEmoji.value = appSettings.shortcutMap.emoji.toUpperCase();
    settingsShortcutToggle.value = appSettings.shortcutMap.toggle.toUpperCase();
    settingsShortcutStats.value = appSettings.shortcutMap.stats.toUpperCase();
    settingsShortcuts.checked = appSettings.shortcutsEnabled;
    settingsShapes.checked = appSettings.shapesEnabled;
    settingsEmojis.checked = appSettings.emojisEnabled;
    settingsModal.classList.add('visible');
    document.body.classList.add('modal-open');
};

const closeSettings = () => {
    if (!settingsModal) return;
    settingsModal.classList.remove('visible');
    document.body.classList.remove('modal-open');
};

let emojiPickerState = { mode: 'create', anchor: null, onSelect: null, target: null, tab: 'common', query: '', selected: [] };
let photoCropState = { photo: null, container: null, image: null, rect: null, scale: 1 };

const getEmojiListByTab = (tabId) => {
    if (tabId === 'recent') return getRecentEmojis().slice(0, MAX_RECENT_DISPLAY);
    if (tabId === 'common') {
        const common = getCommonEmojis();
        const hidden = new Set(getHiddenEmojis());
        const commonSet = new Set(common);
        return [...common, ...EMOJI_PRESETS.filter(e => !commonSet.has(e))].filter(e => !hidden.has(e));
    }
    return EMOJI_LIBRARY[tabId] || [];
};

const renderEmojiPickerTabs = () => {
    emojiPickerTabs.innerHTML = '';
    EMOJI_TABS.forEach(tab => {
        const btn = document.createElement('button');
        btn.className = `emoji-picker-tab ${emojiPickerState.tab === tab.id ? 'active' : ''}`;
        btn.textContent = tab.label;
        btn.addEventListener('click', () => {
            emojiPickerState.tab = tab.id;
            renderEmojiPickerTabs();
            renderEmojiPickerGrid();
        });
        emojiPickerTabs.appendChild(btn);
    });
};

const renderEmojiPickerGrid = () => {
    const list = getEmojiListByTab(emojiPickerState.tab);
    const q = emojiPickerState.query.trim();
    const filtered = q ? list.filter(e => e.includes(q)) : list;
    
    // 如果是文件夹图标选择模式，添加默认图标选项
    const isFolderIconMode = emojiPickerState.mode === 'edit' && emojiPickerState.target && emojiPickerState.target.items !== undefined;
    let defaultIconHTML = '';
    if (isFolderIconMode && !q) {
        const isDefaultSelected = emojiPickerState.selected.length === 0;
        defaultIconHTML = `
            <div class="emoji-picker-item emoji-picker-default-icon ${isDefaultSelected ? 'selected' : ''}" data-emoji="" title="默认文件夹图标">
                <span class="material-symbols-rounded">folder_open</span>
            </div>
        `;
    }
    
    emojiPickerGrid.innerHTML = defaultIconHTML + filtered.map(e => {
        const selected = emojiPickerState.selected.includes(e) ? 'selected' : '';
        return `<div class="emoji-picker-item ${selected}" data-emoji="${e}">${e}</div>`;
    }).join('');
    if (emojiPickerSelected) {
        emojiPickerSelected.innerHTML = emojiPickerState.selected.map(e => `<span data-emoji="${e}" title="点击移除">${e}</span>`).join('');
    }
};

const openEmojiPicker = ({ mode = 'create', anchor = null, onSelect = null, target = null } = {}) => {
    emojiPickerState = { mode, anchor, onSelect, target, tab: 'common', query: '', selected: [] };
    if (emojiPickerSearch) emojiPickerSearch.value = '';
    renderEmojiPickerTabs();
    renderEmojiPickerGrid();
    emojiPickerModal.classList.add('visible');
};

const closeEmojiPicker = () => {
    emojiPickerModal.classList.remove('visible');
};

const drawPhotoCropOverlay = () => {
    if (!photoCropOverlay || !photoCropState.image) return;
    const ctx = photoCropOverlay.getContext('2d');
    const { width, height } = photoCropOverlay;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, width, height);
    if (photoCropState.rect) {
        const { x, y, w, h } = photoCropState.rect;
        ctx.clearRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    }
};

const openPhotoCropper = (photo, container) => {
    if (!photoCropModal || !photoCropCanvas || !photoCropOverlay) return;
    if (!photo || !photo.src) {
        showToast('图片不存在，无法裁剪', 'info');
        return;
    }
    const img = new Image();
    img.onload = () => {
        const maxW = 640;
        const maxH = 420;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const canvasW = Math.max(1, Math.round(img.width * scale));
        const canvasH = Math.max(1, Math.round(img.height * scale));
        photoCropCanvas.width = canvasW;
        photoCropCanvas.height = canvasH;
        photoCropOverlay.width = canvasW;
        photoCropOverlay.height = canvasH;
        const ctx = photoCropCanvas.getContext('2d');
        ctx.clearRect(0, 0, canvasW, canvasH);
        ctx.drawImage(img, 0, 0, canvasW, canvasH);
        photoCropState = {
            photo,
            container,
            image: img,
            rect: { x: 0, y: 0, w: canvasW, h: canvasH },
            scale
        };
        drawPhotoCropOverlay();
        photoCropModal.classList.add('visible');
        document.body.classList.add('modal-open');
    };
    img.src = photo.src;
};

const closePhotoCropper = () => {
    if (!photoCropModal) return;
    photoCropModal.classList.remove('visible');
    document.body.classList.remove('modal-open');
    photoCropState = { photo: null, container: null, image: null, rect: null, scale: 1 };
};

const getRecentEmojis = () => {
    try {
        const raw = localStorage.getItem(EMOJI_RECENT_STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.filter(Boolean) : [];
    } catch {
        return [];
    }
};

const addRecentEmoji = (emoji) => {
    if (!emoji) return;
    const list = getRecentEmojis();
    const next = [emoji, ...list.filter(e => e !== emoji)].slice(0, MAX_RECENT_EMOJIS);
    localStorage.setItem(EMOJI_RECENT_STORAGE_KEY, JSON.stringify(next));
};

const removeRecentEmoji = (emoji) => {
    if (!emoji) return;
    const list = getRecentEmojis();
    const next = list.filter(e => e !== emoji);
    localStorage.setItem(EMOJI_RECENT_STORAGE_KEY, JSON.stringify(next));
};

const getCommonEmojis = () => {
    try {
        const raw = localStorage.getItem(EMOJI_COMMON_STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.filter(Boolean) : [];
    } catch {
        return [];
    }
};

const addCommonEmoji = (emoji) => {
    if (!emoji) return;
    const list = getCommonEmojis();
    const next = [emoji, ...list.filter(e => e !== emoji)].slice(0, MAX_COMMON_EMOJIS);
    localStorage.setItem(EMOJI_COMMON_STORAGE_KEY, JSON.stringify(next));
    const hidden = getHiddenEmojis().filter(e => e !== emoji);
    localStorage.setItem(EMOJI_HIDDEN_STORAGE_KEY, JSON.stringify(hidden));
};

const removeCommonEmoji = (emoji) => {
    if (!emoji) return;
    const list = getCommonEmojis();
    const next = list.filter(e => e !== emoji);
    localStorage.setItem(EMOJI_COMMON_STORAGE_KEY, JSON.stringify(next));
};

const getHiddenEmojis = () => {
    try {
        const raw = localStorage.getItem(EMOJI_HIDDEN_STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.filter(Boolean) : [];
    } catch {
        return [];
    }
};

const addHiddenEmoji = (emoji) => {
    if (!emoji) return;
    const list = getHiddenEmojis();
    const next = [emoji, ...list.filter(e => e !== emoji)];
    localStorage.setItem(EMOJI_HIDDEN_STORAGE_KEY, JSON.stringify(next));
};

const removeHiddenEmoji = (emoji) => {
    if (!emoji) return;
    const list = getHiddenEmojis();
    const next = list.filter(e => e !== emoji);
    localStorage.setItem(EMOJI_HIDDEN_STORAGE_KEY, JSON.stringify(next));
};

const moveEmojiInList = (list, emoji, targetIndex) => {
    const next = list.filter(e => e !== emoji);
    const idx = Math.max(0, Math.min(targetIndex, next.length));
    next.splice(idx, 0, emoji);
    return next;
};

const showEmojiMenu = (eventOrPoint, onSelect) => {
    closeAllDropdowns();
    const menu = document.createElement('div');
    menu.className = 'custom-dropdown-menu';
    lastEmojiMenuPoint = 'pageX' in eventOrPoint ? { x: eventOrPoint.pageX, y: eventOrPoint.pageY } : { x: eventOrPoint.x, y: eventOrPoint.y };
    const recent = getRecentEmojis().slice(0, MAX_RECENT_DISPLAY);
    const recentHTML = recent.length
        ? `
            <div class="emoji-menu-section">
                <div class="emoji-menu-title">最近使用</div>
                <div class="emoji-menu-grid emoji-menu-grid-recent" data-section="recent">
                    ${recent.map(e => `
                        <div class="dropdown-option emoji-option" data-emoji="${e}" data-section="recent" draggable="true">
                            <span class="emoji-symbol">${e}</span>
                            <button class="emoji-remove-btn" data-remove="${e}" data-source="recent" title="删除最近">×</button>
                        </div>
                    `).join('')}
                </div>
            </div>
          `
        : '';
    const common = getCommonEmojis();
    const hidden = new Set(getHiddenEmojis());
    const commonSet = new Set(common);
    const mergedCommon = [...common, ...EMOJI_PRESETS.filter(e => !commonSet.has(e))].filter(e => !hidden.has(e));
    const presetHTML = `
        <div class="emoji-menu-section">
            <div class="emoji-menu-title">常用</div>
            <div class="emoji-menu-grid" data-section="common">
                ${mergedCommon.map(e => {
                    const isCommon = commonSet.has(e);
                    return `<div class="dropdown-option emoji-option ${isCommon ? 'emoji-option-common' : ''}" data-emoji="${e}" data-section="common" draggable="true">
                                <span class="emoji-symbol">${e}</span>
                                <button class="emoji-remove-btn" data-remove="${e}" data-source="common" title="删除常用">×</button>
                            </div>`;
                }).join('')}
            </div>
        </div>
    `;
    menu.innerHTML = `${recentHTML}${presetHTML}<div class="dropdown-divider"></div><div class="dropdown-option" data-emoji="custom">自定义...</div><div class="dropdown-option" data-emoji="add-common">添加到常用...</div>`;
    if ('pageX' in eventOrPoint) {
        positionContextMenu(menu, eventOrPoint);
    } else {
        positionContextMenuAt(menu, eventOrPoint.x, eventOrPoint.y);
    }
    menu.addEventListener('click', async (e) => {
        const removeBtn = e.target.closest('.emoji-remove-btn');
        if (removeBtn) {
            e.preventDefault();
            e.stopPropagation();
            const targetEmoji = removeBtn.dataset.remove;
            const source = removeBtn.dataset.source;
            if (source === 'recent') {
                removeRecentEmoji(targetEmoji);
            } else {
                addHiddenEmoji(targetEmoji);
                removeCommonEmoji(targetEmoji);
            }
            removeBtn.closest('.emoji-option')?.remove();
            return;
        }
        const opt = e.target.closest('.dropdown-option');
        if (!opt) return;
        const emoji = opt.dataset.emoji;
        const keepOpen = e.ctrlKey;
        if (!keepOpen) {
            closeAllDropdowns();
        }
        if (emoji === 'custom') {
            if (keepOpen) closeAllDropdowns();
            openEmojiPicker({ mode: 'create', anchor: lastEmojiMenuPoint, onSelect });
        } else if (emoji === 'add-common') {
            if (keepOpen) closeAllDropdowns();
            openEmojiPicker({ mode: 'add-common' });
        } else if (emoji) {
            addRecentEmoji(emoji);
            onSelect(emoji);
        }
    });

    menu.addEventListener('dragstart', (e) => {
        const option = e.target.closest('.emoji-option');
        if (!option) return;
        const emoji = option.dataset.emoji;
        const section = option.dataset.section || (option.classList.contains('emoji-option-common') ? 'common' : 'common');
        e.dataTransfer.setData('text/plain', JSON.stringify({ emoji, section }));
        e.dataTransfer.effectAllowed = 'move';
    });

    menu.addEventListener('dragover', (e) => {
        const grid = e.target.closest('.emoji-menu-grid');
        if (!grid) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    });

    menu.addEventListener('drop', (e) => {
        const grid = e.target.closest('.emoji-menu-grid');
        if (!grid) return;
        e.preventDefault();
        const payload = e.dataTransfer.getData('text/plain');
        if (!payload) return;
        let data;
        try { data = JSON.parse(payload); } catch { return; }
        const emoji = data.emoji;
        const targetSection = grid.dataset.section || 'common';
        if (!emoji) return;

        if (targetSection === 'recent') {
            let list = getRecentEmojis();
            if (!list.includes(emoji)) {
                list = [emoji, ...list];
            }
            const targetOption = e.target.closest('.emoji-option');
            const targetIndex = targetOption ? Array.from(grid.querySelectorAll('.emoji-option')).indexOf(targetOption) : list.length;
            const next = moveEmojiInList(list, emoji, targetIndex).slice(0, MAX_RECENT_EMOJIS);
            localStorage.setItem(EMOJI_RECENT_STORAGE_KEY, JSON.stringify(next));
        } else {
            removeHiddenEmoji(emoji);
            let list = getCommonEmojis();
            if (!list.includes(emoji)) {
                list = [emoji, ...list];
            }
            const targetOption = e.target.closest('.emoji-option');
            let targetIndex = list.length;
            if (targetOption && targetOption.classList.contains('emoji-option-common')) {
                const commonOptions = Array.from(grid.querySelectorAll('.emoji-option-common'));
                targetIndex = commonOptions.indexOf(targetOption);
                if (targetIndex < 0) targetIndex = list.length;
            }
            const next = moveEmojiInList(list, emoji, targetIndex).slice(0, MAX_COMMON_EMOJIS);
            localStorage.setItem(EMOJI_COMMON_STORAGE_KEY, JSON.stringify(next));
        }

        if (lastEmojiMenuPoint) {
            showEmojiMenu(lastEmojiMenuPoint, onSelect);
        }
    });
};

const updateEmojiSize = (container) => {
    const emojiEl = container.querySelector('.emoji-body');
    if (!emojiEl) return;
    const width = container.offsetWidth || 0;
    const height = container.offsetHeight || 0;
    const base = Math.min(width, height);
    const size = Math.max(12, Math.min(120, Math.round(base * 0.75)));
    emojiEl.style.fontSize = `${size}px`;
};

const getDefaultShapeSize = (type) => {
    if (type === 'line') return { width: 140, height: 24 };
    if (type === 'triangle') return { width: 100, height: 86 };
    return { width: 90, height: 90 };
};

const showShapeTypeMenu = (eventOrPoint, onSelect) => {
    closeAllDropdowns();
    const menu = document.createElement('div');
    menu.className = 'custom-dropdown-menu';
    menu.innerHTML = SHAPE_TYPES.map(t => `<div class="dropdown-option" data-shape="${t.id}">${t.label}</div>`).join('');
    if ('pageX' in eventOrPoint) {
        positionContextMenu(menu, eventOrPoint);
    } else {
        positionContextMenuAt(menu, eventOrPoint.x, eventOrPoint.y);
    }
    menu.addEventListener('click', e => {
        const opt = e.target.closest('.dropdown-option');
        if (!opt) return;
        const shapeType = opt.dataset.shape;
        const keepOpen = e.ctrlKey;
        if (shapeType) {
            onSelect(shapeType);
        }
        if (!keepOpen) {
            closeAllDropdowns();
        }
    });
};

const updateShapeTextSize = (container) => {
    const textEl = container.querySelector('.shape-text');
    if (!textEl) return;
    const width = container.offsetWidth || 0;
    const height = container.offsetHeight || 0;
    const base = Math.min(width, height);
    const size = Math.max(10, Math.min(64, Math.round(base * 0.22)));
    textEl.style.fontSize = `${size}px`;
};

function updateBodySizeForZoom() {
    if (!appContainer) return;

    // 1. 确定内容的实际边界
    let contentRightBound = 0;
    let contentBottomBound = 0;

    // 使用 Array.from(appContainer.children) 确保只遍历元素节点
    Array.from(appContainer.children).forEach(node => {
        // *** 关键修复 ***
        // 原来的 node.style.position 读不到 CSS 类里的样式。
        // 改为直接判断它是不是项目或者便签容器。
        if (node.classList.contains('project-container') || node.classList.contains('note-container')) {
            
            // 忽略被隐藏的元素
            if (node.style.display === 'none') return;

            const rightEdge = node.offsetLeft + node.offsetWidth;
            const bottomEdge = node.offsetTop + node.offsetHeight;
            
            if (rightEdge > contentRightBound) contentRightBound = rightEdge;
            if (bottomEdge > contentBottomBound) contentBottomBound = bottomEdge;
        }
    });

    if (DEBUG_LOGS) {
        console.log(`调整布局 - 检测到内容底部边缘: ${contentBottomBound}`);
    }

    // 2. 定义“呼吸空间” (Buffer) - 这里设置 600px 的额外空间
    const EXTRA_MARGIN = 300 / currentZoom; 

    // 3. 计算当前视口在缩放后的逻辑尺寸
    const viewportWidth = window.innerWidth / currentZoom;
    const viewportHeight = window.innerHeight / currentZoom;

    // 4. 计算最终需要的画布尺寸
    // 取 (视口大小) 和 (内容边缘 + 呼吸空间) 中的较大值
    const finalWidth = Math.max(viewportWidth, contentRightBound + EXTRA_MARGIN) * currentZoom;
    const finalHeight = Math.max(viewportHeight, contentBottomBound + EXTRA_MARGIN) * currentZoom;
    
    // 5. 应用尺寸（避免重复写入）
    if (Math.abs(finalWidth - lastBodyWidth) < 1 && Math.abs(finalHeight - lastBodyHeight) < 1) return;
    lastBodyWidth = finalWidth;
    lastBodyHeight = finalHeight;
    document.body.style.width = `${finalWidth}px`;
    document.body.style.height = `${finalHeight}px`;
}


const debouncedUpdateBodySize = debounce(() => scheduleUpdateBodySize(), 300);
let bodySizeRafId = null;
const scheduleUpdateBodySize = () => {
    if (bodySizeRafId) return;
    bodySizeRafId = requestAnimationFrame(() => {
        bodySizeRafId = null;
        updateBodySizeForZoom();
    });
};


// --- DATA IMPORT/EXPORT ---
async function exportData() {
    const dataToSave = { workspaces, currentWorkspaceIndex };
    const dataStr = JSON.stringify(dataToSave, null, 2);

    // 检查是否在 PyWebView 环境中
    if (window.pywebview && window.pywebview.api) {
        try {
            // 调用 Python 的 export_data 函数，并传递JSON字符串
            console.log("Calling Python API for export...");
            const result = await window.pywebview.api.export_data(dataStr);
            if (result && result.status === 'ok') {
                showToast(`数据已导出到 ${result.path}`, 'success', 2500);
            } else {
                showToast('导出被取消或发生错误', 'error');
                console.error("Export failed:", result);
            }
        } catch (e) {
            showToast('导出功能调用失败', 'error');
            console.error("Error calling export API:", e);
        }
    } else {
        // 保持原有的浏览器下载逻辑
        const blob = new Blob([dataStr], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `todo_backup_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('数据已导出', 'success');
    }
}

async function handleImport(event) {
    const file = event.target.files[0]; 
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const importedData = JSON.parse(e.target.result);
            if (Array.isArray(importedData.workspaces) && typeof importedData.currentWorkspaceIndex === 'number') {
                try {
                    await showCustomModal({ 
                        title: '确认导入', 
                        message: '导入数据将覆盖当前所有内容。此操作不可撤销，确定要继续吗？', 
                        okText: '导入' 
                    });

                    // 1. 先将导入的数据赋值给全局变量
                    workspaces = importedData.workspaces;
                    currentWorkspaceIndex = importedData.currentWorkspaceIndex;
                    
                    // 2. 立即、强制地将新数据保存到后端，并等待其完成
                    const success = await forceSaveWorkspaces();
                    
                    if (success) {
                        // 3. 只有在保存成功后，才重置状态并重新渲染UI
                        resetHistory();
                        highestZIndex = 1;
                        renderCurrentWorkspace();
                        scheduleRenderWorkspaceSwitcher();
                        await showCustomModal({ title: '导入成功', message: '数据已成功导入并保存。', type: 'confirm', okText: '好的' });
                    } else {
                        // 如果保存失败，提示用户并可以考虑恢复到导入前的数据
                        await showCustomModal({ title: '导入失败', message: '数据无法保存到服务器，请检查网络连接或联系管理员。', type: 'confirm', okText: '好的' });
                        // 可以在这里重新加载页面以恢复到旧状态
                        // window.location.reload(); 
                    }

                } catch (userCancelledError) {
                    // 用户在确认对话框中点击了“取消”
                    console.log("Import cancelled by user.");
                }
            } else { 
                await showCustomModal({ title: '导入失败', message: '文件格式不正确。', okText: '好的' }); 
            }
        } catch (parseError) { 
            await showCustomModal({ title: '导入失败', message: '无效的 JSON 文件。', okText: '好的' }); 
        } finally {
            // 无论成功与否，都清空文件输入框，以便下次能选择同一个文件
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}

// --- STATISTICS MODAL ---
function openStatistics() {
    if (!workspaces.length || !workspaces[currentWorkspaceIndex]) return;

    const currentWorkspace = workspaces[currentWorkspaceIndex];
    const projectFilter = document.getElementById('stats-project-filter');
    const activeList = document.getElementById('active-stats-list');
    const completedList = document.getElementById('completed-stats-list');
    const activeCountEl = document.getElementById('active-count');
    const completedCountEl = document.getElementById('completed-count');

    // --- 1. 初始化和填充项目筛选器 (仅在首次打开时执行) ---
    if (projectFilter.options.length <= 1) {
        projectFilter.innerHTML = '<option value="all">所有项目</option>';
        Object.values(currentWorkspace.projects)
            .sort((a, b) => a.name.localeCompare(b.name)) // 按名称排序
            .forEach(project => {
                const option = document.createElement('option');
                option.value = project.id;
                option.textContent = project.name;
                projectFilter.appendChild(option);
            });
        // 添加事件监听器，当筛选变化时重新渲染
        projectFilter.onchange = openStatistics;
    }
    const selectedProjectId = projectFilter.value;

    // --- 2. 收集并处理所有任务数据 ---
    let allTasks = [];
    Object.values(currentWorkspace.projects).forEach(project => {
        // 如果不是“所有项目”且当前项目不匹配，则跳过
        if (selectedProjectId !== 'all' && project.id !== selectedProjectId) {
            return;
        }
        project.todos.forEach(todo => {
            const category = todo.categoryId ? project.categories.find(c => c.id === todo.categoryId) : null;
            allTasks.push({
                ...todo, // 包含 id, text, completed, subtasks 等
                projectName: project.name,
                projectId: project.id,
                categoryName: category ? category.name : null,
                categoryColor: category ? category.color : 'var(--secondary-text-color)',
            });
        });
    });

    const activeTasks = allTasks.filter(t => !t.completed);
    const completedTasks = allTasks.filter(t => t.completed);

    // 更新任务计数
    activeCountEl.textContent = activeTasks.length;
    completedCountEl.textContent = completedTasks.length;

    // --- 3. 渲染函数 ---
    const renderStatsColumn = (container, tasks) => {
        container.innerHTML = ''; // 清空旧内容
        if (tasks.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--secondary-text-color); margin-top: 20px;">无任务</p>';
            return;
        }

        // 按项目ID对任务进行分组
        const tasksByProject = tasks.reduce((acc, task) => {
            if (!acc[task.projectId]) {
                acc[task.projectId] = { name: task.projectName, tasks: [] };
            }
            acc[task.projectId].tasks.push(task);
            return acc;
        }, {});

        // 创建并附加 HTML
        const fragment = document.createDocumentFragment();
        for (const projectId in tasksByProject) {
            const group = tasksByProject[projectId];
            const projectGroupDiv = document.createElement('div');
            projectGroupDiv.className = 'stats-project-group';

            let groupHTML = `<h4 class="stats-project-title">${escapeHTML(group.name)}</h4>`;
            
            group.tasks.forEach(task => {
                // 分类标签 HTML
                const categoryTag = task.categoryName 
                    ? `<span class="stats-category-tag" style="background-color:${task.categoryColor};">${escapeHTML(task.categoryName)}</span>` 
                    : '';

                // 子任务列表 HTML
                let subtasksHTML = '';
                if (task.subtasks && task.subtasks.length > 0) {
                    subtasksHTML = '<ul class="stats-subtask-list">';
                    task.subtasks.forEach(sub => {
                        const statusIcon = sub.completed ? '<span class="subtask-status-icon">✓</span>' : '';
                        subtasksHTML += `<li class="stats-subtask-item ${sub.completed ? 'completed' : ''}">${statusIcon}<span class="subtask-text">${escapeHTML(sub.text)}</span></li>`;
                    });
                    subtasksHTML += '</ul>';
                }

                groupHTML += `
                    <div class="stats-task-item">
                        <div class="stats-task-info">
                            <span class="stats-task-text">${escapeHTML(task.text)}</span>
                            ${categoryTag}
                        </div>
                        ${subtasksHTML}
                    </div>
                `;
            });
            projectGroupDiv.innerHTML = groupHTML;
            fragment.appendChild(projectGroupDiv);
        }
        container.appendChild(fragment);
    };

    // --- 4. 执行渲染并显示模态框 ---
    renderStatsColumn(activeList, activeTasks);
    renderStatsColumn(completedList, completedTasks);
    
    statsModal.classList.add('visible');
    document.body.classList.add('modal-open');
}


function closeStatistics() {
    statsModal.classList.remove('visible'); document.body.classList.remove('modal-open');
}

function openHelpModal() {
    helpModal.classList.add('visible');
    document.body.classList.add('modal-open');
}
function closeHelpModal() {
    helpModal.classList.remove('visible');
    document.body.classList.remove('modal-open');
}

// +++ START: 搜索功能核心逻辑 +++

function openSearch() {
    if (!workspaces.length || !workspaces[currentWorkspaceIndex]) return;
    searchModal.classList.add('visible');
    document.body.classList.add('modal-open');
    searchInput.value = '';
    searchResults.innerHTML = '<div class="initial-message">输入关键词开始搜索...</div>';
    setTimeout(() => searchInput.focus(), 100);
}

function closeSearch() {
    searchModal.classList.remove('visible');
    document.body.classList.remove('modal-open');
}

function performSearch(query) {
    if (!query) {
        searchResults.innerHTML = '<div class="initial-message">输入关键词开始搜索...</div>';
        return;
    }

    query = query.toLowerCase();
    const currentWorkspace = workspaces[currentWorkspaceIndex];
    const results = [];

    // 1. 搜索项目 (名称)
    Object.values(currentWorkspace.projects).forEach(p => {
        if (p.name.toLowerCase().includes(query)) {
            results.push({ type: 'project', id: p.id, name: p.name, matchText: p.name, parentName: '项目' });
        }
        
        // 2. 搜索任务 (内容)
        p.todos.forEach(t => {
            if (t.text.toLowerCase().includes(query)) {
                results.push({ type: 'task', id: t.id, projectId: p.id, name: t.text, matchText: t.text, parentName: p.name });
            }
            // 3. 搜索子任务
            if (t.subtasks) {
                t.subtasks.forEach(st => {
                    if (st.text.toLowerCase().includes(query)) {
                        results.push({ type: 'subtask', id: st.id, parentTaskId: t.id, projectId: p.id, name: st.text, matchText: st.text, parentName: `${p.name} > ${t.text}` });
                    }
                });
            }
        });
    });

    // 4. 搜索便签 (纯文本内容)
    Object.values(currentWorkspace.notes).forEach(n => {
        // 创建一个临时 DOM 来提取纯文本
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = n.content;
        const textContent = tempDiv.textContent || "";
        
        if (n.title.toLowerCase().includes(query) || textContent.toLowerCase().includes(query)) {
            const matchSource = n.title.toLowerCase().includes(query) ? n.title : textContent;
            results.push({ type: 'note', id: n.id, name: n.title || '便签', matchText: matchSource, parentName: '便签' });
        }
    });

    renderSearchResults(results, query);
}

function renderSearchResults(results, query) {
    searchResults.innerHTML = '';
    if (results.length === 0) {
        searchResults.innerHTML = '<div class="initial-message">未找到匹配项</div>';
        return;
    }

    const fragment = document.createDocumentFragment();
    
    // 高亮匹配文本的辅助函数
    const highlightText = (text, q) => {
        const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return escapeHTML(text).replace(regex, '<mark>$1</mark>');
    };

    results.forEach(item => {
        const div = document.createElement('div');
        div.className = 'stats-task-item'; // 复用统计样式的 item 类
        div.style.cursor = 'pointer';
        
        let icon = '';
        if (item.type === 'project') icon = '📁';
        else if (item.type === 'task') icon = '✅';
        else if (item.type === 'subtask') icon = '↳';
        else if (item.type === 'note') icon = '📝';

        div.innerHTML = `
            <div class="stats-task-info">
                <span style="margin-right: 8px;">${icon}</span>
                <div style="display:flex; flex-direction:column; overflow:hidden;">
                    <span class="stats-task-text" style="font-size: 1rem;">${highlightText(item.matchText, query)}</span>
                    <span style="font-size: 0.8rem; color: var(--secondary-text-color);">${escapeHTML(item.parentName)}</span>
                </div>
            </div>
        `;

        div.addEventListener('click', () => {
            navigateToItem(item);
        });

        fragment.appendChild(div);
    });
    searchResults.appendChild(fragment);
}

function navigateToItem(item) {
    closeSearch();
    
    let targetEl = null;
    let containerEl = null;

    // 根据类型找到 DOM 元素
    if (item.type === 'project') {
        targetEl = document.querySelector(`.project-container[data-project-id="${item.id}"]`);
        containerEl = targetEl;
    } else if (item.type === 'note') {
        targetEl = document.querySelector(`.note-container[data-note-id="${item.id}"]`);
        containerEl = targetEl;
    } else if (item.type === 'task') {
        // 确保该任务所在的项目可见（如果是筛选状态，这里简单处理为重置筛选可能比较好，或者只跳转DOM）
        // 这里假设 DOM 存在（即没有被 filter 隐藏）。如果被隐藏了，可能需要先重置 filter。
        // 为了简单起见，我们先尝试直接找。
        targetEl = document.querySelector(`.todo-item[data-id="${item.id}"]`);
        containerEl = targetEl ? targetEl.closest('.project-container') : null;
        
        // 如果没找到，可能是因为 filter 隐藏了，强制显示所有可能比较复杂，这里暂且只处理可见的
        if (!targetEl && item.projectId) {
             // 尝试找到项目并提示
             targetEl = document.querySelector(`.project-container[data-project-id="${item.projectId}"]`);
             containerEl = targetEl;
             showToast('任务可能在已过滤的视图中，已定位到项目', 'info');
        }
    } else if (item.type === 'subtask') {
        targetEl = document.querySelector(`.sub-task-item[data-id="${item.id}"]`);
        containerEl = targetEl ? targetEl.closest('.project-container') : null;
    }

    if (containerEl) {
        // 1. 将整个容器（项目/便签）移到视口中心
        const rect = containerEl.getBoundingClientRect();
        const absoluteTop = window.scrollY + rect.top;
        const absoluteLeft = window.scrollX + rect.left;
        
        window.scrollTo({
            top: absoluteTop - (window.innerHeight / 2) + (rect.height / 2),
            left: absoluteLeft - (window.innerWidth / 2) + (rect.width / 2),
            behavior: 'smooth'
        });

        // 2. 如果是任务列表内部的元素，尝试滚动列表
        if ((item.type === 'task' || item.type === 'subtask') && targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // 3. 添加高亮闪烁动画
        // 移除旧的（如果有）
        document.querySelectorAll('.highlight-target').forEach(el => el.classList.remove('highlight-target'));
        
        // 稍微延迟一点等待滚动开始
        setTimeout(() => {
            if (targetEl) targetEl.classList.add('highlight-target');
            // 动画结束后移除类
            setTimeout(() => {
                if (targetEl) targetEl.classList.remove('highlight-target');
            }, 1500);
        }, 300);
    }
}
// +++ END: 搜索功能核心逻辑 +++


// --- UI CONTROL FUNCTIONS ---
function setAddButtonsVisibility(shouldShow) {
    if (prefersReducedMotion.matches) {
        addButtonsContainer.classList.toggle('visible', shouldShow);
        addButtonsContainer.classList.remove('hiding');
        localStorage.setItem('addButtonsVisible', shouldShow);
        return;
    }

    if (shouldShow) {
        addButtonsContainer.classList.remove('hiding');
        addButtonsContainer.classList.add('visible');
        localStorage.setItem('addButtonsVisible', true);
        return;
    }

    if (!addButtonsContainer.classList.contains('visible') || addButtonsContainer.classList.contains('hiding')) {
        localStorage.setItem('addButtonsVisible', false);
        return;
    }

    addButtonsContainer.classList.add('hiding');
    localStorage.setItem('addButtonsVisible', false);

    const onHideEnd = (event) => {
        if (event.target !== addButtonsContainer) return;
        addButtonsContainer.classList.remove('visible');
        addButtonsContainer.classList.remove('hiding');
        addButtonsContainer.removeEventListener('animationend', onHideEnd);
    };
    addButtonsContainer.addEventListener('animationend', onHideEnd);
}

function toggleAddButtons() {
    const shouldShow = !addButtonsContainer.classList.contains('visible');
    setAddButtonsVisibility(shouldShow);
}

function toggleWorkspaceControls() {
    workspaceControls.classList.toggle('visible');
    // 新增：将状态保存到 localStorage
    localStorage.setItem('workspaceControlsVisible', workspaceControls.classList.contains('visible'));
}

const sanitizeFileName = (name) => {
    return String(name || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .trim()
        .slice(0, 60) || 'note';
};

const downloadBlob = (filename, blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
};

const downloadTextFile = (filename, content, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    downloadBlob(filename, blob);
};

const htmlToMhtml = (html, title = '') => {
    const root = document.createElement('div');
    root.innerHTML = html;
    const images = Array.from(root.querySelectorAll('img'));
    const parts = [];
    let index = 1;
    images.forEach(img => {
        const src = img.getAttribute('src') || '';
        const match = src.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (!match) return;
        const mime = match[1];
        const base64 = match[2];
        const ext = mime.split('/')[1] || 'png';
        const cid = `image${index}.${ext}`;
        img.setAttribute('src', `cid:${cid}`);
        parts.push({ cid, mime, base64 });
        index += 1;
    });
    const boundary = `----=_NextPart_000_0000_${Date.now()}`;
    const newline = '\r\n';
    const htmlBody = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:"MiSans",sans-serif;line-height:1.6;}img{max-width:100%;}</style></head><body>${root.innerHTML}</body></html>`;
    let mhtml = '';
    mhtml += `From: <Saved by Todo>${newline}`;
    mhtml += `Subject: ${title}${newline}`;
    mhtml += `MIME-Version: 1.0${newline}`;
    mhtml += `Content-Type: multipart/related; type="text/html"; boundary="${boundary}"${newline}${newline}`;
    mhtml += `--${boundary}${newline}`;
    mhtml += `Content-Type: text/html; charset="utf-8"${newline}`;
    mhtml += `Content-Location: file:///C:/note.html${newline}${newline}`;
    mhtml += `${htmlBody}${newline}${newline}`;
    parts.forEach(part => {
        mhtml += `--${boundary}${newline}`;
        mhtml += `Content-Type: ${part.mime}${newline}`;
        mhtml += `Content-Transfer-Encoding: base64${newline}`;
        mhtml += `Content-Location: ${part.cid}${newline}${newline}`;
        mhtml += `${part.base64}${newline}${newline}`;
    });
    mhtml += `--${boundary}--`;
    return mhtml;
};

const dataUrlToUint8Array = (dataUrl) => {
    const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
    if (!match) return null;
    const base64 = match[2];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
};

const getImageSizeFromDataUrl = (dataUrl) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
        const maxWidth = 520;
        const ratio = img.width ? (img.height / img.width) : 1;
        const width = Math.min(maxWidth, img.width || maxWidth);
        const height = Math.max(1, Math.round(width * ratio));
        resolve({ width, height });
    };
    img.onerror = () => resolve({ width: 520, height: 320 });
    img.src = dataUrl;
});

const htmlToDocx = async (html) => {
    if (!window.docx) return null;
    const { Document, Paragraph, TextRun, ImageRun } = window.docx;
    const root = document.createElement('div');
    root.innerHTML = html;

    const runsFromNode = async (node, marks = {}) => {
        if (node.nodeType === Node.TEXT_NODE) {
            if (!node.textContent) return [];
            return [new TextRun({
                text: node.textContent,
                bold: !!marks.bold,
                italics: !!marks.italics,
                underline: marks.underline ? {} : undefined
            })];
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return [];
        const tag = node.tagName.toLowerCase();
        if (tag === 'img') {
            const src = node.getAttribute('src') || '';
            const bytes = dataUrlToUint8Array(src);
            if (!bytes) return [];
            const size = await getImageSizeFromDataUrl(src);
            return [new ImageRun({
                data: bytes,
                transformation: size
            })];
        }
        const nextMarks = { ...marks };
        if (tag === 'strong' || tag === 'b') nextMarks.bold = true;
        if (tag === 'em' || tag === 'i') nextMarks.italics = true;
        if (tag === 'u') nextMarks.underline = true;
        if (tag === 'br') return [new TextRun({ break: 1 })];
        const childRuns = [];
        for (const child of Array.from(node.childNodes)) {
            const part = await runsFromNode(child, nextMarks);
            childRuns.push(...part);
        }
        return childRuns;
    };

    const paragraphs = [];
    for (const node of Array.from(root.childNodes)) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toLowerCase();
            if (tag === 'p' || tag === 'div' || tag === 'li') {
                const runs = await runsFromNode(node);
                if (runs.length > 0) {
                    const prefix = tag === 'li' ? [new TextRun({ text: '- ' })] : [];
                    paragraphs.push(new Paragraph({ children: [...prefix, ...runs] }));
                } else {
                    paragraphs.push(new Paragraph(''));
                }
                continue;
            }
        }
        const runs = await runsFromNode(node);
        if (runs.length > 0) {
            paragraphs.push(new Paragraph({ children: runs }));
        }
    }

    return new Document({
        sections: [{
            properties: {},
            children: paragraphs.length ? paragraphs : [new Paragraph('')]
        }]
    });
};

const htmlToMarkdown = (html) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    const convert = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent;
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const tag = node.tagName.toLowerCase();
        const children = Array.from(node.childNodes).map(convert).join('');
        if (tag === 'br') return '\n';
        if (tag === 'img') {
            const src = node.getAttribute('src') || '';
            const alt = node.getAttribute('alt') || 'image';
            return src ? `![${alt}](${src})` : '';
        }
        if (tag === 'strong' || tag === 'b') return `**${children}**`;
        if (tag === 'em' || tag === 'i') return `*${children}*`;
        if (tag === 'p' || tag === 'div') return `${children}\n`;
        if (tag === 'li') return `- ${children}\n`;
        return children;
    };
    return convert(root).replace(/\n{3,}/g, '\n\n').trim();
};

const formatDateTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatDateTimeLocalInput = (value) => {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    if (!value) {
        date.setDate(date.getDate() + 1);
        date.setHours(12, 0, 0, 0);
    }
    const pad = (n) => String(n).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const parseDateTimeInput = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return null;
    return normalized; // 保存为本地时间字符串，避免时区偏移
};

const parseDateTimeToMs = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!match) return null;
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const hour = parseInt(match[4], 10);
    const minute = parseInt(match[5], 10);
    const date = new Date(year, month, day, hour, minute, 0, 0);
    if (Number.isNaN(date.getTime())) return null;
    return date.getTime();
};

const logReminderEvent = (message, data = {}) => {
    if (typeof API_SAVE_URL === 'undefined') return;
    const url = API_SAVE_URL.replace(/\/api\/save$/, '/api/log');
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, data })
    }).catch(() => {});
};

const logUiEvent = (message, data = {}) => {
    logReminderEvent(`ui:${message}`, data);
};

let checkTaskReminders = () => {
    const now = Date.now();
    let hasChange = false;
    workspaces.forEach(ws => {
        Object.values(ws.projects || {}).forEach(project => {
            (project.todos || []).forEach(todo => {
                if (!todo.remindTime || todo.remindNotified) return;
                const due = typeof todo.remindAt === 'number' ? todo.remindAt : parseDateTimeToMs(todo.remindTime);
                if (typeof due !== 'number' || Number.isNaN(due)) return;
                if (due <= now) {
                    todo.remindNotified = true;
                    hasChange = true;
                    const title = todo.text || getPlainText(todo.textHtml || '');
                    showToast(`任务提醒：${title}`, 'info', 5000);
                    showCustomModal({
                        title: '任务提醒',
                        message: title || '任务到时间了',
                        okText: '知道了'
                    }).catch(() => {});
                    logReminderEvent('remind_fire', { due, now, todoId: todo.id, text: title });
                }
            });
        });
    });
    if (hasChange) {
        debouncedSave();
        renderCurrentWorkspace();
    }
};

const scheduleNextReminder = () => {
    if (reminderTimeout) {
        clearTimeout(reminderTimeout);
        reminderTimeout = null;
    }
    let nextDue = null;
    workspaces.forEach(ws => {
        Object.values(ws.projects || {}).forEach(project => {
            (project.todos || []).forEach(todo => {
                if (!todo.remindTime || todo.remindNotified) return;
                const due = typeof todo.remindAt === 'number' ? todo.remindAt : parseDateTimeToMs(todo.remindTime);
                if (typeof due !== 'number' || Number.isNaN(due)) return;
                if (nextDue === null || due < nextDue) nextDue = due;
            });
        });
    });
    if (nextDue !== null) {
        const delay = Math.max(1000, nextDue - Date.now());
        reminderTimeout = setTimeout(() => {
            checkTaskReminders();
            scheduleNextReminder();
        }, delay);
        logReminderEvent('remind_schedule', { nextDue, delay, now: Date.now() });
    }
};

const startReminderWatcher = () => {
    if (reminderTimer) clearInterval(reminderTimer);
    reminderTimer = setInterval(checkTaskReminders, 60000);
    setTimeout(checkTaskReminders, 1500);
    scheduleNextReminder();
};

function toggleAllUiPanels() {
    const shouldShow = !(
        addButtonsContainer.classList.contains('visible') &&
        workspaceControls.classList.contains('visible') &&
        isSwitcherVisible
    );

    setAddButtonsVisibility(shouldShow);
    workspaceControls.classList.toggle('visible', shouldShow);
    isSwitcherVisible = shouldShow;
    workspaceSwitcherContainer.classList.toggle('switcher-visible', isSwitcherVisible);

    localStorage.setItem('addButtonsVisible', shouldShow);
    localStorage.setItem('workspaceControlsVisible', shouldShow);
    localStorage.setItem('workspaceSwitcherVisible', isSwitcherVisible);
}

// --- CORE APPLICATION LOGIC ---
function applyProjectStyles(container, project) {
    const color = project.color || 'var(--main-color)';
    container.style.backgroundColor = color;
    const addForm = container.querySelector('.add-form');
    if (addForm) {
        addForm.style.backgroundColor = color;
    }

    // 如果是默认颜色，使用 CSS 变量自适应主题
    if (!project.color || project.color === 'var(--main-color)') {
        container.style.removeProperty('--proj-text-color');
        container.style.removeProperty('--proj-text-color-rgb');
        container.style.removeProperty('--proj-secondary-text-color');
        container.style.removeProperty('--proj-border-color');
    } else {
        const contrastColor = getContrastColor(project.color);
        const contrastColorRGB = contrastColor === '#1d1d1f' ? '29, 29, 31' : '242, 242, 247';
        container.style.setProperty('--proj-text-color-rgb', contrastColorRGB);
        container.style.setProperty('--proj-text-color', contrastColor);
        container.style.setProperty('--proj-secondary-text-color', contrastColor === '#1d1d1f' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.6)');
        container.style.setProperty('--proj-border-color', contrastColor === '#1d1d1f' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)');
    }
    
    if (project.size) {
        container.style.width = project.size.width;
        container.style.height = project.size.height;
    }
}

function makeDraggableAndResizable(element, itemData) {
    const header = element.querySelector('.project-header, .note-header, .shape-header') || element;
    const resizers = element.querySelectorAll('.resizer');
    
    let isDragging = false, isResizing = false;
    let actionStateCaptured = false;
    let initialX, initialY, offsetX, offsetY;
    let initialWidth, initialHeight, initialTop, initialLeft;
    let resizeDirection = '';
    let dragGroup = null;
    let primaryStartLeft = 0;
    let primaryStartTop = 0;

    const handleMove = (e) => {
        if (isDragging && dragGroup) {
            let newX = e.pageX / currentZoom - offsetX;
            let newY = e.pageY / currentZoom - offsetY;
            newX = Math.max(0, newX);
            newY = Math.max(0, newY);
            const dx = newX - primaryStartLeft;
            const dy = newY - primaryStartTop;

            dragGroup.forEach(({ element: el, startLeft, startTop }) => {
                el.style.left = `${Math.max(0, startLeft + dx)}px`;
                el.style.top = `${Math.max(0, startTop + dy)}px`;
            });
            
            if (currentResizableImage && element.contains(currentResizableImage)) {
                showImageResizer(currentResizableImage);
            }
            
            // 检测是否悬停在文件夹上，显示高亮
            const type = getWindowType(element);
            if (type === 'note' || type === 'project' || type === 'photo') {
                const elementsUnder = document.elementsFromPoint(e.clientX, e.clientY);
                const folderUnder = elementsUnder.find(el => 
                    el.classList.contains('folder-container') && el !== element
                );
                document.querySelectorAll('.folder-drop-target').forEach(el => {
                    if (el !== folderUnder) el.classList.remove('folder-drop-target');
                });
                if (folderUnder) {
                    folderUnder.classList.add('folder-drop-target');
                }

                // 拖动到打开的文件夹面板时高亮提示
                const panelBody = openFolderPanel?.panel?.querySelector('.folder-panel-body');
                if (panelBody) {
                    const panelUnder = elementsUnder.find(el =>
                        el.classList.contains('folder-panel') ||
                        el.classList.contains('folder-panel-body') ||
                        el.closest?.('.folder-panel')
                    );
                    panelBody.classList.toggle('drop-zone-active', !!panelUnder);
                }
            }
        }
        if (isResizing) {
            const styles = window.getComputedStyle(element);
            const minWidth = parseFloat(styles.minWidth);
            const minHeight = parseFloat(styles.minHeight);
            let dx = e.pageX / currentZoom - initialX;
            let dy = e.pageY / currentZoom - initialY;
            const isShape = element.classList.contains('shape-container');
            const isEmoji = element.classList.contains('emoji-container');
            const isPhoto = element.classList.contains('photo-container');
            const isGraphic = isShape || isEmoji || isPhoto;
            const keepRatio = (isShape || isPhoto) && (e.shiftKey || e.ctrlKey) && initialHeight !== 0;
            const ratio = keepRatio ? ((isShape && e.ctrlKey) ? 1 : (initialWidth / initialHeight)) : null;
            const centerResize = isGraphic && e.altKey;
            
            if (resizeDirection === 'bottom-right') {
                let newWidth = initialWidth + (centerResize ? dx * 2 : dx);
                let newHeight = initialHeight + (centerResize ? dy * 2 : dy);
                if (keepRatio) {
                    if (Math.abs(dx) >= Math.abs(dy)) {
                        newHeight = newWidth / ratio;
                    } else {
                        newWidth = newHeight * ratio;
                    }
                }
                newWidth = Math.max(minWidth, newWidth);
                newHeight = Math.max(minHeight, newHeight);
                element.style.width = `${newWidth}px`;
                element.style.height = `${newHeight}px`;
                if (centerResize) {
                    element.style.left = `${initialLeft + (initialWidth - newWidth) / 2}px`;
                    element.style.top = `${initialTop + (initialHeight - newHeight) / 2}px`;
                }
            } else if (resizeDirection === 'top-left') {
                let newWidth = initialWidth - (centerResize ? dx * 2 : dx);
                let newHeight = initialHeight - (centerResize ? dy * 2 : dy);
                if (keepRatio) {
                    if (Math.abs(dx) >= Math.abs(dy)) {
                        newHeight = newWidth / ratio;
                        dy = initialHeight - newHeight;
                    } else {
                        newWidth = newHeight * ratio;
                        dx = initialWidth - newWidth;
                    }
                }
                newWidth = Math.max(minWidth, newWidth);
                newHeight = Math.max(minHeight, newHeight);
                element.style.width = `${newWidth}px`;
                element.style.height = `${newHeight}px`;
                if (centerResize) {
                    element.style.left = `${initialLeft + (initialWidth - newWidth) / 2}px`;
                    element.style.top = `${initialTop + (initialHeight - newHeight) / 2}px`;
                } else {
                    element.style.left = `${initialLeft + dx}px`;
                    element.style.top = `${initialTop + dy}px`;
                }
            } else if (resizeDirection === 'top-right') {
                let newWidth = initialWidth + (centerResize ? dx * 2 : dx);
                let newHeight = initialHeight - (centerResize ? dy * 2 : dy);
                if (keepRatio) {
                    if (Math.abs(dx) >= Math.abs(dy)) {
                        newHeight = newWidth / ratio;
                        dy = initialHeight - newHeight;
                    } else {
                        newWidth = newHeight * ratio;
                    }
                }
                newWidth = Math.max(minWidth, newWidth);
                newHeight = Math.max(minHeight, newHeight);
                element.style.width = `${newWidth}px`;
                element.style.height = `${newHeight}px`;
                if (centerResize) {
                    element.style.left = `${initialLeft + (initialWidth - newWidth) / 2}px`;
                    element.style.top = `${initialTop + (initialHeight - newHeight) / 2}px`;
                } else {
                    element.style.top = `${initialTop + dy}px`;
                }
            } else if (resizeDirection === 'bottom-left') {
                let newWidth = initialWidth - (centerResize ? dx * 2 : dx);
                let newHeight = initialHeight + (centerResize ? dy * 2 : dy);
                if (keepRatio) {
                    if (Math.abs(dx) >= Math.abs(dy)) {
                        newHeight = newWidth / ratio;
                        dy = newHeight - initialHeight;
                    } else {
                        newWidth = newHeight * ratio;
                        dx = initialWidth - newWidth;
                    }
                }
                newWidth = Math.max(minWidth, newWidth);
                newHeight = Math.max(minHeight, newHeight);
                element.style.width = `${newWidth}px`;
                element.style.height = `${newHeight}px`;
                if (centerResize) {
                    element.style.left = `${initialLeft + (initialWidth - newWidth) / 2}px`;
                    element.style.top = `${initialTop + (initialHeight - newHeight) / 2}px`;
                } else {
                    element.style.left = `${initialLeft + dx}px`;
                }
            }
            if (isShape) {
                updateShapeTextSize(element);
            }
            if (isEmoji) {
                updateEmojiSize(element);
            }
        }
    };

    const handleMouseUp = (e) => {
        let stateChanged = false;
        let droppedToFolder = false;
        
        if (isDragging) {
            isDragging = false;
            isWindowDragActive = false;
            
            // 检查是否拖放到文件夹上
            const elementsUnder = document.elementsFromPoint(e.clientX, e.clientY);
            const panelUnder = openFolderPanel
                ? elementsUnder.find(el => el.classList.contains('folder-panel') || el.classList.contains('folder-panel-body') || el.closest?.('.folder-panel'))
                : null;
            const folderUnder = elementsUnder.find(el => 
                el.classList.contains('folder-container') && el !== element
            );
            
            // 清除所有文件夹的高亮
            document.querySelectorAll('.folder-drop-target').forEach(el => 
                el.classList.remove('folder-drop-target')
            );
            const panelBody = openFolderPanel?.panel?.querySelector('.folder-panel-body');
            if (panelBody) panelBody.classList.remove('drop-zone-active');
            
            // 如果拖放到打开的文件夹面板上
            if (panelUnder && openFolderPanel) {
                const folderId = openFolderPanel.folder?.id;
                if (folderId) {
                    const targets = dragGroup ? dragGroup.map(item => item.element) : [element];
                    let addedAny = false;
                    targets.forEach(el => {
                        const type = getWindowType(el);
                        let id = null;
                        if (type === 'note') id = el.dataset.noteId;
                        else if (type === 'project') id = el.dataset.projectId;
                        else if (type === 'photo') id = el.dataset.photoId;
                        if (id && (type === 'note' || type === 'project' || type === 'photo')) {
                            addedAny = addItemToFolder(folderId, type, id) || addedAny;
                        }
                    });
                    if (addedAny) {
                        droppedToFolder = true;
                    }
                }
            }

            // 如果拖放到文件夹图标上
            const type = getWindowType(element);
            if (!droppedToFolder && folderUnder && (type === 'note' || type === 'project' || type === 'photo')) {
                droppedToFolder = handleWindowDropToFolder(element, folderUnder);
            }

            if (droppedToFolder && dragGroup) {
                // 恢复原位置（因为元素将被隐藏/移除）
                dragGroup.forEach(({ element: el, startLeft, startTop }) => {
                    el.style.left = `${startLeft}px`;
                    el.style.top = `${startTop}px`;
                });
            }
            
            if (!droppedToFolder) {
                if (dragGroup) {
                    dragGroup.forEach(({ element: el, data }) => {
                        el.classList.remove('dragging');
                        if (!data || !data.position) return;
                        if (data.position.top !== el.style.top || data.position.left !== el.style.left) {
                            data.position = { top: el.style.top, left: el.style.left };
                            stateChanged = true;
                        }
                    });
                } else {
                    element.classList.remove('dragging');
                    if (itemData.position.top !== element.style.top || itemData.position.left !== element.style.left) {
                        itemData.position = { top: element.style.top, left: element.style.left };
                        stateChanged = true;
                    }
                }
            }
        }
        if (isResizing) {
            isResizing = false;
            isWindowDragActive = false;
            if (itemData.size.width !== element.style.width || itemData.size.height !== element.style.height || 
                (resizeDirection === 'top-left' && (itemData.position.top !== element.style.top || itemData.position.left !== element.style.left))) {
                
                itemData.size = { width: element.style.width, height: element.style.height };
                itemData.position = { top: element.style.top, left: element.style.left };
                stateChanged = true;
            }
        }
        if (stateChanged) {
            if (!actionStateCaptured) {
                recordState();
            }
            debouncedSave();
            debouncedUpdateBodySize();
            logUiEvent('window_move_end', {
                type: getWindowType(element),
                id: element.dataset.projectId || element.dataset.noteId || element.dataset.shapeId || element.dataset.emojiId || element.dataset.photoId,
                left: element.style.left,
                top: element.style.top,
                width: element.style.width,
                height: element.style.height,
                undoStack: undoStack.length,
                redoStack: redoStack.length
            });
        }
        actionStateCaptured = false;
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleMouseUp);
        dragGroup = null;
    };

    const startDrag = (e) => {
        if (e.target.classList.contains('resizer') || e.target.isContentEditable || e.target.closest('button, input')) return;
        if (e.ctrlKey || e.shiftKey) return;
        isDragging = true;
        isWindowDragActive = true;
        if (!actionStateCaptured) {
            allowSameStateOnce = true;
            recordState();
            actionStateCaptured = true;
            logUiEvent('window_move_start', {
                type: getWindowType(element),
                id: element.dataset.projectId || element.dataset.noteId || element.dataset.shapeId || element.dataset.emojiId || element.dataset.photoId,
                left: element.style.left,
                top: element.style.top,
                undoStack: undoStack.length,
                redoStack: redoStack.length
            });
        }

        if (!selectedWindows.has(element)) {
            clearWindowSelection();
            selectWindowWithGroup(element);
        } else {
            expandSelectionByGroups();
        }

        const targets = Array.from(selectedWindows).filter(el => {
            if (!el.isConnected) {
                selectedWindows.delete(el);
                return false;
            }
            return true;
        });
        dragGroup = targets.map(el => ({
            element: el,
            startLeft: el.offsetLeft,
            startTop: el.offsetTop,
            data: getWindowDataByElement(el)
        }));
        primaryStartLeft = element.offsetLeft;
        primaryStartTop = element.offsetTop;

        offsetX = e.pageX / currentZoom - element.offsetLeft;
        offsetY = e.pageY / currentZoom - element.offsetTop;
        dragGroup.forEach(({ element: el }) => el.classList.add('dragging'));
        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const startResize = (e) => {
        e.preventDefault();
        const resizer = e.target;
        isResizing = true;
        isWindowDragActive = true;
        if (!actionStateCaptured) {
            allowSameStateOnce = true;
            recordState();
            actionStateCaptured = true;
            logUiEvent('window_resize_start', {
                type: getWindowType(element),
                id: element.dataset.projectId || element.dataset.noteId || element.dataset.shapeId || element.dataset.emojiId || element.dataset.photoId,
                width: element.style.width,
                height: element.style.height,
                undoStack: undoStack.length,
                redoStack: redoStack.length
            });
        }
        resizeDirection = resizer.dataset.direction;
        initialX = e.pageX / currentZoom;
        initialY = e.pageY / currentZoom;
        initialWidth = element.offsetWidth;
        initialHeight = element.offsetHeight;
        initialLeft = element.offsetLeft;
        initialTop = element.offsetTop;
        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleMouseUp);
    };
    
    header.addEventListener('mousedown', startDrag);

    resizers.forEach(resizer => {
        resizer.addEventListener('mousedown', startResize);
    });
}

// static/script.js

function applyShapeTypeClass(shapeBody, type) {
    SHAPE_TYPES.forEach(t => shapeBody.classList.remove(`shape-${t.id}`));
    shapeBody.classList.add(`shape-${type}`);
    shapeBody.dataset.shapeType = type;
}

function createEmojiPane(emoji) {
    const emojiTemplate = document.getElementById('emoji-template');
    if (!emojiTemplate) return null;
    const node = emojiTemplate.content.cloneNode(true);
    const container = node.querySelector('.emoji-container');
    const emojiBody = node.querySelector('.emoji-body');

    emoji.symbol ||= '😀';

    container.dataset.emojiId = emoji.id;
    container.style.top = emoji.position.top;
    container.style.left = emoji.position.left;
    container.style.width = emoji.size.width;
    container.style.height = emoji.size.height;
    emojiBody.textContent = emoji.symbol;
    updateEmojiSize(container);

    const editEmoji = () => {
        openEmojiPicker({
            mode: 'edit',
            target: emoji,
            onSelect: (symbol) => {
                recordState();
                emoji.symbol = symbol;
                emojiBody.textContent = emoji.symbol;
                debouncedSave();
            }
        });
    };

    const deleteEmojiAction = () => {
        recordState();
        delete workspaces[currentWorkspaceIndex].emojis[emoji.id];
        debouncedSave();
        container.classList.add('fade-out-emoji');
        setTimeout(() => container.remove(), 300);
    };

    container.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (!selectedWindows.has(container)) {
            clearWindowSelection();
            selectWindowWithGroup(container);
        } else {
            expandSelectionByGroups();
        }
        closeAllDropdowns();
        const menu = document.createElement('div');
        menu.className = 'custom-dropdown-menu';
        const groupMenuHTML = buildGroupMenuHTML();
        const layerMenuHTML = `
            <div class="dropdown-divider"></div>
            <div class="dropdown-option" data-action="layerUp">上移一级 (Ctrl+])</div>
            <div class="dropdown-option" data-action="layerDown">下移一级 (Ctrl+[)</div>
            <div class="dropdown-option" data-action="layerTop">显示到顶部 (Ctrl+Shift+])</div>
            <div class="dropdown-option" data-action="layerBottom">显示到底层 (Ctrl+Shift+[)</div>
        `;
        menu.innerHTML = `<div class="dropdown-option" data-action="edit">编辑表情</div>${groupMenuHTML}${layerMenuHTML}<div class="dropdown-divider"></div><div class="dropdown-option danger" data-action="delete">删除表情</div>`;
        positionContextMenu(menu, e);
        menu.addEventListener('click', me => {
            const action = me.target.dataset.action;
            if (action === 'edit') {
                closeAllDropdowns();
                editEmoji();
            } else if (action === 'delete') {
                closeAllDropdowns();
                if (selectedWindows.size > 1 && selectedWindows.has(container)) {
                    deleteSelectedWindows();
                } else {
                    deleteEmojiAction();
                }
            } else if (action === 'group') {
                closeAllDropdowns();
                applyGroupToSelection();
            } else if (action === 'ungroup') {
                closeAllDropdowns();
                ungroupSelection();
            } else if (action === 'layerUp') {
                closeAllDropdowns();
                const hasShape = Array.from(selectedWindows).some(el => el.classList.contains('shape-container'));
                const hasPhoto = Array.from(selectedWindows).some(el => el.classList.contains('photo-container'));
                moveSelectionInLayer(hasShape || hasPhoto ? 'all' : 'emoji', 'up');
            } else if (action === 'layerDown') {
                closeAllDropdowns();
                const hasShape = Array.from(selectedWindows).some(el => el.classList.contains('shape-container'));
                const hasPhoto = Array.from(selectedWindows).some(el => el.classList.contains('photo-container'));
                moveSelectionInLayer(hasShape || hasPhoto ? 'all' : 'emoji', 'down');
            } else if (action === 'layerTop') {
                closeAllDropdowns();
                const hasShape = Array.from(selectedWindows).some(el => el.classList.contains('shape-container'));
                const hasPhoto = Array.from(selectedWindows).some(el => el.classList.contains('photo-container'));
                moveSelectionInLayer(hasShape || hasPhoto ? 'all' : 'emoji', 'top');
            } else if (action === 'layerBottom') {
                closeAllDropdowns();
                const hasShape = Array.from(selectedWindows).some(el => el.classList.contains('shape-container'));
                const hasPhoto = Array.from(selectedWindows).some(el => el.classList.contains('photo-container'));
                moveSelectionInLayer(hasShape || hasPhoto ? 'all' : 'emoji', 'bottom');
            }
        });
    });

    if (!emoji.zIndex || emoji.zIndex < EMOJI_Z_INDEX_BASE) {
        emoji.zIndex = SHAPE_Z_INDEX_BASE - 1;
    }
    container.style.zIndex = emoji.zIndex;

    appContainer.appendChild(node);
    makeDraggableAndResizable(container, emoji);
    updateEmojiSize(container);
    return container;
}

function createPhotoPane(photo) {
    const photoTemplate = document.getElementById('photo-template');
    if (!photoTemplate) return null;
    const node = photoTemplate.content.cloneNode(true);
    const container = node.querySelector('.photo-container');
    const photoBody = node.querySelector('.photo-body');

    photo.src ||= '';

    container.dataset.photoId = photo.id;
    container.style.top = photo.position.top;
    container.style.left = photo.position.left;
    container.style.width = photo.size.width;
    container.style.height = photo.size.height;
    photoBody.src = photo.src;

    const deletePhotoAction = () => {
        recordState();
        delete workspaces[currentWorkspaceIndex].photos[photo.id];
        debouncedSave();
        container.classList.add('fade-out-photo');
        setTimeout(() => container.remove(), 300);
    };

    container.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (!selectedWindows.has(container)) {
            clearWindowSelection();
            selectWindowWithGroup(container);
        } else {
            expandSelectionByGroups();
        }
        closeAllDropdowns();
        const menu = document.createElement('div');
        menu.className = 'custom-dropdown-menu';
        const groupMenuHTML = buildGroupMenuHTML();
        const folderMenuHTML = buildFolderMenuOptions(photo.id, 'photo');
        const layerMenuHTML = `
            <div class="dropdown-divider"></div>
            <div class="dropdown-option" data-action="layerUp">上移一级 (Ctrl+])</div>
            <div class="dropdown-option" data-action="layerDown">下移一级 (Ctrl+[)</div>
            <div class="dropdown-option" data-action="layerTop">显示到顶部 (Ctrl+Shift+])</div>
            <div class="dropdown-option" data-action="layerBottom">显示到底层 (Ctrl+Shift+[)</div>
        `;
        menu.innerHTML = `<div class="dropdown-option" data-action="crop">裁剪图片</div>${folderMenuHTML}${groupMenuHTML}${layerMenuHTML}<div class="dropdown-divider"></div><div class="dropdown-option danger" data-action="delete">删除图片</div>`;
        positionContextMenu(menu, e);
        menu.addEventListener('click', me => {
            const action = me.target.dataset.action;
            if (action === 'crop') {
                closeAllDropdowns();
                openPhotoCropper(photo, container);
            } else if (action === 'delete') {
                closeAllDropdowns();
                if (selectedWindows.size > 1 && selectedWindows.has(container)) {
                    deleteSelectedWindows();
                } else {
                    deletePhotoAction();
                }
            } else if (action === 'addToFolder') {
                closeAllDropdowns();
                const folderId = me.target.dataset.folderId;
                if (folderId) {
                    const currentWorkspace = workspaces[currentWorkspaceIndex];
                    const folder = currentWorkspace.folders?.[folderId];
                    if (folder) {
                        const existingIndex = folder.items.findIndex(item => item.id === photo.id && item.type === 'photo');
                        if (existingIndex >= 0) {
                            recordState();
                            folder.items.splice(existingIndex, 1);
                            delete photo.folderId;
                            updateFolderBadge(folderId);
                            debouncedSave();
                            showToast(`已从 "${folder.name}" 中移出`, 'success');
                        } else {
                            addItemToFolder(folderId, 'photo', photo.id);
                            showToast(`已添加到 "${folder.name}"`, 'success');
                        }
                    }
                }
            } else if (action === 'group') {
                closeAllDropdowns();
                applyGroupToSelection();
            } else if (action === 'ungroup') {
                closeAllDropdowns();
                ungroupSelection();
            } else if (action && action.startsWith('layer')) {
                closeAllDropdowns();
                const hasGraphics = Array.from(selectedWindows).some(el => el.classList.contains('shape-container') || el.classList.contains('emoji-container') || el.classList.contains('photo-container'));
                const actionMap = { layerUp: 'up', layerDown: 'down', layerTop: 'top', layerBottom: 'bottom' };
                const moveAction = actionMap[action];
                moveSelectionInLayer(hasGraphics ? 'all' : 'photo', moveAction);
            }
        });
    });

    if (!photo.zIndex || photo.zIndex < PHOTO_Z_INDEX_BASE) {
        photo.zIndex = SHAPE_Z_INDEX_BASE - 1;
    }
    container.style.zIndex = photo.zIndex;

    appContainer.appendChild(node);
    makeDraggableAndResizable(container, photo);
    return container;
}

function createShapePane(shape) {
    const shapeTemplate = document.getElementById('shape-template');
    if (!shapeTemplate) return null;
    const node = shapeTemplate.content.cloneNode(true);
    const container = node.querySelector('.shape-container');
    const shapeBody = node.querySelector('.shape-body');
    const shapeText = node.querySelector('.shape-text');
    const shapeTextInner = node.querySelector('.shape-text-inner');

    shape.type ||= 'rect';
    shape.color ||= '#4f46e5';
    shape.text ??= '';
    shape.isBold ??= false;

    container.dataset.shapeId = shape.id;
    container.style.top = shape.position.top;
    container.style.left = shape.position.left;
    container.style.width = shape.size.width;
    container.style.height = shape.size.height;
    container.style.setProperty('--shape-color', shape.color);
    applyShapeTypeClass(shapeBody, shape.type);
    shapeTextInner.textContent = shape.text;
    shapeText.classList.toggle('is-bold', shape.isBold);
    updateShapeTextSize(container);

    const deleteShapeAction = () => {
        recordState();
        delete workspaces[currentWorkspaceIndex].shapes[shape.id];
        debouncedSave();
        container.classList.add('fade-out-shape');
        setTimeout(() => container.remove(), 300);
    };

    const openColorPicker = () => {
        const tempColorInput = document.createElement('input');
        tempColorInput.type = 'color';
        tempColorInput.style.position = 'absolute';
        tempColorInput.style.opacity = '0';
        tempColorInput.value = shape.color || '#4f46e5';
        document.body.appendChild(tempColorInput);
        tempColorInput.addEventListener('input', () => {
            shape.color = tempColorInput.value;
            container.style.setProperty('--shape-color', shape.color);
            debouncedSave();
        });
        tempColorInput.addEventListener('blur', () => {
            recordState();
            tempColorInput.remove();
        }, { once: true });
        tempColorInput.click();
    };

    const changeShapeType = (type) => {
        if (!type || shape.type === type) return;
        recordState();
        shape.type = type;
        applyShapeTypeClass(shapeBody, type);
        debouncedSave();
    };

    const enterTextEdit = () => {
        shapeTextInner.contentEditable = 'true';
        shapeText.classList.add('is-editing');
        shapeTextInner.focus();
        document.execCommand('selectAll', false, null);
    };

    const exitTextEdit = () => {
        if (shapeTextInner.contentEditable === 'true') {
            shapeTextInner.contentEditable = 'false';
            shapeText.classList.remove('is-editing');
            const newText = shapeTextInner.textContent || '';
            if (shape.text !== newText) {
                recordState();
                shape.text = newText;
                debouncedSave();
            }
        }
    };

    shapeTextInner.addEventListener('blur', exitTextEdit);
    shapeTextInner.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            shapeTextInner.blur();
        }
    });

    container.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (!selectedWindows.has(container)) {
            clearWindowSelection();
            selectWindowWithGroup(container);
        } else {
            expandSelectionByGroups();
        }
        closeAllDropdowns();
        const menu = document.createElement('div');
        menu.className = 'custom-dropdown-menu';
        const typeOptions = SHAPE_TYPES.map(t => 
            `<div class="dropdown-option ${shape.type === t.id ? 'selected' : ''}" data-action="type" data-shape="${t.id}">${t.label}</div>`
        ).join('');
        const boldLabel = shape.isBold ? '取消加粗' : '加粗';
        const groupMenuHTML = buildGroupMenuHTML();
        const layerMenuHTML = `
            <div class="dropdown-divider"></div>
            <div class="dropdown-option" data-action="layerUp">上移一级 (Ctrl+])</div>
            <div class="dropdown-option" data-action="layerDown">下移一级 (Ctrl+[)</div>
            <div class="dropdown-option" data-action="layerTop">显示到顶部 (Ctrl+Shift+])</div>
            <div class="dropdown-option" data-action="layerBottom">显示到底层 (Ctrl+Shift+[)</div>
        `;
        menu.innerHTML = `<div class="dropdown-option" data-action="editText">编辑文本</div><div class="dropdown-option" data-action="toggleBold">${boldLabel}</div><div class="dropdown-divider"></div><div class="dropdown-option" data-action="color">更改颜色</div><div class="dropdown-divider"></div>${typeOptions}${groupMenuHTML}${layerMenuHTML}<div class="dropdown-divider"></div><div class="dropdown-option danger" data-action="delete">删除形状</div>`;
        positionContextMenu(menu, e);
        menu.addEventListener('click', me => {
            const action = me.target.dataset.action;
            if (action === 'editText') {
                closeAllDropdowns();
                enterTextEdit();
            } else if (action === 'toggleBold') {
                closeAllDropdowns();
                recordState();
                shape.isBold = !shape.isBold;
                shapeText.classList.toggle('is-bold', shape.isBold);
                debouncedSave();
            } else if (action === 'color') {
                closeAllDropdowns();
                openColorPicker();
            } else if (action === 'type') {
                closeAllDropdowns();
                changeShapeType(me.target.dataset.shape);
            } else if (action === 'delete') {
                closeAllDropdowns();
                if (selectedWindows.size > 1 && selectedWindows.has(container)) {
                    deleteSelectedWindows();
                } else {
                    deleteShapeAction();
                }
            } else if (action === 'group') {
                closeAllDropdowns();
                applyGroupToSelection();
            } else if (action === 'ungroup') {
                closeAllDropdowns();
                ungroupSelection();
            } else if (action === 'layerUp') {
                closeAllDropdowns();
                const hasEmoji = Array.from(selectedWindows).some(el => el.classList.contains('emoji-container'));
                const hasPhoto = Array.from(selectedWindows).some(el => el.classList.contains('photo-container'));
                moveSelectionInLayer(hasEmoji || hasPhoto ? 'all' : 'shape', 'up');
            } else if (action === 'layerDown') {
                closeAllDropdowns();
                const hasEmoji = Array.from(selectedWindows).some(el => el.classList.contains('emoji-container'));
                const hasPhoto = Array.from(selectedWindows).some(el => el.classList.contains('photo-container'));
                moveSelectionInLayer(hasEmoji || hasPhoto ? 'all' : 'shape', 'down');
            } else if (action === 'layerTop') {
                closeAllDropdowns();
                const hasEmoji = Array.from(selectedWindows).some(el => el.classList.contains('emoji-container'));
                const hasPhoto = Array.from(selectedWindows).some(el => el.classList.contains('photo-container'));
                moveSelectionInLayer(hasEmoji || hasPhoto ? 'all' : 'shape', 'top');
            } else if (action === 'layerBottom') {
                closeAllDropdowns();
                const hasEmoji = Array.from(selectedWindows).some(el => el.classList.contains('emoji-container'));
                const hasPhoto = Array.from(selectedWindows).some(el => el.classList.contains('photo-container'));
                moveSelectionInLayer(hasEmoji || hasPhoto ? 'all' : 'shape', 'bottom');
            }
        });
    });

    if (!shape.zIndex || shape.zIndex < SHAPE_Z_INDEX_BASE) {
        shape.zIndex = SHAPE_Z_INDEX_BASE - 1;
    }
    container.style.zIndex = shape.zIndex;

    appContainer.appendChild(node);
    makeDraggableAndResizable(container, shape);
    updateShapeTextSize(container);
    return container;
}

// ==================== 文件夹功能 ====================
function buildFolderMenuOptions(excludeItemId = null, itemType = null) {
    const currentWorkspace = workspaces[currentWorkspaceIndex];
    if (!currentWorkspace || !currentWorkspace.folders) return '';
    const folders = Object.values(currentWorkspace.folders);
    if (folders.length === 0) return '';
    
    let html = '<div class="dropdown-divider"></div>';
    folders.forEach(folder => {
        // 检查项目是否已在此文件夹中
        const isInFolder = excludeItemId && folder.items.some(item => 
            item.id === excludeItemId && item.type === itemType
        );
        html += `<div class="dropdown-option ${isInFolder ? 'selected' : ''}" data-action="addToFolder" data-folder-id="${folder.id}">
            <span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${folder.color};margin-right:6px;"></span>
            ${isInFolder ? '已在' : '移到'} ${escapeHTML(folder.name)}
        </div>`;
    });
    return html;
}

function createFolderPane(folder) {
    const folderTemplate = document.getElementById('folder-template');
    if (!folderTemplate) return null;
    const node = folderTemplate.content.cloneNode(true);
    const container = node.querySelector('.folder-container');
    const folderIcon = node.querySelector('.folder-icon');
    const folderDefaultIcon = node.querySelector('.folder-default-icon');
    const folderEmojiIcon = node.querySelector('.folder-emoji-icon');
    const folderName = node.querySelector('.folder-name');
    const folderBadge = node.querySelector('.folder-badge');
    const appContainer = document.getElementById('app-container');

    folder.name ||= '新文件夹';
    folder.color ||= '#5ac8fa';
    folder.items ||= []; // 存储 { type: 'note'|'project'|'photo', id: string }

    container.dataset.folderId = folder.id;
    container.style.top = folder.position.top;
    container.style.left = folder.position.left;
    container.style.setProperty('--folder-color', folder.color);
    folderName.textContent = folder.name;
    folderBadge.textContent = folder.items.length;
    folderBadge.dataset.count = folder.items.length;

    // 更新文件夹图标显示
    const updateFolderIcon = () => {
        if (folder.icon) {
            folderEmojiIcon.textContent = folder.icon;
            folderEmojiIcon.style.display = 'flex';
            folderDefaultIcon.style.display = 'none';
        } else {
            folderEmojiIcon.style.display = 'none';
            folderDefaultIcon.style.display = 'flex';
        }
    };
    updateFolderIcon();

    // 双击打开/关闭文件夹面板
    container.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (openFolderPanel && openFolderPanel.folder?.id === folder.id) {
            closeFolderPanel();
        } else {
            openFolderPanelUI(folder, container);
        }
    });

    // 右键菜单
    container.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selectedWindows.has(container)) {
            clearWindowSelection();
            selectWindowWithGroup(container);
        } else {
            expandSelectionByGroups();
        }
        closeAllDropdowns();
        const menu = document.createElement('div');
        menu.className = 'custom-dropdown-menu';
        const groupMenuHTML = buildGroupMenuHTML();
        menu.innerHTML = `
            <div class="dropdown-option" data-action="open">打开文件夹</div>
            <div class="dropdown-option" data-action="rename">重命名</div>
            <div class="dropdown-option" data-action="icon">修改图标</div>
            <div class="dropdown-option" data-action="color">更改颜色</div>
            ${groupMenuHTML}
            <div class="dropdown-divider"></div>
            <div class="dropdown-option danger" data-action="delete">删除文件夹</div>
        `;
        positionContextMenu(menu, e);
        menu.addEventListener('click', (me) => {
            const action = me.target.dataset.action;
            if (action === 'open') {
                closeAllDropdowns();
                openFolderPanelUI(folder, container);
            } else if (action === 'rename') {
                closeAllDropdowns();
                enterFolderNameEdit();
            } else if (action === 'icon') {
                closeAllDropdowns();
                openFolderIconPicker();
            } else if (action === 'color') {
                closeAllDropdowns();
                openFolderColorPicker();
            } else if (action === 'delete') {
                closeAllDropdowns();
                if (selectedWindows.size > 1 && selectedWindows.has(container)) {
                    deleteSelectedWindows();
                } else {
                    deleteFolderAction();
                }
            } else if (action === 'group') {
                closeAllDropdowns();
                applyGroupToSelection();
            } else if (action === 'ungroup') {
                closeAllDropdowns();
                ungroupSelection();
            }
        });
    });

    const enterFolderNameEdit = () => {
        folderName.contentEditable = 'true';
        folderName.focus();
        document.execCommand('selectAll', false, null);
        const exitEdit = () => {
            folderName.contentEditable = 'false';
            const newName = folderName.textContent.trim() || '未命名文件夹';
            if (folder.name !== newName) {
                recordState();
                folder.name = newName;
                debouncedSave();
            } else {
                folderName.textContent = folder.name;
            }
        };
        folderName.addEventListener('blur', exitEdit, { once: true });
        folderName.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                folderName.blur();
            }
        });
    };

    const openFolderColorPicker = () => {
        const tempColorInput = document.createElement('input');
        tempColorInput.type = 'color';
        tempColorInput.style.position = 'absolute';
        tempColorInput.style.opacity = '0';
        tempColorInput.value = folder.color || '#5ac8fa';
        document.body.appendChild(tempColorInput);
        tempColorInput.addEventListener('input', () => {
            folder.color = tempColorInput.value;
            container.style.setProperty('--folder-color', folder.color);
            debouncedSave();
        });
        tempColorInput.addEventListener('blur', () => {
            recordState();
            tempColorInput.remove();
        }, { once: true });
        tempColorInput.click();
    };

    const openFolderIconPicker = () => {
        // 预选中当前的 emoji（如果有）
        if (folder.icon) {
            emojiPickerState.selected = [folder.icon];
        } else {
            emojiPickerState.selected = [];
        }
        
        openEmojiPicker({
            mode: 'edit',
            target: folder,
            onSelect: (emoji) => {
                recordState();
                // 如果选中了 emoji，使用第一个；如果没有选中，清空图标
                folder.icon = emoji || null;
                updateFolderIcon();
                debouncedSave();
            }
        });
    };

    const deleteFolderAction = () => {
        showCustomModal({
            type: 'confirm',
            title: '删除文件夹',
            message: folder.items.length > 0 
                ? `文件夹 "${folder.name}" 包含 ${folder.items.length} 个项目。删除后，这些项目将被释放到工作区。确定要删除吗？`
                : `确定要删除文件夹 "${folder.name}" 吗？`
        }).then(() => {
            recordState();
            // 释放文件夹中的项目到工作区
            const currentWorkspace = workspaces[currentWorkspaceIndex];
            folder.items.forEach(item => {
                const data = getFolderItemData(item.type, item.id);
                if (data) {
                    // 移除 folderId 标记
                    delete data.folderId;
                }
            });
            delete currentWorkspace.folders[folder.id];
            debouncedSave();
            container.classList.add('fade-out-folder');
            setTimeout(() => {
                container.remove();
                // 重新渲染工作区以显示释放的项目
                renderCurrentWorkspace();
            }, 300);
        }).catch(() => {});
    };

    // 拖放到文件夹的处理
    container.addEventListener('dragover', (e) => {
        if (draggedTaskInfo || !e.dataTransfer.types.includes('application/x-folder-item')) {
            // 只接受窗口拖拽，不接受任务拖拽
            if (document.querySelector('.dragging:not(.folder-container)')) {
                e.preventDefault();
                container.classList.add('folder-drop-target');
            }
        }
    });

    container.addEventListener('dragleave', () => {
        container.classList.remove('folder-drop-target');
    });

    container.addEventListener('drop', (e) => {
        container.classList.remove('folder-drop-target');
        // 拖入处理在全局 drop 事件中
    });

    if (!folder.zIndex || folder.zIndex < FOLDER_Z_INDEX_BASE) {
        folder.zIndex = FOLDER_Z_INDEX_BASE;
    }
    container.style.zIndex = folder.zIndex;

    appContainer.appendChild(node);
    makeFolderDraggable(container, folder);
    return container;
}

function makeFolderDraggable(container, folder) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    let actionStateCaptured = false;

    const onMouseDown = (e) => {
        if (e.target.contentEditable === 'true') return;
        if (e.button !== 0) return;
        if (e.ctrlKey || e.shiftKey) return;
        
        e.preventDefault();
        isDragging = true;
        actionStateCaptured = false;
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = parseFloat(container.style.left) || 0;
        initialTop = parseFloat(container.style.top) || 0;
        
        container.classList.add('dragging');
        isWindowDragActive = true;

        // 处理多选拖动
        if (!e.ctrlKey && !e.shiftKey && !selectedWindows.has(container)) {
            clearWindowSelection();
        }
        if (e.ctrlKey || e.shiftKey) {
            toggleWindowSelection(container);
        } else if (!selectedWindows.has(container)) {
            selectWindowWithGroup(container);
        }
        expandSelectionByGroups();

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
        if (!isDragging) return;
        
        const dx = (e.clientX - startX) / currentZoom;
        const dy = (e.clientY - startY) / currentZoom;

        if (!actionStateCaptured && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
            recordState();
            actionStateCaptured = true;
        }

        if (selectedWindows.size > 1 && selectedWindows.has(container)) {
            selectedWindows.forEach(el => {
                const data = getWindowDataByElement(el);
                if (data && data.position) {
                    const origLeft = parseFloat(el.dataset.origLeft || el.style.left) || 0;
                    const origTop = parseFloat(el.dataset.origTop || el.style.top) || 0;
                    if (!el.dataset.origLeft) {
                        el.dataset.origLeft = origLeft;
                        el.dataset.origTop = origTop;
                    }
                    el.style.left = `${origLeft + dx}px`;
                    el.style.top = `${origTop + dy}px`;
                }
            });
        } else {
            container.style.left = `${initialLeft + dx}px`;
            container.style.top = `${initialTop + dy}px`;
        }
    };

    const onMouseUp = (e) => {
        isDragging = false;
        isWindowDragActive = false;
        container.classList.remove('dragging');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        // 清除原始位置缓存
        selectedWindows.forEach(el => {
            delete el.dataset.origLeft;
            delete el.dataset.origTop;
            const data = getWindowDataByElement(el);
            if (data && data.position) {
                data.position.left = el.style.left;
                data.position.top = el.style.top;
            }
        });

        folder.position.left = container.style.left;
        folder.position.top = container.style.top;
        debouncedSave();
    };

    container.addEventListener('mousedown', onMouseDown);
}

function getFolderItemData(type, id) {
    const currentWorkspace = workspaces[currentWorkspaceIndex];
    if (!currentWorkspace) return null;
    if (type === 'note' && currentWorkspace.notes) return currentWorkspace.notes[id];
    if (type === 'project' && currentWorkspace.projects) return currentWorkspace.projects[id];
    if (type === 'photo' && currentWorkspace.photos) return currentWorkspace.photos[id];
    return null;
}

function updateFolderBadge(folderId) {
    const currentWorkspace = workspaces[currentWorkspaceIndex];
    if (!currentWorkspace || !currentWorkspace.folders) return;
    const folder = currentWorkspace.folders[folderId];
    if (!folder) return;
    const container = document.querySelector(`[data-folder-id="${folderId}"]`);
    if (!container) return;
    const badge = container.querySelector('.folder-badge');
    if (badge) {
        badge.textContent = folder.items.length;
        badge.dataset.count = folder.items.length;
    }
}

function openFolderPanelUI(folder, folderContainer) {
    // 关闭已打开的面板
    if (openFolderPanel) {
        closeFolderPanel();
    }

    const panelTemplate = document.getElementById('folder-panel-template');
    if (!panelTemplate) return;
    
    const node = panelTemplate.content.cloneNode(true);
    const panel = node.querySelector('.folder-panel');
    const titleText = node.querySelector('.folder-panel-title-text');
    const defaultIcon = node.querySelector('.folder-panel-default-icon');
    const emojiIcon = node.querySelector('.folder-panel-emoji-icon');
    const closeBtn = node.querySelector('.folder-panel-close');
    const body = node.querySelector('.folder-panel-body');

    titleText.textContent = folder.name;
    panel.style.setProperty('--folder-color', folder.color);
    panel.dataset.folderId = folder.id;

    // 设置文件夹图标
    if (folder.icon) {
        emojiIcon.textContent = folder.icon;
        emojiIcon.style.display = 'inline';
        defaultIcon.style.display = 'none';
    }

    // 定位面板
    const containerRect = folderContainer.getBoundingClientRect();
    let panelLeft = containerRect.right + 10;
    let panelTop = containerRect.top;
    
    // 确保面板不超出屏幕
    if (panelLeft + 420 > window.innerWidth) {
        panelLeft = containerRect.left - 430;
    }
    if (panelLeft < 10) panelLeft = 10;
    if (panelTop + 400 > window.innerHeight) {
        panelTop = window.innerHeight - 410;
    }
    if (panelTop < 10) panelTop = 10;
    
    panel.style.left = `${panelLeft}px`;
    panel.style.top = `${panelTop}px`;

    // 渲染文件夹内容
    renderFolderPanelItems(body, folder);

    // 关闭按钮
    closeBtn.addEventListener('click', closeFolderPanel);

    // 拖拽面板标题移动
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    const header = panel.querySelector('.folder-panel-header');
    header.addEventListener('mousedown', (e) => {
        if (e.target === closeBtn) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = parseFloat(panel.style.left) || 0;
        initialTop = parseFloat(panel.style.top) || 0;
        
        const onMove = (me) => {
            if (!isDragging) return;
            panel.style.left = `${initialLeft + me.clientX - startX}px`;
            panel.style.top = `${initialTop + me.clientY - startY}px`;
        };
        const onUp = () => {
            isDragging = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // 拖放到面板
    body.addEventListener('dragover', (e) => {
        e.preventDefault();
        body.classList.add('drop-zone-active');
    });

    body.addEventListener('dragleave', (e) => {
        if (!body.contains(e.relatedTarget)) {
            body.classList.remove('drop-zone-active');
        }
    });

    body.addEventListener('drop', (e) => {
        e.preventDefault();
        body.classList.remove('drop-zone-active');
        // 全局 drop 处理器会处理添加逻辑
    });

    panel.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });

    document.body.appendChild(panel);
    openFolderPanel = { panel, folder, folderContainer };
}

function closeFolderPanel() {
    if (!openFolderPanel) return;
    const { panel } = openFolderPanel;
    panel.classList.add('closing');
    setTimeout(() => {
        panel.remove();
    }, 200);
    openFolderPanel = null;
}

function renderFolderPanelItems(body, folder) {
    body.innerHTML = '';
    const currentWorkspace = workspaces[currentWorkspaceIndex];
    
    folder.items.forEach((item, index) => {
        const data = getFolderItemData(item.type, item.id);
        if (!data) return;

        const itemEl = document.createElement('div');
        itemEl.className = 'folder-item';
        itemEl.dataset.itemType = item.type;
        itemEl.dataset.itemId = item.id;
        itemEl.dataset.itemIndex = index;
        itemEl.draggable = true;

        const header = document.createElement('div');
        header.className = 'folder-item-header';

        const icon = document.createElement('div');
        icon.className = `folder-item-icon type-${item.type}`;
        
        const iconSpan = document.createElement('span');
        iconSpan.className = 'material-symbols-rounded';
        if (item.type === 'note') iconSpan.textContent = 'sticky_note_2';
        else if (item.type === 'project') iconSpan.textContent = 'checklist';
        else if (item.type === 'photo') iconSpan.textContent = 'image';
        icon.appendChild(iconSpan);

        const typeLabel = document.createElement('span');
        typeLabel.className = 'folder-item-type';
        if (item.type === 'note') typeLabel.textContent = '便签';
        else if (item.type === 'project') typeLabel.textContent = '项目';
        else if (item.type === 'photo') typeLabel.textContent = '图片';

        header.appendChild(icon);
        header.appendChild(typeLabel);
        itemEl.appendChild(header);

        // 标题/预览
        if (item.type === 'note') {
            const preview = document.createElement('div');
            preview.className = 'folder-item-preview';
            preview.textContent = getPlainText(data.content).substring(0, 60) || '(空)';
            itemEl.appendChild(preview);
        } else if (item.type === 'project') {
            const title = document.createElement('div');
            title.className = 'folder-item-title';
            title.textContent = data.name || '无标题项目';
            itemEl.appendChild(title);
            
            const preview = document.createElement('div');
            preview.className = 'folder-item-preview';
            const todoCount = data.todos ? data.todos.length : 0;
            const doneCount = data.todos ? data.todos.filter(t => t.completed).length : 0;
            preview.textContent = `${doneCount}/${todoCount} 任务完成`;
            itemEl.appendChild(preview);
        } else if (item.type === 'photo') {
            const thumb = document.createElement('img');
            thumb.className = 'folder-item-thumbnail';
            thumb.src = data.src;
            thumb.alt = '图片';
            thumb.draggable = false; // 防止图片本身的拖拽干扰
            itemEl.appendChild(thumb);
        }

        // 移除按钮
        const removeBtn = document.createElement('button');
        removeBtn.className = 'folder-item-remove';
        removeBtn.innerHTML = '&times;';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeItemFromFolder(folder, index);
        });
        itemEl.appendChild(removeBtn);

        // 点击预览（不移出）
        itemEl.addEventListener('click', (e) => {
            if (e.target === removeBtn) return;
            body.querySelectorAll('.folder-item.active').forEach(el => el.classList.remove('active'));
            itemEl.classList.add('active');
        });

        // 右键菜单 - 支持拖出到工作区
        itemEl.addEventListener('contextmenu', (e) => {
            console.log('Context menu triggered on folder item:', item.type, item.id);
            e.preventDefault();
            e.stopPropagation();
            closeAllDropdowns();
            
            const menu = document.createElement('div');
            menu.className = 'custom-dropdown-menu';
            menu.innerHTML = `
                <div class="dropdown-option" data-action="dragout">📤 拖出到工作区</div>
                <div class="dropdown-divider"></div>
                <div class="dropdown-option danger" data-action="delete">🗑️ 从文件夹移除</div>
            `;
            
            // 定位菜单 - 确保在视口内
            let menuX = e.clientX;
            let menuY = e.clientY;
            const menuWidth = 150; // 预估菜单宽度
            const menuHeight = 80; // 预估菜单高度
            
            if (menuX + menuWidth > window.innerWidth) {
                menuX = window.innerWidth - menuWidth - 10;
            }
            if (menuY + menuHeight > window.innerHeight) {
                menuY = window.innerHeight - menuHeight - 10;
            }
            
            menu.style.position = 'fixed';
            menu.style.left = `${menuX}px`;
            menu.style.top = `${menuY}px`;
            menu.style.zIndex = '99999';
            menu.style.minWidth = '140px';
            document.body.appendChild(menu);
            
            console.log('Context menu created and appended to body');
            
            // 处理菜单点击
            menu.addEventListener('click', (me) => {
                const action = me.target.dataset.action;
                console.log('Context menu action:', action);
                if (action === 'dragout') {
                    closeAllDropdowns();
                    dragOutFolderItem(folder, index, item, data);
                } else if (action === 'delete') {
                    closeAllDropdowns();
                    removeItemFromFolder(folder, index);
                }
            });
            
            // 阻止菜单上的右键事件
            menu.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        // 双击展开详情（不移出）
        itemEl.addEventListener('dblclick', (e) => {
            if (e.target === removeBtn) return;
            const isExpanded = itemEl.classList.toggle('expanded');
            let detailEl = itemEl.querySelector('.folder-item-detail');
            if (!detailEl) {
                detailEl = document.createElement('div');
                detailEl.className = 'folder-item-detail';
                itemEl.appendChild(detailEl);
            }
            if (!isExpanded) {
                detailEl.textContent = '';
                return;
            }

            if (item.type === 'note') {
                detailEl.innerHTML = '';
                const fullText = getPlainText(data.content);
                detailEl.textContent = fullText || '(空)';
            } else if (item.type === 'project') {
                detailEl.innerHTML = '';
                const list = document.createElement('ul');
                list.className = 'folder-item-todo-list';
                (data.todos || []).forEach(todo => {
                    const li = document.createElement('li');
                    li.className = `folder-item-todo ${todo.completed ? 'done' : ''}`;
                    li.textContent = todo.text || '(无标题任务)';
                    list.appendChild(li);
                });
                if (!list.children.length) {
                    const empty = document.createElement('div');
                    empty.className = 'folder-item-empty';
                    empty.textContent = '暂无任务';
                    detailEl.appendChild(empty);
                } else {
                    detailEl.appendChild(list);
                }
            } else if (item.type === 'photo') {
                detailEl.innerHTML = '';
                const img = document.createElement('img');
                img.className = 'folder-item-detail-image';
                img.src = data.src;
                img.alt = '图片';
                detailEl.appendChild(img);
            }
        });

        // 拖出文件夹
        itemEl.addEventListener('dragstart', (e) => {
            const dragData = JSON.stringify({
                folderId: folder.id,
                itemIndex: index,
                type: item.type,
                id: item.id
            });
            // 使用多种数据格式以确保兼容性
            e.dataTransfer.setData('application/x-folder-item', dragData);
            e.dataTransfer.setData('text/plain', dragData);
            e.dataTransfer.effectAllowed = 'move';
            itemEl.classList.add('dragging');
        });

        itemEl.addEventListener('dragend', () => {
            itemEl.classList.remove('dragging');
        });

        body.appendChild(itemEl);
    });
}

function removeItemFromFolder(folder, itemIndex) {
    recordState();
    const item = folder.items[itemIndex];
    if (!item) return;
    
    const data = getFolderItemData(item.type, item.id);
    if (data) {
        delete data.folderId;
    }
    folder.items.splice(itemIndex, 1);
    updateFolderBadge(folder.id);
    debouncedSave();
    
    // 刷新面板
    if (openFolderPanel && openFolderPanel.folder.id === folder.id) {
        const body = openFolderPanel.panel.querySelector('.folder-panel-body');
        renderFolderPanelItems(body, folder);
    }
}

function dragOutFolderItem(folder, itemIndex, item, data) {
    recordState();
    const currentWorkspace = workspaces[currentWorkspaceIndex];
    if (!currentWorkspace) return;
    
    // 从文件夹中移除
    if (data) {
        delete data.folderId;
    }
    folder.items.splice(itemIndex, 1);
    updateFolderBadge(folder.id);
    
    // 计算放置位置 - 在文件夹面板旁边
    let dropX, dropY;
    if (openFolderPanel) {
        const panelRect = openFolderPanel.panel.getBoundingClientRect();
        dropX = (panelRect.right + 20) / currentZoom;
        dropY = (panelRect.top + 50) / currentZoom;
    } else {
        // 如果没有打开的面板，放在屏幕中央
        dropX = (window.innerWidth / 2) / currentZoom - 100;
        dropY = (window.innerHeight / 2) / currentZoom - 50;
    }
    
    // 根据类型设置偏移量
    let offsetX = 100;
    let offsetY = 50;
    if (item.type === 'photo' && data.size) {
        const width = parseInt(data.size.width) || 240;
        const height = parseInt(data.size.height) || 180;
        offsetX = width / 2;
        offsetY = height / 2;
    } else if (item.type === 'note') {
        offsetX = 125;
        offsetY = 75;
    } else if (item.type === 'project') {
        offsetX = 150;
        offsetY = 100;
    }
    
    data.position = { 
        left: `${dropX - offsetX}px`, 
        top: `${dropY - offsetY}px` 
    };
    
    debouncedSave();
    
    // 刷新面板
    if (openFolderPanel && openFolderPanel.folder.id === folder.id) {
        const body = openFolderPanel.panel.querySelector('.folder-panel-body');
        renderFolderPanelItems(body, folder);
    }
    
    // 将元素渲染到工作区
    let newEl = null;
    if (item.type === 'note') newEl = createNotePane(data);
    else if (item.type === 'project') newEl = createProjectPane(data, currentWorkspace);
    else if (item.type === 'photo') newEl = createPhotoPane(data);
    
    if (newEl) {
        if (data.zIndex && data.zIndex >= highestZIndex) {
            highestZIndex = data.zIndex + 1;
        }
        // 添加动画效果
        newEl.classList.add('newly-added');
        setTimeout(() => newEl.classList.remove('newly-added'), 400);
        checkEmptyState(currentWorkspace);
    }
}

function releaseItemFromFolder(folder, itemIndex, scrollToItem = false) {
    recordState();
    const item = folder.items[itemIndex];
    if (!item) return;
    
    const data = getFolderItemData(item.type, item.id);
    if (data) {
        delete data.folderId;
    }
    folder.items.splice(itemIndex, 1);
    updateFolderBadge(folder.id);
    debouncedSave();
    
    // 关闭面板
    closeFolderPanel();
    
    // 重新渲染工作区
    renderCurrentWorkspace();
    
    // 滚动到元素
    if (scrollToItem) {
        setTimeout(() => {
            let selector = '';
            if (item.type === 'note') selector = `[data-note-id="${item.id}"]`;
            else if (item.type === 'project') selector = `[data-project-id="${item.id}"]`;
            else if (item.type === 'photo') selector = `[data-photo-id="${item.id}"]`;
            const el = document.querySelector(selector);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('highlight-target');
                setTimeout(() => el.classList.remove('highlight-target'), 1500);
            }
        }, 100);
    }
}

function addItemToFolder(folderId, type, id) {
    const currentWorkspace = workspaces[currentWorkspaceIndex];
    if (!currentWorkspace || !currentWorkspace.folders) return false;
    const folder = currentWorkspace.folders[folderId];
    if (!folder) return false;
    
    // 检查是否已在文件夹中
    if (folder.items.some(item => item.type === type && item.id === id)) {
        return false;
    }
    
    recordState();
    folder.items.push({ type, id });
    
    // 标记数据
    const data = getFolderItemData(type, id);
    if (data) {
        data.folderId = folderId;
    }
    
    updateFolderBadge(folderId);
    debouncedSave();
    
    // 隐藏原元素（重新渲染会处理）
    let selector = '';
    if (type === 'note') selector = `[data-note-id="${id}"]`;
    else if (type === 'project') selector = `[data-project-id="${id}"]`;
    else if (type === 'photo') selector = `[data-photo-id="${id}"]`;
    const el = document.querySelector(selector);
    if (el) {
        el.classList.add('fade-out-note');
        setTimeout(() => el.remove(), 300);
    }
    
    // 刷新面板
    if (openFolderPanel && openFolderPanel.folder.id === folderId) {
        const body = openFolderPanel.panel.querySelector('.folder-panel-body');
        renderFolderPanelItems(body, folder);
    }
    
    return true;
}

function handleWindowDropToFolder(element, folderContainer) {
    const folderId = folderContainer.dataset.folderId;
    const type = getWindowType(element);
    let id = null;
    
    if (type === 'note') id = element.dataset.noteId;
    else if (type === 'project') id = element.dataset.projectId;
    else if (type === 'photo') id = element.dataset.photoId;
    
    if (!id || !folderId) return false;
    
    // 不能把文件夹放进文件夹
    if (type === 'folder') return false;
    
    return addItemToFolder(folderId, type, id);
}
// ==================== 文件夹功能结束 ====================

function createNotePane(note) {
    const noteTemplate = document.getElementById('note-template');
    const node = noteTemplate.content.cloneNode(true);
    const container = node.querySelector('.note-container');
    const contentEl = node.querySelector('.note-content');
    const toolbar = node.querySelector('.note-toolbar');
    const colorInput = node.querySelector('.color-picker-input');
    const deleteBtn = node.querySelector('.delete-note-btn');

    // 可复用的右键菜单函数
    const setupContextMenu = (button, menuContentHTML, onSelect) => {
        button.addEventListener('mousedown', e => {
            if (e.button === 2) { e.preventDefault(); }
        });
        button.addEventListener('contextmenu', e => {
            e.preventDefault();
            closeAllDropdowns();
            const menu = document.createElement('div');
            menu.className = 'custom-dropdown-menu';
            menu.innerHTML = menuContentHTML;
            positionContextMenu(menu, e);
            menu.addEventListener('mousedown', me => {
                me.preventDefault();
                const selectedValue = me.target.dataset.value;
                if (selectedValue) {
                    onSelect(selectedValue);
                    closeAllDropdowns();
                }
            });
        });
    };

    container.dataset.noteId = note.id;
    container.style.top = note.position.top;
    container.style.left = note.position.left;
    container.style.width = note.size.width;
    container.style.height = note.size.height;
    container.style.backgroundColor = note.color;
    contentEl.innerHTML = note.content;
    
    const deleteNoteAction = () => {
        const doDelete = () => {
            recordState();
            delete workspaces[currentWorkspaceIndex].notes[note.id];
            debouncedSave();
            container.classList.add('fade-out-note');
            setTimeout(() => container.remove(), 300);
        };
        if (isNoteEmpty(note)) {
            doDelete();
            return;
        }
        showCustomModal({
            title: '删除便签',
            message: `确定要删除便签 "${note.title || '无标题'}" 吗？`,
            okText: '删除'
        }).then(doDelete).catch(() => {});
    };

    deleteBtn.addEventListener('click', deleteNoteAction);

    container.querySelector('.note-header').addEventListener('contextmenu', e => {
        e.preventDefault();
        if (!selectedWindows.has(container)) {
            clearWindowSelection();
            selectWindowWithGroup(container);
        } else {
            expandSelectionByGroups();
        }
        closeAllDropdowns();
        const menu = document.createElement('div');
        menu.className = 'custom-dropdown-menu';
        const moveOption = workspaces.length > 1 ? `<div class="dropdown-option" data-action="move">移动到工作区...</div>` : '';
        const groupMenuHTML = buildGroupMenuHTML();
        const folderMenuHTML = buildFolderMenuOptions(note.id, 'note');
        menu.innerHTML = `
            <div class="dropdown-option" data-action="color">更改颜色</div>
            <div class="dropdown-option" data-action="exportMarkdown">导出为 Markdown</div>
            <div class="dropdown-option" data-action="exportWord">导出为 Word(DOCX)</div>
            ${moveOption}
            ${folderMenuHTML}
            ${groupMenuHTML}
            <div class="dropdown-divider"></div>
            <div class="dropdown-option danger" data-action="delete">删除便签</div>
        `;
        positionContextMenu(menu, e);

        menu.addEventListener('click', async me => {
            const action = me.target.dataset.action;
            closeAllDropdowns(); 
            if (action === 'rename') {
                showCustomModal({
                    title: '重命名便签',
                    type: 'prompt',
                    initialValue: note.title,
                    okText: '保存'
                }).then(newTitle => {
                    if (note.title !== newTitle) {
                        recordState();
                        note.title = newTitle;
                        debouncedSave();
                    }
                }).catch(() => {});
            } else if (action === 'color') {
                colorInput.click();
            } else if (action === 'exportMarkdown') {
                const rawHtml = contentEl.innerHTML || '';
                const md = htmlToMarkdown(rawHtml);
                const filename = `${sanitizeFileName(note.title || '便签')}_${new Date().toISOString().slice(0, 10)}.md`;
                downloadTextFile(filename, md, 'text/markdown;charset=utf-8');
            } else if (action === 'exportWord') {
                const rawHtml = contentEl.innerHTML || '';
                const title = note.title || '便签';
                const doc = await htmlToDocx(rawHtml);
                if (!doc || !window.docx) {
                    showToast('DOCX 导出不可用，请检查网络是否可访问', 'error');
                    return;
                }
                const blob = await window.docx.Packer.toBlob(doc);
                const filename = `${sanitizeFileName(title)}_${new Date().toISOString().slice(0, 10)}.docx`;
                downloadBlob(filename, blob);
            } else if (action === 'delete') {
                deleteNoteAction();
            } else if (action === 'group') {
                applyGroupToSelection();
            } else if (action === 'ungroup') {
                ungroupSelection();
            } else if (action === 'addToFolder') {
                const folderId = me.target.dataset.folderId;
                if (folderId) {
                    const currentWorkspace = workspaces[currentWorkspaceIndex];
                    const folder = currentWorkspace.folders?.[folderId];
                    if (folder) {
                        // 检查是否已在文件夹中
                        const existingIndex = folder.items.findIndex(item => item.id === note.id && item.type === 'note');
                        if (existingIndex >= 0) {
                            // 从文件夹中移出
                            recordState();
                            folder.items.splice(existingIndex, 1);
                            delete note.folderId;
                            updateFolderBadge(folderId);
                            debouncedSave();
                            showToast(`已从 "${folder.name}" 中移出`, 'success');
                        } else {
                            // 添加到文件夹
                            addItemToFolder(folderId, 'note', note.id);
                            showToast(`已添加到 "${folder.name}"`, 'success');
                        }
                    }
                }
            } else if (action === 'move') {
                const rect = menu.getBoundingClientRect();
                const subMenu = document.createElement('div');
                subMenu.className = 'custom-dropdown-menu';
                let optionsHTML = '';
                workspaces.forEach((ws, index) => {
                    const isCurrent = index === currentWorkspaceIndex;
                    optionsHTML += `<div class="dropdown-option ${isCurrent ? 'selected' : ''}" data-ws-index="${index}">${escapeHTML(ws.name)}</div>`;
                });
                subMenu.innerHTML = optionsHTML;
                document.body.appendChild(subMenu);
                subMenu.style.top = `${rect.top + window.scrollY}px`;
                subMenu.style.left = `${rect.right + window.scrollX + 5}px`;
                requestAnimationFrame(() => subMenu.classList.add('visible'));
                subMenu.addEventListener('click', sme => {
                    const opt = sme.target.closest('.dropdown-option');
                    if (opt && !opt.classList.contains('selected')) {
                        const targetWsIndex = parseInt(opt.dataset.wsIndex, 10);
                        recordState();
                        const noteData = workspaces[currentWorkspaceIndex].notes[note.id];
                        workspaces[targetWsIndex].notes[note.id] = noteData;
                        delete workspaces[currentWorkspaceIndex].notes[note.id];
                        debouncedSave();
                        container.classList.add('fade-out-note');
                        setTimeout(() => container.remove(), 300);
                    }
                    closeAllDropdowns();
                });
            }
        });
    });

    const debouncedContentSave = debounce(() => { if (note.content !== contentEl.innerHTML) { recordState(); note.content = contentEl.innerHTML; saveWorkspaces(); } }, 500);
    contentEl.addEventListener('input', debouncedContentSave);
    colorInput.addEventListener('input', (e) => { recordState(); note.color = e.target.value; container.style.backgroundColor = note.color; debouncedSave(); });

    const updateToolbarState = () => { toolbar.querySelectorAll('.toolbar-btn').forEach(btn => { const command = btn.dataset.command; if (command && document.queryCommandState(command)) { btn.classList.add('active'); } else { btn.classList.remove('active'); } }); };
    
    // 修改工具栏的 mousedown 事件监听器
    toolbar.addEventListener('mousedown', e => { 
        const btn = e.target.closest('.toolbar-btn'); 
        if (!btn) return;
        e.preventDefault(); 
        
        // 只响应鼠标左键点击
        if (e.button !== 0) return;

        const command = btn.dataset.command; 
        
        // 其他按钮保持原有功能
        document.execCommand(command, false, null); 
        updateToolbarState(); 
    });
    
    const textColorPicker = toolbar.querySelector('.toolbar-color-picker[data-color-type="text"]');
    
    const applyColor = (color) => {
        contentEl.focus();
        recordState();
        document.execCommand('foreColor', false, color);
        const selection = window.getSelection();
        if (selection && selection.rangeCount) {
            selection.collapseToEnd();
        }
        lastTextColor = color;
        localStorage.setItem('lastTextColor', color);
        if (textColorPicker) {
            textColorPicker.style.setProperty('--current-text-color', color);
        }
        debouncedContentSave();
        showToast('已应用文字颜色', 'success', 1200);
    };

    const showColorMenu = (e) => {
        closeAllDropdowns();
        const menu = document.createElement('div');
        menu.className = 'custom-dropdown-menu custom-color-menu';
        
        const defaultTextColors = ['#000000', '#FFFFFF', '#d94336', '#f29d38', '#4285f4', '#34a853'];
        const swatchesHTML = defaultTextColors.map(color => 
            `<div class="color-swatch" data-value="${color}" style="background-color: ${color}"></div>`
        ).join('');

        menu.innerHTML = `<div class="color-swatches">${swatchesHTML}</div>`;
        positionContextMenu(menu, e);

        menu.addEventListener('mousedown', (me) => {
            me.preventDefault();
            const swatch = me.target.closest('.color-swatch');
            if (swatch) {
                applyColor(swatch.dataset.value);
                closeAllDropdowns();
            }
        });
    };

    if (textColorPicker) {
        textColorPicker.style.setProperty('--current-text-color', lastTextColor);
        textColorPicker.addEventListener('click', (e) => { e.preventDefault(); applyColor(lastTextColor); });
        textColorPicker.addEventListener('contextmenu', (e) => { e.preventDefault(); showColorMenu(e); });
    }
    
    // ++++++++++++++++ START: 新增右键菜单核心逻辑 ++++++++++++++++
    contentEl.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        closeAllDropdowns();

        const selection = window.getSelection();
        const hasSelection = selection.toString().trim().length > 0;
        
        const menu = document.createElement('div');
        menu.className = 'custom-dropdown-menu';

        if (hasSelection) {
            // 场景1: 选中了文字
            menu.innerHTML = `
                <div class="dropdown-option" data-action="cut">剪切</div>
                <div class="dropdown-option" data-action="copy">复制</div>
                <div class="dropdown-divider"></div>
                <div class="dropdown-option" data-action="color">修改颜色...</div>
            `;
        } else {
            // 场景2: 未选中文字 (点击空白处)
            menu.innerHTML = `
                <div class="dropdown-option" data-action="paste">粘贴</div>
                <div class="dropdown-option" data-action="pasteText">以文本形式粘贴</div>
            `;
        }

        positionContextMenu(menu, e);

        // 使用 mousedown 避免失去编辑器焦点
        menu.addEventListener('mousedown', async (me) => {
            me.preventDefault(); // 阻止默认行为
            const actionTarget = me.target.closest('.dropdown-option');
            if (!actionTarget) return;

            const action = actionTarget.dataset.action;

            // --- 处理选中文字时的操作 ---
            if (action === 'cut') {
                document.execCommand('cut');
                closeAllDropdowns();
            } else if (action === 'copy') {
                document.execCommand('copy');
                closeAllDropdowns();
            } else if (action === 'color') {
                // 重用已有的颜色选择器逻辑
                showColorMenu(e);
            }

            // --- 处理未选中文字时的操作 ---
            else if (action === 'paste') {
                try {
                    const clipboardItems = await navigator.clipboard.read();
                    for (const item of clipboardItems) {
                        if (item.types.includes('image/png') || item.types.includes('image/jpeg')) {
                            const blob = await item.getType(item.types.find(t => t.startsWith('image/')));
                            const reader = new FileReader();
                            reader.onload = function(event) {
                                const imgHTML = `<img src="${event.target.result}" style="max-width: 100%; cursor: pointer;">`;
                                document.execCommand('insertHTML', false, imgHTML);
                                contentEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                            };
                            reader.readAsDataURL(blob);
                            closeAllDropdowns();
                            return;
                        } else if (item.types.includes('text/html')) {
                            const blob = await item.getType('text/html');
                            let html = await blob.text();
                            // 清理背景色
                            const tempDiv = document.createElement('div');
                            tempDiv.innerHTML = html;
                            tempDiv.querySelectorAll('*').forEach(el => {
                                el.style.backgroundColor = '';
                                el.style.background = '';
                                el.removeAttribute('bgcolor');
                            });
                            document.execCommand('insertHTML', false, tempDiv.innerHTML);
                            closeAllDropdowns();
                            return;
                        }
                    }
                    // 如果上面都失败了，作为纯文本回退
                    const text = await navigator.clipboard.readText();
                    document.execCommand('insertText', false, text);
                } catch (err) {
                    showToast('粘贴内容失败，可能需要授权。', 'error');
                    console.error('Paste error:', err);
                }
                closeAllDropdowns();
            } else if (action === 'pasteText') {
                try {
                    const text = await navigator.clipboard.readText();
                    document.execCommand('insertText', false, text);
                } catch (err) {
                    showToast('粘贴文本失败，可能需要授权。', 'error');
                    console.error('Paste text error:', err);
                }
                closeAllDropdowns();
            }
        });
    });
    // ++++++++++++++++ END: 新增右键菜单核心逻辑 ++++++++++++++++

    contentEl.addEventListener('paste', (e) => {
        e.preventDefault();
        const clipboardData = e.clipboardData || window.clipboardData;
        const items = clipboardData.items;

        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const file = items[i].getAsFile();
                if (file) {
                    const reader = new FileReader();
                    reader.onload = function(event) {
                        const imgHTML = `<img src="${event.target.result}" style="max-width: 100%; cursor: pointer;">`;
                        document.execCommand('insertHTML', false, imgHTML);
                        contentEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                    };
                    reader.readAsDataURL(file);
                    return;
                }
            }
        }

        const pastedHtml = clipboardData.getData('text/html');
        if (pastedHtml) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = pastedHtml;
            
            // 1. 清理样式属性
            const allElements = tempDiv.querySelectorAll('*');
            let hasInlineNoWrap = false;
            allElements.forEach(el => {
                const inlineStyle = (el.getAttribute('style') || '').toLowerCase();
                if (inlineStyle.includes('white-space') || inlineStyle.includes('word-break') || inlineStyle.includes('overflow-wrap')) {
                    hasInlineNoWrap = true;
                }
                el.style.backgroundColor = '';
                el.style.background = '';
                el.style.whiteSpace = '';
                el.style.wordBreak = '';
                el.style.overflowWrap = '';
                el.style.width = '';
                el.style.maxWidth = '';
                el.removeAttribute('bgcolor');
            });
            
            // 2. 将块级元素转换为 span，避免产生额外换行
            const blockTags = ['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'td', 'th'];
            blockTags.forEach(tag => {
                const elements = tempDiv.getElementsByTagName(tag);
                while (elements.length > 0) {
                    const el = elements[0];
                    const span = document.createElement('span');
                    // 保留内部内容和行内样式
                    span.innerHTML = el.innerHTML;
                    span.style.cssText = el.style.cssText;
                    // 保留 class 属性（如果有）
                    if (el.className) span.className = el.className;
                    // 替换元素
                    el.parentNode.replaceChild(span, el);
                }
            });
            
            // 3. 处理 <br> 标签，移除连续的多余 <br>
            let sanitizedHtml = tempDiv.innerHTML;
            sanitizedHtml = sanitizedHtml.replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>');
            
            // 4. 清理首尾空白
            const finalDiv = document.createElement('div');
            finalDiv.innerHTML = sanitizedHtml;
            sanitizedHtml = finalDiv.innerHTML.trim();
            
            document.execCommand('insertHTML', false, sanitizedHtml);
            logUiEvent('note_paste', {
                hasHtml: true,
                htmlLength: pastedHtml.length,
                inlineWrapStyle: hasInlineNoWrap
            });
        } else {
            const pastedText = clipboardData.getData('text/plain');
            document.execCommand('insertText', false, pastedText);
            logUiEvent('note_paste', {
                hasHtml: false,
                textLength: pastedText.length
            });
        }
    });

    contentEl.addEventListener('keydown', e => {
        // +++ START: 新增快捷键处理 +++
        // 监听 Ctrl + Shift + X
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'x') {
            // 阻止浏览器默认行为 (如果有的话)
            e.preventDefault(); 
            // 执行与工具栏按钮相同的命令
            document.execCommand('strikeThrough', false, null);
            // 更新工具栏按钮的状态，使其高亮或取消高亮
            updateToolbarState(); 
        }
        // +++ END: 新增快捷键处理 +++

        if (e.key === 'Enter') {
            setTimeout(() => {
                document.execCommand('removeFormat', false, null);
                // ... (后面的代码)
            }, 0);
        }
    });

    contentEl.addEventListener('keyup', updateToolbarState);
    contentEl.addEventListener('mouseup', updateToolbarState);
    container.addEventListener('focusin', updateToolbarState);
    
    container.style.zIndex = note.zIndex || 1;
    container.addEventListener('mousedown', () => {
        if (parseInt(container.style.zIndex || 0) < highestZIndex - 1) {
            const newZ = highestZIndex++;
            container.style.zIndex = newZ;
            note.zIndex = newZ;
            if (!isWindowDragActive) {
                recordState();
            }
            debouncedSave();
        }
    });

    appContainer.appendChild(node);
    makeDraggableAndResizable(container, note);
    return container;
}

function createProjectPane(project, workspace) {
    const projectTemplate = document.getElementById('project-template');
    const node = projectTemplate.content.cloneNode(true);
    const container = node.querySelector('.project-container');
    const projectNameEl = node.querySelector('h1');
    const todoList = node.querySelector('.todo-list');
    const filtersContainer = node.querySelector('.filters');

    // +++ START: 兼容旧数据，为没有颜色的分类分配颜色 +++
    project.categories.forEach((cat, index) => {
        if (!cat.color) {
            cat.color = CATEGORY_COLORS[index % CATEGORY_COLORS.length];
        }
    });
    // +++ END: 兼容旧数据 +++
    
    let currentFilter = project.activeFilter || 'all';
    project.activeFilter ??= 'all'; project.categories ??= []; project.todos ??= [];
    container.dataset.projectId = project.id;
    projectNameEl.textContent = project.name;
    container.style.top = project.position.top; container.style.left = project.position.left;
    
    const renderSubTasks = (subTaskListEl, parentTodo) => {
        subTaskListEl.innerHTML = '';
        parentTodo.subtasks.forEach(subtask => {
            const subLi = document.createElement('li');
            subLi.className = `sub-task-item ${subtask.completed ? 'completed' : ''}`;
            subLi.dataset.id = parentTodo.id;
            subLi.dataset.subId = subtask.id;
            subLi.draggable = true;
            subLi.innerHTML = `
                <div class="toggle"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg></div>
                <span class="text">${escapeHTML(subtask.text)}</span>
                <div class="actions"><button class="delete-btn" title="删除任务">&times;</button></div>
            `;
            subTaskListEl.appendChild(subLi);
        });
    };

    const renderTodos = () => {
        let displayTodos = [];
        if (currentFilter === 'all') displayTodos = project.todos;
        else if (currentFilter === 'active') displayTodos = project.todos.filter(t => !t.completed);
        else if (currentFilter === 'completed') displayTodos = project.todos.filter(t => t.completed);
        else displayTodos = project.todos.filter(t => t.categoryId === currentFilter);
        
        displayTodos.sort((a, b) =>
            (b.isPriority ? 1 : 0) - (a.isPriority ? 1 : 0) ||
            (b.isImportant ? 1 : 0) - (a.isImportant ? 1 : 0)
        );

        const shouldAnimate = !prefersReducedMotion.matches && displayTodos.length <= 120;
        
        const existingNodes = new Map(Array.from(todoList.children).filter(el => el.dataset.id).map(el => [el.dataset.id, el]));
        const displayedIds = new Set(displayTodos.map(todo => String(todo.id)));
        existingNodes.forEach((node, id) => { if (!displayedIds.has(id)) { node.classList.add('fade-out'); setTimeout(() => node.remove(), 300); } });
        let lastElement = null;
        if (displayTodos.length === 0) {
            if (!todoList.querySelector('.empty-state')) { todoList.innerHTML = '<div class="empty-state" style="padding: 20px; text-align: center; color: var(--proj-secondary-text-color);"><p>列表为空</p></div>'; }
        } else {
            todoList.querySelector('.empty-state')?.remove();
            displayTodos.forEach((todo) => {
                todo.subtasks = todo.subtasks || [];
                const todoIdStr = String(todo.id); let li = existingNodes.get(todoIdStr);
                if (li) { 
                    li.classList.toggle('completed', todo.completed);
                    li.classList.toggle('important-task', !!todo.isImportant);
                    li.classList.toggle('priority-task', !!todo.isPriority);
                    const textSpan = li.querySelector('.text'); 
                    if (textSpan) {
                        const html = todo.textHtml ? todo.textHtml : escapeHTML(todo.text || '');
                        if (textSpan.innerHTML !== html) { textSpan.innerHTML = html; }
                        textSpan.style.color = todo.textColor || 'inherit';
                        textSpan.classList.toggle('is-bold', !!todo.textBold && !todo.textHtml);
                    }
                    let metaEl = li.querySelector('.todo-meta');
                    if (!metaEl) {
                        metaEl = document.createElement('div');
                        metaEl.className = 'todo-meta';
                        const main = li.querySelector('.todo-item-main');
                        if (main) {
                            main.after(metaEl);
                        } else {
                            li.appendChild(metaEl);
                        }
                    }
                    const metaParts = [];
                    if (todo.planTime) metaParts.push(`计划: ${formatDateTime(todo.planTime)}`);
                    if (todo.remindTime) {
                        metaParts.push(todo.remindNotified ? '提醒: 已提醒' : `提醒: ${formatDateTime(todo.remindTime)}`);
                    }
                    metaEl.innerHTML = metaParts.map(p => `<span>${escapeHTML(p)}</span>`).join('');
                    metaEl.style.display = metaParts.length ? 'flex' : 'none';
                } else { 
                    li = document.createElement('li');
                    li.className = `todo-item ${todo.completed ? 'completed' : ''}`;
                    li.dataset.id = todoIdStr; li.draggable = true; 
                    
                    // +++ START: 关键HTML结构修复 +++
                    // 将 .category-tag-dot 和 .actions 移到 .todo-item-main 内部
                    li.innerHTML = `<div class="todo-item-main">
                                        <div class="toggle"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg></div>
                                        <span class="text"></span>
                                        <div class="category-tag-dot" style="display: none;" title=""></div>
                                        <div class="actions"><button class="delete-btn" title="删除任务">&times;</button></div>
                                    </div>
                                    <div class="todo-meta"></div>
                                    <ul class="sub-task-list"></ul>`;
                    // +++ END: 关键HTML结构修复 +++
                    
                    const newTextSpan = li.querySelector('.text');
                    if (newTextSpan) {
                        const html = todo.textHtml ? todo.textHtml : escapeHTML(todo.text || '');
                        newTextSpan.innerHTML = html;
                        newTextSpan.style.color = todo.textColor || 'inherit';
                        newTextSpan.classList.toggle('is-bold', !!todo.textBold && !todo.textHtml);
                    }
                    const metaEl = li.querySelector('.todo-meta');
                    const metaParts = [];
                    if (todo.planTime) metaParts.push(`计划: ${formatDateTime(todo.planTime)}`);
                    if (todo.remindTime) {
                        metaParts.push(todo.remindNotified ? '提醒: 已提醒' : `提醒: ${formatDateTime(todo.remindTime)}`);
                    }
                    if (metaEl) {
                        metaEl.innerHTML = metaParts.map(p => `<span>${escapeHTML(p)}</span>`).join('');
                        metaEl.style.display = metaParts.length ? 'flex' : 'none';
                    }
                    if (todo.isImportant) li.classList.add('important-task');
                    if (todo.isPriority) li.classList.add('priority-task');
                }
                
                const categoryDot = li.querySelector('.category-tag-dot');
                if (todo.categoryId) {
                    const category = project.categories.find(c => c.id === todo.categoryId);
                    if (category && categoryDot) {
                        categoryDot.style.backgroundColor = category.color;
                        categoryDot.title = `分类: ${escapeHTML(category.name)}`;
                        categoryDot.style.display = 'block';
                    } else if (categoryDot) {
                        categoryDot.style.display = 'none';
                    }
                } else if (categoryDot) {
                    categoryDot.style.display = 'none';
                }
                
                const subTaskListEl = li.querySelector('.sub-task-list');
                if (subTaskListEl && todo.subtasks.length > 0) {
                    renderSubTasks(subTaskListEl, todo);
                } else if(subTaskListEl) {
                    subTaskListEl.innerHTML = '';
                }

                if (lastElement) { lastElement.after(li); } else { todoList.prepend(li); }
                lastElement = li;
            });
        }
        // 简化的刷新动画 - 只添加淡入效果，避免位置弹跳
        if (shouldAnimate) {
            todoList.querySelectorAll('.todo-item, .sub-task-item').forEach((item, index) => {
                item.style.opacity = '0';
                item.style.transform = 'translateY(10px)';
                item.style.transition = 'none';
                
                requestAnimationFrame(() => {
                    item.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
                    item.style.opacity = '1';
                    item.style.transform = 'translateY(0)';
                    
                    // 清理内联样式
                    setTimeout(() => {
                        item.style.opacity = '';
                        item.style.transform = '';
                        item.style.transition = '';
                    }, 250);
                });
            });
        }
    };

    const setupProjectHeader = () => {
        const deleteProjectBtn = container.querySelector('.delete-project-btn');
        projectNameEl.contentEditable = false;
        let exitEditMode, handleKeydown;

        const enterProjectNameEditMode = () => {
            projectNameEl.contentEditable = true; projectNameEl.focus(); document.execCommand('selectAll', false, null);
            exitEditMode = () => {
                projectNameEl.contentEditable = false; const newName = projectNameEl.textContent.trim() || '未命名项目';
                if (project.name !== newName) { recordState(); project.name = newName; debouncedSave(); } 
                else { projectNameEl.textContent = project.name; }
                projectNameEl.removeEventListener('blur', exitEditMode); projectNameEl.removeEventListener('keydown', handleKeydown);
            };
            handleKeydown = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); exitEditMode(); }
                if (e.key === 'Escape') { projectNameEl.textContent = project.name; exitEditMode(); }
            };
            projectNameEl.addEventListener('blur', exitEditMode, { once: true });
            projectNameEl.addEventListener('keydown', handleKeydown);
        };

        deleteProjectBtn.addEventListener('click', async () => {
            const doDelete = () => {
                recordState();
                const projectElement = document.querySelector(`[data-project-id="${project.id}"]`);
                if (projectElement) {
                    delete workspace.projects[project.id];
                    debouncedSave();
                    projectElement.classList.add('fade-out-project');
                    setTimeout(() => { projectElement.remove(); checkEmptyState(workspace); }, 300);
                }
            };
            if (isProjectEmpty(project)) {
                doDelete();
                return;
            }
            try {
                await showCustomModal({ title: '删除项目', message: `确定要删除项目 "${project.name}" 吗？`, okText: '删除' });
                doDelete();
            } catch {}
        });
        
        container.querySelector('.project-header').addEventListener('contextmenu', e => {
            if (e.target.closest('.header-buttons')) return;
            e.preventDefault();
            if (!selectedWindows.has(container)) {
                clearWindowSelection();
                selectWindowWithGroup(container);
            } else {
                expandSelectionByGroups();
            }
            closeAllDropdowns();
            const menu = document.createElement('div');
            menu.className = 'custom-dropdown-menu';
            const moveOption = workspaces.length > 1 ? `<div class="dropdown-option" data-action="move">移动到工作区...</div>` : '';
            const groupMenuHTML = buildGroupMenuHTML();
            const folderMenuHTML = buildFolderMenuOptions(project.id, 'project');

            menu.innerHTML = `<div class="dropdown-option" data-action="rename">重命名</div><div class="dropdown-option" data-action="color">更改颜色</div>${moveOption}${folderMenuHTML}${groupMenuHTML}<div class="dropdown-divider"></div><div class="dropdown-option danger" data-action="delete">删除项目</div>`;
            
            positionContextMenu(menu, e);
            
            menu.addEventListener('click', me => {
                const action = me.target.dataset.action;
                
                if (action === 'rename') {
                    closeAllDropdowns();
                    enterProjectNameEditMode();
                } else if (action === 'color') {
                    closeAllDropdowns();
                    const tempColorInput = document.createElement('input');
                    tempColorInput.type = 'color';
                    // 让它不可见，但功能正常
                    tempColorInput.style.position = 'absolute';
                    tempColorInput.style.opacity = '0';
                    tempColorInput.value = project.color || '#ffffff';
                    document.body.appendChild(tempColorInput);

                    // +++ START: 关键修复 - 分离事件逻辑 +++

                    // 1. 监听 'input' 事件，用于实时更新颜色
                    tempColorInput.addEventListener('input', () => {
                        project.color = tempColorInput.value;
                        applyProjectStyles(container, project);
                        debouncedSave(); // debouncedSave 很重要，防止频繁保存
                    });

                    // 2. 监听 'blur' 事件，用于在调色板关闭后清理元素
                    tempColorInput.addEventListener('blur', () => {
                        recordState(); // 记录最终状态
                        tempColorInput.remove();
                    }, { once: true }); // once: true 确保这个清理事件只执行一次

                    // +++ END: 关键修复 +++

                    tempColorInput.click(); // 打开调色板
                
                } else if (action === 'move') {
                    const rect = menu.getBoundingClientRect();
                    closeAllDropdowns();
                    const subMenu = document.createElement('div');
                    subMenu.className = 'custom-dropdown-menu';
                    let optionsHTML = '';
                    workspaces.forEach((ws, index) => {
                        const isCurrent = index === currentWorkspaceIndex;
                        optionsHTML += `<div class="dropdown-option ${isCurrent ? 'selected' : ''}" data-ws-index="${index}">${escapeHTML(ws.name)}</div>`;
                    });
                    subMenu.innerHTML = optionsHTML;
                    document.body.appendChild(subMenu);
                    subMenu.style.top = `${rect.top + window.scrollY}px`;
                    subMenu.style.left = `${rect.right + window.scrollX + 5}px`;
                    requestAnimationFrame(() => subMenu.classList.add('visible'));
                    subMenu.addEventListener('click', sme => {
                        const opt = sme.target.closest('.dropdown-option');
                        if (opt && !opt.classList.contains('selected')) {
                            const targetWsIndex = parseInt(opt.dataset.wsIndex, 10);
                            recordState();
                            const projectData = workspace.projects[project.id];
                            workspaces[targetWsIndex].projects[project.id] = projectData;
                            delete workspace.projects[project.id];
                            debouncedSave();
                            container.classList.add('fade-out-project');
                            setTimeout(() => {
                                container.remove();
                                checkEmptyState(workspace);
                            }, 300);
                        }
                        closeAllDropdowns();
                    });
                } else if (action === 'delete') {
                    closeAllDropdowns();
                    deleteProjectBtn.click();
                } else if (action === 'addToFolder') {
                    closeAllDropdowns();
                    const folderId = me.target.dataset.folderId;
                    if (folderId) {
                        const currentWorkspace = workspaces[currentWorkspaceIndex];
                        const folder = currentWorkspace.folders?.[folderId];
                        if (folder) {
                            const existingIndex = folder.items.findIndex(item => item.id === project.id && item.type === 'project');
                            if (existingIndex >= 0) {
                                recordState();
                                folder.items.splice(existingIndex, 1);
                                delete project.folderId;
                                updateFolderBadge(folderId);
                                debouncedSave();
                                showToast(`已从 "${folder.name}" 中移出`, 'success');
                            } else {
                                addItemToFolder(folderId, 'project', project.id);
                                showToast(`已添加到 "${folder.name}"`, 'success');
                            }
                        }
                    }
                } else if (action === 'group') {
                    closeAllDropdowns();
                    applyGroupToSelection();
                } else if (action === 'ungroup') {
                    closeAllDropdowns();
                    ungroupSelection();
                }
            });
        });
    };
    
    const setupFiltersAndCategories = () => {
        const addForm = container.querySelector('.add-form');
        const todoInput = container.querySelector('.todo-input');
        const addCategoryBtn = container.querySelector('.add-category-btn');
        
        const renderCategories = () => {
            filtersContainer.querySelectorAll('.category-btn').forEach(btn => btn.remove());
            const fragment = document.createDocumentFragment();
            project.categories.forEach(cat => {
                const catBtn = document.createElement('button');
                catBtn.className = 'category-btn';
                catBtn.dataset.filter = cat.id;
                catBtn.draggable = true;
                // +++ START: 应用分类颜色 +++
                catBtn.style.setProperty('--category-color', cat.color);
                // +++ END: 应用分类颜色 +++

                const nameSpan = document.createElement('span');
                nameSpan.className = 'category-name';
                nameSpan.textContent = cat.name;

                catBtn.addEventListener('click', () => handleFilterClick(cat.id));
                const startRename = () => {
                    // ... (这部分内部逻辑保持不变)
                    if (nameSpan.isContentEditable) return;
                    nameSpan.contentEditable = true;
                    nameSpan.focus();
                    document.execCommand('selectAll', false, null);
                    const exitEditMode = () => {
                        if (!nameSpan.isContentEditable) return;
                        nameSpan.contentEditable = false;
                        const newName = nameSpan.textContent.trim();
                        if (newName && cat.name !== newName) { recordState(); cat.name = newName; debouncedSave(); renderCategories(); } 
                        else { nameSpan.textContent = cat.name; }
                        document.removeEventListener('click', handleGlobalClick, true);
                    };
                    const handleGlobalClick = (event) => { if (!nameSpan.contains(event.target)) { exitEditMode(); } };
                    document.addEventListener('click', handleGlobalClick, true);
                    nameSpan.addEventListener('blur', exitEditMode, { once: true });
                    nameSpan.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') { e.preventDefault(); exitEditMode(); }
                        if (e.key === 'Escape') { nameSpan.textContent = cat.name; exitEditMode(); }
                    });
                };

                // +++ START: 修改右键菜单以支持颜色更改 +++
                catBtn.addEventListener('contextmenu', e => {
                    e.preventDefault(); closeAllDropdowns();
                    const menu = document.createElement('div');
                    menu.className = 'custom-dropdown-menu';
                    menu.innerHTML = `<div class="dropdown-option" data-action="rename">重命名</div>
                                      <div class="dropdown-option" data-action="color">更改颜色</div>
                                      <div class="dropdown-divider"></div>
                                      <div class="dropdown-option danger" data-action="delete">删除</div>`;
                    positionContextMenu(menu, e);
                    menu.addEventListener('click', async (me) => {
                        const action = me.target.dataset.action;
                        closeAllDropdowns();
                        if (action === 'rename') {
                            startRename();
                        } else if (action === 'delete') {
                            try {
                                await showCustomModal({ title: '删除子项目', message: `确定要删除子项目 "${cat.name}" 吗？所有属于此分类的任务将变为未分类。`, okText: '删除' });
                                recordState();
                                project.todos.forEach(t => { if (t.categoryId === cat.id) t.categoryId = null; });
                                project.categories = project.categories.filter(c => c.id !== cat.id);
                                if (currentFilter === cat.id) { handleFilterClick('all'); }
                                debouncedSave();
                                renderCategories();
                                renderTodos();
                            } catch {}
                        } else if (action === 'color') {
                            const colorInput = document.createElement('input');
                            colorInput.type = 'color';
                            colorInput.value = cat.color;
                            colorInput.style.position = 'absolute';
                            colorInput.style.opacity = '0';
                            document.body.appendChild(colorInput);
                            
                            colorInput.addEventListener('input', () => {
                                recordState();
                                cat.color = colorInput.value;
                                debouncedSave();
                                renderCategories(); // 实时更新按钮颜色
                                renderTodos();      // 实时更新任务标记颜色
                            });
                            
                            colorInput.addEventListener('change', () => { // 当颜色选择器关闭时
                                document.body.removeChild(colorInput);
                            }, { once: true });

                            colorInput.click();
                        }
                    });
                });
                // +++ END: 修改右键菜单 +++

                catBtn.appendChild(nameSpan); fragment.appendChild(catBtn);
            });
            addCategoryBtn.before(fragment);
        };

        const setActiveFilterButton = () => {
            filtersContainer.querySelectorAll('.active')?.forEach(el => {
                el.classList.remove('active');
                el.style.backgroundColor = ''; // 清除内联样式
                el.style.borderColor = '';
                el.style.color = '';
            });

            const buttonToActivate = filtersContainer.querySelector(`[data-filter="${currentFilter}"]`);
            if (buttonToActivate) {
                buttonToActivate.classList.add('active');
                 // +++ START: 为激活的分类按钮应用特殊样式 +++
                if (buttonToActivate.classList.contains('category-btn')) {
                    const category = project.categories.find(c => c.id === currentFilter);
                    if (category) {
                        // 使用 CSS 变量来驱动样式
                        buttonToActivate.style.setProperty('--category-color', category.color);
                    }
                }
                 // +++ END: 为激活的分类按钮应用特殊样式 +++
            } else {
                filtersContainer.querySelector('[data-filter="all"]').classList.add('active');
                currentFilter = 'all';
                project.activeFilter = 'all';
            }
        };

        const handleFilterClick = (filterId) => {
            currentFilter = filterId;
            project.activeFilter = currentFilter;
            // 不保存，因为这只是UI状态，不应触发undo
            // debouncedSave(); 
            setActiveFilterButton();
            renderTodos();
        };

        addForm.addEventListener('submit', e => {
            e.preventDefault();
            const text = todoInput.value.trim();
            if (text) {
                recordState();
                const newTodo = { id: Date.now(), text, textHtml: escapeHTML(text), completed: false, isImportant: false, isPriority: false, categoryId: currentFilter.startsWith('cat_') ? currentFilter : null, subtasks: [], textBold: false, textColor: null, planTime: null, remindTime: null, remindAt: null, remindNotified: false };
                project.todos.push(newTodo);
                debouncedSave();
                renderTodos();
                const newItem = todoList.querySelector(`[data-id="${newTodo.id}"]`);
                if (newItem) { newItem.classList.add('newly-added'); setTimeout(() => newItem.classList.remove('newly-added'), 400); }
                todoInput.value = '';
                todoInput.focus();
            }
        });

        filtersContainer.addEventListener('click', (e) => {
            const targetButton = e.target.closest('.filter-btn, .category-btn');
            if (targetButton) { handleFilterClick(targetButton.dataset.filter); }
        });

        addCategoryBtn.addEventListener('click', async () => {
            try {
                const name = await showCustomModal({ title: '创建新子项目', type: 'prompt', placeholder: '输入子项目名称', okText: '创建' });
                if (name?.trim()) {
                    recordState();
                    // +++ START: 创建新分类时自动分配颜色 +++
                    const newCategory = {
                        id: `cat_${Date.now()}`,
                        name: name.trim(),
                        color: CATEGORY_COLORS[project.categories.length % CATEGORY_COLORS.length]
                    };
                    project.categories.push(newCategory);
                    // +++ END: 创建新分类时自动分配颜色 +++
                    debouncedSave();
                    renderCategories();
                    setActiveFilterButton();
                }
            } catch {}
        });
        
        filtersContainer.addEventListener('dragover', (e) => {
            // ... (这部分保持不变)
            if (!draggedTaskInfo || draggedTaskInfo.sourceProjectId !== project.id) return;
            if (draggedTaskInfo.type !== 'task') return;
            const targetCategory = e.target.closest('.category-btn');
            if (targetCategory) {
                e.preventDefault();
                filtersContainer.querySelectorAll('.drop-zone-category').forEach(btn => btn.classList.remove('drop-zone-category'));
                targetCategory.classList.add('drop-zone-category');
            }
        });

        filtersContainer.addEventListener('dragleave', (e) => {
            // ... (这部分保持不变)
            const targetCategory = e.target.closest('.category-btn');
            if (targetCategory) {
                targetCategory.classList.remove('drop-zone-category');
            }
        });

        filtersContainer.addEventListener('drop', (e) => {
            // ... (这部分保持不变)
            e.preventDefault();
            if (!draggedTaskInfo || draggedTaskInfo.sourceProjectId !== project.id) return;
            const targetCategory = e.target.closest('.category-btn');
            if (targetCategory) {
                const categoryId = targetCategory.dataset.filter;
                const { draggedItemId, type } = draggedTaskInfo;
                if (type === 'task') {
                    const todo = project.todos.find(t => t.id == draggedItemId);
                    if (todo && todo.categoryId !== categoryId) {
                        todo.categoryId = categoryId;
                        recordState();
                        debouncedSave();
                        renderTodos(); 
                    }
                }
            }
            filtersContainer.querySelectorAll('.drop-zone-category').forEach(btn => btn.classList.remove('drop-zone-category'));
        });

        renderCategories();
        setActiveFilterButton();
    };

    const setupTodoListInteractions = () => {
        const enterEditMode = (textSpan, originalText, onSave, options = {}) => {
            const item = textSpan.closest('.todo-item, .sub-task-item');
            if (!item || container.querySelector('.edit-textarea')) return;
            item.draggable = false;

            if (options.rich) {
                const editor = document.createElement('div');
                editor.className = 'edit-rich';
                editor.contentEditable = 'true';
                editor.innerHTML = originalText || '';
                const autoResize = () => {
                    editor.style.height = '1px';
                    editor.style.height = editor.scrollHeight + 'px';
                };
                textSpan.replaceWith(editor);
                setTimeout(() => { editor.focus(); autoResize(); }, 0);

                const exitEditMode = () => {
                    const newHtml = editor.innerHTML.trim();
                    const newText = getPlainText(newHtml);
                    const newSpan = document.createElement('span');
                    newSpan.className = 'text';
                    onSave({ html: newHtml, text: newText });
                    editor.replaceWith(newSpan);
                    item.draggable = true;
                    editor.removeEventListener('blur', exitEditMode);
                    editor.removeEventListener('keydown', handleKeydown);
                    editor.removeEventListener('input', autoResize);
                    renderTodos();
                };

                const handleKeydown = (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); editor.blur(); }
                    if (e.key === 'Escape') { editor.innerHTML = originalText || ''; editor.blur(); }
                };
                editor.addEventListener('blur', exitEditMode, { once: true });
                editor.addEventListener('keydown', handleKeydown);
                editor.addEventListener('input', autoResize);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = originalText;
                textarea.className = 'edit-textarea';
                const autoResize = () => { textarea.style.height = '1px'; textarea.style.height = textarea.scrollHeight + 'px'; };
                textSpan.replaceWith(textarea);
                setTimeout(() => { textarea.focus(); textarea.select(); autoResize(); }, 0);

                const exitEditMode = () => {
                    const newText = textarea.value.trim();
                    const newSpan = document.createElement('span');
                    newSpan.className = 'text';
                    onSave(newText);
                    textarea.replaceWith(newSpan); item.draggable = true;
                    textarea.removeEventListener('blur', exitEditMode);
                    textarea.removeEventListener('keydown', handleKeydown);
                    textarea.removeEventListener('input', autoResize);
                    renderTodos();
                };

                const handleKeydown = (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textarea.blur(); }
                    if (e.key === 'Escape') { textarea.value = originalText; textarea.blur(); }
                };
                textarea.addEventListener('blur', exitEditMode, { once: true });
                textarea.addEventListener('keydown', handleKeydown);
                textarea.addEventListener('input', autoResize);
            }
        };

        const showTodoColorMenu = (e, todo) => {
            closeAllDropdowns();
            const menu = document.createElement('div');
            menu.className = 'custom-dropdown-menu custom-color-menu';
            const defaultTextColors = ['#000000', '#1d1d1f', '#d94336', '#f29d38', '#4285f4', '#34a853'];
            const swatchesHTML = defaultTextColors.map(color =>
                `<div class="color-swatch" data-value="${color}" style="background-color: ${color}"></div>`
            ).join('');
            menu.innerHTML = `<div class="color-swatches">${swatchesHTML}</div>`;
            positionContextMenu(menu, e);
            menu.addEventListener('mousedown', (me) => {
                me.preventDefault();
                const swatch = me.target.closest('.color-swatch');
                if (swatch) {
                    recordState();
                    todo.textColor = swatch.dataset.value;
                    debouncedSave();
                    renderTodos();
                    closeAllDropdowns();
                }
            });
        };

        todoList.addEventListener('click', e => { 
            const item = e.target.closest('.todo-item, .sub-task-item'); if (!item) return; 
            const isSubtask = item.classList.contains('sub-task-item');
            const parentItem = isSubtask ? item.closest('.todo-item') : item;
            const todoId = parentItem.dataset.id;
            const todo = project.todos.find(t => t.id == todoId); if (!todo) return;

            if (isSubtask) {
                const subtaskId = item.dataset.id;
                const subtask = todo.subtasks.find(st => st.id == subtaskId); if (!subtask) return;
                
                if (e.target.closest('.toggle')) { recordState(); subtask.completed = !subtask.completed; debouncedSave(); renderTodos(); } 
                else if (e.target.closest('.delete-btn')) { recordState(); todo.subtasks = todo.subtasks.filter(st => st.id != subtaskId); debouncedSave(); renderTodos(); }
            } else {
                if (e.target.closest('.toggle')) { recordState(); todo.completed = !todo.completed; debouncedSave(); renderTodos(); return; }
                if (e.target.closest('.delete-btn')) { recordState(); project.todos = project.todos.filter(t => t.id != todoId); debouncedSave(); renderTodos(); return; }
            }
        });

        todoList.addEventListener('contextmenu', e => {
            const item = e.target.closest('.todo-item'); if (!item) return;
            e.preventDefault(); closeAllDropdowns();
            const todoId = item.dataset.id; const todo = project.todos.find(t => t.id == todoId); if (!todo) return;
            const menu = document.createElement('div'); menu.className = 'custom-dropdown-menu';
            const importantText = todo.isImportant ? '取消重要' : '标记为重要';
            const priorityText = todo.isPriority ? '取消优先' : '标记为优先';
            const moveCategoryOption = project.categories.length > 0 ? `<div class="dropdown-option" data-action="move-category">移动到子项目...</div>` : '';
                const boldText = todo.textBold ? '取消加粗' : '加粗文本';
            menu.innerHTML = `
                <div class="dropdown-option" data-action="add-subtask">添加子任务</div>
                <div class="dropdown-divider"></div>
                <div class="dropdown-option" data-action="toggle-bold">${boldText}</div>
                <div class="dropdown-option" data-action="text-color">文本颜色</div>
                <div class="dropdown-option" data-action="plan-time">设置计划时间</div>
                <div class="dropdown-option" data-action="remind-time">设置任务提醒</div>
                <div class="dropdown-option" data-action="clear-plan">清除计划时间</div>
                <div class="dropdown-option" data-action="clear-remind">清除提醒</div>
                <div class="dropdown-divider"></div>
                <div class="dropdown-option" data-action="priority">${priorityText}</div>
                <div class="dropdown-option" data-action="important">${importantText}</div>
                ${moveCategoryOption}
                <div class="dropdown-divider"></div>
                <div class="dropdown-option danger" data-action="delete">删除任务</div>
            `;
            positionContextMenu(menu, e);
            
            menu.addEventListener('click', async me => {
                const action = me.target.dataset.action;
                if (action === 'move-category') {
                    const itemRect = item.getBoundingClientRect(); closeAllDropdowns();
                    const subMenu = document.createElement('div'); subMenu.className = 'custom-dropdown-menu';
                    let optionsHTML = `<div class="dropdown-option ${!todo.categoryId ? 'selected' : ''}" data-cat-id="null">未分类</div>`;
                    project.categories.forEach(cat => { optionsHTML += `<div class="dropdown-option ${todo.categoryId === cat.id ? 'selected' : ''}" data-cat-id="${cat.id}">${escapeHTML(cat.name)}</div>`; });
                    subMenu.innerHTML = optionsHTML; document.body.appendChild(subMenu);
                    subMenu.style.top = `${itemRect.top + window.scrollY}px`;
                    subMenu.style.left = `${itemRect.right + window.scrollX + 5}px`;
                    requestAnimationFrame(() => subMenu.classList.add('visible'));
                    subMenu.addEventListener('click', (sme) => { const opt = sme.target.closest('.dropdown-option'); if(opt) { const newCatId = opt.dataset.catId === 'null' ? null : opt.dataset.catId; if(todo.categoryId != newCatId) { recordState(); todo.categoryId = newCatId; debouncedSave(); renderTodos(); } closeAllDropdowns(); } });
                    return;
                }
                closeAllDropdowns();
                if (action === 'edit') { 
                    const textSpan = item.querySelector('.text');
                    const originHtml = todo.textHtml ? todo.textHtml : escapeHTML(todo.text || '');
                    enterEditMode(textSpan, originHtml, (result) => {
                        const newText = result?.text || '';
                        const newHtml = result?.html || '';
                        if (newText) {
                            if (newText !== todo.text || newHtml !== todo.textHtml) {
                                recordState();
                                todo.text = newText;
                                todo.textHtml = newHtml;
                                debouncedSave();
                            }
                        } else {
                            recordState();
                            project.todos = project.todos.filter(t => t.id != todo.id);
                            debouncedSave();
                        }
                    }, { rich: true });
                } 
                else if (action === 'priority') { recordState(); todo.isPriority = !todo.isPriority; debouncedSave(); renderTodos(); }
                else if (action === 'important') { recordState(); todo.isImportant = !todo.isImportant; debouncedSave(); renderTodos(); }
                else if (action === 'delete') { recordState(); project.todos = project.todos.filter(t => t.id != todoId); debouncedSave(); renderTodos(); }
                else if (action === 'add-subtask') {
                    recordState();
                    const newSubtask = { id: `sub_${Date.now()}`, text: '新子任务', completed: false };
                    todo.subtasks.push(newSubtask);
                    debouncedSave();
                    renderTodos();
                    const newSubtaskEl = todoList.querySelector(`.sub-task-item[data-id="${newSubtask.id}"]`);
                    if (newSubtaskEl) {
                        const textSpan = newSubtaskEl.querySelector('.text');
                    enterEditMode(textSpan, newSubtask.text, (newText) => {
                            if (newText && newText !== newSubtask.text) { recordState(); newSubtask.text = newText; debouncedSave();} 
                            else if (!newText) { recordState(); todo.subtasks = todo.subtasks.filter(st => st.id != newSubtask.id); debouncedSave(); }
                        });
                    }
                }
                else if (action === 'toggle-bold') {
                    recordState();
                    const rawText = todo.textHtml ? todo.textHtml : escapeHTML(todo.text || '');
                    if (rawText.startsWith('<strong>') && rawText.endsWith('</strong>')) {
                        todo.textHtml = rawText.replace(/^<strong>/, '').replace(/<\/strong>$/, '');
                        todo.text = getPlainText(todo.textHtml);
                        todo.textBold = false;
                    } else {
                        todo.textHtml = `<strong>${rawText}</strong>`;
                        todo.text = getPlainText(todo.textHtml);
                        todo.textBold = true;
                    }
                    debouncedSave();
                    renderTodos();
                }
                else if (action === 'text-color') {
                    showTodoColorMenu(e, todo);
                }
                else if (action === 'plan-time') {
                    const value = await showCustomModal({
                        title: '设置计划时间',
                        type: 'prompt',
                        inputType: 'datetime-local',
                        initialValue: formatDateTimeLocalInput(todo.planTime),
                        message: `当前时间：${formatDateTime(new Date())}`
                    });
                    if (!value) return;
                    const iso = parseDateTimeInput(value);
                    if (!iso) { showToast('时间格式无效', 'error'); return; }
                    recordState();
                    todo.planTime = iso;
                    debouncedSave();
                    renderTodos();
                }
                else if (action === 'remind-time') {
                    const value = await showCustomModal({
                        title: '设置任务提醒',
                        type: 'prompt',
                        inputType: 'datetime-local',
                        initialValue: formatDateTimeLocalInput(todo.remindTime),
                        message: `当前时间：${formatDateTime(new Date())}`
                    });
                    if (!value) return;
                    const iso = parseDateTimeInput(value);
                    const due = parseDateTimeToMs(value);
                    if (!iso || due === null) { showToast('时间格式无效', 'error'); return; }
                    if (due <= Date.now()) {
                        showToast('提醒时间需晚于当前时间', 'error');
                        logReminderEvent('remind_time_invalid', { input: value, due, now: Date.now(), todoId: todo.id });
                        return;
                    }
                    recordState();
                    todo.remindTime = iso;
                    todo.remindAt = due;
                    todo.remindNotified = false;
                    debouncedSave();
                    renderTodos();
                    scheduleNextReminder();
                    logReminderEvent('remind_time_set', { input: value, due, now: Date.now(), todoId: todo.id });
                }
                else if (action === 'clear-plan') {
                    recordState();
                    todo.planTime = null;
                    debouncedSave();
                    renderTodos();
                }
                else if (action === 'clear-remind') {
                    recordState();
                    todo.remindTime = null;
                    todo.remindAt = null;
                    todo.remindNotified = false;
                    debouncedSave();
                    renderTodos();
                    scheduleNextReminder();
                }
            });
        });

        todoList.addEventListener('dblclick', e => {
            const item = e.target.closest('.todo-item, .sub-task-item');
            const textSpan = e.target.closest('.text');

            // --- 场景1: 双击了现有任务的文本区域 (保持不变) ---
            if (textSpan && item) {
                const isSubtask = item.classList.contains('sub-task-item');
                const parentItem = isSubtask ? item.closest('.todo-item') : item;
                const todo = project.todos.find(t => t.id == parentItem.dataset.id);
                if (!todo) return;

                if (isSubtask) {
                    const subtask = todo.subtasks.find(st => st.id == item.dataset.id);
                    if (subtask) {
                        enterEditMode(textSpan, subtask.text, (newText) => {
                             if (newText && newText !== subtask.text) { recordState(); subtask.text = newText; debouncedSave();} 
                             else if (!newText) { recordState(); todo.subtasks = todo.subtasks.filter(st => st.id != subtask.id); debouncedSave();}
                        });
                    }
                } else {
                     const originHtml = todo.textHtml ? todo.textHtml : escapeHTML(todo.text || '');
                     enterEditMode(textSpan, originHtml, (result) => {
                        const newText = result?.text || '';
                        const newHtml = result?.html || '';
                        if (newText) {
                            if (newText !== todo.text || newHtml !== todo.textHtml) {
                                recordState();
                                todo.text = newText;
                                todo.textHtml = newHtml;
                                debouncedSave();
                            }
                        } else {
                            recordState();
                            project.todos = project.todos.filter(t => t.id != todo.id);
                            debouncedSave();
                        }
                    }, { rich: true });
                }
                return;
            }

            // --- 场景2: 双击了任务列表的空白区域 (优化版) ---
            if (!item) {
                recordState();
                
                const newTodo = { 
                    id: Date.now(), 
                    // +++ 关键改动 1: 初始文本为空 +++
                    text: '',
                    textHtml: '',
                    completed: false, 
                    isImportant: false, 
                    isPriority: false,
                    categoryId: currentFilter.startsWith('cat_') ? currentFilter : null, 
                    subtasks: [],
                    textBold: false,
                    textColor: null,
                    planTime: null,
                    remindTime: null,
                    remindAt: null,
                    remindNotified: false
                };
                
                project.todos.push(newTodo);
                // 注意：这里我们先不保存，等待用户输入
                
                renderTodos();

                const newItemElement = todoList.querySelector(`.todo-item[data-id="${newTodo.id}"]`);
                if (newItemElement) {
                    const newTextSpan = newItemElement.querySelector('.text');
                    if (newTextSpan) {
                        enterEditMode(newTextSpan, newTodo.text, (newText) => {
                            // +++ 关键改动 2: 只有在有有效文本时才保存 +++
                            if (newText) { // newText 是 trim() 后的结果，所以空格会被视为空
                                recordState();
                                newTodo.text = newText;
                                debouncedSave(); // 此时才真正保存
                            } else {
                                // 如果没有有效文本，则从数组中移除这个临时任务
                                project.todos = project.todos.filter(t => t.id != newTodo.id);
                                // 不需要保存，因为它从未被有效创建过
                                renderTodos(); // 重新渲染以移除界面上的空任务
                            }
                        });
                    }
                }
            }
        });
    };
    
    const handleTodoListDrop = (e) => {
        if (draggedTaskInfo && draggedTaskInfo.sourceProjectId !== project.id) {
            return; // 跨项目拖放由父容器处理
        }
        e.preventDefault();
        e.stopPropagation();

        if (!draggedTaskInfo) return cleanupDragDropState();
        
        const { draggedItemId, sourceParentTodoId, type } = draggedTaskInfo;
        
        // 找到被拖动的数据项
        let draggedItemData;
        let sourceArray, sourceIndex;

        if (type === 'subtask') {
            const parentTodo = project.todos.find(t => t.id == sourceParentTodoId);
            if (!parentTodo) return cleanupDragDropState();
            sourceArray = parentTodo.subtasks;
            sourceIndex = sourceArray.findIndex(st => st.id == draggedItemId);
        } else { // 'task'
            sourceArray = project.todos;
            sourceIndex = sourceArray.findIndex(t => t.id == draggedItemId);
        }

        if (sourceIndex === -1) return cleanupDragDropState();
        
        // 记录变更前状态，便于撤销
        recordState();

        // 从原数组中移除
        [draggedItemData] = sourceArray.splice(sourceIndex, 1);
        
        let operationPerformed = false;
        // 优先查找子任务上的指示器，然后是主任务
        let dropTargetEl = document.querySelector('.sub-task-item.drop-indicator-top, .sub-task-item.drop-indicator-bottom');
        if (!dropTargetEl) {
            dropTargetEl = document.querySelector('.todo-item.drop-indicator-top, .todo-item.drop-indicator-bottom, .drop-zone-parent, .todo-item-placeholder');
        }

        if (dropTargetEl) {
            if (type === 'subtask') {
                // --- 拖动的是子任务 ---
                if (dropTargetEl.classList.contains('sub-task-item')) {
                    // 放置到另一个子任务位置（排序）
                    const targetParentTodo = project.todos.find(t => t.id == dropTargetEl.dataset.id);
                    if (targetParentTodo && targetParentTodo.subtasks) {
                        // 使用 dragover 中保存的目标索引（基于完整数组的索引）
                        let targetSubtaskIndex = draggedTaskInfo.targetSubtaskIndex;
                        
                        if (targetSubtaskIndex !== undefined && targetSubtaskIndex !== -1) {
                            // 检查源和目标是否在同一个父任务中
                            const sourceParentTodo = project.todos.find(t => t.id == sourceParentTodoId);
                            const isSameParent = sourceParentTodo === targetParentTodo;
                            
                            // 计算插入位置
                            let insertIndex;
                            if (dropTargetEl.classList.contains('drop-indicator-top')) {
                                // 插入到目标子任务之前
                                insertIndex = targetSubtaskIndex;
                                // 如果源在目标之前，且是同一个父任务，需要+1补偿
                                // 因为源子任务被移除后，目标前移了一位
                                if (isSameParent && sourceIndex < targetSubtaskIndex) {
                                    insertIndex++;
                                }
                            } else {
                                // 插入到目标子任务之后
                                insertIndex = targetSubtaskIndex + 1;
                                // 如果源在目标之前，且是同一个父任务，需要-1补偿
                                // 因为源子任务被移除后，目标前移了一位
                                if (isSameParent && sourceIndex < targetSubtaskIndex) {
                                    insertIndex--;
                                }
                            }
                            
                            targetParentTodo.subtasks.splice(insertIndex, 0, draggedItemData);
                            operationPerformed = true;
                        }
                    }
                } else if (dropTargetEl.classList.contains('todo-item')) {
                    // 放置到主任务上（变为该主任务的子任务）
                    const targetParentTodo = project.todos.find(t => t.id == dropTargetEl.dataset.id);
                    if (targetParentTodo) {
                        targetParentTodo.subtasks = targetParentTodo.subtasks || [];
                        targetParentTodo.subtasks.push(draggedItemData);
                        operationPerformed = true;
                    }
                }
            } else {
                // --- 拖动的是主任务 ---
                if (dropTargetEl.classList.contains('drop-zone-parent')) {
                    // 放置为子任务
                    const targetParentTodo = project.todos.find(t => t.id == dropTargetEl.dataset.id);
                    if (targetParentTodo && targetParentTodo.id != draggedItemId) {
                        targetParentTodo.subtasks = targetParentTodo.subtasks || [];
                        const newSubtask = { id: `sub_${Date.now()}`, text: draggedItemData.text, completed: draggedItemData.completed };
                        targetParentTodo.subtasks.push(newSubtask);
                        if (draggedItemData.subtasks?.length) {
                             targetParentTodo.subtasks.push(...draggedItemData.subtasks);
                        }
                        operationPerformed = true;
                    }
                } else if (dropTargetEl.classList.contains('todo-item')) {
                    // 排序主任务
                    const targetId = dropTargetEl.dataset.id;
                    const targetIndex = project.todos.findIndex(t => t.id == targetId);
                    if (targetIndex !== -1) {
                         const insertIndex = dropTargetEl.classList.contains('drop-indicator-top') ? targetIndex : targetIndex + 1;
                         project.todos.splice(insertIndex, 0, draggedItemData);
                         operationPerformed = true;
                    }
                } else if (dropTargetEl.classList.contains('todo-item-placeholder')) {
                    // 列表为空时直接放入
                    project.todos.push(draggedItemData);
                    operationPerformed = true;
                }
            }
        } else if (type === 'task') {
            // 如果没有明确的放置目标，主任务添加到末尾
            project.todos.push(draggedItemData);
            operationPerformed = true;
        }

        if (operationPerformed) {
            debouncedSave();
        } else {
            // 操作未成功，将数据项放回原处
            sourceArray.splice(sourceIndex, 0, draggedItemData);
        }

        renderTodos();
        cleanupDragDropState();
    };

    const setupDragAndDrop = () => {
        // 用于缓存上一次拖动悬停信息，避免不必要的DOM操作，提升性能
        let lastDragOverInfo = { target: null, indicator: '' };

        // 任务开始拖动
        todoList.addEventListener('dragstart', (e) => {
            const draggedEl = e.target.closest('.todo-item, .sub-task-item');
            if (!draggedEl) return;
            
            // 使用 setTimeout 确保拖动元素的视觉样式在下一帧应用
            setTimeout(() => {
                draggedEl.classList.add('dragging-task');
                document.body.classList.add('body-dragging');
            }, 0);

            const isSubtask = draggedEl.classList.contains('sub-task-item');
            const parentTodoEl = isSubtask ? draggedEl.closest('.todo-item') : null;

            const draggedId = isSubtask ? draggedEl.dataset.subId : draggedEl.dataset.id;
            if (!draggedId) {
                console.error('无法获取拖动项ID');
                return;
            }
            
            draggedTaskInfo = {
                sourceProjectId: project.id,
                draggedItemId: draggedId,
                sourceParentTodoId: isSubtask ? parentTodoEl.dataset.id : null,
                type: isSubtask ? 'subtask' : 'task'
            };
            // 重置缓存
            lastDragOverInfo = { target: null, indicator: '' };
        });

        // 任务在可放置区域上移动
        todoList.addEventListener('dragover', (e) => {
            if (!draggedTaskInfo) return;
            e.preventDefault(); 
            e.dataTransfer.dropEffect = 'move';
            
            const draggedEl = todoList.querySelector('.dragging-task');
            // 如果 dragging-task 类还没有被添加，使用 draggedTaskInfo 中的信息
            const draggedItemId = draggedTaskInfo.draggedItemId;

            const hoverTargetItem = e.target.closest('.todo-item');
            const hoverTargetSubItem = e.target.closest('.sub-task-item');
            
            let currentTarget = null;
            let currentIndicator = '';

            // --- 统一的排序和父子关系判断逻辑 ---
            // 检查悬停目标是否是当前拖动的元素
            const isHoveringDraggedItem = hoverTargetSubItem && hoverTargetSubItem.dataset.subId === draggedItemId;
            if (draggedTaskInfo.type === 'subtask' && hoverTargetSubItem && !isHoveringDraggedItem) {
                // 场景1: 拖动子任务，在其他子任务之间排序
                const parentTodoEl = hoverTargetSubItem.closest('.todo-item');
                if (parentTodoEl) {
                    currentTarget = hoverTargetSubItem;
                    const rect = hoverTargetSubItem.getBoundingClientRect();
                    currentIndicator = (e.clientY - rect.top < rect.height / 2) ? 'top' : 'bottom';
                    
                    // 保存目标信息用于 drop（基于完整数组的索引）
                    const targetParentTodo = project.todos.find(t => t.id == parentTodoEl.dataset.id);
                    if (targetParentTodo && targetParentTodo.subtasks) {
                        const targetSubtaskId = hoverTargetSubItem.dataset.subId;
                        const targetSubtaskIndex = targetParentTodo.subtasks.findIndex(st => st.id == targetSubtaskId);
                        draggedTaskInfo.targetSubtaskIndex = targetSubtaskIndex;
                        draggedTaskInfo.targetParentTodoId = parentTodoEl.dataset.id;
                    }
                }
            } else if (draggedTaskInfo.type === 'subtask' && hoverTargetItem && hoverTargetItem.dataset.id !== draggedTaskInfo.sourceParentTodoId) {
                // 场景1b: 拖动子任务，悬停在主任务上（可以变为该主任务的子任务）
                currentTarget = hoverTargetItem;
                const rect = hoverTargetItem.getBoundingClientRect();
                currentIndicator = (e.clientY - rect.top < rect.height / 2) ? 'top' : 'bottom';
            } else if (hoverTargetItem && hoverTargetItem.dataset.id !== draggedItemId) {
                // 场景2: 拖动主任务，进行排序或变为子任务
                currentTarget = hoverTargetItem;
                const isHoverOnMainPart = e.target.closest('.todo-item-main');
                const canBecomeSubtask = draggedTaskInfo.type === 'task';
                
                // 仅当拖动主任务并悬停在另一个主任务的主要区域时，才显示“变为子任务”的高亮
                if (isHoverOnMainPart && canBecomeSubtask) {
                    currentIndicator = 'parent';
                } else { // 否则，显示排序指示线
                    const rect = hoverTargetItem.getBoundingClientRect();
                    currentIndicator = (e.clientY - rect.top < rect.height / 2) ? 'top' : 'bottom';
                }
            } else if (!hoverTargetItem && !hoverTargetSubItem) {
                // 场景3: 拖动到列表的空白区域 (顶部或底部)
                const draggableElements = [...todoList.querySelectorAll('.todo-item:not(.dragging-task)')];
                if (draggableElements.length > 0) {
                    const firstElRect = draggableElements[0].getBoundingClientRect();
                    const lastElRect = draggableElements[draggableElements.length - 1].getBoundingClientRect();
                    if (e.clientY < firstElRect.top) {
                        currentTarget = draggableElements[0];
                        currentIndicator = 'top';
                    } else if (e.clientY > lastElRect.bottom) {
                        currentTarget = draggableElements[draggableElements.length - 1];
                        currentIndicator = 'bottom';
                    }
                } else if (draggedTaskInfo.type === 'task') {
                    // 如果列表为空，则显示一个占位符作为放置目标
                    let placeholder = todoList.querySelector('.todo-item-placeholder');
                    if (!placeholder) {
                        placeholder = document.createElement('div');
                        placeholder.className = 'todo-item-placeholder';
                        todoList.appendChild(placeholder);
                    }
                    currentTarget = placeholder;
                    currentIndicator = 'bottom'; 
                }
            }

            // --- 性能优化：只有在目标或指示器变化时才更新DOM ---
            if (lastDragOverInfo.target === currentTarget && lastDragOverInfo.indicator === currentIndicator) {
                return;
            }
            lastDragOverInfo = { target: currentTarget, indicator: currentIndicator };

            // 清理所有旧的指示器
            document.querySelectorAll('.drop-indicator-top, .drop-indicator-bottom, .drop-zone-parent').forEach(el => {
                el.classList.remove('drop-indicator-top', 'drop-indicator-bottom', 'drop-zone-parent');
            });
            todoList.querySelector('.todo-item-placeholder')?.remove();

            // 应用新的指示器
            if (currentTarget) {
                if (currentIndicator === 'top') currentTarget.classList.add('drop-indicator-top');
                else if (currentIndicator === 'bottom') currentTarget.classList.add('drop-indicator-bottom');
                else if (currentIndicator === 'parent') currentTarget.classList.add('drop-zone-parent');
            }
        });
        
        // 任务放置
        todoList.addEventListener('drop', (e) => {
            handleTodoListDrop(e);
        });
    };

    setupProjectHeader();
    setupFiltersAndCategories();
    setupTodoListInteractions();
    setupDragAndDrop();

    container.addEventListener('dragover', e => {
        // 检查是否有任务正在被拖动，并且这个任务不属于当前项目
        if (draggedTaskInfo && draggedTaskInfo.sourceProjectId !== project.id) {
            e.preventDefault(); // 允许放置
            e.stopPropagation(); // 防止事件冒泡到上层
            container.classList.add('drop-zone-project'); // 添加高亮样式
        } else if (draggedTaskInfo && draggedTaskInfo.sourceProjectId === project.id) {
            // 允许在项目窗口顶部区域放置（比如过滤栏/标题区域）
            e.preventDefault();
            e.stopPropagation();
        }
    });

    container.addEventListener('dragleave', () => {
        // 鼠标离开时移除高亮
        container.classList.remove('drop-zone-project');
    });

    container.addEventListener('drop', e => {
        // 同项目拖放由 todoList 自己处理
        if (!draggedTaskInfo || draggedTaskInfo.sourceProjectId === project.id) {
            container.classList.remove('drop-zone-project');
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        container.classList.remove('drop-zone-project');

        const { sourceProjectId, draggedItemId, sourceParentTodoId, type } = draggedTaskInfo;

        const sourceWorkspace = workspaces[currentWorkspaceIndex];
        const sourceProject = sourceWorkspace.projects[sourceProjectId];
        if (!sourceProject) return cleanupDragDropState();

        let draggedItemData;
        let sourceArray, sourceIndex;

        if (type === 'subtask') {
            const parentTodo = sourceProject.todos.find(t => t.id == sourceParentTodoId);
            if (!parentTodo) return cleanupDragDropState();
            sourceArray = parentTodo.subtasks;
            sourceIndex = sourceArray.findIndex(st => st.id == draggedItemId);
        } else {
            sourceArray = sourceProject.todos;
            sourceIndex = sourceArray.findIndex(t => t.id == draggedItemId);
        }

        if (sourceIndex > -1) {
            // 记录变更前状态，便于撤销
            recordState();
            [draggedItemData] = sourceArray.splice(sourceIndex, 1);

            if (type === 'subtask') {
                draggedItemData = {
                    id: Date.now(), text: draggedItemData.text, completed: draggedItemData.completed,
                    isImportant: false, isPriority: false, categoryId: null, subtasks: []
                };
            }

            if (project.activeFilter && project.activeFilter.startsWith('cat_')) {
                draggedItemData.categoryId = project.activeFilter;
            } else {
                draggedItemData.categoryId = null;
            }

            project.todos ??= [];
            project.todos.push(draggedItemData);

            const activeFilter = project.activeFilter || 'all';
            const shouldShow =
                activeFilter === 'all' ||
                (activeFilter === 'active' && !draggedItemData.completed) ||
                (activeFilter === 'completed' && draggedItemData.completed) ||
                (activeFilter.startsWith('cat_') && draggedItemData.categoryId === activeFilter);
            if (!shouldShow) {
                project.activeFilter = 'all';
            }

            debouncedSave();

            // +++ START: 关键修复 - 保持 Z-Index +++
            
            // 1. 在重新渲染前，保存当前所有项目窗口的 z-index
            const zIndexMap = new Map();
            document.querySelectorAll('.project-container, .note-container, .shape-container, .emoji-container, .photo-container').forEach(el => {
                const id = el.dataset.projectId || el.dataset.noteId || el.dataset.shapeId || el.dataset.emojiId || el.dataset.photoId;
                if (id) {
                    zIndexMap.set(id, el.style.zIndex);
                }
            });
            
            // 2. 调用全局刷新
            renderCurrentWorkspace();
            
            // 3. 重新渲染后，恢复所有窗口的 z-index
            requestAnimationFrame(() => {
                zIndexMap.forEach((zIndex, id) => {
                    const el = document.querySelector(`[data-project-id="${id}"], [data-note-id="${id}"], [data-shape-id="${id}"], [data-emoji-id="${id}"]`);
                    if (el && zIndex) {
                        el.style.zIndex = zIndex;
                    }
                });
            });
            
            // +++ END: 关键修复 +++
        }

        cleanupDragDropState();
    });

    container.style.zIndex = project.zIndex || 1;
    container.addEventListener('mousedown', () => {
        if (parseInt(container.style.zIndex || 0) < highestZIndex - 1) {
            const newZ = highestZIndex++;
            container.style.zIndex = newZ;
            project.zIndex = newZ;
            if (!isWindowDragActive) {
                recordState();
            }
            debouncedSave();
        }
    });

    appContainer.appendChild(node);
    applyProjectStyles(container, project);
    renderTodos();
    makeDraggableAndResizable(container, project);
    return container;
}

function toggleWorkspaceSwitcher() {
    isSwitcherVisible = !isSwitcherVisible;
    // 新增：将状态保存到 localStorage
    localStorage.setItem('workspaceSwitcherVisible', isSwitcherVisible);
    workspaceSwitcherContainer.classList.toggle('switcher-visible', isSwitcherVisible);
    if (isSwitcherVisible) {
        animateWorkspaceTabs();
    }
}

function animateWorkspaceTabs() {
    workspaceSwitcher.classList.remove('tabs-ready');
    requestAnimationFrame(() => {
        workspaceSwitcher.classList.add('tabs-ready');
    });
}

function renderWorkspaceSwitcher() {
    workspaceSwitcher.innerHTML = '';
    workspaceSwitcherContainer.style.display = 'block';
    const indicator = document.createElement('div');
    indicator.className = 'workspace-switcher-indicator';
    workspaceSwitcher.appendChild(indicator);
    workspaces.forEach((ws, index) => {
        const displayName = (ws.name || '').trim() || '未命名工作区';
        const tab = document.createElement('button');
        tab.className = 'workspace-tab';
        tab.textContent = displayName;
        tab.dataset.index = index;
        tab.draggable = true;
        if (index === currentWorkspaceIndex) { tab.classList.add('active'); }
        workspaceSwitcher.appendChild(tab);
    });
    if (addWorkspaceBtn) {
        addWorkspaceBtn.classList.add('workspace-add-btn');
        workspaceSwitcher.appendChild(addWorkspaceBtn);
    }
    if (isSwitcherVisible) {
        animateWorkspaceTabs();
    }
    updateWorkspaceSwitcherIndicator();
}

let workspaceSwitcherRafId = null;
const scheduleRenderWorkspaceSwitcher = () => {
    if (workspaceSwitcherRafId) return;
    workspaceSwitcherRafId = requestAnimationFrame(() => {
        workspaceSwitcherRafId = null;
        renderWorkspaceSwitcher();
    });
};

function updateWorkspaceSwitcherActive() {
    const tabs = Array.from(workspaceSwitcher.querySelectorAll('.workspace-tab'));
    if (tabs.length !== workspaces.length) {
        scheduleRenderWorkspaceSwitcher();
        return;
    }
    tabs.forEach((tab, index) => {
        if (index === currentWorkspaceIndex) tab.classList.add('active');
        else tab.classList.remove('active');
        if (workspaces[index]) {
            const displayName = (workspaces[index].name || '').trim() || '未命名工作区';
            if (tab.textContent !== displayName) {
                tab.textContent = displayName;
            }
        }
    });
    updateWorkspaceSwitcherIndicator();
}

function updateWorkspaceSwitcherIndicator() {
    const indicator = workspaceSwitcher.querySelector('.workspace-switcher-indicator');
    const activeTab = workspaceSwitcher.querySelector('.workspace-tab.active');
    if (!indicator || !activeTab) return;
    const containerRect = workspaceSwitcher.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    const left = tabRect.left - containerRect.left;
    const width = tabRect.width;
    indicator.style.width = `${width}px`;
    indicator.style.transform = `translateX(${left}px)`;
    indicator.style.opacity = '1';
}

function switchWorkspace(newIndex) {
    if (newIndex === currentWorkspaceIndex) return;
    document.body.classList.add('body-switching');
    resetHistory();
    highestZIndex = 1;
    const direction = newIndex > currentWorkspaceIndex || (newIndex === 0 && currentWorkspaceIndex === workspaces.length - 1) ? 'right' : 'left';
    appContainer.classList.add(direction === 'right' ? 'switching-out-left' : 'switching-out-right');
    setTimeout(() => {
        currentWorkspaceIndex = newIndex;
        saveWorkspaces();
        renderCurrentWorkspace();
        updateWorkspaceSwitcherActive();
        appContainer.style.transition = 'none';
        appContainer.classList.remove('switching-out-left', 'switching-out-right');
        appContainer.classList.add(direction === 'right' ? 'switching-out-right' : 'switching-out-left');
        requestAnimationFrame(() => {
            appContainer.style.transition = 'transform 0.35s ease-in-out, opacity 0.35s ease-in-out';
            appContainer.classList.remove('switching-out-left', 'switching-out-right');
        });
        setTimeout(() => {
            document.body.classList.remove('body-switching');
        }, 350);
    }, 350);
}

function applyZoom(zoom) {
    if (appContainer) {
        appContainer.style.transform = `scale(${zoom})`;
    }
    localStorage.setItem('appZoomLevel', zoom);
    scheduleUpdateBodySize();
}
    
function renderCurrentWorkspace() {
    appContainer.innerHTML = '';
    clearWindowSelection();
    // 关闭打开的文件夹面板
    if (openFolderPanel) {
        closeFolderPanel();
    }
    if (focusedWindow) {
        focusedWindow.classList.remove('window-focused');
        focusedWindow = null;
    }
    if (!workspaces.length || !workspaces[currentWorkspaceIndex]) {
        workspaceNameEl.textContent = '无工作区'; checkEmptyState(null); return;
    }
    const currentWorkspace = workspaces[currentWorkspaceIndex];
    currentWorkspace.notes = currentWorkspace.notes || {};
    currentWorkspace.shapes = currentWorkspace.shapes || {};
    currentWorkspace.emojis = currentWorkspace.emojis || {};
    currentWorkspace.photos = currentWorkspace.photos || {};
    currentWorkspace.folders = currentWorkspace.folders || {};
    if (workspaceNameEl) {
        workspaceNameEl.textContent = currentWorkspace.name;
    }

    let maxZ = 0;
    Object.values(currentWorkspace.projects).forEach(proj => {
        maxZ = Math.max(maxZ, proj.zIndex || 0);
    });
    Object.values(currentWorkspace.notes).forEach(note => {
        maxZ = Math.max(maxZ, note.zIndex || 0);
    });
    highestZIndex = maxZ + 1;

    let maxShapeZ = SHAPE_Z_INDEX_BASE;
    Object.values(currentWorkspace.shapes).forEach(shape => {
        maxShapeZ = Math.max(maxShapeZ, shape.zIndex || 0);
    });
    highestShapeZIndex = maxShapeZ + 1;

    let maxEmojiZ = EMOJI_Z_INDEX_BASE;
    Object.values(currentWorkspace.emojis).forEach(emoji => {
        maxEmojiZ = Math.max(maxEmojiZ, emoji.zIndex || 0);
    });
    highestEmojiZIndex = maxEmojiZ + 1;

    let maxPhotoZ = PHOTO_Z_INDEX_BASE;
    Object.values(currentWorkspace.photos).forEach(photo => {
        maxPhotoZ = Math.max(maxPhotoZ, photo.zIndex || 0);
    });
    highestPhotoZIndex = maxPhotoZ + 1;

    let maxFolderZ = FOLDER_Z_INDEX_BASE;
    Object.values(currentWorkspace.folders).forEach(folder => {
        maxFolderZ = Math.max(maxFolderZ, folder.zIndex || 0);
    });
    highestFolderZIndex = maxFolderZ + 1;

    // 只渲染不在文件夹中的项目/便签/图片
    Object.values(currentWorkspace.projects).forEach(proj => {
        if (!proj.folderId) createProjectPane(proj, currentWorkspace);
    });
    Object.values(currentWorkspace.notes).forEach(note => {
        if (!note.folderId) createNotePane(note);
    });
    Object.values(currentWorkspace.shapes).forEach(shape => createShapePane(shape));
    Object.values(currentWorkspace.emojis).forEach(emoji => createEmojiPane(emoji));
    Object.values(currentWorkspace.photos).forEach(photo => {
        if (!photo.folderId) createPhotoPane(photo);
    });
    // 渲染文件夹
    Object.values(currentWorkspace.folders).forEach(folder => createFolderPane(folder));
    
    if (Object.keys(currentWorkspace.shapes).length || Object.keys(currentWorkspace.emojis).length || Object.keys(currentWorkspace.photos).length) {
        normalizeLayerAll();
    }
    checkEmptyState(currentWorkspace);
}

function checkEmptyState(workspace) {
    let welcome = document.querySelector('.welcome-screen');
    const hasContent = workspace && (
        Object.keys(workspace.projects).length > 0 ||
        (workspace.notes && Object.keys(workspace.notes).length > 0) ||
        (workspace.shapes && Object.keys(workspace.shapes).length > 0) ||
        (workspace.emojis && Object.keys(workspace.emojis).length > 0) ||
        (workspace.photos && Object.keys(workspace.photos).length > 0) ||
        (workspace.folders && Object.keys(workspace.folders).length > 0)
    );
    if (!hasContent) {
        if (!welcome) appContainer.insertAdjacentHTML('afterbegin', `<div class="welcome-screen"><h2>工作区为空</h2><p>点击右下角 '+' 创建新项目或便签</p></div>`);
    } else { if (welcome) welcome.remove(); }
}

function cleanupDragDropState() {
    document.body.classList.remove('body-dragging');
    const draggedEl = document.querySelector('.dragging-task');
    if(draggedEl) draggedEl.classList.remove('dragging-task');
    document.querySelectorAll('.drop-zone-project, .drop-zone-category, .drag-over, .drag-over-cat, .drop-zone-parent, .drop-indicator-top, .drop-indicator-bottom').forEach(el => 
        el.classList.remove('drop-zone-project', 'drop-zone-category', 'drag-over', 'drag-over-cat', 'drop-zone-parent', 'drop-indicator-top', 'drop-indicator-bottom')
    );
    // 清理 draggedTaskInfo 中的临时数据
    if (draggedTaskInfo) {
        delete draggedTaskInfo.targetSubtaskIndex;
        delete draggedTaskInfo.targetParentTodoId;
    }
    document.querySelectorAll('.todo-list.drop-zone-promote').forEach(el => el.classList.remove('drop-zone-promote'));
    // 防止拖拽中残留样式导致的重要任务高亮异常
    if (workspaces[currentWorkspaceIndex]) {
        const todosById = new Map();
        Object.values(workspaces[currentWorkspaceIndex].projects).forEach(project => {
            (project.todos || []).forEach(todo => {
                todosById.set(String(todo.id), {
                    important: !!todo.isImportant,
                    priority: !!todo.isPriority
                });
            });
        });
        document.querySelectorAll('.todo-item').forEach(item => {
            const id = item.dataset.id;
            const flags = todosById.get(id) || {};
            item.classList.toggle('important-task', flags.important === true);
            item.classList.toggle('priority-task', flags.priority === true);
        });
    }
    draggedTaskInfo = null;
}

function setupGlobalListeners() {
    
    exportBtn?.addEventListener('click', exportData);
    importBtn?.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', handleImport);
    statsBtn?.addEventListener('click', openStatistics);
    statsModal.addEventListener('click', e => { if (e.target === statsModal || e.target.matches('.modal-close-btn')) closeStatistics(); });
    helpModal.addEventListener('click', e => { if (e.target === helpModal || e.target.matches('.modal-close-btn')) closeHelpModal(); });

     // +++ 新增：搜索事件监听 +++
    // 1. 点击模态框背景关闭
    searchModal.addEventListener('click', e => {
        if (e.target === searchModal || e.target.matches('.modal-close-btn')) closeSearch();
    });

    // 2. 输入框输入事件 (防抖)
    const debouncedSearch = debounce((e) => performSearch(e.target.value), 300);
    searchInput.addEventListener('input', debouncedSearch);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            checkTaskReminders();
        }
    });
    
    // 3. 输入框回车 (可选，比如直接跳转第一个结果)
    searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            // 简单的逻辑：如果有结果，点击第一个
            const firstResult = searchResults.querySelector('.stats-task-item');
            if (firstResult) firstResult.click();
        }
    });
    // +++ 结束 +++


    window.addEventListener('click', e => {
        if (!e.target.closest('.custom-dropdown-menu, .workspace-tab')) {
            closeAllDropdowns();
        }
    });

    emojiPickerModal?.addEventListener('click', (e) => {
        if (e.target === emojiPickerModal || e.target.matches('.modal-close-btn')) {
            closeEmojiPicker();
        }
    });

    settingsModal?.addEventListener('click', (e) => {
        if (e.target === settingsModal || e.target.matches('.modal-close-btn')) {
            closeSettings();
        }
    });

    photoCropModal?.addEventListener('click', (e) => {
        if (e.target === photoCropModal || e.target.matches('.modal-close-btn')) {
            closePhotoCropper();
        }
    });

    let isCropping = false;
    let cropStart = null;

    photoCropOverlay?.addEventListener('mousedown', (e) => {
        if (!photoCropState.image) return;
        isCropping = true;
        const rect = photoCropOverlay.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        cropStart = { x, y };
        photoCropState.rect = { x, y, w: 1, h: 1 };
        drawPhotoCropOverlay();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isCropping || !photoCropOverlay || !cropStart) return;
        const rect = photoCropOverlay.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        const left = Math.min(cropStart.x, x);
        const top = Math.min(cropStart.y, y);
        const right = Math.max(cropStart.x, x);
        const bottom = Math.max(cropStart.y, y);
        photoCropState.rect = { x: left, y: top, w: right - left, h: bottom - top };
        drawPhotoCropOverlay();
    });

    document.addEventListener('mouseup', () => {
        if (!isCropping) return;
        isCropping = false;
        cropStart = null;
        if (photoCropState.rect) {
            const { w, h } = photoCropState.rect;
            if (w < 20 || h < 20) {
                photoCropState.rect = { x: 0, y: 0, w: photoCropOverlay.width, h: photoCropOverlay.height };
            }
        }
        drawPhotoCropOverlay();
    });

    photoCropCancel?.addEventListener('click', () => {
        closePhotoCropper();
    });

    photoCropConfirm?.addEventListener('click', () => {
        const { photo, container, image, rect, scale } = photoCropState;
        if (!photo || !container || !image || !rect) {
            closePhotoCropper();
            return;
        }
        const sx = Math.max(0, rect.x / scale);
        const sy = Math.max(0, rect.y / scale);
        const sw = Math.max(1, rect.w / scale);
        const sh = Math.max(1, rect.h / scale);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(sw);
        canvas.height = Math.round(sh);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        recordState();
        photo.src = dataUrl;
        const imgEl = container.querySelector('.photo-body');
        if (imgEl) imgEl.src = dataUrl;
        const currentWidth = parseFloat(container.style.width) || container.offsetWidth;
        const newHeight = Math.max(80, currentWidth * (canvas.height / canvas.width));
        container.style.height = `${newHeight}px`;
        photo.size = { width: container.style.width, height: container.style.height };
        debouncedSave();
        closePhotoCropper();
    });

    emojiPickerSearch?.addEventListener('input', (e) => {
        emojiPickerState.query = e.target.value || '';
        renderEmojiPickerGrid();
    });

    emojiPickerGrid?.addEventListener('click', (e) => {
        const item = e.target.closest('.emoji-picker-item');
        if (!item) return;
        const emoji = item.dataset.emoji;
        
        // 处理默认图标选项（emoji 为空字符串）
        if (emoji === '') {
            // 清空选择，表示使用默认图标
            emojiPickerState.selected = [];
            renderEmojiPickerGrid();
            return;
        }
        
        if (!emoji) return;
        const idx = emojiPickerState.selected.indexOf(emoji);
        if (idx >= 0) emojiPickerState.selected.splice(idx, 1);
        else emojiPickerState.selected.push(emoji);
        renderEmojiPickerGrid();
    });

    emojiPickerSelected?.addEventListener('click', (e) => {
        const item = e.target.closest('span');
        if (!item) return;
        const emoji = item.dataset.emoji;
        if (!emoji) return;
        const idx = emojiPickerState.selected.indexOf(emoji);
        if (idx >= 0) {
            emojiPickerState.selected.splice(idx, 1);
            renderEmojiPickerGrid();
        }
    });

    emojiPickerCancel?.addEventListener('click', () => {
        closeEmojiPicker();
    });

    emojiPickerConfirm?.addEventListener('click', () => {
        const list = emojiPickerState.selected.slice();
        if (emojiPickerState.mode === 'add-common') {
            list.forEach(addCommonEmoji);
        } else if (emojiPickerState.mode === 'edit' && emojiPickerState.target) {
            // 编辑模式：传递选中的 emoji（可能是空，表示清空）
            emojiPickerState.onSelect?.(list[0] || null);
        } else {
            if (list.length === 0) {
                closeEmojiPicker();
                return;
            }
            list.forEach(addRecentEmoji);
            if (typeof emojiPickerState.onSelect === 'function') {
                emojiPickerState.onSelect(list);
            } else {
                createEmojiAt(list, emojiPickerState.anchor);
            }
        }
        closeEmojiPicker();
    });

    settingsReset?.addEventListener('click', () => {
        appSettings = { ...DEFAULT_SETTINGS };
        applySettings();
        saveSettings();
        openSettings();
    });

    settingsSave?.addEventListener('click', () => {
        const noteSize = parseInt(settingsNoteFontSize.value, 10);
        const projectSize = parseInt(settingsProjectFontSize.value, 10);
        appSettings.noteFontSize = isNaN(noteSize) ? DEFAULT_SETTINGS.noteFontSize : noteSize;
        appSettings.projectFontSize = isNaN(projectSize) ? DEFAULT_SETTINGS.projectFontSize : projectSize;
        appSettings.workspaceBg = settingsBgColor.value || DEFAULT_SETTINGS.workspaceBg;
        appSettings.shortcutsEnabled = !!settingsShortcuts.checked;
        appSettings.shapesEnabled = !!settingsShapes.checked;
        appSettings.emojisEnabled = !!settingsEmojis.checked;
        appSettings.shortcutMap = {
            project: normalizeShortcutKey(settingsShortcutProject.value, DEFAULT_SETTINGS.shortcutMap.project),
            note: normalizeShortcutKey(settingsShortcutNote.value, DEFAULT_SETTINGS.shortcutMap.note),
            shape: normalizeShortcutKey(settingsShortcutShape.value, DEFAULT_SETTINGS.shortcutMap.shape),
            emoji: normalizeShortcutKey(settingsShortcutEmoji.value, DEFAULT_SETTINGS.shortcutMap.emoji),
            toggle: normalizeShortcutKey(settingsShortcutToggle.value, DEFAULT_SETTINGS.shortcutMap.toggle),
            stats: normalizeShortcutKey(settingsShortcutStats.value, DEFAULT_SETTINGS.shortcutMap.stats)
        };
        applySettings();
        saveSettings();
        closeSettings();
    });

    if (workspaceNameEl) {
        workspaceNameEl.addEventListener('blur', () => { const newName = workspaceNameEl.textContent.trim(); if (newName && workspaces[currentWorkspaceIndex] && workspaces[currentWorkspaceIndex].name !== newName) { recordState(); workspaces[currentWorkspaceIndex].name = newName; debouncedSave(); scheduleRenderWorkspaceSwitcher(); } else if (workspaces[currentWorkspaceIndex]) { workspaceNameEl.textContent = workspaces[currentWorkspaceIndex].name; } });
        workspaceNameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    }
    addWorkspaceBtn.addEventListener('click', () => { recordState(); workspaces.push({ id: `ws_${Date.now()}`, name: '新工作区', projects: {}, notes: {}, shapes: {}, emojis: {}, photos: {}, folders: {} }); currentWorkspaceIndex = workspaces.length - 1; saveWorkspaces(); resetHistory(); highestZIndex = 1; renderCurrentWorkspace(); scheduleRenderWorkspaceSwitcher(); });
    
    // 全局 drop 事件处理器 - 处理从文件夹面板拖出的项目
    document.addEventListener('dragover', (e) => {
        // 允许放置 - 检查多种数据格式以确保 webview 兼容性
        const types = e.dataTransfer.types || [];
        const hasFolderItem = types.includes('application/x-folder-item') || 
                              types.includes('text/plain');
        if (hasFolderItem) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        }
    });
    
    document.addEventListener('drop', (e) => {
        // 处理从文件夹面板拖出的项目 - 尝试多种数据格式
        let folderItemData = e.dataTransfer.getData('application/x-folder-item');
        if (!folderItemData) {
            folderItemData = e.dataTransfer.getData('text/plain');
        }
        if (folderItemData) {
            e.preventDefault();
            try {
                const { folderId, itemIndex, type, id } = JSON.parse(folderItemData);
                const currentWorkspace = workspaces[currentWorkspaceIndex];
                if (!currentWorkspace || !currentWorkspace.folders) return;
                const folder = currentWorkspace.folders[folderId];
                if (!folder) return;
                
                // 检查是否拖到了另一个文件夹上
                const elementsUnder = document.elementsFromPoint(e.clientX, e.clientY);
                const folderUnder = elementsUnder.find(el => 
                    el.classList.contains('folder-container') && el.dataset.folderId !== folderId
                );
                
                if (folderUnder) {
                    // 移到另一个文件夹
                    const targetFolderId = folderUnder.dataset.folderId;
                    const targetFolder = currentWorkspace.folders[targetFolderId];
                    if (targetFolder) {
                        recordState();
                        // 从原文件夹移除
                        folder.items.splice(itemIndex, 1);
                        // 添加到新文件夹
                        targetFolder.items.push({ type, id });
                        // 更新 folderId
                        const data = getFolderItemData(type, id);
                        if (data) data.folderId = targetFolderId;
                        updateFolderBadge(folderId);
                        updateFolderBadge(targetFolderId);
                        debouncedSave();
                        // 刷新打开的面板
                        if (openFolderPanel) {
                            const body = openFolderPanel.panel.querySelector('.folder-panel-body');
                            renderFolderPanelItems(body, openFolderPanel.folder);
                        }
                    }
                } else if (!elementsUnder.some(el => el.classList.contains('folder-panel'))) {
                    // 拖到工作区空白处 - 释放项目
                    recordState();
                    const data = getFolderItemData(type, id);
                    if (data) {
                        delete data.folderId;
                        // 设置新位置 - 根据元素类型使用不同的偏移量
                        let offsetX = 100;
                        let offsetY = 50;
                        if (type === 'photo' && data.size) {
                            // 图片居中于鼠标位置
                            const width = parseInt(data.size.width) || 240;
                            const height = parseInt(data.size.height) || 180;
                            offsetX = width / 2;
                            offsetY = height / 2;
                        } else if (type === 'note') {
                            offsetX = 125; // 便签宽度的一半
                            offsetY = 75;  // 便签高度的一半
                        } else if (type === 'project') {
                            offsetX = 150; // 项目窗口宽度的一半
                            offsetY = 100; // 项目窗口高度的一半
                        }
                        const dropX = (e.pageX / currentZoom) - offsetX;
                        const dropY = (e.pageY / currentZoom) - offsetY;
                        data.position = { left: `${dropX}px`, top: `${dropY}px` };
                    }
                    folder.items.splice(itemIndex, 1);
                    updateFolderBadge(folderId);
                    debouncedSave();

                    // 保持面板打开，并刷新面板内容
                    if (openFolderPanel && openFolderPanel.folder.id === folderId) {
                        const body = openFolderPanel.panel.querySelector('.folder-panel-body');
                        renderFolderPanelItems(body, openFolderPanel.folder);
                    }

                    // 将元素重新渲染到工作区
                    if (data) {
                        let newEl = null;
                        if (type === 'note') newEl = createNotePane(data);
                        else if (type === 'project') newEl = createProjectPane(data, currentWorkspace);
                        else if (type === 'photo') newEl = createPhotoPane(data);
                        if (newEl && data.zIndex && data.zIndex >= highestZIndex) {
                            highestZIndex = data.zIndex + 1;
                        }
                        checkEmptyState(currentWorkspace);
                    }
                }
            } catch (err) {
                console.error('Error handling folder item drop:', err);
            }
        }
    });
    // 删除按钮移除，改为工作区标签右键删除
    
    const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

    const getPhotoSizeFromDataUrl = (dataUrl) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const baseWidth = 240;
            let width = baseWidth;
            let height = baseWidth * (img.height / img.width);
            if (height < 120) {
                height = 120;
                width = height * (img.width / img.height);
            } else if (height > 360) {
                height = 360;
                width = height * (img.width / img.height);
            }
            resolve({ width, height });
        };
        img.onerror = () => resolve({ width: 240, height: 180 });
        img.src = dataUrl;
    });

    const createPhotoAt = async (dataUrls, anchor) => {
        if (!workspaces.length) return;
        const list = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
        if (list.length === 0) return;
        const currentWorkspace = workspaces[currentWorkspaceIndex];
        recordState();
        const newSelected = [];
        const baseX = anchor ? anchor.x / currentZoom : window.scrollX / currentZoom + (window.innerWidth / 2 / currentZoom);
        const baseY = anchor ? anchor.y / currentZoom : window.scrollY / currentZoom + (window.innerHeight / 2 / currentZoom);

        for (let index = 0; index < list.length; index += 1) {
            const src = list[index];
            const size = await getPhotoSizeFromDataUrl(src);
            const offset = index * 24;
            const posX = baseX - size.width / 2 + offset;
            const posY = baseY - size.height / 2 + offset;
            const newPhotoId = `photo_${Date.now()}_${index}`;
            currentWorkspace.photos ??= {};
            currentWorkspace.photos[newPhotoId] = {
                id: newPhotoId,
                src,
                position: { top: `${posY}px`, left: `${posX}px` },
                size: { width: `${size.width}px`, height: `${size.height}px` },
                zIndex: SHAPE_Z_INDEX_BASE - 1
            };
            const newPhotoElement = createPhotoPane(currentWorkspace.photos[newPhotoId]);
            if (newPhotoElement) {
                newPhotoElement.style.zIndex = currentWorkspace.photos[newPhotoId].zIndex;
                newPhotoElement.classList.add('newly-added');
                setTimeout(() => newPhotoElement.classList.remove('newly-added'), 400);
                newSelected.push(newPhotoElement);
            }
        }

        clearWindowSelection();
        newSelected.forEach(selectWindow);
        normalizeLayerAll();
        debouncedSave();
        checkEmptyState(currentWorkspace);
    };

    const createShapeAt = (type, anchor) => {
        if (!workspaces.length) return;
        const currentWorkspace = workspaces[currentWorkspaceIndex];
        const newShapeId = `shape_${Date.now()}`;
        const defaultSize = getDefaultShapeSize(type);
        let posX;
        let posY;
        if (anchor) {
            posX = anchor.x / currentZoom - defaultSize.width / 2;
            posY = anchor.y / currentZoom - defaultSize.height / 2;
        } else {
            posX = window.scrollX / currentZoom + (window.innerWidth / 2 / currentZoom) - defaultSize.width / 2;
            posY = window.scrollY / currentZoom + (window.innerHeight / 2 / currentZoom) - defaultSize.height / 2;
        }
        recordState();
        currentWorkspace.shapes ??= {};
        currentWorkspace.shapes[newShapeId] = {
            id: newShapeId,
            type,
            position: { top: `${posY}px`, left: `${posX}px` },
            size: { width: `${defaultSize.width}px`, height: `${defaultSize.height}px` },
            color: '#4f46e5',
            text: '',
            isBold: false,
            zIndex: SHAPE_Z_INDEX_BASE - 1
        };
        debouncedSave();
        const newShapeElement = createShapePane(currentWorkspace.shapes[newShapeId]);
        if (newShapeElement) {
            normalizeLayer('shape');
            newShapeElement.style.zIndex = currentWorkspace.shapes[newShapeId].zIndex;
            newShapeElement.classList.add('newly-added');
            setTimeout(() => newShapeElement.classList.remove('newly-added'), 400);
        }
        checkEmptyState(currentWorkspace);
    };

    const createEmojiAt = (symbolOrList, anchor) => {
        const list = Array.isArray(symbolOrList) ? symbolOrList : splitEmojiInput(symbolOrList);
        if (!workspaces.length || list.length === 0) return;
        const currentWorkspace = workspaces[currentWorkspaceIndex];
        const size = { width: 90, height: 90 };
        const gap = 16;
        let startX;
        let startY;
        if (anchor) {
            startX = anchor.x / currentZoom - size.width / 2;
            startY = anchor.y / currentZoom - size.height / 2;
        } else {
            startX = window.scrollX / currentZoom + (window.innerWidth / 2 / currentZoom) - size.width / 2;
            startY = window.scrollY / currentZoom + (window.innerHeight / 2 / currentZoom) - size.height / 2;
        }
        recordState();
        currentWorkspace.emojis ??= {};
        list.forEach((symbol, index) => {
            const newEmojiId = `emoji_${Date.now()}_${index}`;
            const posX = startX + index * (size.width + gap);
            const posY = startY;
            currentWorkspace.emojis[newEmojiId] = {
                id: newEmojiId,
                symbol,
                position: { top: `${posY}px`, left: `${posX}px` },
                size: { width: `${size.width}px`, height: `${size.height}px` },
                zIndex: SHAPE_Z_INDEX_BASE - list.length + index
            };
            const newEmojiElement = createEmojiPane(currentWorkspace.emojis[newEmojiId]);
            if (newEmojiElement) {
                newEmojiElement.style.zIndex = currentWorkspace.emojis[newEmojiId].zIndex;
                newEmojiElement.classList.add('newly-added');
                setTimeout(() => newEmojiElement.classList.remove('newly-added'), 400);
            }
        });
        normalizeLayer('emoji');
        debouncedSave();
        checkEmptyState(currentWorkspace);
    };

    addProjectBtn.addEventListener('click', () => {
        if (!workspaces.length) return;
        recordState();
        const currentWorkspace = workspaces[currentWorkspaceIndex];
        const newProjectId = `proj_${Date.now()}`;
        const posX = window.scrollX / currentZoom + (window.innerWidth / 2 / currentZoom) - 225;
        const posY = window.scrollY / currentZoom + (window.innerHeight / 2 / currentZoom) - 250;
        currentWorkspace.projects[newProjectId] = { id: newProjectId, name: '新项目', position: { top: `${posY}px`, left: `${posX}px` }, size: { width: '450px', height: '500px' }, color: null, todos: [], categories: [], activeFilter: 'all' };
        debouncedSave();
        const newProjectElement = createProjectPane(currentWorkspace.projects[newProjectId], currentWorkspace);
        newProjectElement.style.zIndex = highestZIndex++;
        newProjectElement.classList.add('newly-added');
        setTimeout(() => newProjectElement.classList.remove('newly-added'), 400);
        checkEmptyState(currentWorkspace);
    });

    addNoteBtn.addEventListener('click', () => {
        if (!workspaces.length) return;
        recordState();
        const currentWorkspace = workspaces[currentWorkspaceIndex];
        const newNoteId = `note_${Date.now()}`;
        const posX = window.scrollX / currentZoom + (window.innerWidth / 2 / currentZoom) - 160;
        const posY = window.scrollY / currentZoom + (window.innerHeight / 2 / currentZoom) - 160;
        currentWorkspace.notes[newNoteId] = { id: newNoteId, title: '', content: ' ', position: { top: `${posY}px`, left: `${posX}px` }, size: { width: '320px', height: '320px' }, color: 'var(--note-yellow)' };
        debouncedSave();
        const newNoteElement = createNotePane(currentWorkspace.notes[newNoteId]);
        newNoteElement.style.zIndex = highestZIndex++;
        newNoteElement.classList.add('newly-added');
        setTimeout(() => newNoteElement.classList.remove('newly-added'), 400);
        checkEmptyState(currentWorkspace);
    });

    addShapeBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
    if (!appSettings.shapesEnabled) { showToast('形状功能已关闭', 'info'); return; }
    showShapeTypeMenu(e, (type) => createShapeAt(type));
    });

    addEmojiBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
    if (!appSettings.emojisEnabled) { showToast('表情功能已关闭', 'info'); return; }
    showEmojiMenu(e, (emoji) => createEmojiAt(emoji));
    });

    addPhotoBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        lastPhotoMenuPoint = null;
        addPhotoInput?.click();
    });

    addFolderBtn?.addEventListener('click', () => {
        if (!workspaces.length) return;
        recordState();
        const currentWorkspace = workspaces[currentWorkspaceIndex];
        currentWorkspace.folders = currentWorkspace.folders || {};
        const newFolderId = `folder_${Date.now()}`;
        const posX = window.scrollX / currentZoom + (window.innerWidth / 2 / currentZoom) - 40;
        const posY = window.scrollY / currentZoom + (window.innerHeight / 2 / currentZoom) - 45;
        currentWorkspace.folders[newFolderId] = {
            id: newFolderId,
            name: '新文件夹',
            color: '#5ac8fa',
            position: { top: `${posY}px`, left: `${posX}px` },
            items: [],
            zIndex: highestFolderZIndex++
        };
        debouncedSave();
        const newFolderElement = createFolderPane(currentWorkspace.folders[newFolderId]);
        if (newFolderElement) {
            newFolderElement.classList.add('newly-added');
            setTimeout(() => newFolderElement.classList.remove('newly-added'), 400);
        }
        checkEmptyState(currentWorkspace);
    });

    addPhotoInput?.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []).filter(f => f.type && f.type.startsWith('image/'));
        if (files.length === 0) return;
        try {
            const dataUrls = await Promise.all(files.map(readFileAsDataUrl));
            const anchor = lastPhotoMenuPoint || lastPointer;
            createPhotoAt(dataUrls, anchor);
        } catch (err) {
            console.error(err);
            showToast('图片读取失败', 'error');
        } finally {
            addPhotoInput.value = '';
        }
    });

    moreWsBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const existing = document.querySelector('.custom-dropdown-menu[data-owner="more-ws"]');
        if (existing) {
            existing.remove();
            return;
        }
        closeAllDropdowns();
        const menu = document.createElement('div');
        menu.className = 'custom-dropdown-menu';
        menu.dataset.owner = 'more-ws';
        menu.innerHTML = `
            <div class="dropdown-option" data-action="import"><span class="material-symbols-rounded">upload</span>导入数据</div>
            <div class="dropdown-option" data-action="export"><span class="material-symbols-rounded">download</span>导出数据</div>
            <div class="dropdown-option" data-action="stats"><span class="material-symbols-rounded">insights</span>查看统计</div>
            <div class="dropdown-option" data-action="settings"><span class="material-symbols-rounded">settings</span>设置</div>
        `;
        positionContextMenu(menu, e);
        menu.addEventListener('click', (me) => {
            const action = me.target.dataset.action;
            closeAllDropdowns();
            if (action === 'import') {
                importFileInput.click();
            } else if (action === 'export') {
                exportData();
            } else if (action === 'stats') {
                openStatistics();
            } else if (action === 'settings') {
                openSettings();
            }
        });
    });
    
    let isPanning = false;
    let isSpacePressed = false;
    let isHandToolActive = false; 
    let panStartX, panStartY;
    let initialScrollX, initialScrollY;
    
    const updateCursorAndInteraction = () => {
        if (isPanning) {
            document.body.style.cursor = 'grabbing';
        } else if (isHandToolActive || isSpacePressed) {
            document.body.style.cursor = 'grab';
        } else {
            document.body.style.cursor = '';
        }
        
        // --- 关键修改在这里 ---
        // 之前只检查 isHandToolActive，现在我们检查 isHandToolActive 或 isSpacePressed
        // 确保只要是抓手工具模式（无论通过H键还是空格），都禁用下层元素的鼠标事件
        document.body.classList.toggle('hand-tool-active', isHandToolActive || isSpacePressed);
    };

    window.addEventListener('keydown', (e) => {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const ctrlKey = isMac ? e.metaKey : e.ctrlKey;
        const isInputFocused = document.activeElement.isContentEditable || ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || customModal.classList.contains('visible');
        
        // +++ 【在这里插入代码】 +++ 
        // 必须放在 isInputFocused 检查逻辑之前，否则聚焦在搜索框时按 ESC 无效
        if (e.key === 'Escape') {
            if (searchModal && searchModal.classList.contains('visible')) {
                closeSearch();
                e.preventDefault(); // 阻止默认行为，比如退出全屏等
                return;
            }
        }
        // +++ 插入结束 +++
        
        if (!appSettings.shortcutsEnabled) return;

        // +++ 新增：Ctrl + F 快捷键 +++
        if (ctrlKey && e.key.toLowerCase() === 'f') {
            e.preventDefault();
            openSearch();
            return;
        }
        // +++ 结束 +++

        if (e.code === 'Space' && !isInputFocused) {
            e.preventDefault();
            if (!isSpacePressed) {
                isSpacePressed = true;
                updateCursorAndInteraction();
            }
        }
        
        if (isInputFocused) {
             if (ctrlKey && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y' || e.key.toLowerCase() === 's')) {}
             else { return; }
        }

        if (ctrlKey && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            copySelectedWindows();
            return;
        }
        if (ctrlKey && e.key.toLowerCase() === 'v') {
            pasteHandled = false;
            setTimeout(() => {
                if (!pasteHandled && windowClipboard && windowClipboard.length > 0) {
                    pasteClipboardWindows();
                }
            }, 60);
            return;
        }

        if (ctrlKey && (e.key === ']' || e.key === '}' || e.key === '[' || e.key === '{')) {
            e.preventDefault();
            const isUp = e.key === ']' || e.key === '}';
            const isTop = e.shiftKey && isUp;
            const isBottom = e.shiftKey && !isUp;
            const action = isTop ? 'top' : isBottom ? 'bottom' : isUp ? 'up' : 'down';
            const selectedShapes = Array.from(selectedWindows).filter(el => el.classList.contains('shape-container'));
            const selectedEmojis = Array.from(selectedWindows).filter(el => el.classList.contains('emoji-container'));
            const selectedPhotos = Array.from(selectedWindows).filter(el => el.classList.contains('photo-container'));
            const hasMixed = [selectedShapes.length, selectedEmojis.length, selectedPhotos.length].filter(Boolean).length > 1;
            if (hasMixed) {
                moveSelectionInLayer('all', action);
            } else {
                if (selectedShapes.length) moveSelectionInLayer('shape', action);
                if (selectedEmojis.length) moveSelectionInLayer('emoji', action);
                if (selectedPhotos.length) moveSelectionInLayer('photo', action);
            }
            return;
        }

        if (ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); performUndo(); return; }
        if (ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); performRedo(); return; }
        if (ctrlKey && e.key.toLowerCase() === 's') { 
            e.preventDefault(); 
            forceSaveWorkspaces().then(success => {
                if (success) {
                    showToast('已保存', 'success');
                } else {
                    showToast('保存失败', 'error');
                }
            });
            return;
        }

        if ((e.key === 'Delete' || e.key === 'Backspace') && currentResizableImage) {
            const noteContent = currentResizableImage.closest('.note-content');
            if (noteContent && document.activeElement === noteContent) {
                e.preventDefault();
                recordState();
                const imageToRemove = currentResizableImage;
                hideImageResizer();
                imageToRemove.remove();
                const noteContainer = noteContent.closest('.note-container');
                const noteId = noteContainer?.dataset?.noteId;
                const noteData = noteId ? workspaces[currentWorkspaceIndex]?.notes?.[noteId] : null;
                if (noteData) {
                    noteData.content = noteContent.innerHTML;
                }
                saveWorkspaces();
                return;
            }
        }

        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWindows.size > 0) {
            e.preventDefault();
            deleteSelectedWindows();
            return;
        }
        
        if (e.key.toLowerCase() === 'h') {
            isHandToolActive = !isHandToolActive;
            updateCursorAndInteraction();
        }
        
        if (e.altKey) {
            // +++ START: 新增 Alt + 数字 切换工作区逻辑 +++
            const keyNum = parseInt(e.key, 10);
            // 检查按键是否是 1 到 9 之间的数字
            if (!isNaN(keyNum) && keyNum >= 1 && keyNum <= 9) {
                e.preventDefault();
                const targetIndex = keyNum - 1; // 转换为 0-based 索引
                
                // 检查目标工作区是否存在
                if (targetIndex < workspaces.length) {
                    switchWorkspace(targetIndex);
                }
                return; // 已处理，直接返回
            }
            // +++ END: 新增逻辑 +++

            const key = e.key.toLowerCase();
            const map = appSettings.shortcutMap;
            if (!appSettings.shapesEnabled && key === map.shape) return;
            if (!appSettings.emojisEnabled && key === map.emoji) return;
            if (key === map.note) { e.preventDefault(); addNoteBtn.click(); }
            else if (key === map.project) { e.preventDefault(); addProjectBtn.click(); }
            else if (key === map.shape) {
                e.preventDefault();
                showShapeTypeMenu({ x: window.scrollX + window.innerWidth / 2, y: window.scrollY + window.innerHeight / 2 }, (type) => createShapeAt(type));
            } else if (key === map.emoji) {
                e.preventDefault();
                showEmojiMenu({ x: window.scrollX + window.innerWidth / 2, y: window.scrollY + window.innerHeight / 2 }, (emoji) => createEmojiAt(emoji));
            } else if (key === map.toggle) { e.preventDefault(); toggleAllUiPanels(); }
            else if (key === map.stats) { e.preventDefault(); openStatistics(); }
            return;
        }
        
        if (e.key === 'ArrowLeft') { e.preventDefault(); const newIndex = (currentWorkspaceIndex - 1 + workspaces.length) % workspaces.length; switchWorkspace(newIndex); } 
        else if (e.key === 'ArrowRight') { e.preventDefault(); const newIndex = (currentWorkspaceIndex + 1) % workspaces.length; switchWorkspace(newIndex); }
    });
    
    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            isSpacePressed = false;
            if (!isPanning) updateCursorAndInteraction();
        }
    });
    
    document.addEventListener('dragend', () => {
        cleanupDragDropState();
    });

    document.addEventListener('mousemove', (e) => {
        lastPointer = { x: e.pageX, y: e.pageY };
    });

    appContainer.addEventListener('dragover', (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
            e.preventDefault();
        }
    });

    appContainer.addEventListener('drop', async (e) => {
        const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type && f.type.startsWith('image/'));
        if (files.length === 0) return;
        if (e.target.closest('.note-content')) return;
        e.preventDefault();
        try {
            const dataUrls = await Promise.all(files.map(readFileAsDataUrl));
            createPhotoAt(dataUrls, { x: e.pageX, y: e.pageY });
        } catch (err) {
            console.error(err);
            showToast('图片读取失败', 'error');
        }
    });

    document.addEventListener('paste', async (e) => {
        if (e.target.closest('.note-content') || e.target.closest('input, textarea, [contenteditable="true"]')) {
            return;
        }
        const items = Array.from(e.clipboardData?.items || []);
        const imageItems = items.filter(item => item.type && item.type.startsWith('image/'));
        if (imageItems.length > 0) {
            e.preventDefault();
            pasteHandled = true;
            const files = imageItems.map(item => item.getAsFile()).filter(Boolean);
            try {
                const dataUrls = await Promise.all(files.map(readFileAsDataUrl));
                createPhotoAt(dataUrls, lastPointer);
            } catch (err) {
                console.error(err);
                showToast('图片粘贴失败', 'error');
            }
            return;
        }
        if (windowClipboard && windowClipboard.length > 0) {
            e.preventDefault();
            pasteHandled = true;
            pasteClipboardWindows();
        }
    });

    document.body.addEventListener('contextmenu', e => {
        if (e.target.closest('.project-container, .note-container, .shape-container, .emoji-container, .photo-container, .folder-container')) {
            return;
        }
        
        if (e.target.closest('.folder-item, .folder-panel')) {
            return;
        }
        
        if (e.target.closest('.workspace-switcher-container, .workspace-controls-container, .add-buttons-container, .modal-overlay')) {
            return;
        }

        e.preventDefault();
        closeAllDropdowns();

        const menu = document.createElement('div');
        menu.className = 'custom-dropdown-menu';
        const undoDisabled = undoStack.length === 0 ? 'style="opacity: 0.5; pointer-events: none;"' : '';
        const allPanelsText = (addButtonsContainer.classList.contains('visible') && workspaceControls.classList.contains('visible') && isSwitcherVisible)
            ? '隐藏全部控件'
            : '显示全部控件';
        const themeToggleText = getEffectiveTheme() === 'dark' ? '切换到浅色模式' : '切换到深色模式';

        const shapeOption = appSettings.shapesEnabled ? `<div class="dropdown-option" data-action="newShape">创建新形状 (Alt+${appSettings.shortcutMap.shape.toUpperCase()})</div>` : '';
        const emojiOption = appSettings.emojisEnabled ? `<div class="dropdown-option" data-action="newEmoji">创建表情 (Alt+${appSettings.shortcutMap.emoji.toUpperCase()})</div>` : '';
        menu.innerHTML = `
            <div class="dropdown-option" data-action="newProject">创建新项目 (Alt+${appSettings.shortcutMap.project.toUpperCase()})</div>
            <div class="dropdown-option" data-action="newNote">创建新便签 (Alt+${appSettings.shortcutMap.note.toUpperCase()})</div>
            <div class="dropdown-option" data-action="newPhoto">添加图片</div>
            ${shapeOption}
            ${emojiOption}
            <div class="dropdown-divider"></div>
            <div class="dropdown-option" data-action="toggleAllPanels">${allPanelsText} (Alt+${appSettings.shortcutMap.toggle.toUpperCase()})</div>
            <div class="dropdown-divider"></div>
            <div class="dropdown-option" data-action="toggleTheme">${themeToggleText}</div>
            <div class="dropdown-divider"></div>
            <div class="dropdown-option" data-action="help">快捷键帮助</div>
            <div class="dropdown-option" data-action="undo" ${undoDisabled}>撤销 (Ctrl+Z)</div>
        `;
        positionContextMenu(menu, e);

        menu.addEventListener('click', me => {
            const action = me.target.dataset.action;
            closeAllDropdowns();

            switch (action) {
                case 'newProject': addProjectBtn.click(); break;
                case 'newNote': addNoteBtn.click(); break;
                case 'newShape':
                    showShapeTypeMenu(e, (type) => createShapeAt(type, { x: e.pageX, y: e.pageY }));
                    break;
                case 'newEmoji':
                    showEmojiMenu(e, (emoji) => createEmojiAt(emoji, { x: e.pageX, y: e.pageY }));
                    break;
                case 'newPhoto':
                    lastPhotoMenuPoint = { x: e.pageX, y: e.pageY };
                    addPhotoInput?.click();
                    break;
                case 'toggleAllPanels': toggleAllUiPanels(); break;
                case 'toggleTheme': toggleTheme(); break;
                case 'help': openHelpModal(); break;
                case 'undo': performUndo(); break;
            }
        });
    });
    
    let panRafId = null;
    let pendingPan = null;
    const handlePanMove = (e) => {
        if (!isPanning) return;
        e.preventDefault();
        pendingPan = { x: e.clientX, y: e.clientY };
        if (panRafId) return;
        panRafId = requestAnimationFrame(() => {
            if (!isPanning || !pendingPan) { panRafId = null; return; }
            const dx = pendingPan.x - panStartX;
            const dy = pendingPan.y - panStartY;
            window.scrollTo(initialScrollX - dx, initialScrollY - dy);
            panRafId = null;
        });
    };

    const stopPan = () => {
        if (!isPanning) return;
        isPanning = false;
        // +++ 添加下面这一行 +++
        document.body.classList.remove('body-panning');
        updateCursorAndInteraction();
        document.removeEventListener('mousemove', handlePanMove);
        document.removeEventListener('mouseup', stopPan);
        pendingPan = null;
        if (panRafId) cancelAnimationFrame(panRafId);
        panRafId = null;
    };

    window.addEventListener('mousedown', (e) => {
        // +++ START: 焦点窗口逻辑 (修改) +++
        const targetWindow = e.target.closest('.project-container, .note-container, .shape-container, .emoji-container, .photo-container, .folder-container');
        const isPanningClick = (isSpacePressed || isHandToolActive) && e.button === 0;
        const isBackgroundClick = !e.target.closest('button, input, textarea, [contenteditable="true"], .workspace-switcher-container, .workspace-controls-container, .add-buttons-container, .modal-overlay, .custom-dropdown-menu, .resizer, .folder-panel');
        
        if (targetWindow) {
            // 1. 如果点击的是某个窗口
            if (focusedWindow !== targetWindow) {
                // 移除旧窗口的高亮
                if (focusedWindow) focusedWindow.classList.remove('window-focused');
                
                // 设置新焦点
                focusedWindow = targetWindow;
                focusedWindow.classList.add('window-focused');
            }
            
            // +++ START: 多选窗口逻辑 +++
            if (!isPanningClick && e.button === 0 && !e.target.closest('button, input, textarea, [contenteditable="true"], .resizer')) {
                const groupId = getWindowGroupId(targetWindow);
                if (e.ctrlKey || e.shiftKey) {
                    if (groupId) {
                        toggleGroupSelection(groupId);
                    } else {
                        toggleWindowSelection(targetWindow);
                    }
                } else {
                    if (groupId) {
                        if (!isGroupFullySelected(groupId)) {
                            clearWindowSelection();
                            getGroupElements(groupId).forEach(el => selectWindow(el));
                        }
                    } else if (!selectedWindows.has(targetWindow)) {
                        clearWindowSelection();
                        selectWindow(targetWindow);
                    }
                }
            }
            // +++ END: 多选窗口逻辑 +++
        } else {
            // 2. 如果点击的不是窗口（也不是其他功能按钮），则视为点击了背景
            if (isBackgroundClick) {
                if (focusedWindow) {
                    focusedWindow.classList.remove('window-focused');
                    focusedWindow = null;
                }
                if (!isPanningClick) {
                    clearWindowSelection();
                }
            }
        }
        // +++ END: 焦点窗口逻辑 +++

        // +++ START: 框选多窗口逻辑 +++
        if (!targetWindow && isBackgroundClick && !isPanningClick && e.button === 0 && !e.target.closest('#image-resizer') && !isResizing) {
            const additive = e.ctrlKey || e.shiftKey;
            isMarqueeSelecting = true;
            marqueeStart = { x: e.clientX, y: e.clientY };
            if (!marqueeBox) {
                marqueeBox = document.createElement('div');
                marqueeBox.className = 'selection-rect';
                document.body.appendChild(marqueeBox);
            }
            marqueeBox.style.display = 'block';
            marqueeBox.style.left = `${marqueeStart.x}px`;
            marqueeBox.style.top = `${marqueeStart.y}px`;
            marqueeBox.style.width = '0px';
            marqueeBox.style.height = '0px';
            updateMarqueeSelection({
                left: marqueeStart.x,
                top: marqueeStart.y,
                right: marqueeStart.x,
                bottom: marqueeStart.y
            }, additive);

            const handleMarqueeMove = (me) => {
                if (!isMarqueeSelecting || !marqueeStart || !marqueeBox) return;
                const x1 = marqueeStart.x;
                const y1 = marqueeStart.y;
                const x2 = me.clientX;
                const y2 = me.clientY;
                const left = Math.min(x1, x2);
                const top = Math.min(y1, y2);
                const right = Math.max(x1, x2);
                const bottom = Math.max(y1, y2);
                marqueeBox.style.left = `${left}px`;
                marqueeBox.style.top = `${top}px`;
                marqueeBox.style.width = `${right - left}px`;
                marqueeBox.style.height = `${bottom - top}px`;
                updateMarqueeSelection({ left, top, right, bottom }, additive);
            };

            const handleMarqueeUp = () => {
                if (!isMarqueeSelecting) return;
                isMarqueeSelecting = false;
                marqueeStart = null;
                if (marqueeBox) {
                    marqueeBox.style.display = 'none';
                }
                document.removeEventListener('mousemove', handleMarqueeMove);
                document.removeEventListener('mouseup', handleMarqueeUp);
            };

            document.addEventListener('mousemove', handleMarqueeMove);
            document.addEventListener('mouseup', handleMarqueeUp);
        }
        // +++ END: 框选多窗口逻辑 +++

        // ... (下方是原有的平移/抓手工具逻辑，保持不变) ...
        if ((isSpacePressed || isHandToolActive) && e.button === 0) {
            // ... 原有代码 ...
             if (e.target.closest('button, a, input, [contenteditable="true"], .resizer')) {
                return;
            }
            e.preventDefault();
            isPanning = true;
            document.body.classList.add('body-panning'); // 确保这行也在
            panStartX = e.clientX;
            panStartY = e.clientY;
            initialScrollX = window.scrollX;
            initialScrollY = window.scrollY;
            updateCursorAndInteraction();
            document.addEventListener('mousemove', handlePanMove);
            document.addEventListener('mouseup', stopPan);
        }
    });
    
    let wheelRafId = null;
    let wheelState = {
        deltaX: 0,
        deltaY: 0,
        ctrlKey: false,
        shiftKey: false,
        clientX: 0,
        clientY: 0
    };
    window.addEventListener('wheel', (e) => {
        // 1. 获取鼠标当前悬停的便签或项目容器
        const hoverWindow = e.target.closest('.project-container, .note-container, .shape-container, .emoji-container, .photo-container');

        // +++ 核心判断逻辑 +++
        // 允许内部滚动的条件：
        // A. 鼠标确实在某个窗口内
        // B. 这个窗口必须是当前被点击(聚焦)的窗口 (hoverWindow === focusedWindow)
        // C. 没有按住 Ctrl 键 (Ctrl是缩放)
        const isInternalScroll = hoverWindow && hoverWindow === focusedWindow && !e.ctrlKey;

        if (isInternalScroll) {
            // 满足条件：允许浏览器默认行为（滚动便签内部）
            // 这里不需要写代码，直接 return，浏览器会自动处理内部滚动
            return;
        }

        // 2. 如果不满足上述条件，说明我们要控制“工作区界面”
        // 必须阻止默认行为，否则浏览器会尝试滚动鼠标下的未聚焦便签
        e.preventDefault();

        wheelState.deltaX += e.deltaX;
        wheelState.deltaY += e.deltaY;
        wheelState.ctrlKey = wheelState.ctrlKey || e.ctrlKey;
        wheelState.shiftKey = wheelState.shiftKey || e.shiftKey;
        wheelState.clientX = e.clientX;
        wheelState.clientY = e.clientY;

        if (wheelRafId) return;
        wheelRafId = requestAnimationFrame(() => {
            const { deltaX, deltaY, ctrlKey, shiftKey, clientX, clientY } = wheelState;
            wheelState = { deltaX: 0, deltaY: 0, ctrlKey: false, shiftKey: false, clientX: 0, clientY: 0 };
            wheelRafId = null;

            if (ctrlKey) {
                // --- Ctrl + 滚轮：缩放逻辑 (平滑化) ---
                const appContainerRect = appContainer.getBoundingClientRect();
                const prevZoom = currentZoom;

                const focalPointX = (clientX - appContainerRect.left) / prevZoom;
                const focalPointY = (clientY - appContainerRect.top) / prevZoom;

                const zoomAmount = 0.1;
                if (deltaY > 0) {
                    currentZoom = Math.max(0.2, currentZoom - zoomAmount);
                } else if (deltaY < 0) {
                    currentZoom = Math.min(3.0, currentZoom + zoomAmount);
                }

                applyZoom(currentZoom);

                const newFocalPointAbsoluteX = focalPointX * currentZoom;
                const newFocalPointAbsoluteY = focalPointY * currentZoom;
                
                const newScrollX = newFocalPointAbsoluteX - clientX;
                const newScrollY = newFocalPointAbsoluteY - clientY;

                window.scrollTo(newScrollX, newScrollY);
            } else {
                // --- 普通滚轮：滚动工作区界面 ---
                if (shiftKey) {
                    // Shift + 滚轮：水平滚动
                    window.scrollBy(deltaY, 0);
                } else {
                    // 普通滚轮：垂直/双向滚动
                    window.scrollBy(deltaX, deltaY);
                }
            }
        });
    }, { passive: false }); // passive: false 是必须的，否则无法 preventDefault

    function setupWorkspaceSwitcherListeners() {
        let draggedTabIndex = null;
        workspaceSwitcher.addEventListener('click', e => { const tab = e.target.closest('.workspace-tab'); if (tab && !tab.classList.contains('active')) { switchWorkspace(parseInt(tab.dataset.index, 10)); } });
        workspaceSwitcher.addEventListener('dblclick', async e => {
            const tab = e.target.closest('.workspace-tab');
            if (!tab) return;
            const index = parseInt(tab.dataset.index, 10);
            const workspace = workspaces[index];
            if (!workspace) return;
            try {
                const newName = await showCustomModal({
                    title: '重命名工作区',
                    type: 'prompt',
                    placeholder: '输入新的工作区名称',
                    okText: '保存',
                    initialValue: workspace.name
                });
                if (newName && newName.trim() !== workspace.name) {
                    recordState();
                    workspaces[index].name = newName.trim();
                    saveWorkspaces();
                    scheduleRenderWorkspaceSwitcher();
                    if (index === currentWorkspaceIndex && workspaceNameEl) {
                        workspaceNameEl.textContent = newName.trim();
                    }
                }
            } catch {}
        });
        workspaceSwitcher.addEventListener('contextmenu', e => {
            e.preventDefault(); const tab = e.target.closest('.workspace-tab'); if (!tab) return;
            const index = parseInt(tab.dataset.index, 10); const workspace = workspaces[index];
            closeAllDropdowns();
            const menu = document.createElement('div'); menu.className = 'custom-dropdown-menu';
            menu.innerHTML = `
                <div class="dropdown-option" data-action="rename">重命名</div>
                <div class="dropdown-option danger" data-action="delete">删除工作区</div>
            `;
            positionContextMenu(menu, e);
            menu.addEventListener('click', async me => {
                const action = me.target.dataset.action; closeAllDropdowns();
                if (action === 'rename') { try { const newName = await showCustomModal({ title: '重命名工作区', type: 'prompt', placeholder: '输入新的工作区名称', okText: '保存', initialValue: workspace.name }); if (newName && newName.trim() !== workspace.name) { recordState(); workspaces[index].name = newName.trim(); saveWorkspaces(); scheduleRenderWorkspaceSwitcher(); if (index === currentWorkspaceIndex && workspaceNameEl) { workspaceNameEl.textContent = newName.trim(); } } } catch {} }
                if (action === 'delete') {
                    if (workspaces.length <= 1) { await showCustomModal({ title: '无法删除', message: '这是最后一个工作区，无法删除！', okText: '好的' }); return; }
                    try {
                        await showCustomModal({ title: '删除工作区', message: `确定要删除工作区 "${workspace.name}" 吗？此操作不可恢复！`, okText: '永久删除' });
                        recordState();
                        workspaces.splice(index, 1);
                        if (currentWorkspaceIndex >= workspaces.length) { currentWorkspaceIndex = workspaces.length - 1; }
                        saveWorkspaces(); resetHistory(); highestZIndex = 1; renderCurrentWorkspace(); scheduleRenderWorkspaceSwitcher();
                    } catch {}
                }
            });
        });
        workspaceSwitcher.addEventListener('dragstart', e => { const tab = e.target.closest('.workspace-tab'); if (tab) { draggedTabIndex = parseInt(tab.dataset.index, 10); setTimeout(() => tab.classList.add('dragging-tab'), 0); } });
        workspaceSwitcher.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const targetTab = e.target.closest('.workspace-tab'); if (targetTab && parseInt(targetTab.dataset.index, 10) !== draggedTabIndex) { workspaceSwitcher.querySelectorAll('.drag-over-tab').forEach(t => t.classList.remove('drag-over-tab')); targetTab.classList.add('drag-over-tab'); } });
        workspaceSwitcher.addEventListener('dragleave', e => { e.target.closest('.workspace-tab')?.classList.remove('drag-over-tab'); });
        workspaceSwitcher.addEventListener('drop', e => {
            e.preventDefault(); workspaceSwitcher.querySelectorAll('.drag-over-tab').forEach(t => t.classList.remove('drag-over-tab'));
            const targetTab = e.target.closest('.workspace-tab');
            if (targetTab && draggedTabIndex !== null) {
                const targetIndex = parseInt(targetTab.dataset.index, 10);
                if (targetIndex !== draggedTabIndex) {
                    recordState(); const activeWorkspaceId = workspaces[currentWorkspaceIndex].id;
                    const [draggedItem] = workspaces.splice(draggedTabIndex, 1);
                    workspaces.splice(targetIndex, 0, draggedItem);
                    currentWorkspaceIndex = workspaces.findIndex(ws => ws.id === activeWorkspaceId);
                    saveWorkspaces(); scheduleRenderWorkspaceSwitcher();
                }
            }
            draggedTabIndex = null;
        });
        workspaceSwitcher.addEventListener('dragend', e => { e.target.closest('.workspace-tab')?.classList.remove('dragging-tab'); draggedTabIndex = null; });
    }
    setupWorkspaceSwitcherListeners();

    let currentResizableImage = null;
    let isResizing = false;
    let initialResizeState = {};

    function showImageResizer(imageEl) {
        if (!imageEl) return;
    
        const noteContent = imageEl.closest('.note-content');
        if (noteContent) {
            noteContent.focus();
        }
        
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNode(imageEl);
    
        selection.removeAllRanges();
        selection.addRange(range);
    
        currentResizableImage = imageEl;
    
        const rect = imageEl.getBoundingClientRect();
        
        const left = window.scrollX + rect.left;
        const top = window.scrollY + rect.top;
        const width = rect.width;
        const height = rect.height;
    
        imageResizer.style.left = `${left}px`;
        imageResizer.style.top = `${top}px`;
        imageResizer.style.width = `${width}px`;
        imageResizer.style.height = `${height}px`;
        imageResizer.style.display = 'block';
    }

    function hideImageResizer() {
        if (currentResizableImage) {
            currentResizableImage = null;
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                selection.removeAllRanges();
            }
        }
        imageResizer.style.display = 'none';
    }

    document.body.addEventListener('click', (e) => {
        const imageEl = e.target;
        if (imageEl.tagName === 'IMG' && imageEl.closest('.note-content')) {
            if (imageEl === currentResizableImage) return;
            showImageResizer(imageEl);
        } else if (currentResizableImage && !e.target.closest('#image-resizer')) {
            hideImageResizer();
        }
    });

    const syncImageResizerState = () => {
        if (currentResizableImage && !currentResizableImage.isConnected) {
            hideImageResizer();
        }
    };

    document.addEventListener('selectionchange', syncImageResizerState);
    document.body.addEventListener('input', syncImageResizerState, true);

    imageResizer.addEventListener('mousedown', (e) => {
        if (!e.target.classList.contains('resize-handle')) return;
        e.preventDefault();
        e.stopPropagation();
        
        isResizing = true;
        const handle = e.target.dataset.handle;
        
        initialResizeState = {
            handle: handle,
            startX: e.clientX,
            startY: e.clientY,
            initialWidth: currentResizableImage.offsetWidth,
            initialHeight: currentResizableImage.offsetHeight,
        };

        document.addEventListener('mousemove', handleImageResize);
        document.addEventListener('mouseup', stopImageResize);
    });

    function handleImageResize(e) {
        if (!isResizing || !currentResizableImage) return;

        const dx = e.clientX - initialResizeState.startX;
        const dy = e.clientY - initialResizeState.startY;

        let newWidth = initialResizeState.initialWidth;
        let newHeight = initialResizeState.initialHeight;

        const handle = initialResizeState.handle;

        if (handle.includes('right')) newWidth += dx;
        if (handle.includes('left')) newWidth -= dx;
        if (handle.includes('bottom')) newHeight += dy;
        if (handle.includes('top')) newHeight -= dy;
        
        const aspectRatio = initialResizeState.initialWidth / initialResizeState.initialHeight;
        if (handle.includes('left') || handle.includes('right')) {
             if (handle.includes('top') || handle.includes('bottom')) { // Corner handles
                if (Math.abs(dx) > Math.abs(dy)) {
                    newHeight = newWidth / aspectRatio;
                } else {
                    newWidth = newHeight * aspectRatio;
                }
            }
        }

        currentResizableImage.style.width = `${Math.max(30, newWidth)}px`;
        currentResizableImage.style.height = 'auto';
        
        showImageResizer(currentResizableImage);
    }

    function stopImageResize() {
        if (!isResizing) return;
        isResizing = false;

        document.removeEventListener('mousemove', handleImageResize);
        document.removeEventListener('mouseup', stopImageResize);
        
        if (currentResizableImage) {
            const noteContent = currentResizableImage.closest('.note-content');
            if (noteContent) {
                noteContent.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            }
        }
    }
    document.addEventListener('copy', async (e) => {
        if (currentResizableImage) {
            e.preventDefault();
    
            try {
                const dataUrl = currentResizableImage.src;
                const blob = dataURLtoBlob(dataUrl);
                const item = new ClipboardItem({ [blob.type]: blob });
                await navigator.clipboard.write([item]);
                console.log('图片已成功复制到剪贴板！');
            } catch (err) {
                console.error('使用 Clipboard API 复制图片失败:', err);
            }
        }
    });

    // 在 setupGlobalListeners 函数的末尾添加：
    window.addEventListener('resize', debounce(() => {
        trackWindowResize();
        scheduleUpdateBodySize();
    }, 200));
    
    
}

// ===================== 关键改动 2: 应用初始化 =====================
function initialize() {
    addButtonsContainer = document.querySelector('.add-buttons-container');
    workspaceControls = document.querySelector('.workspace-controls');
    
    appContainer.style.transition = 'none';

    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'dark' || savedTheme === 'light') {
        applyTheme(savedTheme);
    }
    
    // --- Settings ---
    loadSettings();
    
    // 强制同步项目字体大小至便签字体大小 (20px)
    if (appSettings.projectFontSize !== appSettings.noteFontSize) {
        appSettings.projectFontSize = appSettings.noteFontSize;
        saveSettings();
    }
    
    applySettings();

    // --- UI 状态加载 (这部分与模式无关，总是从 localStorage 读取) ---
    lastTextColor = localStorage.getItem('lastTextColor') || '#000000';
    lastBgColor = localStorage.getItem('lastBgColor') || '#fffbe0';
    recentTextColors = JSON.parse(localStorage.getItem('recentTextColors')) || ['#d94336', '#f29d38', '#4285f4', '#34a853', '#858585', '#000000'];
    recentBgColors = JSON.parse(localStorage.getItem('recentBgColors')) || ['#fffbe0', '#d4e5f7', '#deead7', '#fde2dd', '#e8e8e8', '#ffffff'];
    
    // *** 关键修改开始 ***
    // 将默认逻辑从“不为false则显示”改为“明确为true才显示”，实现默认隐藏
    const savedSwitcherState = localStorage.getItem('workspaceSwitcherVisible');
    // 首次进入默认显示
    isSwitcherVisible = savedSwitcherState === null ? true : savedSwitcherState === 'true';
    workspaceSwitcherContainer.classList.toggle('switcher-visible', isSwitcherVisible);

    const savedAddButtonsVisible = localStorage.getItem('addButtonsVisible');
    if (savedAddButtonsVisible === null || savedAddButtonsVisible === 'true') {
        addButtonsContainer.classList.add('visible');
    }

    const savedWorkspaceControlsVisible = localStorage.getItem('workspaceControlsVisible');
    if (savedWorkspaceControlsVisible === null || savedWorkspaceControlsVisible === 'true') {
        workspaceControls.classList.add('visible');
    }
    // *** 关键修改结束 ***
    
    const savedZoom = parseFloat(localStorage.getItem('appZoomLevel'));
    if (savedZoom && !isNaN(savedZoom)) {
        currentZoom = savedZoom;
        applyZoom(currentZoom);
    }
    
    // --- 核心数据加载 (根据模式选择不同逻辑) ---
    let savedData = null;

    if (RUN_MODE === 'SERVER' || RUN_MODE === 'WEBVIEW') { // WEBVIEW 模式也从后端获取初始数据
        console.log(`Running in ${RUN_MODE} mode. Loading data from server.`);
        savedData = INITIAL_DATA;
    } else { // 'STATIC' 模式
        console.log("Running in STATIC mode. Loading data from localStorage.");
        const localDataString = localStorage.getItem('todoWorkspaces');
        if (localDataString) {
            try {
                savedData = JSON.parse(localDataString);
            } catch (e) {
                console.error("Failed to parse localStorage data, falling back to initial data.", e);
                savedData = INITIAL_DATA;
            }
        } else {
            savedData = INITIAL_DATA;
        }
    }

    // --- 数据初始化与渲染 ---
    if (savedData && savedData.workspaces && savedData.workspaces.length > 0) {
        workspaces = savedData.workspaces;
        // 兼容性检查和数据清洗
        workspaces.forEach(ws => { 
            ws.name = (ws.name || '').trim() || '未命名工作区';
            ws.notes = ws.notes || {};
            ws.shapes = ws.shapes || {};
            ws.emojis = ws.emojis || {};
            ws.photos = ws.photos || {};
            Object.values(ws.notes).forEach(note => { 
                if (typeof note.title === 'undefined') { note.title = '便签'; } 
            });
            Object.values(ws.shapes).forEach(shape => {
                shape.text ??= '';
                shape.isBold ??= false;
                shape.type ||= 'rect';
                shape.color ||= '#4f46e5';
            });
            Object.values(ws.emojis).forEach(emoji => {
                emoji.symbol ||= '😀';
            });
            Object.values(ws.projects || {}).forEach(project => {
                (project.todos || []).forEach(todo => {
                    todo.textBold ??= false;
                    if (typeof todo.textColor === 'undefined' || todo.textColor === '#000000') {
                        todo.textColor = null;
                    }
                    todo.planTime ??= null;
                    todo.remindTime ??= null;
                    todo.remindNotified ??= false;
                    if (typeof todo.remindAt === 'undefined' && todo.remindTime) {
                        todo.remindAt = parseDateTimeToMs(todo.remindTime);
                    } else if (typeof todo.remindAt === 'undefined') {
                        todo.remindAt = null;
                    }
                    if (typeof todo.textHtml === 'undefined') {
                        todo.textHtml = escapeHTML(todo.text || '');
                    }
                });
            });
            Object.values(ws.photos).forEach(photo => {
                photo.src ||= '';
            });
        });
        currentWorkspaceIndex = savedData.currentWorkspaceIndex < savedData.workspaces.length ? savedData.currentWorkspaceIndex : 0;
        lastSavedPayload = JSON.stringify({ workspaces, currentWorkspaceIndex });
    } else {
        console.warn("No valid data found. Creating a default workspace.");
        workspaces = [{ id: `ws_${Date.now()}`, name: '我的工作区', projects: {}, notes: {}, shapes: {}, emojis: {}, photos: {} }];
        currentWorkspaceIndex = 0;
        saveWorkspaces();
    }
    
    setupGlobalListeners();
    startFrameGapMonitor();
    renderCurrentWorkspace();
    scheduleRenderWorkspaceSwitcher();
    startReminderWatcher();
    scheduleUpdateBodySize();

    setTimeout(() => {
        appContainer.style.transition = 'transform 0.35s ease-in-out, opacity 0.35s ease-in-out';
    }, 0);
}
// ==========================================================

// --- PERF WRAPS (placed after definitions) ---
renderCurrentWorkspace = perfWrap('renderCurrentWorkspace', renderCurrentWorkspace);
renderWorkspaceSwitcher = perfWrap('renderWorkspaceSwitcher', renderWorkspaceSwitcher);
updateBodySizeForZoom = perfWrap('updateBodySizeForZoom', updateBodySizeForZoom);
checkTaskReminders = perfWrap('checkTaskReminders', checkTaskReminders);
saveWorkspaces = perfWrap('saveWorkspaces', saveWorkspaces);
initialize = perfWrap('initialize', initialize);

initialize();