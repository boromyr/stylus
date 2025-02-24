/* global $ $create getEventKeyName messageBoxProxy moveFocus */// dom.js
/* global CodeMirror */
/* global editor */
/* global prefs */
/* global clipString */// toolbox.js
/* global t */// localization.js
'use strict';

const helpPopup = {

  /**
   * @param {string} title - plain text
   * @param {string|Node} body - Node, html or plain text
   * @param {Node} [props] - DOM props for the popup element
   * @returns {Element} the popup
   */
  show(title = '', body, props) {
    const div = $('#help-popup');
    const contents = helpPopup.contents = $('.contents', div);
    div.style = '';
    div.className = '';
    contents.textContent = '';
    Object.assign(div, props);
    if (body) {
      contents.appendChild(typeof body === 'string' ? t.HTML(body) : body);
    }
    $('.title', div).textContent = title;
    $('.dismiss', div).onclick = helpPopup.close;
    window.on('keydown', helpPopup.close, true);
    div.style.display = 'block';
    helpPopup.originalFocus = document.activeElement;
    helpPopup.div = div;
    moveFocus(div, 0);
    return div;
  },

  close(event) {
    let el;
    const canClose =
      !event ||
      event.type === 'click' ||
      getEventKeyName(event) === 'Escape' && !$('.CodeMirror-hints, #message-box') && (
        !(el = document.activeElement) ||
        !el.closest('#search-replace-dialog')
      );
    const {div} = helpPopup;
    if (!canClose || !div) {
      return;
    }
    if (event && (el = div.codebox) && !el.options.readOnly && !el.isClean()) {
      setTimeout(async () => {
        const ok = await messageBoxProxy.confirm(t('confirmDiscardChanges'));
        return ok && helpPopup.close();
      });
      return;
    }
    if (div.contains(document.activeElement) && (el = helpPopup.originalFocus)) {
      el.focus();
    }
    const {contents} = helpPopup;
    div.style.display = '';
    contents.textContent = '';
    window.off('keydown', helpPopup.close, true);
    window.dispatchEvent(new Event('closeHelp'));
  },
};

// reroute handling to nearest editor when keypress resolves to one of these commands
const rerouteHotkeys = {
  commands: [
    'beautify',
    'colorpicker',
    'find',
    'findNext',
    'findPrev',
    'jumpToLine',
    'nextEditor',
    'prevEditor',
    'replace',
    'replaceAll',
    'save',
    'toggleEditorFocus',
    'toggleStyle',
  ],

  toggle(enable) {
    document[enable ? 'on' : 'off']('keydown', rerouteHotkeys.handler);
  },

  handler(event) {
    const keyName = CodeMirror.keyName(event);
    if (!keyName) {
      return;
    }
    const rerouteCommand = name => {
      if (rerouteHotkeys.commands.includes(name)) {
        CodeMirror.commands[name](editor.closestVisible(event.target));
        return true;
      }
    };
    if (CodeMirror.lookupKey(keyName, CodeMirror.defaults.keyMap, rerouteCommand) === 'handled' ||
        CodeMirror.lookupKey(keyName, CodeMirror.defaults.extraKeys, rerouteCommand) === 'handled') {
      event.preventDefault();
      event.stopPropagation();
    }
  },
};

/* exported createHotkeyInput */
function createHotkeyInput(prefId, {buttons = true, onDone}) {
  const RX_ERR = new RegExp('^(' + [
    /Space/,
    /(Shift-)?./, // a single character
    /(?=.)(Shift-?|Ctrl-?|Control-?|Alt-?|Meta-?)*(Escape|Tab|Page(Up|Down)|Arrow(Up|Down|Left|Right)|Home|End)?/,
  ].map(r => r.source || r).join('|') + ')$', 'i');
  const initialValue = prefs.get(prefId);
  const input = $create('input', {
    spellcheck: false,
    onpaste: e => onkeydown(e, e.clipboardData.getData('text')),
    onkeydown,
  });
  buttons = buttons && [
    ['confirmOK', 'Enter'],
    ['undo', initialValue],
    ['genericResetLabel', ''],
  ].map(([label, val]) =>
    $create('button', {onclick: e => onkeydown(e, val)}, t(label)));
  const [btnOk, btnUndo, btnReset] = buttons || [];
  onkeydown(null, initialValue);
  return buttons
    ? $create('fragment', [input, $create('.buttons', buttons)])
    : input;

  function onkeydown(e, key) {
    let newValue;
    if (e && e.type === 'keydown') {
      key = getEventKeyName(e);
    }
    switch (e && key) {
      case 'Tab':
      case 'Shift-Tab':
        return;
      case 'BackSpace':
      case 'Delete':
        newValue = '';
        break;
      case 'Enter':
        if (input.checkValidity() && onDone) onDone();
        break;
      case 'Escape':
        if (onDone) onDone();
        break;
      default:
        newValue = key.replace(/\b.$/, c => c.toUpperCase());
    }
    if (newValue != null) {
      const error = RX_ERR.test(newValue) ? t('genericError') : '';
      if (e && !error) prefs.set(prefId, newValue);
      input.setCustomValidity(error);
      input.value = newValue;
      input.focus();
      if (buttons) {
        btnOk.disabled = Boolean(error);
        btnUndo.disabled = newValue === initialValue;
        btnReset.disabled = !newValue;
      }
    }
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
}

/* exported showCodeMirrorPopup */
function showCodeMirrorPopup(title, html, options) {
  const popup = helpPopup.show(title, html, {className: 'big'});

  let cm = popup.codebox = CodeMirror(helpPopup.contents, Object.assign({
    mode: 'css',
    lineNumbers: true,
    lineWrapping: prefs.get('editor.lineWrapping'),
    foldGutter: true,
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter', 'CodeMirror-lint-markers'],
    matchBrackets: true,
    styleActiveLine: true,
    theme: prefs.get('editor.theme'),
    keyMap: prefs.get('editor.keyMap'),
  }, options));
  cm.focus();

  $.root.style.pointerEvents = 'none';
  popup.style.pointerEvents = 'auto';

  const onKeyDown = event => {
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const search = $('#search-replace-dialog');
      const area = search && search.contains(document.activeElement) ? search : popup;
      moveFocus(area, event.shiftKey ? -1 : 1);
      event.preventDefault();
    }
  };
  window.on('keydown', onKeyDown, true);

  window.on('closeHelp', () => {
    window.off('keydown', onKeyDown, true);
    $.root.style.removeProperty('pointer-events');
    cm = popup.codebox = null;
  }, {once: true});

  return popup;
}

/* exported trimCommentLabel */
function trimCommentLabel(str, limit = 1000) {
  // stripping /*** foo ***/ to foo
  return clipString(str.replace(/^[!-/:;=\s]*|[-#$&(+,./:;<=>\s*]*$/g, ''), limit);
}
