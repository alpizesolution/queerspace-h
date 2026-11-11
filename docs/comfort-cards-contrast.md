# Comfort Cards: contrast audit

Measured in headless Chrome on the real components, in both themes, with the four message placements (Signals outgoing and incoming, Seek outgoing and incoming), a long question, a narrow bubble, a card still sending, and the picker. Foreground and background are the **rendered** colours; where text sits on a gradient, every glyph was hidden and the pixels behind it were sampled, and the worst case is reported. Targets (WCAG 2.1 AA): text 4.5:1, icons and essential UI edges 3:1.

Re-run: the contrast tokens are guarded by `src/components/ComfortCardsContrast.test.tsx`, which recomputes the token pairs below on every test run.

## Dark theme

| Element | Where | Foreground | Background | Ratio | Needs | |
|---|---|---|---|---|---|---|
| Category label | all card placements | `#e8b5ff` | `#211327` | **10.52** | 4.5 | pass |
| Question text | all card placements | `#ffffff` | `#211327` | **17.69** | 4.5 | pass |
| Timestamp | all card placements | `#c9b8d0` | `#211327` | **9.48** | 4.5 | pass |
| Answer label | all card placements | `#ffffff` | `#49304f` | **11.54** | 4.5 | pass |
| Answer icon | all card placements | `#ffffff` | `#49304f` | **11.54** | 3 | pass |
| Card vs message bubble (UI boundary: fill or edge) | signals-out, long | `#211327 fill / #a77fb8 edge` | `#e07bb8` | **6.48** | 3 | pass |
| Answer button edge vs card (UI) | all card placements | `#a77fb8` | `#211327` | **5.37** | 3 | pass |
| Card vs message bubble (UI boundary: fill or edge) | signals-in, seek-in, narrow | `#211327 fill / #a77fb8 edge` | `#241829` | **5.15** | 3 | pass |
| Card vs message bubble (UI boundary: fill or edge) | seek-out | `#211327 fill / #a77fb8 edge` | `#8e547e` | **3.13** | 3 | pass |
| Answer label | signals-out · Answer hover, signals-in · Answer hover | `#ffffff` | `#5a3d62` | **9.22** | 4.5 | pass |
| Answer label | signals-out · Answer pressed, signals-in · Answer pressed | `#ffffff` | `#6a4874` | **7.52** | 4.5 | pass |
| Answer label (disabled) | pending · Answer disabled | `#b8a9bd` | `#2c1d33` | **7.1** | 4.5 | pass |
| Focus ring vs card (UI) | focus ring | `#e8b5ff` | `#211327` | **10.52** | 3 | pass |
| Tagline | picker | `#b8a9bd` | `#1a111f` | **8.26** | 4.5 | pass |
| Featured: DAILY ICEBREAKER | picker | `#c8b5e6` | `#19111e … #50304c` | **6** | 4.5 | pass |
| Featured: heading | picker | `#f7f0f6` | `#19111e … #472b44` | **11.05** | 4.5 | pass |
| Featured: supporting text | picker | `#b8a9bd` | `#19111e … #392339` | **6.41** | 4.5 | pass |
| Shuffle button label | picker | `#1c1022` | `#a4a2f3 … #d49bf0` | **7.88** | 4.5 | pass |
| Category chip (unselected) | picker | `#f7f0f6` | `#291a29` | **14.72** | 4.5 | pass |
| Category chip (selected) | picker | `#e879c6` | `#432640` | **5.02** | 4.5 | pass |
| Question (unselected) | picker | `#f7f0f6` | `#241627` | **15.38** | 4.5 | pass |
| Question (selected) | picker | `#f7f0f6` | `#3b223a` | **12.7** | 4.5 | pass |
| Selected check mark (UI) | picker | `#120b17` | `#e879c6` | **7.35** | 3 | pass |
| Cancel label | picker | `#f7f0f6` | `#241829` | **15.15** | 4.5 | pass |
| Send this card label | picker | `#120b17` | `#e879c6` | **7.35** | 4.5 | pass |
| Chip edge, unselected (UI) | picker | `#a8637e` | `#1a111f` | **4.15** | 3 | pass |
| Chip edge, selected (UI) | picker | `#a0558c` | `#1a111f` | **3.65** | 3 | pass |
| Question row edge, unselected (UI) | picker | `#a0558c` | `#1a111f` | **3.65** | 3 | pass |
| Question row edge, selected (UI) | picker | `#aa5a94` | `#1a111f` | **4.02** | 3 | pass |

## Light theme

| Element | Where | Foreground | Background | Ratio | Needs | |
|---|---|---|---|---|---|---|
| Category label | all card placements | `#75418e` | `#ffffff` | **7.23** | 4.5 | pass |
| Question text | all card placements | `#291b32` | `#ffffff` | **16.19** | 4.5 | pass |
| Timestamp | all card placements | `#5f5068` | `#ffffff` | **7.41** | 4.5 | pass |
| Answer label | all card placements | `#56316b` | `#ede2f2` | **8.19** | 4.5 | pass |
| Answer icon | all card placements | `#56316b` | `#ede2f2` | **8.19** | 3 | pass |
| Card vs message bubble (UI boundary: fill or edge) | signals-out, long | `#ffffff fill / #8c64a3 edge` | `#a83279` | **6.18** | 3 | pass |
| Answer button edge vs card (UI) | all card placements | `#8c64a3` | `#ffffff` | **4.7** | 3 | pass |
| Card vs message bubble (UI boundary: fill or edge) | signals-in, seek-in, narrow | `#ffffff fill / #8c64a3 edge` | `#f2edf6` | **4.08** | 3 | pass |
| Card vs message bubble (UI boundary: fill or edge) | seek-out | `#ffffff fill / #8c64a3 edge` | `#e9d8e8` | **3.46** | 3 | pass |
| Answer label | signals-out · Answer hover, signals-in · Answer hover | `#56316b` | `#e1d0ea` | **7.04** | 4.5 | pass |
| Answer label | signals-out · Answer pressed, signals-in · Answer pressed | `#56316b` | `#d5bfe2` | **6.05** | 4.5 | pass |
| Answer label (disabled) | pending · Answer disabled | `#6f6276` | `#f2edf6` | **4.94** | 4.5 | pass |
| Focus ring vs card (UI) | focus ring | `#75418e` | `#ffffff` | **7.23** | 3 | pass |
| Tagline | picker | `#6f6276` | `#ffffff` | **5.7** | 4.5 | pass |
| Featured: DAILY ICEBREAKER | picker | `#77528e` | `#f4ecf3 … #ffffff` | **5.36** | 4.5 | pass |
| Featured: heading | picker | `#2b2030` | `#f5eff5 … #ffffff` | **13.72** | 4.5 | pass |
| Featured: supporting text | picker | `#6f6276` | `#f9f4f8 … #ffffff` | **5.24** | 4.5 | pass |
| Shuffle button label | picker | `#1c1022` | `#a4a2f3 … #d49bf0` | **7.88** | 4.5 | pass |
| Category chip (unselected) | picker | `#2b2030` | `#f9f0f3` | **13.9** | 4.5 | pass |
| Category chip (selected) | picker | `#9a1f82` | `#ebd2e6` | **5.15** | 4.5 | pass |
| Question (unselected) | picker | `#2b2030` | `#faf4f9` | **14.33** | 4.5 | pass |
| Question (selected) | picker | `#2b2030` | `#efdbeb` | **11.84** | 4.5 | pass |
| Selected check mark (UI) | picker | `#fbf9fc` | `#9a1f82` | **6.93** | 3 | pass |
| Cancel label | picker | `#2b2030` | `#f2edf6` | **13.48** | 4.5 | pass |
| Send this card label | picker | `#fbf9fc` | `#9a1f82` | **6.93** | 4.5 | pass |
| Chip edge, unselected (UI) | picker | `#c3708d` | `#ffffff` | **3.49** | 3 | pass |
| Chip edge, selected (UI) | picker | `#bd6dae` | `#ffffff` | **3.52** | 3 | pass |
| Question row edge, unselected (UI) | picker | `#bd6dae` | `#ffffff` | **3.52** | 3 | pass |
| Question row edge, selected (UI) | picker | `#b862a8` | `#ffffff` | **3.92** | 3 | pass |

136 measurements; 0 below target.

The old Answer button used the category accent (a pastel pink) for its label on a 12% tint of the same pink, sitting directly on the pink outgoing bubble: about 1.0 to 1.5:1 in the dark theme. It now lives inside the card, on the card's own surface.
