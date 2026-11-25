# Theme Typography

Choose type from language, subject, audience, viewing distance, and evidence density. A theme's `type_direction` is a role contract, not permission to use an unavailable font.

## Core roles

- `--font-display`: title, chapter, and large finding role. It may be expressive, but must support the actual Korean, Japanese, Latin, numerals, and punctuation used.
- `--font-body`: paragraphs, labels, captions, and notes. Optimize for projection readability and dense-slide rhythm.
- `--font-mono`: commands, code, identifiers, route metadata, formulas, and tabular technical detail. Do not use mono for ordinary Korean paragraphs.
- Bundle actual local WOFF2 files with compatible licensing, declare only real weights, and keep `font-synthesis: none`.
- Test the longest Korean title, the densest body slide, mixed Korean/English proper nouns, numerals, parentheses, and bold emphasis before the system is locked.

## Recommended role systems

These are safe starting points when the files are available and licensed. Substitute equivalent local faces when necessary; never silently fall back to `system-ui`.

| Direction | Display | Body | Mono | Character |
|---|---|---|---|---|
| Travel Editorial Collage | Noto Serif KR or Noto Serif CJK KR | Noto Sans KR | IBM Plex Mono | literary place title, contemporary guide copy, compact route metadata |
| Protocol Proof | Noto Sans KR Black or a bundled Korean grotesk | Noto Sans KR | JetBrains Mono or IBM Plex Mono | direct technical thesis, readable mechanism, clear protocol labels |
| Pop Culture Scrapbook | bundled Korean grotesk with a true heavy weight | Noto Sans KR | IBM Plex Mono | bold campaign title, neutral reading copy, visible credits |
| Technical Conference | Noto Sans KR Black or a compatible event display face | Noto Sans KR | IBM Plex Mono | stage-readable title, compact session hierarchy, code-aware detail |
| Research Report Editorial | Noto Serif KR or a high-contrast Korean sans | Noto Sans KR | IBM Plex Mono | authoritative publication title, long-form reading, tabular evidence |

Latin-only display faces such as Source Serif 4, Source Sans 3, Archivo, or Space Grotesk may support an English role only when the Korean fallback has compatible x-height, weight, and tone. Do not let the title look like two unrelated brands.

## Density and whitespace

- Sparse keynote typography is appropriate for a reveal, vision, quote, or chapter. It is not the default for technical shares, reports, workshops, or evidence-led body slides.
- Use roughly 55–85% of the safe frame for meaningful body-slide content as a visual review heuristic. Use roughly 60–85% on covers unless a deliberate full-bleed image or isolated artifact owns the field. These are judgment ranges, not validator quotas.
- Large type must create a composition, not merely enlarge a short title in an empty half of the slide.
- Prefer open alignment, rules, captions, images, charts, and annotations over a large empty panel. A container must earn its footprint with information or media.
- Keep body line length near 28–46 Korean characters where practical. Shorten the measure for projected dense copy rather than shrinking the font.

## Theme-specific cautions

- Travel: do not imitate brush calligraphy or use decorative Japanese glyphs as atmosphere. Let photography, editorial pacing, and real place metadata carry identity.
- Protocol Proof: use violet/cyan as path or party roles, not as low-contrast glow. Mathematical labels must remain readable without zoom.
- Pop Culture Scrapbook: use one authentic hero image. Tilted paper frames and hand-drawn loops are accents, not the whole layout.
- Technical Conference: do not use terminal mono as the primary Korean display face. Avoid fake console panels and repeated status chips.
- Research Report Editorial: body copy and source bands may be compact, but findings and caveats must not become footnote gray.
