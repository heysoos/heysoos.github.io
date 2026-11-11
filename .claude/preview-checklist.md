# CPPN preview: phone checklist

**Link:** https://heysoos.github.io/preview-cppn/gallery/cppn/

## Round 1

1. **Inputs list scrolls.** Open the inputs band, add inputs until the list overflows (6 to 8), then drag up and down starting *on a row*. It should scroll.
2. **No tap after a scroll.** After a scroll, lifting your finger must not open the row. A plain tap still opens it; holding still still locks it.
3. **No false save/discard prompt.** Lock a layer width (long-press it), load a few presets in a row and switch between them without changing anything: no prompt. Then change a value and switch: the prompt appears.
4. **Faster recompiles.** Scrub a layer width back and forth, or add several layers quickly. The spinner should be shorter, and going back to a width you just had should be instant.
5. **No deep-zoom jump.** Pinch deep into a pattern and lift your fingers unevenly (one first, then the other). The image must not jump. A deliberate one-finger drag still moves through latent space.
6. **Idle frames.** Pause (⏸), or set Animate off with only `x y r` inputs: the fps readout drops to 0 and the image stays put. Zooming or panning while paused still redraws smoothly. With an input that uses `t`, it keeps animating.

## Round 2

7. **Undo / redo in the capsule.** The bottom capsule reads ? ↶ ↷ | ⏸ ↺ | ⚄ ⚙. Change a param: ↶ lights up and undoes it, ↷ redoes it. The fps readout is now in the top-right corner.
8. **Presets button.** In the open card, Presets › fills the first header row: larger, accent border and tint. Tapping it shows ‹ Params, same size.
9. **Save/discard pop-up.** Change something, open Presets, tap another preset. A small dialog appears mid-screen (Save / Discard / Cancel), not at the bottom of the list. Tapping the dim area outside it cancels. Save as… and Overwrite use the same pop-up.
10. **Z scale.** Motion group, last row. At 1 every preset looks exactly as before. Lower values calm the latent motion and the drag offset; higher values exaggerate them.
11. **Back button.** In the inputs band, ‹ (top-left) should take one tap, in both list and edit view.
12. **Keyboard on open.** Tap an input row: the editor opens and the keyboard comes up by itself.
13. **Tap-to-select terms.** In the editor, tap on a function name (`sin`) or a bracket: the whole `sin(…)` term is selected. Tap a function chip to wrap it, or backspace to delete it. Tap again inside the selection: plain caret. Tapping a variable or number gives a plain caret.
14. **Lock glyph.** Hold an input row or a param row: the lock shows as the thin outline padlock from the ? card, not the 🔒 emoji or a small block.
15. **Add input.** + add input appends a random expression and doesn't open the editor. New inputs and full Randomize turn normalize on. Old presets keep their own normalize setting.

## Your notes so far

- 1: first drag on the list doesn't scroll properly, the second does (janky). **Fixed, now live:** the list only became scrollable on a timer tick after each re-render. Retest.
- 9: Save as / Discard still appears inside the params pane, not as a pop-up. **The live preview shows the pop-up** (checked at phone size). Your phone probably had the old page cached (Pages caches up to 10 min). Force-reload and retest. If it's still in the pane, say what you tapped and where it shows.
- 3: the lock test isn't the bug you reported. **Checked without locks:** all 21 built-in presets load clean and switch with no prompt; ⏸ doesn't mark a preset dirty either. Tell me what you'd done before the false prompt appeared and I'll reproduce it.

## Round 3

16. **Undo / redo highlight.** Change one thing, ↶, then ↷: after the redo, ↶ is bright again and ↷ is dim (nothing left to redo).
17. **Inputs group.** The card opens on a new INPUTS group above Network: a big accent button (thumbnails + "N inputs ›") that opens the inputs band in one tap, then Coordinate scale and Z scale. Network's `in` row is now just a label. Motion no longer has Z scale, and the View group is gone. Long-press the button to lock the whole Inputs group (expressions and both scales).
18. **Wider scales.** Coordinate scale goes 0.1 to 20 and Z scale 0 to 10. The middle 60% of each slider covers 1 to 3, so dragging feels as fine as before around normal values. Presets look unchanged.
19. **Responsive UI on heavy presets.** Load Roses, then scroll the card, scrub a value, open Presets. It should feel noticeably less sluggish than before. The image may look a bit softer on heavy presets: render resolution drops (down to half) while frames are slow and comes back when they're cheap.

## Round 4

Your round 3 notes: thumbnails closed the card; the Inputs button locked the scales too; undo/redo highlight still wrong; Roses still sluggish; reroll inside the inputs page was blocked by the outer lock.

20. **Thumbnail tap.** Tapping anywhere on the INPUTS button, thumbnails included, opens the inputs band. The card stays open.
21. **Inputs button lock.** Holding it locks the expressions only. Coordinate scale and Z scale stay unlocked; lock those on their own rows or with the group.
22. **Lock is from the outside.** Lock the Inputs button, open the band, tap ⚄ inputs: it rerolls. Per-row locks set inside the band still hold. The card's Randomize keeps the expressions.
23. **Undo / redo highlight.** The cause was the phone keeping the last-tapped button "hovered", which held a dim button bright until you tapped elsewhere. Disabled buttons now always draw dim. Retest change → ↶ → ↷, with the card open and closed.
24. **Roses.** The resolution drop did nothing on phones before, because the phone's 320px cap was applied after it. It now applies. The fps readout shows `· 70% res` etc. when it kicks in. Tell me the fps and % you see on Roses and whether the UI feels better.

## Round 5

Since round 4: the fps fix (merged to main and live), plus your notes on the layer slider, scrub drag and `in` row. Preview: /preview-cppn/gallery/cppn/

25. **FPS.** The default preset runs at ~40 fps again. Roses: note the fps. Adaptive resolution is off now, so there's no `% res`.
26. **Tap a layer row.** Tapping a layer's width cell opens it in the drag-the-canvas view, even at width 256.
27. **Axis lock.** In the canvas drag, start vertically and wobble sideways: the value only fine-tunes. A deliberate ~40px sideways swipe switches to coarse, and the other guide line dims.
28. **Vertical ticks.** The vertical guide has ticks too. Horizontal is 10% per tick, vertical is 1% per tick ("1 step" for params whose steps are coarser). Each ruler is labelled.
29. **Fine on stepped params.** Vertical fine now always moves at least one step per ~28px, so nothing feels dead vertically (small int ranges used to need ~390px per step). Seed moves one step per 24px on both axes.
30. **Layer rows.** The width meter fills only the width cell. The tanh › chip sits beside it, never on top. The Network `in` row is gone.

## Round 6

31. ~~(superseded by 33: the filled 3D dice were rejected)~~ **Reroll dice.** Left of the bottom capsule: two small 3D dice in the accent colour, no box. Tapping rerolls the params and the dice spin and land on new faces. While a heavy reroll recompiles, they hide behind the spinner.
32. **Theme colours.** Nothing should look different on the current theme. Panels, the capsule, the scrub chip, the inputs band and error text now take their colours from the theme, so a future theme switch recolours all of it.
33. **Reroll dice, redrawn.** Last slot of the capsule, right of ⚙: two small rounded dice drawn as thin accent lines, no fill. Tap: they tumble and land in the same pose with new faces, and the params reroll.

## Round 7

34. **Card buttons match.** Presets ›, Randomize and the CPPN "N inputs ›" button are the same height, shape, type and colour.
35. **Randomize icon.** The card's Randomize shows the same line dice as the capsule button, and they tumble when tapped.
36. **Minimap shape.** On a phone (portrait) the minimap's frame is a tall rectangle, matching the screen.

## Round 8

37. **Chip reset buttons.** Open a param from the card (e.g. Z scale): top right shows a bookmark and a diamond with arrow tips, plus two small marks on the bar. Drag the value away: both light up. Bookmark returns it to the preset's value, diamond to the default; each dims when the value is already there. Seed / particle counts show no diamond. Undo reverts a reset.
