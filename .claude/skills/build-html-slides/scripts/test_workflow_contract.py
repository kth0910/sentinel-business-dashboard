#!/usr/bin/env python3
"""Guard the user-confirmation and installation-consent workflow contract."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def repository_file(*parts: str) -> Path:
    for parent in (ROOT, *ROOT.parents):
        candidate = parent.joinpath(*parts)
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"repository file not found: {'/'.join(parts)}")


VISUAL_REVIEWER = repository_file("agents", "build-html-slides-visual-reviewer.md")
QUALITY_EDITOR = repository_file("agents", "build-html-slides-quality-editor.md")
NEW_THEME_NAMES = [
    "Sports Broadcast",
    "Clinical Clarity",
    "Fashion Lookbook",
    "Civic Service",
    "Event Wayfinding",
    "Portfolio Casebook",
    "Crafted Modern",
    "Kinetic Type",
    "Travel Editorial Collage",
    "Protocol Proof",
    "Pop Culture Scrapbook",
    "Technical Conference",
    "Research Report Editorial",
]


class WorkflowContractTests(unittest.TestCase):
    def test_new_deck_offers_optional_reader_facing_study_guide(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        template = (ROOT / "assets" / "slide-guide-template.md").read_text(encoding="utf-8")
        contract = (ROOT / "references" / "validation-contract.md").read_text(encoding="utf-8")
        self.assertIn("The reader-facing study guide is optional", skill)
        self.assertIn("whether the optional reader-facing per-slide study guide is needed", skill)
        self.assertIn("Ask both questions together", skill)
        self.assertIn("never ask again for an answer already given", skill)
        self.assertIn("sibling `OUTPUT-guide.md`, `OUTPUT-guide.html`, and `OUTPUT-guide.pdf`", skill)
        self.assertIn("Explain not only what is visible", skill)
        self.assertIn("trace data or control flow from entry to destination", skill)
        self.assertIn("The study guide is not a required deck deliverable", contract)
        self.assertIn("Each slide capture appears immediately above its explanation", contract)
        self.assertIn("front primer, prerequisites, or terminology only when useful", contract)
        self.assertIn("Omit presenter cues and full read-aloud scripts", contract)
        self.assertIn("화면에 담지 못한 배경, 중간 과정, 작동 원리, 실무 판단 기준", template)
        self.assertIn("발표자 큐, 전체 낭독 대본은 쓰지 않습니다", template)
        self.assertTrue((ROOT / "scripts" / "validate_slide_guide.py").is_file())
        self.assertTrue((ROOT / "scripts" / "render_slide_guide.js").is_file())

    def test_korean_guide_requires_deeper_context_and_humanize_korean(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        template = (ROOT / "assets" / "slide-guide-template.md").read_text(encoding="utf-8")
        contract = (ROOT / "references" / "validation-contract.md").read_text(encoding="utf-8")
        validator = (ROOT / "scripts" / "validate_slide_guide.py").read_text(encoding="utf-8")
        for document in (skill, contract):
            self.assertIn("intermediate reasoning", document)
            self.assertIn("failure modes", document)
            self.assertIn("Lead with the answer", document)
            self.assertIn("`humanize-korean`", document)
            self.assertIn("5,000 characters", document)
            self.assertIn("HUMANIZE-SUMMARY", document)
        self.assertIn("슬라이드가 생략한 세부 내용", template)
        self.assertIn("긴 서론", template)
        self.assertIn("humanize-korean을 반드시 적용", template)
        self.assertIn("HUMANIZE_SUMMARY_PATTERN", validator)

    def test_new_deck_requires_explicit_intake_choices(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        contract = (ROOT / "references" / "validation-contract.md").read_text(encoding="utf-8")
        self.assertIn("For every new deck, resolve two explicit intake choices", skill)
        self.assertIn("Do not silently infer either choice", skill)
        self.assertIn("New-deck creation requires two explicit intake choices", contract)
        self.assertIn("Do not silently infer either choice", contract)

    def test_quick_draft_skips_validation_and_full_requires_preflight(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        contract = (ROOT / "references" / "validation-contract.md").read_text(encoding="utf-8")
        self.assertIn("This is a creation-only mode", skill)
        self.assertIn("deliver immediately after implementation without validation evidence", skill)
        self.assertIn("Quick Draft is creation-only", contract)
        self.assertIn("Do not run `check_environment.py`", contract)
        self.assertIn("Do not run `check_environment.py`", skill)
        self.assertIn("After the user chooses Full Validation", skill)
        self.assertIn("After the user chooses Full Validation", contract)
        self.assertIn("python3 scripts/check_environment.py", skill)
        self.assertIn("python3 scripts/check_environment.py", contract)
        self.assertIn("explicit installation consent", skill)
        self.assertIn("explicit consent", contract)
        self.assertIn("Never run `npm install`", skill)
        self.assertIn("Do not run `npm install`", contract)
        self.assertIn("install_browser_dependencies.py --consent", skill)
        self.assertIn("install_browser_dependencies.py --consent", contract)
        self.assertIn("guide production only, not deck validation", skill)
        self.assertIn("Those production captures are not deck-validation screenshots", contract)

    def test_fan_art_targets_are_checkpoints_and_do_not_expand_review_implicitly(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        contract = (ROOT / "references" / "validation-contract.md").read_text(encoding="utf-8")
        budget = (ROOT / "references" / "fan-art-budget.md").read_text(encoding="utf-8")
        self.assertIn("use the search targets as checkpoints", skill)
        self.assertIn("controls review depth, not research breadth", contract)
        self.assertIn("planning targets, not hard limits", budget)
        self.assertIn("25-35 minutes", budget)
        self.assertIn("40-50 works", budget)
        self.assertIn("24-30 works", budget)
        self.assertIn("ask whether to continue discovery", budget)
        self.assertIn("do not abruptly stop", budget)
        self.assertIn("Image count alone does not make a slide critical", budget)
        machine_contract = json.loads(
            (ROOT / "scripts" / "validation_contract.json").read_text(encoding="utf-8")
        )
        self.assertEqual(machine_contract["review_batch_size"], 4)
        self.assertLess(
            machine_contract["workflow_limits"]["final_cross_review"][
                "standard_ordinary_sample_ratio"
            ],
            1,
        )

    def test_full_validation_uses_one_entrypoint_and_bounded_time_target(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        contract = (ROOT / "references" / "validation-contract.md").read_text(encoding="utf-8")
        for document in (skill, contract):
            self.assertIn("validate_all.py", document)
            self.assertIn("45 minutes", document)
        self.assertIn("60-minute", skill)
        self.assertIn("3,600-second budget", contract)
        self.assertIn("20–25-slide deck", contract)
        self.assertIn("--phase finalize-prepare", contract)
        self.assertIn("--phase finalize-verify", contract)
        self.assertIn("contact sheets", contract)
        self.assertIn("`cross_review_batches`", contract)
        self.assertIn("--restart-validation-session theme-invalidated", skill)
        self.assertIn("--phase cover-verify", skill)
        self.assertIn("blocks approval and deployment", skill)
        self.assertTrue((ROOT / "scripts" / "validate_cover_review.py").is_file())
        self.assertIn("browser-page-scale zoom150", (ROOT / "agents" / "openai.yaml").read_text(encoding="utf-8"))

    def test_workflow_timing_covers_authoring_and_validation_stages(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        debugging = (ROOT / "references" / "performance-debugging.md").read_text(encoding="utf-8")
        for stage in (
            "research",
            "storyboard",
            "editorial-review",
            "editorial-revision",
            "asset-selection",
            "asset-production",
            "implementation",
            "common-preflight",
            "render-automation",
            "ai-review",
            "final-review",
        ):
            self.assertIn(stage, skill)
            self.assertIn(stage, debugging)
        self.assertIn("workflow-timing.json", skill)
        self.assertIn("--debug-timing", skill)
        self.assertIn("including failures and timeouts", debugging)
        self.assertIn("Only one manual stage may be active", debugging)
        self.assertIn("Notion capture", debugging)
        self.assertTrue((ROOT / "scripts" / "workflow_timer.py").is_file())

    def test_research_depth_is_semantic_and_editorial_review_runs_once_before_render(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        research = (ROOT / "references" / "research-first.md").read_text(encoding="utf-8")
        for document in (skill, research):
            self.assertIn("semantic", document.lower())
            self.assertIn("exactly one", document.lower())
            self.assertIn("one consolidated revision", document.lower())
            self.assertIn("before HTML authoring", document)
            self.assertIn("Do not rerun", document)
        self.assertIn("Do not use keyword matching", research)
        self.assertIn("analytical", research)
        self.assertIn("deep technical", research)
        self.assertIn("competing explanations", research)
        self.assertIn("incoming question", research)
        self.assertIn("research-storyboard-review.md", skill)
        self.assertTrue((ROOT / "scripts" / "lock_research_storyboard.py").is_file())

    def test_headline_register_distinguishes_technical_and_evocative_decks(self) -> None:
        routing = (ROOT / "references" / "audience-story-routing.md").read_text(
            encoding="utf-8"
        )
        template = (ROOT / "assets" / "research-brief-template.md").read_text(
            encoding="utf-8"
        )
        korean = (ROOT / "references" / "korean-copy.md").read_text(encoding="utf-8")
        research = (ROOT / "references" / "research-first.md").read_text(encoding="utf-8")
        quality = (ROOT / "references" / "quality-bar.md").read_text(encoding="utf-8")
        review = (ROOT / "references" / "slide-by-slide-review.md").read_text(encoding="utf-8")
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("| 슬라이드 제목 |", template)
        self.assertNotIn("| 결론형 제목 |", template)
        self.assertIn("Choose the headline register", routing)
        self.assertIn("Technical shares, engineering seminars", routing)
        self.assertIn("Brand, culture, entertainment", routing)
        self.assertIn("곡선은 왜 늘어났나", korean)
        self.assertIn("파라미터를 왜 의심하나", korean)
        self.assertIn("Static vs Dynamic Exporter", korean)
        self.assertIn("40%", korean)
        self.assertIn("OpenBao OIDC로 Hubble UI 접근을 인증하고", korean)
        self.assertIn("Direct technical headlines may be short", skill)
        self.assertIn("data-headline-register", skill)
        self.assertIn("Never use declarative endings on three consecutive titles", skill)
        self.assertIn("an evocative register is reserved", research)
        self.assertIn("Technical sharing does not need a forced aphorism", quality)
        self.assertIn("a technical-share or seminar headline", review)

    def test_machine_contract_owns_exact_validation_values(self) -> None:
        contract = (ROOT / "references" / "validation-contract.md").read_text(encoding="utf-8")
        machine = json.loads((ROOT / "scripts" / "validation_contract.json").read_text(encoding="utf-8"))
        self.assertIn("machine-readable authority", contract)
        self.assertEqual(machine["schema_version"], 17)
        self.assertEqual(machine["review_batch_size"], 4)
        self.assertEqual(machine["base_profiles"], ["normal", "short", "zoom150"])
        self.assertIn("font_integrity", machine["automation_checks_by_change"]["text"])
        self.assertIn("design_adherence", machine["checks_by_change"]["all"])
        self.assertIn("component_repetition", machine["checks_by_change"]["all"])
        self.assertIn("aesthetic_quality", machine["checks_by_change"]["all"])
        self.assertIn("readability", machine["checks_by_change"]["all"])
        self.assertIn("layout_integrity", machine["checks_by_change"]["all"])
        self.assertIn("surface_integrity", machine["checks_by_change"]["all"])
        self.assertIn("diagram_semantics", machine["checks_by_change"]["all"])
        self.assertIn("cover_surface_integrity", machine["cover_checks"])
        self.assertIn("design_system_adherence", machine["final_overview_checks"])
        self.assertEqual(machine["impact_scopes"], ["direct", "neighbors", "full"])
        self.assertEqual(
            machine["content_change_categories"],
            ["text", "image", "structure", "style", "runtime"],
        )
        limits = machine["workflow_limits"]
        self.assertEqual(limits["full_validation_seconds"], 3600)
        self.assertEqual(limits["warning_seconds"], 2700)
        self.assertEqual(limits["validation_restart_reasons"], ["theme-invalidated"])
        self.assertEqual(limits["post_deadline_cover_rescue"]["slide"], 1)
        self.assertEqual(
            limits["high_risk_reasons"],
            ["legal", "public-release", "consequential-decision"],
        )
        self.assertEqual(limits["common_preflight"], {
            "minimum_slides": 2,
            "maximum_slides": 3,
        })
        self.assertEqual(limits["parallel_deterministic_checks"], {
            "default_workers": 4,
            "max_workers": 8,
        })
        self.assertEqual(limits["final_cross_review"]["standard_max_slides"], 5)
        self.assertEqual(limits["final_cross_review"]["high_max_slides"], 6)
        self.assertEqual(limits["final_overview"]["max_slides_per_sheet"], 16)
        self.assertRegex(machine["playwright_version"], r"^\d+\.\d+\.\d+$")

    def test_deterministic_failures_are_aggregated_before_parallel_repair(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        contract = (ROOT / "references" / "validation-contract.md").read_text(encoding="utf-8")
        for document in (skill, contract):
            self.assertIn("validation-failures.json", document)
            self.assertIn("parallel", document.lower())
            self.assertIn("shared HTML/CSS/runtime", document)
        self.assertIn("ThreadPoolExecutor", (ROOT / "scripts" / "validate_all.py").read_text(encoding="utf-8"))

    def test_visual_direction_selector_prevents_technical_cover_convergence(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        playbook = (ROOT / "references" / "theme-playbook.md").read_text(encoding="utf-8")
        design_contract = (ROOT / "references" / "design-contract.md").read_text(encoding="utf-8")
        cover = (ROOT / "references" / "cover-design.md").read_text(encoding="utf-8")
        machine = json.loads((ROOT / "scripts" / "validation_contract.json").read_text(encoding="utf-8"))
        self.assertIn("select_visual_direction.py", skill)
        self.assertIn("--output WORKSPACE/drafts/design-contract.json", skill)
        self.assertIn("do not hand-write", skill)
        self.assertIn("Technical is a subject domain, not an art direction", playbook)
        self.assertIn("dark-console-left-title-right-orbit", playbook)
        self.assertIn("incident-dashboard-card-wall", playbook)
        self.assertIn("data-design-contract-id", design_contract)
        self.assertIn("validate_design_contract.py", design_contract)
        validate_all = (ROOT / "scripts" / "validate_all.py").read_text(encoding="utf-8")
        self.assertIn('"locked visual direction"', validate_all)
        self.assertIn('"validate_design_contract.py"', validate_all)
        self.assertIn("model name, reasoning effort, agent identity", cover)
        self.assertIn("cover_distinctiveness", machine["cover_checks"])
        self.assertIn("cover_surface_integrity", machine["cover_checks"])
        self.assertTrue((ROOT / "scripts" / "select_visual_direction.py").is_file())
        self.assertTrue((ROOT / "scripts" / "validate_design_contract.py").is_file())

    def test_theme_registry_and_gallery_have_exact_name_parity(self) -> None:
        registry = json.loads(
            (ROOT / "scripts" / "theme_registry.json").read_text(encoding="utf-8")
        )
        gallery = (ROOT / "references" / "theme-gallery.md").read_text(encoding="utf-8")
        self.assertIn("schema_version", registry)
        self.assertIn("registry_version", registry)
        self.assertIsInstance(registry.get("themes"), list)
        registry_names = [entry["theme"] for entry in registry["themes"]]
        gallery_names = re.findall(r"^## \d+\. (.+)$", gallery, flags=re.MULTILINE)
        self.assertEqual(gallery_names, registry_names)
        self.assertEqual(registry_names[-len(NEW_THEME_NAMES):], NEW_THEME_NAMES)
        self.assertEqual(len(registry_names), len(set(registry_names)))

    def test_theme_selector_uses_six_semantic_inputs_without_raw_keyword_routing(self) -> None:
        selector = (ROOT / "scripts" / "select_visual_direction.py").read_text(encoding="utf-8")
        taxonomy = (ROOT / "references" / "theme-taxonomy.md").read_text(encoding="utf-8")
        playbook = (ROOT / "references" / "theme-playbook.md").read_text(encoding="utf-8")
        design_contract = (ROOT / "references" / "design-contract.md").read_text(encoding="utf-8")
        self.assertIn("theme_registry.json", selector)
        self.assertNotIn("ROUTING_HINTS", selector)
        for flag in (
            "--job",
            "--evidence",
            "--density",
            "--emotional-register",
            "--surface-family",
            "--focal-anchor",
        ):
            self.assertIn(flag, selector)
            self.assertIn(flag, taxonomy)
            self.assertIn(flag, design_contract)
        self.assertIn("do not use raw keywords", playbook)
        self.assertIn("structured values", design_contract)

    def test_theme_guidance_distinguishes_related_directions_and_new_routes(self) -> None:
        gallery = (ROOT / "references" / "theme-gallery.md").read_text(encoding="utf-8")
        taxonomy = (ROOT / "references" / "theme-taxonomy.md").read_text(encoding="utf-8")
        playbook = (ROOT / "references" / "theme-playbook.md").read_text(encoding="utf-8")
        combined = "\n".join((gallery, taxonomy, playbook))
        for theme_name in NEW_THEME_NAMES:
            self.assertIn(theme_name, taxonomy)
            self.assertIn(theme_name, playbook)
        self.assertIn("sports, esports", combined.lower())
        self.assertIn("patient", combined.lower())
        self.assertIn("Clinical Clarity vs Scientific Atlas", combined)
        self.assertIn("Bright Learning vs Playful Modular", combined)
        self.assertIn("Editorial Field Guide vs Field Notes", combined)
        self.assertIn("Product Keynote vs Keynote Minimal Full-Bleed", combined)
        self.assertIn("Systems Blueprint", combined)
        self.assertIn("retired", combined.lower())

    def test_theme_selection_uses_human_references_typography_and_llm_judgment(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        sources = (ROOT / "references" / "designer-reference-sources.md").read_text(
            encoding="utf-8"
        )
        typography = (ROOT / "references" / "theme-typography.md").read_text(
            encoding="utf-8"
        )
        cover = (ROOT / "references" / "cover-design.md").read_text(encoding="utf-8")
        self.assertIn("designer-reference-sources.md", skill)
        self.assertIn("theme-typography.md", skill)
        self.assertIn("subject, purpose, audience, language, evidence", skill)
        self.assertIn("credited designers and studios", sources)
        self.assertIn("Exclude AI-generated galleries", sources)
        self.assertIn("Travel Editorial Collage", typography)
        self.assertIn("Technical Conference", typography)
        self.assertIn("55–85%", typography)
        self.assertIn("60–85%", cover)
        self.assertIn("candidate set", cover)

    def test_stage_and_semantic_color_contract_have_one_canonical_form(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        playbook = (ROOT / "references" / "theme-playbook.md").read_text(encoding="utf-8")
        design_contract = (ROOT / "references" / "design-contract.md").read_text(encoding="utf-8")
        visual_qa = (ROOT / "references" / "visual-qa.md").read_text(encoding="utf-8")
        style_presets = (ROOT / "references" / "style-presets.md").read_text(encoding="utf-8")
        combined = "\n".join((skill, playbook, design_contract, visual_qa, style_presets))
        self.assertNotIn("1920×1080", combined)
        self.assertIn("canonical stage is always 1280×720", skill)
        self.assertIn("1280×720 logical stage without exception", playbook)
        for document in (design_contract, visual_qa, style_presets):
            lowered = document.lower()
            self.assertIn("foreground/background", lowered)
            self.assertIn("foreground-only", lowered)
            self.assertIn("background-only", lowered)
            self.assertIn("rendered contrast gate", lowered)
            self.assertIn("4.5:1", lowered)
            self.assertIn("3:1", lowered)

    def test_identity_review_is_automatic_and_webp_grounded(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        identity = (ROOT / "references" / "identity-review.md").read_text(encoding="utf-8")
        self.assertIn("automatically activated", skill)
        self.assertIn("Omitting the slide flag does not bypass review", identity)
        self.assertIn("local WebP reference", identity)

    def test_placeholders_are_blocked_and_typography_is_selected_proactively(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        contract = (ROOT / "references" / "validation-contract.md").read_text(encoding="utf-8")
        quality = (ROOT / "references" / "quality-bar.md").read_text(encoding="utf-8")
        typography = (ROOT / "references" / "style-presets.md").read_text(encoding="utf-8")
        self.assertIn("Placeholders may exist only in the private authoring workspace", skill)
        self.assertIn("placeholder gate therefore runs once for every new or edited source", contract)
        self.assertIn("One occurrence blocks delivery", quality)
        self.assertIn("Choose the type system without asking a separate font question", typography)
        self.assertTrue((ROOT / "scripts" / "validate_placeholders.py").is_file())

    def test_typography_blocks_synthetic_bold_and_noop_emphasis(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        typography = (ROOT / "references" / "style-presets.md").read_text(encoding="utf-8")
        shell = (ROOT / "assets" / "runtime-shell.html").read_text(encoding="utf-8")
        measure = (ROOT / "scripts" / "measure_text_bounds.js").read_text(encoding="utf-8")
        self.assertIn("font-synthesis: none", shell)
        self.assertIn("Use only weights present", skill)
        self.assertIn("Bundle a real bold/semibold face", typography)
        self.assertIn("has no visible emphasis", measure)
        self.assertIn("outside its declared local faces", measure)

    def test_protected_annotation_regions_and_theme_taxonomy_are_part_of_the_contract(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        taxonomy = (ROOT / "references" / "theme-taxonomy.md").read_text(encoding="utf-8")
        gallery = (ROOT / "references" / "theme-gallery.md").read_text(encoding="utf-8")
        measure = (ROOT / "scripts" / "measure_text_bounds.js").read_text(encoding="utf-8")
        reviewer = VISUAL_REVIEWER.read_text(encoding="utf-8")
        self.assertIn("data-protected-region", skill)
        self.assertIn("Route By Communication Job", taxonomy)
        self.assertIn("## 21. Consulting Precision", gallery)
        self.assertIn("overlaps protected region", measure)
        self.assertIn("crosses an annotation, caveat, source, footnote, or footer band", reviewer)

    def test_incremental_contract_scopes_work_without_dropping_independent_review(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        contract = (ROOT / "references" / "validation-contract.md").read_text(encoding="utf-8")
        review = (ROOT / "references" / "slide-by-slide-review.md").read_text(encoding="utf-8")
        self.assertIn("Pure copy, image, or slide-local CSS refreshes only affected slides", skill)
        self.assertIn("**Direct impact:**", contract)
        self.assertIn("**Neighbor impact:**", contract)
        self.assertIn("**Full impact:**", contract)
        self.assertIn("bounded `cross_review_batches`", contract)
        self.assertIn("Focus that loop on the failed slide and check family", review)

    def test_consumer_travel_routes_to_destination_magazine(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        gallery = (ROOT / "references" / "theme-gallery.md").read_text(encoding="utf-8")
        playbook = (ROOT / "references" / "theme-playbook.md").read_text(encoding="utf-8")
        self.assertIn("ordinary leisure guides default to Destination Magazine", skill)
        self.assertIn("## 7. Destination Magazine", gallery)
        self.assertIn("Do not select Field Notes merely because the subject is travel", gallery)
        self.assertIn("### Travel routing", playbook)
        self.assertIn("Japanese travel does not automatically mean dark green", playbook)

    def test_required_guide_humanizer_and_native_diagrams_are_routed(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        architecture = (ROOT / "references" / "architecture-diagrams.md").read_text(encoding="utf-8")
        self.assertIn("## Companion Skill Routing", skill)
        self.assertIn("hard dependency on `humanize-korean`", skill)
        self.assertIn("Availability is sufficient consent", skill)
        self.assertIn("Do not ask whether to use it after it is installed", skill)
        self.assertIn("self-contained inline SVG", skill)
        self.assertIn("## Choose a native construction path", architecture)
        self.assertIn("semantic HTML/CSS", architecture)
        self.assertIn("inline SVG", architecture)
        removed_companion = "Arch" + "ify"
        self.assertNotIn(removed_companion, skill)
        self.assertNotIn(removed_companion, architecture)

    def test_relevant_photography_is_default_unless_pure_html_is_explicit(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        media = (ROOT / "references" / "media-strategy.md").read_text(encoding="utf-8")
        quality = (ROOT / "references" / "quality-bar.md").read_text(encoding="utf-8")
        self.assertIn("pure-HTML, image-free, or typography/diagram-only", skill)
        self.assertIn("perform a bounded search for relevant sourced photographs", media)
        self.assertIn("This is a relevance rule, not an image quota", media)
        self.assertIn("omit them when they add no information", quality)

    def test_weak_visuals_reuse_and_synthetic_review_are_blocked(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        template = (ROOT / "assets" / "research-brief-template.md").read_text(encoding="utf-8")
        media = (ROOT / "references" / "media-strategy.md").read_text(encoding="utf-8")
        quality = (ROOT / "references" / "quality-bar.md").read_text(encoding="utf-8")
        review = (ROOT / "references" / "slide-by-slide-review.md").read_text(encoding="utf-8")
        visual_reviewer = VISUAL_REVIEWER.read_text(encoding="utf-8")
        quality_editor = QUALITY_EDITOR.read_text(encoding="utf-8")
        self.assertIn("The fallback must be `omit and redesign`", skill)
        self.assertIn("If the result is amateur, unverifiable, generic, or merely fills space, do not draw it", skill)
        self.assertIn("Never create or run a helper script that assigns reviewer identities", skill)
        self.assertIn("사진·도형 없이 재구성", template)
        self.assertIn("## Prefer absence over weak visuals", media)
        self.assertIn("A decorative silhouette with approximate pins is not a map", media)
        self.assertIn("The same underlying photograph appears as multiple crops", quality)
        self.assertIn("do not use a local script to simulate a reviewer response", review)
        self.assertIn("Prefer removing and rebalancing the slide", visual_reviewer)
        self.assertIn("repeated or near-duplicate imagery", quality_editor)

    def test_physical_subjects_keep_real_world_or_scientific_imagery(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        media = (ROOT / "references" / "media-strategy.md").read_text(encoding="utf-8")
        quality = (ROOT / "references" / "quality-bar.md").read_text(encoding="utf-8")
        self.assertIn("Full Validation controls assurance depth, not research breadth, art direction, or visual-media variety", skill)
        self.assertIn("## Classify the visual job semantically", media)
        self.assertIn("AI-driven semiconductor market change", media)
        self.assertIn("Cancer treatment research and development", media)
        self.assertIn("four to eight distinct sourced visual anchors", media)
        self.assertIn("must not remove useful subject imagery", quality)

    def test_cover_is_a_first_class_design_and_review_contract(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        cover = (ROOT / "references" / "cover-design.md").read_text(encoding="utf-8")
        contract = (ROOT / "references" / "validation-contract.md").read_text(encoding="utf-8")
        quality = (ROOT / "references" / "quality-bar.md").read_text(encoding="utf-8")
        reviewer = VISUAL_REVIEWER.read_text(encoding="utf-8")
        self.assertIn("references/cover-design.md", skill)
        self.assertIn("highest-priority art-direction decision", cover)
        self.assertIn("at least two materially different cover directions", cover)
        self.assertIn("cover and closing are always visual-critical", contract)
        self.assertIn("merely acceptable cover", quality)
        self.assertIn("For slide 1, apply `cover-design.md`", reviewer)

    def test_existing_subjects_use_authentic_media_and_generated_support_is_bounded(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        generation = (ROOT / "references" / "image-generation.md").read_text(encoding="utf-8")
        media = (ROOT / "references" / "media-strategy.md").read_text(encoding="utf-8")
        cover = (ROOT / "references" / "cover-design.md").read_text(encoding="utf-8")
        reviewer = VISUAL_REVIEWER.read_text(encoding="utf-8")
        self.assertIn("generated art must never stand in for the real subject", skill)
        self.assertIn("data-media-purpose", skill)
        self.assertIn("fourth-generation girl-group introduction", generation)
        self.assertIn("1990s-2000s game retrospective", generation)
        self.assertIn("Existing entertainment catalog or nostalgia retrospective", media)
        self.assertIn("authentic sourced identity anchor", generation)
        self.assertIn("dedicated refinement pass", cover)
        self.assertIn("generated-only depiction of an existing named subject", reviewer)

    def test_idol_editorial_index_is_optional_job_based_vocabulary(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        gallery = (ROOT / "references" / "theme-gallery.md").read_text(encoding="utf-8")
        playbook = (ROOT / "references" / "theme-playbook.md").read_text(encoding="utf-8")
        self.assertIn("## 20. Idol Editorial Index", gallery)
        self.assertIn("use Idol Editorial Index only when the job is multi-subject", gallery)
        self.assertIn("Do not select Idol Editorial Index merely because an idol appears", playbook)
        self.assertIn("bespoke theme contract", skill)
        self.assertIn("not presets or a closed taxonomy", gallery)


if __name__ == "__main__":
    unittest.main()
