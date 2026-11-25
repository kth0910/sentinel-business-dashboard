(() => {
  const tolerance = 2;
  const active = document.querySelector('.slide.active');
  const issues = [];
  const warnings = [];
  if (!active) return { ok: false, checked: 0, line_checks: 0, issues: ['Missing active slide'], warnings };

  const visiblyEnabled = element => {
    let current = element;
    while (current) {
      const style = getComputedStyle(current);
      if (
        style.display === 'none'
        || ['hidden', 'collapse'].includes(style.visibility)
        || Number(style.opacity) <= 0
        || style.contentVisibility === 'hidden'
      ) {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  };
  const visible = element => {
    const rect = element.getBoundingClientRect();
    return visiblyEnabled(element) && rect.width > 0 && rect.height > 0;
  };
  const label = element => {
    const explicit = element.getAttribute('data-title') || element.getAttribute('aria-label') || element.id;
    const content = (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 56);
    return explicit || content || element.tagName.toLowerCase();
  };
  const outside = (inner, outer) => (
    inner.left < outer.left - tolerance || inner.right > outer.right + tolerance
    || inner.top < outer.top - tolerance || inner.bottom > outer.bottom + tolerance
  );
  const intersection = (left, right) => ({
    width: Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left)),
    height: Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top)),
  });
  const directText = element => [...element.childNodes].some(node => (
    node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()
  ));
  const paintsOpaqueVisual = element => {
    const style = getComputedStyle(element);
    const color = style.backgroundColor || '';
    const alphaMatch = color.match(/rgba?\([^)]*[,/]\s*([\d.]+)\s*\)$/i);
    const backgroundAlpha = color === 'transparent' ? 0 : (alphaMatch ? Number(alphaMatch[1]) : 1);
    return Number(style.opacity) > 0.05 && (
      backgroundAlpha > 0.08 || style.backgroundImage !== 'none'
      || ['IMG', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME'].includes(element.tagName)
    );
  };
  const paintsStructuralBox = element => {
    const style = getComputedStyle(element);
    const borderWidth = ['Top', 'Right', 'Bottom', 'Left'].some(side => (
      Number.parseFloat(style[`border${side}Width`]) > 0
      && style[`border${side}Style`] !== 'none'
    ));
    return paintsOpaqueVisual(element) || borderWidth
      || style.boxShadow !== 'none' || style.outlineStyle !== 'none';
  };
  const nearestPaintedContainer = element => {
    if (paintsStructuralBox(element)) return element;
    let current = element.parentElement;
    while (current && current !== active) {
      if (
        !current.classList.contains('slide-content')
        && !current.classList.contains('slide-media')
        && paintsStructuralBox(current)
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  };
  const normalizeFontFamily = value => value.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  const parseFontWeight = value => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'normal') return 400;
    if (normalized === 'bold') return 700;
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = 1;
  colorCanvas.height = 1;
  const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
  const parseComputedColor = value => {
    if (!colorContext || !value) return null;
    colorContext.clearRect(0, 0, 1, 1);
    colorContext.globalCompositeOperation = 'copy';
    colorContext.fillStyle = 'rgba(0, 0, 0, 0)';
    colorContext.fillStyle = value;
    colorContext.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = colorContext.getImageData(0, 0, 1, 1).data;
    return { red: red / 255, green: green / 255, blue: blue / 255, alpha: alpha / 255 };
  };
  const over = (foreground, background) => {
    const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
    if (alpha <= 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
    return {
      red: (
        foreground.red * foreground.alpha
        + background.red * background.alpha * (1 - foreground.alpha)
      ) / alpha,
      green: (
        foreground.green * foreground.alpha
        + background.green * background.alpha * (1 - foreground.alpha)
      ) / alpha,
      blue: (
        foreground.blue * foreground.alpha
        + background.blue * background.alpha * (1 - foreground.alpha)
      ) / alpha,
      alpha,
    };
  };
  const withOpacity = (color, opacity) => ({ ...color, alpha: color.alpha * opacity });
  const relativeLuminance = color => {
    const linear = channel => (
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    );
    return (
      0.2126 * linear(color.red)
      + 0.7152 * linear(color.green)
      + 0.0722 * linear(color.blue)
    );
  };
  const contrastRatio = (left, right) => {
    const leftLuminance = relativeLuminance(left);
    const rightLuminance = relativeLuminance(right);
    return (
      (Math.max(leftLuminance, rightLuminance) + 0.05)
      / (Math.min(leftLuminance, rightLuminance) + 0.05)
    );
  };
  const pointInside = (element, point) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      && point.x >= rect.left && point.x <= rect.right
      && point.y >= rect.top && point.y <= rect.bottom;
  };
  const nondeterministicVisual = element => {
    const style = getComputedStyle(element);
    return (
      ['IMG', 'PICTURE', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME'].includes(element.tagName)
      || style.backgroundImage !== 'none'
    );
  };
  const compositedTextColors = (element, foreground, point) => {
    const transparent = { red: 0, green: 0, blue: 0, alpha: 0 };
    let backgroundGroup = transparent;
    let textGroup = foreground;
    let current = element;
    let imageBacked = false;
    let opaqueBarrier = null;
    const ancestorChain = new Set();

    while (current) {
      ancestorChain.add(current);
      const style = getComputedStyle(current);
      if (pointInside(current, point)) {
        if (style.backgroundImage !== 'none' && backgroundGroup.alpha < 0.999) {
          imageBacked = true;
        }
        const backgroundColor = parseComputedColor(style.backgroundColor);
        if (backgroundColor) {
          backgroundGroup = over(backgroundGroup, backgroundColor);
          textGroup = over(textGroup, backgroundColor);
        }
      }
      const opacity = Math.max(0, Math.min(1, Number(style.opacity)));
      backgroundGroup = withOpacity(backgroundGroup, Number.isFinite(opacity) ? opacity : 1);
      textGroup = withOpacity(textGroup, Number.isFinite(opacity) ? opacity : 1);
      if (!opaqueBarrier && backgroundGroup.alpha >= 0.999) opaqueBarrier = current;
      if (
        style.mixBlendMode !== 'normal'
        || style.filter !== 'none'
        || (style.backdropFilter && style.backdropFilter !== 'none')
      ) {
        imageBacked = true;
      }
      current = current.parentElement;
    }

    if (!imageBacked) {
      const stack = document.elementsFromPoint(point.x, point.y);
      const ownerIndex = stack.findIndex(candidate => (
        candidate === element || candidate.contains(element)
      ));
      const barrierIndex = opaqueBarrier ? stack.indexOf(opaqueBarrier) : -1;
      const limit = barrierIndex > ownerIndex ? barrierIndex : stack.length;
      if (ownerIndex >= 0) {
        imageBacked = stack.slice(ownerIndex + 1, limit).some(candidate => (
          !ancestorChain.has(candidate) && nondeterministicVisual(candidate)
        ));
      }
    }

    if (imageBacked) return { reliable: false };
    const canvas = { red: 1, green: 1, blue: 1, alpha: 1 };
    return {
      reliable: true,
      foreground: over(textGroup, canvas),
      background: over(backgroundGroup, canvas),
    };
  };
  const declaredFontWeights = new Map();
  const collectFontFaces = rules => {
    for (const rule of rules) {
      if (rule.type === CSSRule.FONT_FACE_RULE) {
        const family = normalizeFontFamily(rule.style.getPropertyValue('font-family'));
        const parts = rule.style.getPropertyValue('font-weight').trim().split(/\s+/).filter(Boolean);
        const start = parseFontWeight(parts[0] || 'normal');
        const end = parseFontWeight(parts[1] || parts[0] || 'normal');
        if (family && start !== null && end !== null) {
          const ranges = declaredFontWeights.get(family) || [];
          ranges.push([Math.min(start, end), Math.max(start, end)]);
          declaredFontWeights.set(family, ranges);
        }
      } else if (rule.cssRules) {
        collectFontFaces(rule.cssRules);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      collectFontFaces(sheet.cssRules);
    } catch (_error) {
      warnings.push('A stylesheet could not be inspected for declared font weights');
    }
  }
  const declaredFamily = style => {
    const families = style.fontFamily.match(/(?:"[^"]*"|'[^']*'|[^,])+/g) || [];
    return families.map(normalizeFontFamily).find(family => declaredFontWeights.has(family));
  };
  const emphasisSignature = style => [
    style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle,
    style.color, style.backgroundColor, style.textDecorationLine,
    style.textDecorationStyle, style.textDecorationColor, style.textShadow,
    style.letterSpacing,
  ].join('|');
  const inlineTextTags = new Set(['SPAN', 'BR', 'EM', 'STRONG', 'B', 'I', 'SMALL', 'MARK', 'S', 'U']);
  const inlineTextWrapper = element => {
    const display = getComputedStyle(element).display;
    return element.childElementCount > 0
      && !display.includes('grid') && !display.includes('flex')
      && (element.textContent || '').trim()
      && [...element.children].every(child => inlineTextTags.has(child.tagName));
  };
  const textSelectors = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'dt', 'dd', 'td', 'th',
    'button', 'a', 'label', 'figcaption', 'blockquote', 'pre', 'code',
    '.display-type', '.headline', '.title', '.quote', '.eyebrow', '.kicker',
    '.caption', '.source', '.footnote', '.badge', '.chip',
    '[data-display-text]', '[data-text-box]', '[data-text-container]'
  ].join(',');
  const displaySelectors = [
    'h1', 'h2', 'h3', 'blockquote', '.display-type', '.headline', '.title', '.quote',
    '[data-display-text]'
  ].join(',');

  const slideRect = active.getBoundingClientRect();
  const logicalSlideWidth = active.offsetWidth || slideRect.width;
  const stageScale = logicalSlideWidth ? slideRect.width / logicalSlideWidth : 1;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  if (
    slideRect.left < -tolerance || slideRect.top < -tolerance
    || slideRect.right > viewportWidth + tolerance || slideRect.bottom > viewportHeight + tolerance
  ) {
    issues.push(
      `Active slide crosses viewport bounds: ${Math.round(slideRect.left)},${Math.round(slideRect.top)} `
      + `${Math.round(slideRect.right)},${Math.round(slideRect.bottom)} vs ${viewportWidth}x${viewportHeight}`
    );
  }

  const semanticElements = [...active.querySelectorAll(textSelectors)];
  const allHtmlElements = [...active.querySelectorAll('*')].filter(element => (
    element.namespaceURI === 'http://www.w3.org/1999/xhtml'
  ));
  const directTextElements = allHtmlElements.filter(directText);
  const inlineTextWrapperCandidates = allHtmlElements.filter(inlineTextWrapper);
  const inlineTextWrappers = inlineTextWrapperCandidates.filter(element => (
    !element.parentElement?.closest(textSelectors)
    && !inlineTextWrapperCandidates.some(owner => owner !== element && owner.contains(element))
  ));
  const elements = [...new Set([...semanticElements, ...directTextElements, ...inlineTextWrappers])].filter(element => (
    visible(element) && (element.textContent || '').trim()
    && !element.closest('[data-text-bounds-ignore]')
  ));
  const contrastIgnoreElements = [
    active,
    ...active.querySelectorAll('[data-contrast-ignore]'),
  ].filter(element => element.hasAttribute('data-contrast-ignore'));
  for (const element of contrastIgnoreElements) {
    const value = element.getAttribute('data-contrast-ignore').trim();
    if (value !== 'decorative') {
      issues.push(
        `${label(element)}: unsupported data-contrast-ignore="${value}"; `
        + 'the only supported value is "decorative"'
      );
    } else if (visiblyEnabled(element)) {
      warnings.push(
        `${label(element)}: exact-element decorative contrast exemption requires visual inspection`
      );
    }
  }

  const contrastRecords = new Map();
  const meaningfulText = value => /[\p{L}\p{N}]/u.test(value);
  const excludedTextParents = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
  const contrastWalker = document.createTreeWalker(active, NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      const parent = node.parentElement;
      if (
        !parent
        || parent.namespaceURI !== 'http://www.w3.org/1999/xhtml'
        || excludedTextParents.has(parent.tagName)
        || !meaningfulText(node.nodeValue)
        || !visiblyEnabled(parent)
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  while (contrastWalker.nextNode()) {
    const node = contrastWalker.currentNode;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter(rect => {
      if (rect.width <= 0 || rect.height <= 0) return false;
      const visibleArea = intersection(rect, slideRect);
      return visibleArea.width > 0 && visibleArea.height > 0;
    });
    range.detach();
    if (!rects.length) continue;
    const element = node.parentElement;
    const record = contrastRecords.get(element) || { element, points: [] };
    for (const rect of rects) {
      const clipped = {
        left: Math.max(rect.left, slideRect.left, 0),
        right: Math.min(rect.right, slideRect.right, viewportWidth),
        top: Math.max(rect.top, slideRect.top, 0),
        bottom: Math.min(rect.bottom, slideRect.bottom, viewportHeight),
      };
      if (clipped.right <= clipped.left || clipped.bottom <= clipped.top) continue;
      record.points.push({
        x: clipped.left + (clipped.right - clipped.left) / 2,
        y: clipped.top + (clipped.bottom - clipped.top) / 2,
      });
    }
    if (record.points.length) contrastRecords.set(element, record);
  }

  let contrastChecks = 0;
  for (const { element, points } of contrastRecords.values()) {
    if (element.getAttribute('data-contrast-ignore') === 'decorative') continue;
    const style = getComputedStyle(element);
    const fillColor = (
      style.webkitTextFillColor && style.webkitTextFillColor !== 'currentcolor'
        ? style.webkitTextFillColor
        : style.color
    );
    const foreground = parseComputedColor(fillColor);
    if (!foreground) continue;
    const clippedTextFill = (
      String(style.backgroundClip).includes('text')
      || String(style.webkitBackgroundClip).includes('text')
    );
    if (foreground.alpha <= 0.001) {
      if (clippedTextFill || style.textShadow !== 'none' || style.backgroundImage !== 'none') {
        warnings.push(
          `${label(element)}: image/effect-backed text contrast cannot be sampled deterministically; `
          + 'visual inspection is required'
        );
      }
      continue;
    }

    let unreliable = false;
    let worstRatio = Number.POSITIVE_INFINITY;
    let sampledBackground = null;
    for (const point of points) {
      const colors = compositedTextColors(element, foreground, point);
      if (!colors.reliable) {
        unreliable = true;
        break;
      }
      const ratio = contrastRatio(colors.foreground, colors.background);
      if (ratio < worstRatio) {
        worstRatio = ratio;
        sampledBackground = colors.background;
      }
    }
    if (unreliable) {
      warnings.push(
        `${label(element)}: image/gradient-backed text contrast cannot be sampled deterministically; `
        + 'visual inspection is required'
      );
      continue;
    }
    if (!Number.isFinite(worstRatio) || !sampledBackground) continue;

    contrastChecks += 1;
    const fontSize = Number.parseFloat(style.fontSize);
    const fontWeight = parseFontWeight(style.fontWeight) || 400;
    const bold = fontWeight >= 700;
    const large = Number.isFinite(fontSize) && fontSize >= (bold ? 18.66 : 24);
    const minimum = large ? 3 : 4.5;
    if (worstRatio + 1e-9 < minimum) {
      const backgroundDescription = [
        Math.round(sampledBackground.red * 255),
        Math.round(sampledBackground.green * 255),
        Math.round(sampledBackground.blue * 255),
      ].join(', ');
      issues.push(
        `${label(element)}: text contrast ${worstRatio.toFixed(2)}:1 is below ${minimum}:1 `
        + `for ${large ? 'large' : 'normal'} text (${fontSize.toFixed(2)}px, weight ${fontWeight}) `
        + `against the nearest composited painted ancestor background rgb(${backgroundDescription})`
      );
    }
  }

  for (const emphasis of active.querySelectorAll('strong, b')) {
    if (!visible(emphasis) || !(emphasis.textContent || '').trim() || emphasis.closest('[data-text-bounds-ignore]')) continue;
    const parent = emphasis.parentElement;
    if (!parent) continue;
    const targets = directText(emphasis)
      ? [emphasis]
      : [...emphasis.querySelectorAll('*')].filter(element => directText(element) && visible(element));
    if (targets.length && targets.every(target => (
      emphasisSignature(getComputedStyle(target)) === emphasisSignature(getComputedStyle(parent))
    ))) {
      issues.push(`${label(emphasis)}: <${emphasis.tagName.toLowerCase()}> has no visible emphasis; use a supported weight or another deliberate cue`);
    }
  }

  for (const element of elements) {
    const elementRect = element.getBoundingClientRect();
    const semanticContainer = element.closest(
      '[data-text-container], [data-layout-box], .card, .panel, .tile, .box, .badge, .chip'
    );
    const container = semanticContainer || nearestPaintedContainer(element) || active;
    const containerRect = container.getBoundingClientRect();
    const name = label(element);
    const style = getComputedStyle(element);
    const localFamily = declaredFamily(style);
    const requestedWeight = parseFontWeight(style.fontWeight);
    if (localFamily && requestedWeight !== null) {
      const supported = declaredFontWeights.get(localFamily).some(([start, end]) => (
        requestedWeight >= start && requestedWeight <= end
      ));
      if (!supported) {
        issues.push(
          `${name}: font-family "${localFamily}" requests weight ${requestedWeight} outside its declared local faces; `
          + 'bundle that weight or choose a supported weight instead of browser-synthesized bold'
        );
      }
    }
    const clipsX = ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX);
    const clipsY = ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY);

    if (outside(elementRect, slideRect)) issues.push(`${name}: element crosses active slide bounds`);
    if (container !== element && container !== active && outside(elementRect, containerRect)) {
      issues.push(`${name}: text element crosses its nearest painted parent container`);
    }
    if (clipsX && element.scrollWidth > element.clientWidth + tolerance) {
      issues.push(`${name}: horizontal text overflow ${element.scrollWidth - element.clientWidth}px`);
    }
    if (clipsY && element.scrollHeight > element.clientHeight + tolerance) {
      issues.push(`${name}: vertical text overflow ${element.scrollHeight - element.clientHeight}px`);
    }

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    while (walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      for (const rect of range.getClientRects()) {
        if (rect.width && rect.height && outside(rect, containerRect)) {
          issues.push(`${name}: rendered glyph bounds cross the intended text container`);
          break;
        }
      }
      range.detach();
    }
  }

  const explicitLineOwners = elements.filter(element => (
    element.matches(textSelectors) || inlineTextWrapper(element)
  ));
  const lineOwners = [...new Set([...explicitLineOwners, ...elements.filter(element => (
    directText(element)
    && !explicitLineOwners.some(owner => owner !== element && owner.contains(element))
  ))])];
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
  const segments = value => {
    if (segmenter) return [...segmenter.segment(value)].map(item => ({ text: item.segment, index: item.index }));
    const result = [];
    let index = 0;
    for (const text of Array.from(value)) {
      result.push({ text, index });
      index += text.length;
    }
    return result;
  };

  const collectLines = element => {
    const glyphs = [];
    let order = 0;
    const leftToRight = getComputedStyle(element).direction !== 'rtl';
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || !visible(parent) || parent.closest('[data-text-bounds-ignore]')) {
          return NodeFilter.FILTER_REJECT;
        }
        const nestedOwner = lineOwners.find(candidate => (
          candidate !== element && element.contains(candidate) && candidate.contains(parent)
        ));
        return nestedOwner ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (const part of segments(node.nodeValue)) {
        const range = document.createRange();
        range.setStart(node, part.index);
        range.setEnd(node, part.index + part.text.length);
        const rect = [...range.getClientRects()].find(candidate => candidate.width > 0 && candidate.height > 0);
        range.detach();
        if (!rect) continue;
        glyphs.push({ text: part.text, order, rect });
        order += 1;
      }
    }

    const lines = [];
    for (const glyph of glyphs) {
      let target = null;
      let nearest = Number.POSITIVE_INFINITY;
      for (const line of lines) {
        const delta = Math.abs(glyph.rect.top - line.anchorTop);
        const limit = Math.max(2, Math.min(glyph.rect.height, line.height) * 0.18);
        const overlap = Math.max(0, Math.min(glyph.rect.bottom, line.bottom) - Math.max(glyph.rect.top, line.top));
        const overlapRatio = overlap / Math.max(1, Math.min(glyph.rect.height, line.height));
        const continuesInline = leftToRight && overlapRatio > 0.5 && glyph.rect.left >= line.right - 2;
        if ((delta <= limit || continuesInline) && delta < nearest) {
          target = line;
          nearest = delta;
        }
      }
      if (!target) {
        target = {
          anchorTop: glyph.rect.top,
          top: glyph.rect.top,
          right: glyph.rect.right,
          bottom: glyph.rect.bottom,
          left: glyph.rect.left,
          height: glyph.rect.height,
          glyphs: [],
        };
        lines.push(target);
      }
      target.glyphs.push(glyph);
      target.top = Math.min(target.top, glyph.rect.top);
      target.right = Math.max(target.right, glyph.rect.right);
      target.bottom = Math.max(target.bottom, glyph.rect.bottom);
      target.left = Math.min(target.left, glyph.rect.left);
      target.height = target.bottom - target.top;
    }
    return lines
      .sort((left, right) => left.top - right.top)
      .map(line => ({
        ...line,
        text: line.glyphs.sort((left, right) => left.order - right.order).map(glyph => glyph.text).join(''),
        width: line.right - line.left,
      }));
  };

  const lineRecords = [];
  for (const element of lineOwners) {
    const style = getComputedStyle(element);
    if (!style.writingMode.startsWith('horizontal')) continue;
    const lines = collectLines(element);
    if (!lines.length) continue;
    lineRecords.push({ element, lines });
    if (lines.length < 2) continue;

    const name = label(element);
    const fullText = lines.map(line => line.text).join('');
    const core = value => Array.from(value.normalize('NFC').replace(/[\s\p{P}\p{S}]/gu, ''));
    const lastCore = core(lines.at(-1).text);
    const previousCore = core(lines.at(-2).text);
    const fullCore = core(fullText);
    const hasHangul = /[\uAC00-\uD7A3]/.test(fullText);
    const displayText = element.matches(displaySelectors) || Number.parseFloat(style.fontSize) >= 32;
    if (element.hasAttribute('data-line-break-ok')) {
      warnings.push(`${name}: intentional final-line exemption requires visual inspection`);
    } else {
      if (displayText && fullCore.length >= 8 && lastCore.length === 0) {
        issues.push(`${name}: punctuation is stranded on its own final line`);
      } else if (displayText && fullCore.length >= 8 && previousCore.length >= 4 && hasHangul && lastCore.length <= 2) {
        issues.push(`${name}: stranded Korean ending leaves only ${lastCore.length} readable character(s) on the final line`);
      }
    }

    const fontSize = Number.parseFloat(style.fontSize);
    const minimumAdvanceRatio = hasHangul ? 0.86 : 0.8;
    const axisAligned = style.transform === 'none';
    let collision = false;
    for (let index = 1; index < lines.length && !collision; index += 1) {
      const previous = lines[index - 1];
      const current = lines[index];
      const advance = current.top - previous.top;
      const advanceRatio = fontSize > 0 ? advance / (fontSize * stageScale) : 1;
      const overlap = Math.max(0, previous.bottom - current.top);
      const overlapRatio = overlap / Math.max(1, Math.min(previous.height, current.height));
      collision = axisAligned && (advanceRatio < minimumAdvanceRatio || overlapRatio > 0.4);
    }
    if (collision) {
      issues.push(`${name}: rendered text lines collide; increase line-height or reduce/reflow the display type`);
    }
  }

  const readableCount = record => Array.from(
    record.lines.map(line => line.text).join('').replace(/[\s\p{P}\p{S}]/gu, '')
  ).length;
  const protectedRegionSelector = [
    '[data-protected-region]',
    '.annotation', '.annotation-bar',
    '.caveat', '.caveat-bar',
    '.source-rail', '.source-band',
    '.footnote', '.footnote-bar',
    '.footer', '.footer-bar',
  ].join(',');
  const structuralBoxSelector = [
    '[data-layout-box]', '[data-overlap-subject]',
    '.card', '.panel', '.tile', '.box', '.band',
  ].join(',');
  const protectedRegions = [...active.querySelectorAll(protectedRegionSelector)].filter(region => (
    visible(region) && !region.closest('[data-text-bounds-ignore]')
  ));
  const rawStructuralBoxes = allHtmlElements.filter(element => {
    if (!visible(element) || element.closest('[data-text-bounds-ignore]')) return false;
    const style = getComputedStyle(element);
    return paintsStructuralBox(element) && (
      element.matches(structuralBoxSelector) || style.transform !== 'none'
    );
  });
  for (const region of protectedRegions) {
    const regionRect = region.getBoundingClientRect();
    const collisions = rawStructuralBoxes
      .filter(box => box !== region && !box.contains(region) && !region.contains(box))
      .map(box => ({ box, area: intersection(box.getBoundingClientRect(), regionRect) }))
      .filter(({ area }) => area.width > 3 && area.height > 3 && area.width * area.height > 48);
    const leafCollisions = collisions.filter(({ box }) => (
      !collisions.some(({ box: child }) => child !== box && box.contains(child))
    ));
    for (const { box, area } of leafCollisions) {
      if (box === region || box.contains(region) || region.contains(box)) continue;
      const allowed = box.closest('[data-protected-overlap-ok]')
        || region.closest('[data-protected-overlap-ok]');
      const depth = Math.round(Math.min(area.width, area.height));
      const message = `${label(box)} / ${label(region)}: layout box overlaps protected region by ${depth}px`;
      if (allowed) warnings.push(`${message}; intentional exemption requires visual inspection`);
      else issues.push(`${message}; reserve the region in normal flow instead of using transforms or offsets`);
    }
  }
  for (const record of lineRecords) {
    const exempt = record.element.closest('[data-occlusion-ok]');
    let occluded = false;
    for (const line of record.lines) {
      const y = line.top + line.height / 2;
      for (const ratio of [0.15, 0.35, 0.5, 0.65, 0.85]) {
        const x = line.left + line.width * ratio;
        if (x < 0 || y < 0 || x >= viewportWidth || y >= viewportHeight) continue;
        const stack = document.elementsFromPoint(x, y);
        const ownerIndex = stack.findIndex(candidate => (
          candidate === record.element || candidate.contains(record.element) || record.element.contains(candidate)
        ));
        if (ownerIndex <= 0) continue;
        occluded = stack.slice(0, ownerIndex).some(candidate => (
          !candidate.closest('[data-text-bounds-ignore]') && paintsOpaqueVisual(candidate)
        ));
        if (occluded) break;
      }
      if (occluded) break;
    }
    if (!occluded) continue;
    if (exempt) warnings.push(`${label(record.element)}: intentional occlusion exemption requires visual inspection`);
    else issues.push(`${label(record.element)}: rendered text is covered by an opaque visual layer`);
  }
  for (const record of lineRecords) {
    if (record.element.closest('[data-text-overlap-ok]')) {
      warnings.push(`${label(record.element)}: intentional text-overlap exemption requires visual inspection`);
    }
  }
  for (let leftIndex = 0; leftIndex < lineRecords.length; leftIndex += 1) {
    const leftRecord = lineRecords[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < lineRecords.length; rightIndex += 1) {
      const rightRecord = lineRecords[rightIndex];
      const leftElement = leftRecord.element;
      const rightElement = rightRecord.element;
      if (leftElement.contains(rightElement) || rightElement.contains(leftElement)) continue;
      if (leftElement.closest('[data-text-overlap-ok]') || rightElement.closest('[data-text-overlap-ok]')) continue;
      if (readableCount(leftRecord) <= 1 || readableCount(rightRecord) <= 1) continue;
      const overlaps = leftRecord.lines.some(leftLine => rightRecord.lines.some(rightLine => {
        const area = intersection(leftLine, rightLine);
        const verticalRatio = area.height / Math.max(1, Math.min(leftLine.height, rightLine.height));
        const horizontalRatio = area.width / Math.max(1, Math.min(leftLine.width, rightLine.width));
        return area.width > 4 && area.height > 4 && verticalRatio > 0.35 && horizontalRatio > 0.12;
      }));
      if (overlaps) {
        issues.push(`${label(leftElement)} / ${label(rightElement)}: rendered text regions overlap`);
      }
    }
  }

  const nav = document.querySelector('.nav');
  if (nav && visible(nav)) {
    const navRect = nav.getBoundingClientRect();
    for (const record of lineRecords) {
      const covered = record.lines.some(line => {
        const area = intersection(line, navRect);
        return area.width > 4 && area.height > 4
          && area.height / Math.max(1, line.height) > 0.15;
      });
      if (covered) issues.push(`${label(record.element)}: rendered text is covered by navigation controls`);
    }
  }

  return {
    ok: issues.length === 0,
    checked: elements.length,
    line_checks: lineRecords.length,
    contrast_checks: contrastChecks,
    protected_region_checks: protectedRegions.length,
    issues: [...new Set(issues)],
    warnings: [...new Set(warnings)],
  };
})()
