'use strict';

{
  let x;
  window.isFrame = x = window !== parent;
  if (x) try { x = !!(Object.getOwnPropertyDescriptor(parent.location, 'href') || {}).get; } catch (e) { x = false; }
  window.isFrameSameOrigin = x;
  window.isFrameNoUrl = x && location.protocol === 'about:';
}

window.StyleInjector = window.INJECTED === 1 ? window.StyleInjector : ({
  compare,
  onUpdate = () => {},
}) => {
  const isExt = !!chrome.tabs;
  const PREFIX = 'stylus-';
  const PATCH_ID = 'transition-patch';
  // styles are out of order if any of these elements is injected between them
  // except `style` on our own page as it contains overrides
  const ORDERED_TAGS = new Set(['head', 'body', 'frameset', !isExt && 'style', 'link']);
  const docRewriteObserver = RewriteObserver(sort);
  const docRootObserver = RootObserver(sortIfNeeded);
  const toSafeChar = c => String.fromCharCode(0xFF00 + c.charCodeAt(0) - 0x20);
  const list = [];
  const table = new Map();
  let isEnabled = true;
  let isTransitionPatched = chrome.app && CSS.supports('accent-color', 'red'); // Chrome 93
  let exposeStyleName;
  // will store the original method refs because the page can override them
  let creationDoc, createElement, createElementNS;

  return {

    list,

    apply({cfg, sections: styles}) {
      if (cfg) exposeStyleName = cfg.name;
      return styles.length
        && docRootObserver.evade(() => {
          if (!isTransitionPatched && isEnabled) {
            applyTransitionPatch(styles);
          }
          return styles.map(addUpdate);
        }).then(emitUpdate);
    },

    clear() {
      if (!list.length) return;
      addRemoveElements(false);
      list.length = 0;
      table.clear();
      emitUpdate();
    },

    clearOrphans() {
      for (const el of document.querySelectorAll(`style[id^="${PREFIX}"].stylus`)) {
        const id = el.id.slice(PREFIX.length);
        if (/^\d+$/.test(id) || id === PATCH_ID) {
          el.remove();
        }
      }
    },

    remove(id) {
      if (remove(id)) emitUpdate();
    },

    replace({cfg, sections: styles}) {
      if (cfg) exposeStyleName = cfg.name;
      const added = new Set(styles.map(s => s.id));
      const removed = [];
      for (const style of list) {
        if (!added.has(style.id)) {
          removed.push(style.id);
        }
      }
      styles.forEach(addUpdate);
      removed.forEach(remove);
      emitUpdate();
    },

    toggle(enable) {
      if (isEnabled === enable) return;
      isEnabled = enable;
      if (!enable) toggleObservers(false);
      addRemoveElements(enable);
      if (enable) toggleObservers(true);
    },

    sort: sort,
  };

  function add(style) {
    const el = style.el = createStyle(style);
    const i = list.findIndex(item => compare(item, style) > 0);
    table.set(style.id, style);
    if (isEnabled) {
      document.documentElement.insertBefore(el, i < 0 ? null : list[i].el);
    }
    list.splice(i < 0 ? list.length : i, 0, style);
    return el;
  }

  function addRemoveElements(add) {
    for (const {el} of list) {
      if (add) {
        document.documentElement.appendChild(el);
      } else {
        el.remove();
      }
    }
  }

  function addUpdate(style) {
    return table.has(style.id) ? update(style) : add(style);
  }

  function applyTransitionPatch(styles) {
    isTransitionPatched = true;
    // CSS transition bug workaround: since we insert styles asynchronously,
    // the browsers, especially Firefox, may apply all transitions on page load
    if (document.readyState === 'complete' ||
        document.visibilityState === 'hidden' ||
        !styles.some(s => s.code.some(c => c.includes('transition')))) {
      return;
    }
    const el = createStyle({id: PATCH_ID, code: `
      :root:not(#\\0):not(#\\0) * {
        transition: none !important;
      }
    `});
    document.documentElement.appendChild(el);
    // wait for the next paint to complete
    // note: requestAnimationFrame won't fire in inactive tabs
    requestAnimationFrame(() => setTimeout(() => el.remove()));
  }

  /** @this {Array} array to compare to */
  function arrItemDiff(c, i) {
    return c !== this[i];
  }

  function createStyle(style) {
    const {id} = style;
    if (!creationDoc) initCreationDoc();
    let el;
    if (document.documentElement instanceof SVGSVGElement) {
      // SVG document style
      el = createElementNS.call(creationDoc, 'http://www.w3.org/2000/svg', 'style');
    } else if (document instanceof XMLDocument) {
      // XML document style
      el = createElementNS.call(creationDoc, 'http://www.w3.org/1999/xhtml', 'style');
    } else {
      // HTML document style; also works on HTML-embedded SVG
      el = createElement.call(creationDoc, 'style');
    }
    if (id) {
      el.id = `${PREFIX}${id}`;
      const oldEl = document.getElementById(el.id);
      if (oldEl) oldEl.id += '-superseded-by-Stylus';
    }
    el.type = 'text/css';
    // SVG className is not a string, but an instance of SVGAnimatedString
    el.classList.add('stylus');
    setTextAndName(el, style);
    return el;
  }

  function setTextAndName(el, {id, code, name}) {
    if (exposeStyleName && name) {
      el.dataset.name = name;
      name = encodeURIComponent(name.replace(/[?#/']/g, toSafeChar));
      code = code.concat(`\n/*# sourceURL=${chrome.runtime.getURL(name)}.user.css#${id}${
        window !== top ? '#' + Math.random().toString(36).slice(2) : '' // https://crbug.com/1298600
      } */`);
    }
    let i, len, n;
    for (i = 0, len = code.length, n = el.firstChild; n; i++, n = n.nextSibling) {
      /* The surplus nodes are cleared to trigger the less frequently observed `characterData` mutations,
         and anyway it's often due to a typo/mistake while editing, which will be fixed soon */
      if (i >= len) n.nodeValue = '';
      else if (n.nodeValue !== code[i]) n.nodeValue = code[i];
    }
    if (i < len) el.append(...code.slice(i));
  }

  function toggleObservers(shouldStart) {
    const onOff = shouldStart && isEnabled ? 'start' : 'stop';
    docRewriteObserver[onOff]();
    docRootObserver[onOff]();
  }

  function emitUpdate() {
    toggleObservers(list.length);
    onUpdate();
  }

  /*
  FF59+ workaround: allow the page to read our sheets, https://github.com/openstyles/stylus/issues/461
  First we're trying the page context document where inline styles may be forbidden by CSP
  https://bugzilla.mozilla.org/show_bug.cgi?id=1579345#c3
  and since userAgent.navigator can be spoofed via about:config or devtools,
  we're checking for getPreventDefault that was removed in FF59
  */
  function initCreationDoc() {
    creationDoc = !Event.prototype.getPreventDefault && document.wrappedJSObject;
    if (creationDoc) {
      ({createElement, createElementNS} = creationDoc);
      const el = document.documentElement.appendChild(createStyle({code: ''}));
      const isApplied = el.sheet;
      el.remove();
      if (isApplied) return;
    }
    creationDoc = document;
    ({createElement, createElementNS} = document);
  }

  function remove(id) {
    const style = table.get(id);
    if (!style) return;
    table.delete(id);
    list.splice(list.indexOf(style), 1);
    style.el.remove();
    return true;
  }

  function sort() {
    docRootObserver.evade(() => {
      list.sort(compare);
      addRemoveElements(true);
    });
  }

  function sortIfNeeded() {
    let needsSort;
    let el = list.length && list[0].el;
    if (!el) {
      needsSort = false;
    } else if (el.parentNode !== creationDoc.documentElement) {
      needsSort = true;
    } else {
      let i = 0;
      while (el) {
        if (i < list.length && el === list[i].el) {
          i++;
        } else if (ORDERED_TAGS.has(el.localName)) {
          needsSort = true;
          break;
        }
        el = el.nextElementSibling;
      }
      // some styles are not injected to the document
      if (i < list.length) needsSort = true;
    }
    if (needsSort) sort();
    return needsSort;
  }

  function update(newStyle) {
    const {id, code} = newStyle;
    const style = table.get(id);
    if (style.code.length !== code.length ||
        style.code.some(arrItemDiff, code) ||
        style.name !== newStyle.name && exposeStyleName) {
      style.code = code;
      setTextAndName(style.el, newStyle);
    }

  }

  function RewriteObserver(onChange) {
    // detect documentElement being rewritten from inside the script
    let root;
    let observing = false;
    let timer;
    const observer = new MutationObserver(check);
    return {start, stop};

    function start() {
      if (observing || isExt) return;
      // detect dynamic iframes rewritten after creation by the embedder i.e. externally
      root = document.documentElement;
      timer = setTimeout(check);
      observer.observe(document, {childList: true});
      observing = true;
    }

    function stop() {
      if (!observing || isExt) return;
      clearTimeout(timer);
      observer.disconnect();
      observing = false;
    }

    function check() {
      if (root !== document.documentElement) {
        root = document.documentElement;
        onChange();
      }
    }
  }

  function RootObserver(onChange) {
    let digest = 0;
    let lastCalledTime = NaN;
    let observing = false;
    const observer = new MutationObserver(() => {
      if (digest) {
        if (performance.now() - lastCalledTime > 1000) {
          digest = 0;
        } else if (digest > 5) {
          throw new Error('The page keeps generating mutations. Skip the event.');
        }
      }
      if (onChange()) {
        digest++;
        lastCalledTime = performance.now();
      }
    });
    return {evade, start, stop};

    function evade(fn) {
      const restore = observing && start;
      stop();
      return new Promise(resolve => run(fn, resolve, waitForRoot))
        .then(restore);
    }

    function start() {
      if (observing) return;
      observer.observe(document.documentElement, {childList: true});
      observing = true;
    }

    function stop() {
      if (!observing) return;
      // FIXME: do we need this?
      observer.takeRecords();
      observer.disconnect();
      observing = false;
    }

    function run(fn, resolve, wait) {
      if (document.documentElement) {
        resolve(fn());
        return true;
      }
      if (wait) wait(fn, resolve);
    }

    function waitForRoot(...args) {
      new MutationObserver((_, observer) => run(...args) && observer.disconnect())
        .observe(document, {childList: true});
    }
  }
};
