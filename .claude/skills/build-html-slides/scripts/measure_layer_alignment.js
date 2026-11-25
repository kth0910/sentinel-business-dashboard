(() => {
  const active = document.querySelector('.slide.active');
  const issues = [];
  const warnings = [];
  if (!active) return { ok: false, checked: 0, issues: ['Missing active slide'], warnings: [] };

  const tolerance = 2;
  const minimumOverlap = 0.35;
  const allowedIntents = new Set([
    'decorative-bleed',
    'edge-bleed',
    'hero-underlay',
    'text-on-image',
  ]);
  const ignoredClasses = new Set([
    'active',
    'slide',
    'slide-content',
    'slide-media',
  ]);
  const mediaRoot = active.querySelector(':scope > .slide-media');
  const contentRoot = active.querySelector(':scope > .slide-content');
  if (!mediaRoot || !contentRoot) {
    return {
      ok: false,
      checked: 0,
      issues: ['Active slide requires direct .slide-media and .slide-content layers'],
      warnings: [],
    };
  }

  const rendered = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  };
  const rectOf = element => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
    };
  };
  const rectDelta = (left, right) => Math.max(
    Math.abs(left.left - right.left),
    Math.abs(left.top - right.top),
    Math.abs(left.right - right.right),
    Math.abs(left.bottom - right.bottom),
  );
  const intersectionRatio = (left, right) => {
    const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
    const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
    const intersection = width * height;
    const smaller = Math.min(left.width * left.height, right.width * right.height);
    return smaller > 0 ? intersection / smaller : 0;
  };
  const sorted = elements => [...elements].sort((left, right) => {
    const a = rectOf(left);
    const b = rectOf(right);
    return (a.centerY - b.centerY) || (a.centerX - b.centerX);
  });
  const intentFor = element => (element.dataset.overlapIntent || '').trim();
  const validateIntent = element => {
    const intent = intentFor(element);
    if (intent && !allowedIntents.has(intent)) {
      issues.push(
        `${element.tagName.toLowerCase()}: data-overlap-intent "${intent}" is unsupported; `
        + `use ${[...allowedIntents].join(', ')}`
      );
    }
    return intent;
  };

  const allLayerElements = [
    ...mediaRoot.querySelectorAll('[data-overlap-intent]'),
    ...contentRoot.querySelectorAll('[data-overlap-intent]'),
  ];
  allLayerElements.forEach(validateIntent);

  let checked = 0;
  const explicitMedia = [...mediaRoot.querySelectorAll('[data-frame-id]')].filter(rendered);
  const explicitContent = [...contentRoot.querySelectorAll('[data-frame-for]')].filter(rendered);
  const frameIds = new Set([
    ...explicitMedia.map(element => (element.dataset.frameId || '').trim()),
    ...explicitContent.map(element => (element.dataset.frameFor || '').trim()),
  ]);
  frameIds.delete('');
  for (const frameId of frameIds) {
    const media = explicitMedia.filter(element => (element.dataset.frameId || '').trim() === frameId);
    const content = explicitContent.filter(element => (element.dataset.frameFor || '').trim() === frameId);
    checked += 1;
    if (media.length !== 1 || content.length !== 1) {
      issues.push(
        `frame "${frameId}" requires exactly one data-frame-id media element and one `
        + `data-frame-for content element`
      );
      continue;
    }
    if (intentFor(media[0]) || intentFor(content[0])) continue;
    const mediaRect = rectOf(media[0]);
    const contentRect = rectOf(content[0]);
    const delta = rectDelta(mediaRect, contentRect);
    if (delta > tolerance) {
      issues.push(
        `frame "${frameId}" media/content edges differ by ${Math.round(delta * 100) / 100}px; `
        + `paired layers must share one geometry contract`
      );
    }
  }

  const mediaByClass = new Map();
  const contentByClass = new Map();
  for (const element of [...mediaRoot.querySelectorAll('[class]')].filter(rendered)) {
    for (const token of element.classList) {
      if (ignoredClasses.has(token)) continue;
      const bucket = mediaByClass.get(token) || [];
      bucket.push(element);
      mediaByClass.set(token, bucket);
    }
  }
  for (const element of [...contentRoot.querySelectorAll('[class]')].filter(rendered)) {
    for (const token of element.classList) {
      if (ignoredClasses.has(token)) continue;
      const bucket = contentByClass.get(token) || [];
      bucket.push(element);
      contentByClass.set(token, bucket);
    }
  }

  for (const [token, mediaElements] of mediaByClass) {
    const contentElements = contentByClass.get(token);
    if (!contentElements || mediaElements.length !== contentElements.length || mediaElements.length > 12) {
      continue;
    }
    const mediaSorted = sorted(mediaElements);
    const contentSorted = sorted(contentElements);
    for (let index = 0; index < mediaSorted.length; index += 1) {
      const media = mediaSorted[index];
      const content = contentSorted[index];
      if (
        media.hasAttribute('data-frame-id')
        || content.hasAttribute('data-frame-for')
        || intentFor(media)
        || intentFor(content)
      ) {
        continue;
      }
      const mediaRect = rectOf(media);
      const contentRect = rectOf(content);
      const overlap = intersectionRatio(mediaRect, contentRect);
      if (overlap < minimumOverlap) continue;
      checked += 1;
      const delta = rectDelta(mediaRect, contentRect);
      if (delta > tolerance) {
        issues.push(
          `mirrored class .${token} crosses media/content layers with ${Math.round(overlap * 100)}% `
          + `overlap but ${Math.round(delta * 100) / 100}px edge mismatch; align the frames, `
          + `declare data-frame-id/data-frame-for, or mark a supported data-overlap-intent`
        );
      }
    }
  }

  return {
    ok: issues.length === 0,
    checked,
    issues: [...new Set(issues)],
    warnings: [...new Set(warnings)],
  };
})()
