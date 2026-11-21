# motion-ledger · a ledger-driven motion-design skill

**English** · [中文](README.md)

> Make any model — including weaker ones — produce motion films close to what a strong model would.
> Not by "taste prompts", but by turning vague briefs into exact values (**three ledgers**) and turning "looks fine" into PASS/FAIL (**code gates**).

---

## The problem this solves

Give the same motion brief to a strong model and a weak one. The gap is not taste, it is **behaviour**. A strong model will:

1. Honour every number in the brief (duration, colours, type size, angles, easing)
2. Turn vague words ("premium", "breathing") into concrete design decisions
3. Design every element instead of shipping the helper's default box
4. Lay out the timeline before writing code
5. Build one system (colour indices, slot constants, a material renderer) instead of re-inventing per scene
6. Come back and fix what it got wrong

A weak model skips all six — and does not notice it skipped them. The output runs, but reads like a template.

`motion-ledger` turns those six behaviours into **explicit steps that cannot be skipped**, and checks with code that they actually happened.

---

## Four layers

```
┌─ 1 Discipline ───────────────────────────────────────────┐
│  Three ledgers S/X/E · timeline before code · ids in src   │
│  produces LEDGER.md            audited by verify/spec.mjs │
├─ 2 Craft ────────────────────────────────────────────────┤
│  duration table (120–220 / 350–650 / 600–1200 / 900–1800) │
│  four visual grammars · three attention layers            │
│  one material world · 9 element playbooks · 6 rules       │
│  produces spec.ts + scenes/    audited by banned-item scan│
├─ 3 Gates (the part nobody else has) ─────────────────────┤
│  verify/film.mjs   MP4 physical: format/seam/motion/PPT   │
│  verify/spec.mjs   ledger coverage + placeholders + bans  │
│  produces PASS/FAIL + out/check/  audited by selftest.mjs │
├─ 4 Delivery ─────────────────────────────────────────────┤
│  captions · multi-track · transitions · mix · aspect      │
│  produces final.mp4            audited by ffprobe + stills│
└──────────────────────────────────────────────────────────┘
════════════════ FOUNDATION (belongs to no layer) ════════════════════
  src/lib/motion.tsx   decides WHERE things are and HOW they move,
                       never WHAT they look like
  time/easing/beats · point-wise morph morphPts · character rig · components
  → mechanism, not design: that is why it is outside the layers,
    and precisely why it is on the do-not-modify list
══════════════════════════════════════════════════════════════════════
```

**The difference that matters**: comparable skills have the model grade its own work, which carries built-in confirmation bias. This project moves everything mechanically decidable into code — motion curves, an anti-slideshow gate, ledger coverage, banned-item scanning. None of it relies on the model being honest.

**Why `motion.tsx` is not one of the four layers**: all four layers answer "what should this film be", while it answers "given time t, where is a point". That is mechanism, not design. Change it and every gate reading stops being comparable — the motion curve `film.mjs` measures, the closed-form `EASE.*` curves, the seed-reproducibility of `rand` all lose their footing. So it is classed as a foundation you do not modify.

What each layer owns, what it does *not* own, where the boundaries are, and **why four layers rather than three or five**, is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (bilingual).

---

## Use it in three steps

### 1. Install

**DeepSeek Harness reads skills from `~/.dsh/skills` (Windows: `D:\Users\<you>\.dsh\skills`)**:

```bash
git clone git@github.com:boosn1/motion-ledger.git ~/.dsh/skills/motion-ledger
```

Other hosts use their own roots: `.claude/skills`, `.agents/skills`, or a project-local `.dsh/skills`.
Requirement: `SKILL.md` must carry non-empty `name` and `description` frontmatter, or it is silently ignored.

Dependencies:

| Dependency | Purpose | Required |
|---|---|---|
| Node.js ≥ 22 | gate scripts, score synthesis | yes |
| ffmpeg + ffprobe | stills, motion curve, audio checks | for gates |
| npm | install Remotion (Remotion route only) | route-dependent |

### 2. Copy the starter and open a new film

```bash
cp -R motion-ledger/templates/remotion-starter my-film
cd my-film
npm install
```

The starter is a **complete, runnable film**: a 15-second brand piece where five blocks converge into a ring, then stretch into a wordmark.
It doubles as the format reference — `LEDGER.md` holds the matching ledger, and every constant in `src/spec.ts` carries a `// S01`-style back-reference.

```bash
npm run studio     # Remotion Studio live preview
npm run render     # write out/film.mp4
npm run check      # stills + motion curve + audio self-check
npm run score      # re-synthesise the score
```

> **Windows note**: Remotion's bundled ffmpeg sometimes gets a permission denial writing to the system TEMP (`FFmpeg quit with code 4294967283`).
> Point TEMP inside the project:
> ```powershell
> $env:TEMP = "$PWD\.rtmp"; $env:TMP = $env:TEMP; npm run render
> ```

### 3. Let the agent work from SKILL.md

Say to the agent: **"Read motion-ledger/SKILL.md and make this film following its process: <your brief>"**

It then walks seven stages:

| Stage | Output | Gate |
|---|---|---|
| 0 Ledger | `LEDGER.md` with three tables (S brief / X transformation / E element) | — |
| 1 Fill gaps | defaults for anything the brief omits, marked `S##*` | — |
| 2 Style | one material world + a 3–5 colour palette | — |
| 3 Timeline | event table, each line `t: element · action · value · id` | beat check |
| 4 Design | key compositions pinned to exact px, statics before motion | — |
| 5 Build | `spec.ts` / `scenes/` | `npm run render` |
| 6 Review | gates + one bounded pass | `spec.mjs` + `film.mjs` |

**Start a fresh conversation for every new film.** In an old thread the model reuses the previous film's code and the new ledger never takes effect — this is the most commonly missed failure mode for skills of this kind.

---

## Running the gates

The gates are standalone scripts. Run them any time, no agent needed:

```bash
# MP4 physical check: format vs spec / first-frame flash / loop seam / motion curve / anti-slideshow dead zone / audio not silent
node verify/film.mjs --film out/film.mp4 --spec src/spec.ts --ledger LEDGER.md

# Ledger audit: coverage / unledgered constants / starter placeholders / banned items
node verify/spec.mjs --ledger LEDGER.md --src src/

# Gate self-test: proves the gates go red as well as green
node verify/selftest.mjs

# Did the two score.mjs copies drift apart? (starters must be self-contained, so two copies are intentional)
node verify/sync.mjs
```

All four depend only on Node built-ins plus ffmpeg — **no npm dependencies, no node_modules**.

**Why two copies of `score.mjs` are not redundancy**: every starter under `templates/` must work after a plain `cp -R`, so it cannot import back into the repo root. The two copies are deliberate — `verify/sync.mjs` compares their sha256 and fails on drift, which is cheaper than merging and re-splitting.

`selftest.mjs` builds fixtures in the system temp directory and runs 11 assertions (positives must pass, negatives must fail, relaxation flags must take effect) without writing anything into the repo.
**Run it first on a new machine or platform** — it tells you immediately whether the gates are still valid in that environment.

### The gates are declarative, not hard-coded

Any real transformation exceeds a "4× median frame delta" threshold. A hard threshold would kill every honest spike, so peaks and holds are **declared in the ledger and the code only checks the declaration**:

```markdown
### 计划内运动峰值
| 区间 | 来源 | 为什么允许 |
|---|---|---|
| 2.50–4.20 | X01 | blocks morph into arcs, the most violent shape change |

### 计划内静止
| 区间 | 来源 | 为什么允许 |
|---|---|---|
| 11.60–15.00 | S18 closing hold | wordmark settles, let the viewer read it |
```

No such table in the ledger means strict mode: any spike or dead zone is a bug. The point: **only the author knows whether a given movement is intended; the code only catches movement you never declared.**

---

## What it can make (by confidence)

Confidence here is not a feeling — it follows from what can be determined frame by frame, traced through a ledger, and checked by a gate.

| Type | Confidence | Why | Typical length |
|---|---|---|---|
| Brand / product motion | **highest** | Elements have explicit origins and destinations; deterministic per frame; composition pinnable to px | 15–60s |
| Data animation / chart morph | **very high** | Every number quoted verbatim into the ledger and coverage-checked; morphs share slots so identity survives | 15–40s |
| Kinetic type / logo reveal | **very high** | Vector, no fuzzy edges; CJK vertical setting and tracking are computable; `<Letters>` is per-glyph controllable | 5–30s |
| Explainer | **moderate-high** | With narration you cut to the word timeline; hand-drawn illustration styles are out of reach | 60–120s |
| UI / product demo | **moderate** | Needs real screenshots (PageCam-style 2.5D camera); hand-faked UI reads as fake instantly | 15–40s |
| Stylised art animation | **moderate** | Ink, halftone, collage, print work; true impasto painting does not | 10–40s |
| Character shorts | **lowest** | Can walk and change pose, cannot act (the source project measured only 0.40–0.49 similarity) | uncertain |

For reference, on the same pipeline: data animation **0.85–0.96**, type **0.79–0.94**, multi-material **0.68–0.89**, character story **0.40–0.49**.

**Cannot do**: live-action footage, editing existing material, photoreal generation (use an image/video model), speech synthesis, narrative longer than about two minutes.

One rule of thumb: **is the hard part *precision* or *texture*?** Precision (numbers, shapes, beat alignment, cross-shot consistency) → this pipeline wins. Texture (looks painted, looks filmed, has brushwork) → this pipeline loses; bring in an image model. If both are present, split the job: generate texture with a model, lay it out with code.

Full list, cost estimates and limits: [`references/09-capabilities.md`](references/09-capabilities.md).

---

## After the render: hand off to an editor

Code draws the frame; the editor owns the timeline and the text. With Concat (0.2.12+):

```bash
node scripts/concat-bridge.mjs --film out/film.mp4 --out final.mp4 \
  --caption "静水流深" --caption-start 0.6 --caption-dur 3.0
```

Measured output:

```
Concat 0.2.12 · D:\Program Files\Concat\concat.exe
imported m1 · 15.019s · 1920×1080
caption "静水流深" · 0.6–3.6s
delivered final.mp4 · 847551 bytes
```

**Concat is one implementation of layer 4 (delivery). It is not a fifth layer, and it does not replace layers 1–3.**
Do not use it in place of Remotion — that is drawing animation in an NLE, positioning things by hand per frame, back to having no ledger and no gates. Equally, do not expect Remotion to do caption layout and voice alignment. The split is documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`references/08-delivery.md`](references/08-delivery.md).

Without Concat you can still deliver: `ffmpeg -vf subtitles=` for burned-in captions, `-i voice.wav -shortest` to attach narration, `-f concat` to join clips. **The layer does not disappear; only the implementation changes.**

### When the score sounds "buzzy": split stems, don't guess

A delivered film has one mixed audio track, which cannot answer "where is that sound coming from". `--stems` splits the score by layers your ears can actually separate:

```bash
node scripts/score.mjs --cues scripts/cues.json --out public/score.wav --stems
```

```
  layer        peak dBFS   RMS dBFS   share
  pad             -8.9     -22.7    14.5%
  sub             -7.8     -18.2    41.0%
  bassPluck       -7.0     -21.3    20.0%
  kick             1.5     -21.9    17.6%
  hat            -19.8     -45.0     0.1%
  ...
```

**This table is the conclusion**: 81% of the energy sits in the four low layers, while `pad` holds 14.5% and `hat` only 0.1% — so the buzz can only come from those four. To audition track by track, lay the stems into Concat (one layer per track):

```bash
node scripts/concat-bridge.mjs --film out/film.mp4 --stems public/stems \
  --subs-from-spec src/spec.ts --out final.mp4
```

One command produces all three: the video track (auto-muted), one audio track per stem, and a caption track. Mute one track at a time; whichever one kills the buzz is your culprit. Add `--no-export` if you only want the project for listening in the GUI. The five real causes and their thresholds are in [`references/06-sound.md`](references/06-sound.md).

---

## Publish discipline

```bash
node scripts/publish.mjs          # gates → dangling-ref check → commit → push
node scripts/publish.mjs --dry    # check only, no commit
```

If a gate fails, the commit is refused — **a broken gate is worse than no gate**, because it makes every later conclusion untrustworthy.

Then sync into the DSH skills directory, or the local skill centre keeps serving the old copy:

```powershell
$src = "<repo path>"
$dst = "$env:USERPROFILE\.dsh\skills\motion-ledger"
Remove-Item -Recurse -Force $dst -ErrorAction SilentlyContinue
git -C $src ls-files | ForEach-Object {
  $t = Join-Path $dst $_
  New-Item -ItemType Directory -Force (Split-Path $t) | Out-Null
  Copy-Item (Join-Path $src $_) $t
}
```

---

## Layout

```
motion-ledger/
├── SKILL.md                        ← the agent reads this (main entry)
├── docs/
│   └── ARCHITECTURE.md             four layers, boundaries, where Concat sits (bilingual)
├── references/
│   ├── 01-ledgers.md               full rules for the three ledgers
│   ├── 02-playbooks.md             9 element types: how to build / how to move / common failures
│   ├── 03-timing-and-grammar.md    duration table, visual grammar, attention, art direction
│   ├── 04-engineering-contract.md  both render contracts (Remotion / HTML+GSAP) + determinism
│   ├── 05-review.md                five judges → gate mapping, independent review, banned list
│   ├── 06-sound.md                 sound policy and score spec
│   ├── 07-competitive-map.md       how this compares to neighbouring projects
│   ├── 08-delivery.md              delivery layer: captions / tracks / mix / Concat bridge
│   └── 09-capabilities.md          what it can and cannot make, with cost estimates
├── scripts/
│   ├── concat-bridge.mjs           film → Concat editor (captions, export)
│   └── publish.mjs                 gates → commit → push in one command
├── verify/                         ← gates (zero dependencies)
│   ├── film.mjs                    MP4 physical check
│   ├── spec.mjs                    ledger ↔ source audit
│   ├── selftest.mjs                gate self-test (11 assertions)
│   ├── sync.mjs                    are the two score.mjs copies still identical
│   └── lib.mjs                     shared helpers
├── templates/
│   ├── remotion-starter/           ← primary: Remotion + React + SVG (renders out of the box)
│   │   ├── LEDGER.md               the matching ledger (copy this format)
│   │   ├── src/spec.ts             design constants (with // S01 back-references)
│   │   ├── src/lib/motion.tsx      helper library (do not modify)
│   │   ├── src/geometry.ts         shape geometry (the technical core of true morphing)
│   │   ├── src/scenes/             scenes (absolute t, return null outside the window)
│   │   ├── scripts/score.mjs       zero-dependency score synthesis
│   │   └── scripts/check.mjs       in-project self-check
│   └── node-starter/               ← alternative: pure Node rasteriser, zero npm deps
│       ├── LEDGER.md               matching ledger
│       ├── src/spec.mjs            design constants
│       ├── src/lib/motion-core.mjs mechanics library (do not modify)
│       ├── src/raster.mjs          raster primitives (polygon/band/stroke)
│       ├── src/film.mjs            scenes (drawn frame by frame)
│       ├── src/render.mjs          frames → ffmpeg
│       └── scripts/score.mjs       soundtrack (same source as the Remotion copy)
├── examples/
│   └── LEDGER.example.md           teaching example (annotated, with reconciliation output)
├── ATTRIBUTION.md                  upstream sources and licences
├── PUBLISH.md                      pushing and troubleshooting
├── README.md                       Chinese
└── LICENSE                         MIT
```

**Do not confuse the two ledgers**: `examples/LEDGER.example.md` is a **teaching example** (line-by-line explanation, source back-reference samples, reconciliation output); `templates/*/LEDGER.md` is **gate input** (a real film, including the peak/hold declaration tables). Copy the format from the latter; learn the rules from the former.

**Choosing a render route**:

- **Remotion** (`templates/remotion-starter`) — Studio live preview, component model, font ecosystem, the common production choice. Needs `npm install`.
- **Pure Node rasteriser** (`templates/node-starter`) — zero dependencies, writes frames directly; fits environments without npm or pipelines that embed it. Far fewer features (no Studio; shape capability is hand-written rasterisation).

Both routes answer to the same gates: `spec.mjs` reads source comments, `film.mjs` only looks at the MP4.

---

## Scope

**Good for**: Remotion (React + SVG) motion, HTML+GSAP motion, brand films, data animation, kinetic type, UI/product demos, stylised art animation, shorts and showreels of 15–60 seconds.

**Not for**: photoreal generation (needs a video model), editing existing material (use an NLE), captioning an existing video, live-action shooting.

---

## Known limits

- **Character work is the weak spot.** Pure-code characters tend to break in exactly two places: identity drift across shots, and hands not on the prop. When characters are needed, the correct answer is **an image model for frames plus code for compositing, frame swapping and material** — not stubborn hand-drawing.
- **Impasto / oil-painting texture cannot be produced in pure code.** It can be imitated, not achieved. Same remedy as above.
- **The score is code-synthesised** and the timbre is simple. If music matters, replace it in post.
- **Remotion licence**: free for individuals; free for companies of ≤3 people; larger companies need a Remotion company licence. Verify before commercial use.
- The gates judge **structure and consistency**, not **beauty**. Aesthetic judgement still needs a human — it just no longer needs to be the person who made the film.

---

## Sources and credit

The rule system here is a **synthesis and rewrite** of four public projects, plus the code-gate layer none of them has. See [ATTRIBUTION.md](ATTRIBUTION.md).

- [8533502-dev/deepseek-opus-motion-skill](https://github.com/8533502-dev/deepseek-opus-motion-skill) (MIT) — the original framing of the three ledgers, the 9 playbooks, the five judges and the banned list
- [nexu-io/open-design](https://github.com/nexu-io/open-design) `skills/motion-design` (Apache-2.0) — duration table, visual grammar, three attention layers, sound policy, bounded review
- [alchaincyf/huashu-art-motion](https://github.com/alchaincyf/huashu-art-motion) (MIT) — the anti-slideshow gate idea and independent review
- [Vincentwei1021/video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) (Apache-2.0) — "the maker has confirmation bias; the first review must not be their own"

## License

MIT. See [LICENSE](LICENSE).
