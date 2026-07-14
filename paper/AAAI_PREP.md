# AAAI 2027 Submission Prep — AlekhDB Paper

## Status: Ready for camera-ready polish

**Deadline: August 2026** (12+ months from now)

## What we have

✅ Full 8-page paper draft (`paper/paper.tex`, `paper/paper.md`)
✅ 5 figures (PNG, 150 DPI, ready for AAAI two-column format)
✅ 6 tables (CSV, can be converted to LaTeX)
✅ Complete reproducibility package (Docker compose + README)
✅ All 5 backends run with real Ollama embeddings
✅ Statistical rigor (N=5 trials, 95% CI)
✅ Scaling evidence (4 sizes)
✅ 9-capability ablation study
✅ Cognitive study (Ebbinghaus vs TTL)
✅ Long-horizon agent task
✅ Pushed to GitHub at https://github.com/MAHADEV369/AlekhDB-v2

## What we need to do for AAAI

### Critical (next 4 weeks)
- [ ] Run 5 more statistical trials → N=10 total (more rigorous)
- [ ] Add 1-2 more agent tasks (extending the 5-bug scenario to 15-20 bugs)
- [ ] Add 1-2 more ablations per capability (3+ tasks each)
- [ ] Add a human evaluation pilot (5-10 participants) for the cognitive claim
- [ ] Convert CSVs to LaTeX tables (table1.tex, table2.tex, etc.)
- [ ] Polish figures for AAAI 2-column format (may need re-rendering)
- [ ] Expand related work to cite more papers (Zep/Graphiti, MemGPT, etc.)
- [ ] Add a "Discussion" section with limitations
- [ ] Add a "Broader Impact" section (AAAI requirement)

### Important (next 8 weeks)
- [ ] Get real SuperMemory binary running (defer until they fix install script)
- [ ] Get real Letta server running (defer until it's possible headless)
- [ ] Implement a learned embedding baseline (fine-tuned MiniLM)
- [ ] Run on a 100K+ node dataset for scaling story
- [ ] Add 1-2 more competitor baselines (e.g., simple Qdrant, plain vector store)
- [ ] Polish writing for clarity (have 2 colleagues read)

### Nice to have
- [ ] Add a "Related Work" section on Episodic + Semantic memory (Tulving, Baddeley)
- [ ] Add ethics discussion (local-first = privacy, but also = easier data loss)
- [ ] Add a "Future Work" section with concrete next steps

## Timeline (working backward from Aug 2026)

| Date | Milestone |
|---|---|
| **Now (Jan 2026)** | Submission prep begins. We have a working draft. |
| Feb 2026 | N=10 trials, 2 more agent tasks, 1-2 more ablations per capability |
| Mar 2026 | Convert all tables to LaTeX, polish figures for AAAI 2-col |
| Apr 2026 | Human evaluation pilot (5-10 participants) |
| May 2026 | Add Discussion, Broader Impact, expand Related Work |
| Jun 2026 | Internal review by 2-3 colleagues, incorporate feedback |
| Jul 2026 | Final camera-ready, submit to AAAI 2027 (deadline ~Aug 15, 2026) |

## Action items for the next 7 days

1. **Run additional 5 trials** (paper/scripts/statistical-trials.js with N=5 → 10)
2. **Convert tables to LaTeX** (paper/tables/*.csv → *.tex)
3. **Polish the introduction** (current is 2 paragraphs; AAAI wants 1 page)
4. **Add a figure caption block** (each figure should have a self-contained caption)
5. **Anonymize for double-blind review** (replace "Anonymous Institution" with truly empty)
6. **Test compile the LaTeX** (need to install texlive, compile, check PDF)

## Risk assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| Real SuperMemory unavailable | Already failed | Document in §9 |
| Real Letta unavailable | Already failed | Document in §9 |
| N=5 too small | Medium | Run more trials (5-7 days) |
| Synthetic agent task unconvincing | Medium | Extend to 15-20 bugs |
| No human study | High | Pilot with 5-10 users |
| Reviewers don't like the local mocks | Medium | Honest documentation in §9 |

## What to do if the paper is rejected

1. **arXiv fallback** — submit to arXiv anyway; gets citable reference
2. **Workshop submission** — NeurIPS 2026 / ICML 2026 workshops on memory / agents
3. **Journal extension** — extend to a 20-page journal paper for TKDD or ACM TIST
4. **Industrial track** — AAAI has an industrial track for applied research

## Decision

The paper is in good shape. The plan above has plenty of buffer. We can deliver a strong submission by Aug 2026 with the additional work, OR submit the current draft to a workshop for fast feedback.

For now: continue polishing in parallel with arXiv submission, then do final AAAI push in mid-2026.
