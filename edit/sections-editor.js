/* global $ $create $remove messageBoxProxy */// dom.js
/* global API */// msg.js
/* global CodeMirror */
/* global RX_META debounce */// toolbox.js
/* global MozDocMapper clipString helpPopup rerouteHotkeys showCodeMirrorPopup */// util.js
/* global EditorSection */// sections-editor-section.js
/* global editor */
/* global linterMan */
/* global prefs */
/* global styleSectionsEqual */ // sections-util.js
/* global t */// localization.js
'use strict';

/* exported SectionsEditor */
function SectionsEditor() {
  const {style, /** @type DirtyReporter */dirty} = editor;
  const container = $('#sections');
  /** @type {EditorSection[]} */
  const sections = [];
  const xo = new IntersectionObserver(refreshOnViewListener, {rootMargin: '100%'});
  let INC_ID = 0; // an increment id that is used by various object to track the order
  let sectionOrder = '';
  let headerOffset; // in compact mode the header is at the top so it reduces the available height
  let cmExtrasHeight; // resize grip + borders
  let upDownJumps;

  updateMeta();
  rerouteHotkeys.toggle(true); // enabled initially because we don't always focus a CodeMirror
  editor.livePreview.init();
  $('#to-mozilla').on('click', showMozillaFormat);
  $('#to-mozilla-help').on('click', showToMozillaHelp);
  $('#from-mozilla').on('click', () => showMozillaFormatImport());
  document.on('wheel', scrollEntirePageOnCtrlShift, {passive: false});
  CodeMirror.defaults.extraKeys['Shift-Ctrl-Wheel'] = 'scrollWindow';
  prefs.subscribe('editor.arrowKeysTraverse', (_, val) => {
    for (const {cm} of sections) handleKeydownSetup(cm, val);
    upDownJumps = val;
  }, true);

  /** @namespace Editor */
  Object.assign(editor, {

    sections,

    closestVisible,
    updateLivePreview,
    updateMeta,

    getEditors() {
      return sections.filter(s => !s.removed).map(s => s.cm);
    },

    getEditorTitle(cm) {
      const index = editor.getEditors().indexOf(cm) + 1;
      return {
        textContent: `#${index}`,
        title: `${t('sectionCode')} ${index}`,
      };
    },

    getValue(asObject) {
      const st = getModel();
      return asObject ? st : MozDocMapper.styleToCss(st);
    },

    getSearchableInputs(cm) {
      const sec = sections.find(s => s.cm === cm);
      return sec ? sec.targets.map(a => a.valueEl).filter(Boolean) : [];
    },

    isSame(styleObj) {
      return styleSectionsEqual(styleObj, getModel());
    },

    jumpToEditor(i) {
      const {cm} = sections[i] || {};
      if (cm) {
        editor.scrollToEditor(cm);
        cm.focus();
      }
    },

    nextEditor(cm, upDown) {
      return !upDown || cm !== findLast(sections, s => !s.removed).cm
        ? nextPrevEditor(cm, 1, upDown)
        : null;
    },

    prevEditor(cm, upDown) {
      return !upDown || cm !== sections.find(s => !s.removed).cm
        ? nextPrevEditor(cm, -1, upDown)
        : null;
    },

    async replaceStyle(newStyle, draft) {
      const sameCode = editor.isSame(newStyle);
      if (!sameCode && !draft && !await messageBoxProxy.confirm(t('styleUpdateDiscardChanges'))) {
        return;
      }
      if (!draft) {
        dirty.clear();
      }
      // FIXME: avoid recreating all editors?
      if (!sameCode) {
        await initSections(newStyle.sections, {
          keepDirty: draft,
          replace: true,
          si: draft && draft.si,
        });
      }
      editor.useSavedStyle(newStyle);
      updateLivePreview();
    },

    async saveImpl() {
      let newStyle = getModel();
      if (!validate(newStyle)) {
        return;
      }
      newStyle = await API.styles.editSave(newStyle);
      dirty.clear();
      editor.useSavedStyle(newStyle);
    },

    scrollToEditor(cm, partial) {
      const cc = partial && cm.cursorCoords(true, 'window');
      const {top: y1, bottom: y2} = cm.el.getBoundingClientRect();
      const rc = container.getBoundingClientRect();
      const rcY1 = Math.max(rc.top, 0);
      const rcY2 = Math.min(rc.bottom, innerHeight);
      const bad = partial
        ? cc.top < rcY1 || cc.top > rcY2 - 30
        : y1 >= rcY1 ^ y2 <= rcY2;
      if (bad) window.scrollBy(0, (y1 + y2 - rcY2 + rcY1) / 2 | 0);
    },
  });

  return initSections(style.sections);

  /** @param {EditorSection} section */
  function fitToContent(section) {
    const {cm, cm: {display: {wrapper, sizer}}} = section;
    if (cm.display.renderedView) {
      resize();
    } else {
      cm.on('update', resize);
    }

    function resize() {
      let contentHeight = sizer.offsetHeight;
      if (contentHeight < cm.defaultTextHeight()) {
        return;
      }
      if (headerOffset == null) {
        headerOffset = Math.ceil(container.getBoundingClientRect().top + scrollY);
      }
      if (cmExtrasHeight == null) {
        cmExtrasHeight = $('.resize-grip', wrapper).offsetHeight + // grip
          wrapper.offsetHeight - wrapper.clientHeight; // borders
      }
      contentHeight += cmExtrasHeight;
      cm.off('update', resize);
      const cmHeight = wrapper.offsetHeight;
      const appliesToHeight = Math.min(section.el.offsetHeight - cmHeight, window.innerHeight / 2);
      const maxHeight = Math.floor(window.innerHeight - headerOffset - appliesToHeight);
      const fit = Math.min(contentHeight, maxHeight);
      if (Math.abs(fit - cmHeight) > 1) {
        cm.setSize(null, fit);
      }
    }
  }

  function fitToAvailableSpace() {
    const lastSectionBottom = sections[sections.length - 1].el.getBoundingClientRect().bottom;
    const delta = Math.floor((window.innerHeight - lastSectionBottom) / sections.length);
    if (delta > 1) {
      sections.forEach(({cm}) => {
        cm.setSize(null, cm.display.lastWrapHeight + delta);
      });
    }
  }

  function genId() {
    return INC_ID++;
  }

  function setGlobalProgress(done, total) {
    const progressElement = $('#global-progress') ||
      total && document.body.appendChild($create('#global-progress'));
    if (total) {
      const progress = (done / Math.max(done, total) * 100).toFixed(1);
      progressElement.style.borderLeftWidth = progress + 'vw';
      setTimeout(() => {
        progressElement.title = progress + '%';
      });
    } else {
      $remove(progressElement);
    }
  }

  function showToMozillaHelp(event) {
    event.preventDefault();
    helpPopup.show(t('styleMozillaFormatHeading'), t('styleToMozillaFormatHelp'));
  }

  /**
   priority:
   1. associated CM for applies-to element
   2. last active if visible
   3. first visible
   */
  function closestVisible(el) {
    // closest editor should have at least 2 lines visible
    const lineHeight = sections[0].cm.defaultTextHeight();
    const margin = 2 * lineHeight;
    const cm = el instanceof CodeMirror ? el :
      el instanceof Node && getAssociatedEditor(el) || getLastActivatedEditor();
    if (el === cm) el = document.body;
    if (el instanceof Node && cm) {
      const {wrapper} = cm.display;
      if (!container.contains(el) || wrapper.closest('.section').contains(el)) {
        const rect = wrapper.getBoundingClientRect();
        if (rect.top < window.innerHeight - margin && rect.bottom > margin) {
          return cm;
        }
      }
    }
    const scrollY = window.scrollY;
    const windowBottom = scrollY + window.innerHeight - margin;
    const allSectionsContainerTop = scrollY + container.getBoundingClientRect().top;
    const distances = [];
    const alreadyInView = cm && offscreenDistance(null, cm) === 0;
    return alreadyInView ? cm : findClosest();

    function offscreenDistance(index, cm) {
      if (index >= 0 && distances[index] !== undefined) {
        return distances[index];
      }
      const section = cm && cm.display.wrapper.closest('.section');
      if (!section) {
        return 1e9;
      }
      const top = allSectionsContainerTop + section.offsetTop;
      if (top < scrollY + lineHeight) {
        return Math.max(0, scrollY - top - lineHeight);
      }
      if (top < windowBottom) {
        return 0;
      }
      const distance = top - windowBottom + section.offsetHeight;
      if (index >= 0) {
        distances[index] = distance;
      }
      return distance;
    }

    function findClosest() {
      const editors = editor.getEditors();
      const last = editors.length - 1;
      let a = 0;
      let b = last;
      let c;
      let distance;
      while (a < b - 1) {
        c = (a + b) / 2 | 0;
        distance = offscreenDistance(c);
        if (!distance || !c) {
          break;
        }
        const distancePrev = offscreenDistance(c - 1);
        const distanceNext = c < last ? offscreenDistance(c + 1) : 1e20;
        if (distancePrev <= distance && distance <= distanceNext) {
          b = c;
        } else {
          a = c;
        }
      }
      while (b && offscreenDistance(b - 1) <= offscreenDistance(b)) {
        b--;
      }
      const cm = editors[b];
      if (distances[b] > 0) {
        editor.scrollToEditor(cm);
      }
      return cm;
    }
  }

  function getAssociatedEditor(nearbyElement) {
    for (let el = nearbyElement; el; el = el.parentElement) {
      // added by EditorSection
      if (el.CodeMirror) {
        return el.CodeMirror;
      }
    }
  }

  function findLast(arr, match) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (match(arr[i])) {
        return arr[i];
      }
    }
  }

  function handleKeydown(event) {
    if (event.shiftKey || event.altKey || event.metaKey ||
        event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }
    let pos;
    let cm = this.CodeMirror;
    const {line, ch} = cm.getCursor();
    if (event.key === 'ArrowUp') {
      cm = line === 0 && editor.prevEditor(cm, true);
      pos = cm && [cm.doc.size - 1, ch];
    } else {
      cm = line === cm.doc.size - 1 && editor.nextEditor(cm, true);
      pos = cm && [0, 0];
    }
    if (cm) {
      cm.setCursor(...pos);
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleKeydownSetup(cm, state) {
    cm.display.wrapper[state ? 'on' : 'off']('keydown', handleKeydown, true);
  }

  function nextPrevEditor(cm, direction, upDown) {
    const editors = editor.getEditors();
    cm = editors[(editors.indexOf(cm) + direction + editors.length) % editors.length];
    editor.scrollToEditor(cm, upDown);
    cm.focus();
    return cm;
  }

  function getLastActivatedEditor() {
    let result;
    for (const section of sections) {
      if (section.removed) {
        continue;
      }
      // .lastActive is initiated by codemirror-factory
      if (!result || section.cm.lastActive > result.lastActive) {
        result = section.cm;
      }
    }
    return result;
  }

  function scrollEntirePageOnCtrlShift(event) {
    // make Shift-Ctrl-Wheel scroll entire page even when mouse is over a code editor
    if (event.shiftKey && event.ctrlKey && !event.altKey && !event.metaKey) {
      // Chrome scrolls horizontally when Shift is pressed but on some PCs this might be different
      window.scrollBy(0, event.deltaX || event.deltaY);
      event.preventDefault();
    }
  }

  function showMozillaFormat() {
    const popup = showCodeMirrorPopup(t('styleToMozillaFormatTitle'), '', {readOnly: true});
    popup.codebox.setValue(editor.getValue());
    popup.codebox.execCommand('selectAll');
  }

  function showMozillaFormatImport(text = '') {
    const popup = showCodeMirrorPopup(t('styleFromMozillaFormatPrompt'),
      $create('.buttons', [
        $create('button', {
          name: 'import-replace',
          textContent: t('importReplaceLabel'),
          title: 'Ctrl-Shift-Enter:\n' + t('importReplaceTooltip'),
          onclick: () => doImport({replaceOldStyle: true}),
        }),
        $create('button', {
          name: 'import-append',
          textContent: t('importAppendLabel'),
          title: 'Ctrl-Enter:\n' + t('importAppendTooltip'),
          onclick: doImport,
        }),
      ]));
    const contents = $('.contents', popup);
    contents.insertBefore(popup.codebox.display.wrapper, contents.firstElementChild);
    popup.codebox.focus();
    popup.codebox.on('changes', cm => {
      popup.classList.toggle('ready', !cm.isBlank());
      cm.markClean();
    });
    if (text) {
      popup.codebox.setValue(text);
      popup.codebox.clearHistory();
      popup.codebox.markClean();
    }
    // overwrite default extraKeys as those are inapplicable in popup context
    popup.codebox.options.extraKeys = {
      'Ctrl-Enter': doImport,
      'Shift-Ctrl-Enter': () => doImport({replaceOldStyle: true}),
    };

    async function doImport({replaceOldStyle = false}) {
      lockPageUI(true);
      try {
        const code = popup.codebox.getValue().trim();
        if (!RX_META.test(code) ||
            !await getPreprocessor(code) ||
            await messageBoxProxy.confirm(
              t('importPreprocessor'), 'pre-line',
              t('importPreprocessorTitle'))
        ) {
          const {sections, errors} = await API.worker.parseMozFormat({code});
          if (!sections.length || errors.some(e => !e.recoverable)) {
            await Promise.reject(errors);
          }
          await initSections(sections, {
            replace: replaceOldStyle,
            focusOn: replaceOldStyle ? 0 : false,
            keepDirty: true,
          });
          helpPopup.close();
        }
      } catch (err) {
        showError(err);
      }
      lockPageUI(false);
    }

    async function getPreprocessor(code) {
      try {
        return (await API.usercss.buildMeta({sourceCode: code})).usercssData.preprocessor;
      } catch (e) {}
    }

    function lockPageUI(locked) {
      $.root.style.pointerEvents = locked ? 'none' : '';
      if (popup.codebox) {
        popup.classList.toggle('ready', locked ? false : !popup.codebox.isBlank());
        popup.codebox.options.readOnly = locked;
        popup.codebox.display.wrapper.style.opacity = locked ? '.5' : '';
      }
    }

    function showError(errors) {
      messageBoxProxy.show({
        className: 'center danger',
        title: t('styleFromMozillaFormatError'),
        contents: $create('pre',
          (Array.isArray(errors) ? errors : [errors])
            .map(e => e.message || e).join('\n')),
        buttons: [t('confirmClose')],
      });
    }
  }

  function updateSectionOrder() {
    const oldOrder = sectionOrder;
    const validSections = sections.filter(s => !s.removed);
    sectionOrder = validSections.map(s => s.id).join(',');
    dirty.modify('sectionOrder', oldOrder, sectionOrder);
    container.dataset.sectionCount = validSections.length;
    linterMan.refreshReport();
    editor.updateToc();
  }

  /** @returns {StyleObj} */
  function getModel() {
    return Object.assign({}, style, {
      sections: sections.filter(s => !s.removed).map(s => s.getModel()),
    });
  }

  function validate() {
    if (!$('#name').reportValidity()) {
      messageBoxProxy.alert(t('styleMissingName'));
      return false;
    }
    for (const section of sections) {
      for (const target of section.targets) {
        if (target.type !== 'regexp') {
          continue;
        }
        if (!target.valueEl.reportValidity()) {
          messageBoxProxy.alert(t('styleBadRegexp'));
          return false;
        }
      }
    }
    return true;
  }

  function updateMeta() {
    $('#name').value = style.customName || style.name || '';
    $('#enabled').checked = style.enabled !== false;
    $('#url').href = style.url || '';
    editor.updateName();
  }

  function updateLivePreview() {
    debounce(updateLivePreviewNow, editor.previewDelay);
  }

  function updateLivePreviewNow() {
    editor.livePreview.update(getModel());
  }

  async function initSections(src, {
    focusOn = 0,
    replace = false,
    keepDirty = false,
    si = editor.scrollInfo,
  } = {}) {
    Object.assign(editor, /** @namespace Editor */ {loading: true});
    if (replace) {
      sections.forEach(s => s.remove(true));
      sections.length = 0;
      container.textContent = '';
    }
    if (si && si.cms && si.cms.length === src.length) {
      si.scrollY2 = si.scrollY + window.innerHeight;
      container.style.height = si.scrollY2 + 'px';
      scrollTo(0, si.scrollY);
      // only restore focus if it's the first CM to avoid derpy quirks
      focusOn = si.cms[0].focus && 0;
    } else {
      si = null;
    }
    let forceRefresh = true;
    let y = 0;
    let tPrev;
    for (let i = 0; i < src.length; i++) {
      const t = performance.now();
      if (!tPrev) {
        tPrev = t;
      } else if (t - tPrev > 100) {
        tPrev = 0;
        forceRefresh = false;
        await new Promise(setTimeout);
      }
      if (si) forceRefresh = y < si.scrollY2 && (y += si.cms[i].parentHeight) > si.scrollY;
      insertSectionAfter(src[i], null, forceRefresh, si && si.cms[i]);
      setGlobalProgress(i, src.length);
      if (!keepDirty) dirty.clear();
      if (i === focusOn) sections[i].cm.focus();
    }
    if (!si || si.cms.every(cm => !cm.height)) {
      requestAnimationFrame(fitToAvailableSpace);
    }
    container.style.removeProperty('height');
    setGlobalProgress();
    editor.loading = false;
  }

  /** @param {EditorSection} section */
  function removeSection(section) {
    if (sections.every(s => s.removed || s === section)) {
      // TODO: hide remove button when `#sections[data-section-count=1]`
      throw new Error('Cannot remove last section');
    }
    if (section.cm.isBlank()) {
      const index = sections.indexOf(section);
      sections.splice(index, 1);
      section.el.remove();
      section.remove();
      section.destroy();
    } else {
      const lines = [];
      const MAX_LINES = 10;
      section.cm.doc.iter(0, MAX_LINES + 1, ({text}) => lines.push(text) && false);
      const title = t('sectionCode') + '\n' +
                   '-'.repeat(20) + '\n' +
                   lines.slice(0, MAX_LINES).map(s => clipString(s, 100)).join('\n') +
                   (lines.length > MAX_LINES ? '\n...' : '');
      $('.deleted-section', section.el).title = title;
      section.remove();
    }
    dirty.remove(section, section);
    updateSectionOrder();
    section.off(updateLivePreview);
    updateLivePreview();
  }

  /** @param {EditorSection} section */
  function restoreSection(section) {
    section.restore();
    updateSectionOrder();
    section.onChange(updateLivePreview);
    updateLivePreview();
  }

  /**
   * @param {StyleSection} [init]
   * @param {EditorSection} [base]
   * @param {boolean} [forceRefresh]
   * @param {EditorScrollInfo} [si]
   */
  function insertSectionAfter(init, base, forceRefresh, si) {
    if (!init) {
      init = {code: '', urlPrefixes: ['https://example.com/']};
    }
    const section = new EditorSection(init, genId, si);
    const {cm} = section;
    const {code} = init;
    const index = base ? sections.indexOf(base) + 1 : sections.length;
    sections.splice(index, 0, section);
    container.insertBefore(section.el, base ? base.el.nextSibling : null);
    refreshOnView(cm, {code, force: base || forceRefresh});
    registerEvents(section);
    if ((!si || !si.height) && (!base || code)) {
      // Fit a) during startup or b) when the clone button is clicked on a section with some code
      fitToContent(section);
    }
    if (base) {
      cm.focus();
      editor.scrollToEditor(cm);
    }
    if (upDownJumps) {
      handleKeydownSetup(cm, true);
    }
    updateSectionOrder();
    updateLivePreview();
    section.onChange(updateLivePreview);
  }

  /** @param {EditorSection} section */
  function moveSectionUp(section) {
    const index = sections.indexOf(section);
    if (index === 0) {
      return;
    }
    container.insertBefore(section.el, sections[index - 1].el);
    sections[index] = sections[index - 1];
    sections[index - 1] = section;
    updateSectionOrder();
    editor.scrollToEditor(section.cm);
  }

  /** @param {EditorSection} section */
  function moveSectionDown(section) {
    const index = sections.indexOf(section);
    if (index === sections.length - 1) {
      return;
    }
    container.insertBefore(sections[index + 1].el, section.el);
    sections[index] = sections[index + 1];
    sections[index + 1] = section;
    updateSectionOrder();
    editor.scrollToEditor(section.cm);
  }

  /** @param {EditorSection} section */
  function registerEvents(section) {
    const {el, cm} = section;
    $('.remove-section', el).onclick = () => removeSection(section);
    $('.add-section', el).onclick = () => insertSectionAfter(undefined, section);
    $('.clone-section', el).onclick = () => insertSectionAfter(section.getModel(), section);
    $('.move-section-up', el).onclick = () => moveSectionUp(section);
    $('.move-section-down', el).onclick = () => moveSectionDown(section);
    $('.restore-section', el).onclick = () => restoreSection(section);
    cm.on('paste', maybeImportOnPaste);
  }

  function maybeImportOnPaste(cm, event) {
    const text = event.clipboardData.getData('text') || '';
    if (/@-moz-document/i.test(text) &&
        /@-moz-document\s+(url|url-prefix|domain|regexp)\(/i
          .test(text.replace(/\/\*([^*]+|\*(?!\/))*(\*\/|$)/g, ''))
    ) {
      event.preventDefault();
      showMozillaFormatImport(text);
    }
  }

  function refreshOnView(cm, {code, force} = {}) {
    if (code) {
      linterMan.enableForEditor(cm, code);
    }
    if (force) {
      refreshOnViewNow(cm);
    } else {
      xo.observe(cm.display.wrapper);
    }
  }

  /** @param {IntersectionObserverEntry[]} entries */
  function refreshOnViewListener(entries) {
    for (const e of entries) {
      const r = e.isIntersecting && e.intersectionRect;
      if (r) {
        xo.unobserve(e.target);
        const cm = e.target.CodeMirror;
        if (r.bottom > 0 && r.top < window.innerHeight) {
          refreshOnViewNow(cm);
        } else {
          setTimeout(refreshOnViewNow, 0, cm);
        }
      }
    }
  }

  async function refreshOnViewNow(cm) {
    linterMan.enableForEditor(cm);
    cm.refresh();
  }
}
