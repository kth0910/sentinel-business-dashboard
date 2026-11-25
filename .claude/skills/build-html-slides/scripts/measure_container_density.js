(() => {
  const active = document.querySelector('.slide.active');
  const issues = [];
  const warnings = [];
  const items = [];
  if (!active) return {
    ok: false,
    checked: 0,
    issues: ['Missing active slide'],
    warnings,
    items,
    dashboard_like: false,
  };

  const explicitSelector = [
    '.card', '.panel', '.tile', '.box',
    '[data-density-container]', '[data-layout-box]',
  ].join(',');
  const visible = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  };
  const paintsBox = element => {
    const style = getComputedStyle(element);
    const color = style.backgroundColor || '';
    const alphaMatch = color.match(/rgba?\([^)]*[,/]\s*([\d.]+)\s*\)$/i);
    const backgroundAlpha = color === 'transparent' ? 0 : (alphaMatch ? Number(alphaMatch[1]) : 1);
    const border = ['Top', 'Right', 'Bottom', 'Left'].some(side => (
      Number.parseFloat(style[`border${side}Width`]) > 0
      && style[`border${side}Style`] !== 'none'
    ));
    return backgroundAlpha > 0.08 || style.backgroundImage !== 'none'
      || border || style.boxShadow !== 'none' || style.outlineStyle !== 'none';
  };
  const intersect = (rect, outer) => {
    const left = Math.max(rect.left, outer.left);
    const right = Math.min(rect.right, outer.right);
    const top = Math.max(rect.top, outer.top);
    const bottom = Math.min(rect.bottom, outer.bottom);
    return right > left && bottom > top
      ? { left, right, top, bottom, width: right - left, height: bottom - top }
      : null;
  };
  const round = value => Math.round(value * 1000) / 1000;
  const label = (element, index) => (
    element.getAttribute('data-title') || element.getAttribute('aria-label') || element.id
    || (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48)
    || `container-${index + 1}`
  );

  const slideRect = active.getBoundingClientRect();
  const slideArea = slideRect.width * slideRect.height;
  const allElements = [...active.querySelectorAll('*')].filter(element => (
    element.namespaceURI === 'http://www.w3.org/1999/xhtml'
    && visible(element)
    && !element.hasAttribute('data-density-ignore')
    && !element.closest('[data-density-ignore]')
    && !element.closest('[data-overlap-intent]')
    && !element.closest('.slide-media')
    && !element.classList.contains('slide-content')
    && !element.classList.contains('slide-media')
  ));
  const candidates = [...new Set([
    ...active.querySelectorAll(explicitSelector),
    ...allElements.filter(paintsBox),
  ])].filter(element => {
    if (
      !visible(element)
      || element.closest('[data-density-ignore]')
      || element.closest('[data-overlap-intent]')
      || element.closest('.slide-media')
    ) return false;
    const rect = element.getBoundingClientRect();
    const ratio = (rect.width * rect.height) / Math.max(slideArea, 1);
    return ratio >= 0.012 && ratio <= 0.78;
  });

  const candidateSet = new Set(candidates);
  const siblingGroups = new Map();
  for (const element of candidates) {
    const parent = element.parentElement;
    if (!parent) continue;
    const group = siblingGroups.get(parent) || [];
    group.push(element);
    siblingGroups.set(parent, group);
  }
  const repeatedGroups = [...siblingGroups.values()].filter(group => group.length >= 3);
  const maxRepeatedSiblings = repeatedGroups.length
    ? Math.max(...repeatedGroups.map(group => group.length))
    : 0;
  const nestingDepth = element => {
    let depth = 0;
    let current = element.parentElement;
    while (current && current !== active) {
      if (candidateSet.has(current)) depth += 1;
      current = current.parentElement;
    }
    return depth;
  };
  const maxNestingDepth = candidates.length
    ? Math.max(...candidates.map(nestingDepth))
    : 0;

  for (const [index, element] of candidates.entries()) {
    const rect = element.getBoundingClientRect();
    const area = rect.width * rect.height;
    const slideAreaRatio = area / Math.max(slideArea, 1);
    if (slideAreaRatio < 0.08 || rect.width < 220 || rect.height < 120) continue;

    const textRects = [];
    let textArea = 0;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.nodeValue.trim()
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
    });
    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      if (!parent || !visible(parent)) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      for (const rawRect of range.getClientRects()) {
        const clipped = intersect(rawRect, rect);
        if (!clipped) continue;
        textRects.push(clipped);
        textArea += clipped.width * clipped.height;
      }
      range.detach();
    }

    let visualArea = 0;
    const visualRects = [];
    for (const visual of element.querySelectorAll(
      'img, video, canvas, table, pre, svg, .chart, .diagram, .key-visual, .ui-screenshot'
    )) {
      if (!visible(visual)) continue;
      const clipped = intersect(visual.getBoundingClientRect(), rect);
      if (!clipped) continue;
      visualRects.push(clipped);
      visualArea += clipped.width * clipped.height;
    }

    const contentRects = [...textRects, ...visualRects];
    const contentTop = contentRects.length ? Math.min(...contentRects.map(item => item.top)) : rect.top;
    const contentBottom = contentRects.length ? Math.max(...contentRects.map(item => item.bottom)) : rect.top;
    const contentHeightRatio = (contentBottom - contentTop) / Math.max(rect.height, 1);
    const textAreaRatio = textArea / Math.max(area, 1);
    const visualAreaRatio = Math.min(1, visualArea / Math.max(area, 1));
    const text = (element.textContent || '').trim().replace(/\s+/g, ' ');
    const characterCount = [...text].length;
    const empty = characterCount === 0 && visualAreaRatio < 0.1;
    const underfilled = characterCount <= 160
      && textAreaRatio < 0.14
      && contentHeightRatio < 0.58
      && visualAreaRatio < 0.1;
    const severeUnderfill = slideAreaRatio >= 0.18
      && rect.width >= 500
      && rect.height >= 220
      && characterCount <= 80
      && textAreaRatio < 0.09
      && contentHeightRatio < 0.42
      && visualAreaRatio < 0.1;

    const item = {
      name: label(element, index),
      slideAreaRatio: round(slideAreaRatio),
      characterCount,
      textAreaRatio: round(textAreaRatio),
      visualAreaRatio: round(visualAreaRatio),
      contentHeightRatio: round(contentHeightRatio),
      warning: empty || underfilled,
      blocking: severeUnderfill,
    };
    items.push(item);
    const message = (
      `${item.name}: oversized low-information container `
      + `(slide ${Math.round(slideAreaRatio * 100)}%, chars ${characterCount}, `
      + `content height ${Math.round(contentHeightRatio * 100)}%)`
    );
    if (severeUnderfill) issues.push(message);
    else if (item.warning) warnings.push(message);
  }

  const badgeCount = active.querySelectorAll('.badge, .chip, [data-badge]').length;
  const dashboardIntent = active.getAttribute('data-dashboard-intent') === 'evidence';
  const dashboardLike = candidates.length >= 8
    && maxRepeatedSiblings >= 3
    && (badgeCount >= 3 || maxNestingDepth >= 1 || candidates.length >= 11);
  const componentWall = candidates.length >= 12
    && maxRepeatedSiblings >= 4
    && (badgeCount >= 4 || maxNestingDepth >= 2 || candidates.length >= 15);
  if (componentWall && !dashboardIntent) {
    issues.push(
      `repeated component wall: ${candidates.length} painted containers, `
      + `${maxRepeatedSiblings} repeated siblings, ${badgeCount} badges/chips, `
      + `nesting depth ${maxNestingDepth}`
    );
  } else if (dashboardLike && !dashboardIntent) {
    warnings.push(
      `dashboard-like component density: ${candidates.length} painted containers and `
      + `${maxRepeatedSiblings} repeated siblings`
    );
  } else if (dashboardLike && dashboardIntent) {
    warnings.push(
      'dashboard evidence exemption requires visual confirmation that the slide presents '
      + 'a literal dashboard rather than using dashboard components as decoration'
    );
  }

  return {
    ok: issues.length === 0,
    checked: items.length,
    issues: [...new Set(issues)],
    warnings: [...new Set(warnings)],
    items,
    painted_container_count: candidates.length,
    max_repeated_siblings: maxRepeatedSiblings,
    max_nesting_depth: maxNestingDepth,
    badge_count: badgeCount,
    dashboard_like: dashboardLike,
    dashboard_intent: dashboardIntent,
  };
})()
