# Babylon NME via MCP — Agent Notes

How to build, preview, and iterate Node Material Editor (NME) materials in this repo
using the `@babylonjs/mcp-servers` MCP server. Written after porting the
`genetic-shaders` heightmap pipeline (incl. the Runevision phacelle erosion filter)
to NME — includes the obstacles hit and how each was resolved.

## Setup

- Server: `npx -y @babylonjs/mcp-servers nme` (stdio, **no login / no API key**).
- Config for Devin lives in `.devin/mcp_config.json`:
  ```json
  { "mcpServers": { "babylon-nme": { "command": "npx", "args": ["-y", "@babylonjs/mcp-servers", "nme"] } } }
  ```
- The server keeps graphs **in memory** — nothing persists unless you export JSON.
  Session state dies with the MCP process.

## Two ways to build a material

1. **Tool calls** (`create_material`, `add_block_batch`, `connect_blocks_batch`,
   `validate_material`, `export_material_json`) — works well for native blocks.
2. **Import a hand-authored NME JSON** (`import_material_json` with `jsonFile`) —
   **required for CustomBlocks**, see "Obstacles" below.

File-based assets in this repo:
- `materials/genetic-height.nme.json` — simple staged pipeline (warpedFbm → plateauRim → shapeHeight → hypsometric).
- `materials/genetic-phacelle.nme.json` — full Runevision phacelle port (baseHS → erosionPhacelle → shapeHeight → alpineDrainage + normal displacement).
- `materials/gen-nme.mjs`, `materials/gen-phacelle-nme.mjs` — generators; edit, run `node materials/gen-*.mjs`, reload the JSON in NME.
- `materials/gen-test-page.cjs` — `node materials/gen-test-page.cjs <mat.json> <out.html>` emits a standalone Babylon page (sphere + ArcRotateCamera) that `NodeMaterial.Parse`s a material file. Serve via `pnpm dev` (Vite, :5173) — `file://` doesn't work.

## Viewing the result

- **Recommended**: open `https://nme.babylonjs.com` → FILE → Load → the `.nme.json`
  file. Stable preview, no flicker.
- **Live session** (`start_session` → paste `http://localhost:3001/session/<id>`
  into the editor's MCP Session panel): live-syncs edits, **but** — see obstacle #4.
- **Test page** for real render verification: `http://localhost:5173/test-phacelle.html`.
- Playwright MCP can drive all of the above: `browser_navigate`, click "Load",
  `browser_file_upload` into the file chooser, `browser_console_messages`
  (NME logs full emitted shader source at info level) and `browser_take_screenshot`.

## Authoring CustomBlocks (the important part)

A CustomBlock in serialized NME JSON is:

```js
{
  customType: "BABYLON.CustomBlock", id, name, target: 4,
  inputs: [...], outputs: [...],           // normal NME port lists
  options: {
    code: [...glsl lines...],
    functionName: "erosionPhacelle",
    target: "Neutral",                     // emits in whatever stage consumes it
    inParameters:  [{ name: "h", type: "Float" }, ...],
    outParameters: [{ name: "result", type: "Vector2" }],
  },
}
```

Rules learned the hard way:

- **`options` alone does not create ports** — the serialized `inputs`/`outputs`
  arrays must also be populated (names must match `inParameters`/`outParameters`
  and the names used in `inputs[].inputName` connections).
- **Namespace every helper** (`bf_simplex`, `er_hash22`, `ad_ramp`, …). All custom
  code is emitted into one shader — duplicate symbol = compile error, and you
  cannot rely on emission order between blocks.
- **One block = one stage**: keep each block self-contained (its own helpers).
  Re-evaluating shared functions is fine (e.g. `baseHS` does 5 taps internally);
  cross-block function calls are not.
- Use `vec2`/`vec3`/`vec4` outputs + `VectorSplitterBlock` (input port `xyzw`,
  outputs `x`,`y`,`z`,`w`,`xy`,`xyz`) instead of hoping multi-out params work.
- **Vertex shader emission**: `target: "Neutral"` blocks emit in the vertex stage
  when their output feeds `VertexOutputBlock` — this is how displacement works
  (`normal * h * scale` + `Add` → Transform). Anything using `dFdx`/`dFdy` must be
  fragment-only consumers.
- GLSL-ES 1.00 style is fine (`gl_FragColor` handled by NME's emitters); loop
  bounds stay constant with `break` (see `genetic-shaders/AGENTS.md`).
- `int` parameters: take `Float` input, cast inside (`int(floor(octaves + 0.5))`).

## Obstacles encountered → resolutions

1. **CustomBlock ports never appear via `add_block`/`set_block_properties`** —
   the MCP derives ports from a static registry; CustomBlock isn't expanded from
   `options`. → Author the full material JSON on disk and `import_material_json`.
2. **`VectorMerger` input names have trailing spaces** (`"xy "`) — if a connection
   fails with "port not found", check `get_block_type_info` output for exact names.
3. **ProceduralTexture mode preview flickers grey** — mode 3 materials don't feed
   the editor's 3D preview mesh. → Use **Material mode (0)** + mesh `uv` attribute
   + `position → Transform(WorldViewProjection) → vertexOutput`.
   (`systemValue: 6` = WorldViewProjection, matrix `type: 128`, `mode: 0` on the
   InputBlock.)
4. **"Node material build successful" but preview flickers** — not a shader bug.
   The live session re-pushes the document on every MCP event; each rebuild
   flashes grey. → Disconnect the session; load the JSON file directly. Also:
   if the editor has stale cached state, **clear local/session storage + hard
   refresh** fixes a file that "opens the graph but won't render".
5. **Blocks pile at (0,0) on load** — hand-authored JSON lacked node positions.
   → Emit `editorData.locations: [{blockId, x, y}]`; the generator computes column
   = graph depth × 340px, row = index × 180px (same scheme as the server's
   auto-layout).
6. **Shader compiles fine but looks wrong / no error text** — NME's Log panel is
   sparse. → Render the JSON in a standalone Babylon page (`gen-test-page.cjs`)
   and/or read NME's console via Playwright — the editor logs the *full emitted
   vertex+fragment source*, which makes CustomBlock emission inspectable.
7. **Git Bash `/tmp` paths** — Node resolves `/tmp/x` as `C:\tmp\x` on Windows;
   use workspace-relative temp paths for MCP file args (`jsonFile` etc.).

## Working pattern that emerged

- Custom nodes carry the ported math verbatim; stock nodes carry attributes,
  uniforms, splitters, and vertex plumbing — mirrors `noiseLib`'s own structure.
- Keep a **generator script** as source of truth (`materials/gen-*.mjs`): tweak →
  regenerate → reload file. Diffs on the JSON are reviewable in git.
- Iteration loop that works well: edit generator → `node materials/gen-*.mjs` →
  NME FILE→Load → drag inspector sliders live → bake preferred values back into
  the generator's `inputBlock` defaults.
- Awaiting a user value? `test-*.html` gives a stable big-canvas preview the
  agent can screenshot via Playwright for self-verification.

## Known limitations / TODO

- The MCP session bridge (`localhost:3001`) is per-process — no durable sessions.
- Saving a Babylon **snippet** writes to Babylon's hosted store (public URL).
- NME materials are Babylon-engine JSON — the GLSL inside CustomBlocks is
  portable, but the graph itself doesn't yield standalone `.frag` files.
- The phacelle material currently omits `laplacianAt` (curvature stage) and the
  classic Gavoronoise mode — both are mechanical additions to
  `gen-phacelle-nme.mjs` following the same stage-block pattern.
