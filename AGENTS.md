we are building BITSPACE:
- 1-bit space game
- socket-based competitive arena gameplay for up to 4 players
- out-compete your opponents at collecting resources, upgrading your ship, building structures & traps, and fighting to the death
- basically minecraft hunger games set in a 1-bit space environment


design details
- the rendering engine will render a 1-bit scene
- pick good default foreground (a lighter color) and background (a darker color) (because its space), but allow for these colors to change easily through a process i'll design in the app later
- tile sets will, obviously, be in 1-bit


more gameplay details
- i still need to design the game. i don't want you to design the game, i just need a good game/rendering engine scaffolding for a 1-bit socket-based game engine


technical details
- MEN app (MERN without the R)
  - static frontend
  - nodejs express backend
  - socket.io

im going to host this on a raspberry pi, and use a reverse proxy app i made to point `bitspace.proj.host` at it, but the domain may change in the future if im able to purchase `bitspace.game`. the important thing is the BITSPACE name

prepare for deployment deploy scripts that run here and manipulate the remote: a raspberry pi on my home 
the pi can be accessed over ssh from anywhere as `cyrus@rain.remote:7006`, and has port `7023` available for the incoming traffic for this game
the pi already has other servers running on it that you need to avoid disturbing


LLM instructions
- never run the app itself. *I* run the app


## LLM ERRATA

- Frontend build tooling is acceptable. A static no-build frontend is not required if a build step gives the project a cleaner structure.
- The Raspberry Pi already has `pm2` and `nginx` installed. Deployment work should assume those are available and avoid disturbing unrelated services on the Pi.
- Deployment scripts should run locally and use `rsync` over SSH to update the remote app files.
- Engine design matters because the scaffold will constrain gameplay later. Do not invent the full game design, but do make careful engine architecture choices for a 1-bit, socket-based, competitive arena game.
- The game render should be square so play is not directionally biased by a wide viewport. Try a `384x384` logical 1-bit framebuffer by default: `24x24` visible tiles at `16px` each.
- Do not use common default app ports like `3000`. BITSPACE should default to port `7023` locally and in production unless explicitly overridden.
- Do not implement game mechanics such as resource spawning, scoring, upgrades, building, traps, combat, or win conditions unless explicitly asked. Keep the engine scaffold neutral: networking, ticks, input, snapshots, entity/render hooks, and debug movement are acceptable.
- The visible page should only be an object-fit contained canvas on a black page background unless UI is explicitly requested.
- Default rendering colors should use the configured 1-bit pixel art palette: foreground `#74cbef`, framebuffer background `#1f2433`, and black page background.
- Canvas sizing should fill the actual browser viewport without `vh` or percentage height. Use `visualViewport`/`innerHeight` based JS sizing for the full-page canvas box, keep the canvas backing store at the logical framebuffer size, and rely on literal CSS `object-fit: contain` for the square game view with black along the sides/letterbox area. Do not manually contain-scale the framebuffer in the renderer.
- Player movement uses a normalized WASD combined vector. Diagonal input must not double velocity. The ship points toward the movement vector while thrusting and keeps its previous facing direction while idle.
- Mouse click-hold powers the mining ray visual. It aims from the closest point on the main ship orb toward the mouse and currently remains visual scaffolding only.
- The main ship sphere currently uses radius `7` in the `16px` tile grid.
- Ship art should be procedural 1-bit projected geometry made of occluding line spheres only: one main centered sphere, with three smaller line spheres around the rear/bottom of the ship. One thruster should occlude the top/front side of the main sphere; the other two sit 120-degree-ish around the lengthwise axis underneath/behind it. Spheres should write 0-bits as occlusion masks before drawing 1-bit lines, but should not dither-shade or add extra decorative interior rings.
- The rear boosters should produce one shared visual-only 1-bit particle plume from the point between the boosters while thrusting, with randomized particle velocities and lifetimes.
- Star background should be a deterministic single layer. Larger/brighter 1-bit star shapes should appear at lower frequencies than smaller/dimmer stars, and the star layer should use parallax rather than moving 1:1 with the camera.
- The camera should not be clamped to the map bounds. Do not keep a hidden square world boundary in asteroid-backed arenas. The playable asteroid boundary is the collision boundary.
- Bumping into other ships should produce a small physics bounce and minor screen shake. Static asteroid/boundary collisions should bounce but should not add screen shake. Screen shake must be implemented inside the renderer/camera, not with HTML or CSS transforms.
- Asteroid fields may be non-contiguous, and interior cave pockets may be disconnected until players mine into them. Do not force all empty space to be connected if that destroys cave geometry.
- Asteroid rock generation should be seeded 3D simplex density: low-frequency body field, domain warp, separate cave fields, radial falloff, and light mask cleanup. Do not create rock with hardcoded stamped disks, paths, straight tunnels, or body blobs.
- Cave systems should come from low-frequency simplex contour/ridge fields inside sufficiently deep rock. After cave carving, enclosed caves below a configurable max size should be closed probabilistically based on size, so tiny pinholes usually disappear while larger caves survive.
- Player starts should be chosen from existing passable pockets in the generated field. Do not carve straight start tunnels to force spawn connectivity.
- Asteroid generation should seed many random candidate ROCK/ORE/DIAMOND nodes throughout rock, use BFS through rock to connect nearby candidates into candidate graphs, group those candidate graphs with BFS, keep whole graphs with a configurable degradation probability based on total graph resource amount, then apply global graph/spawn caps after probability pare-down.
- Arena generation must be replayable by seed. If `BITSPACE_SEED` is not set, the server should generate and log a short alphanumeric seed on startup; rerunning with `BITSPACE_SEED=<seed>` should reproduce that asteroid/game setup.
- The final map boundary should not be square. Derive it from the asteroid occupancy mask with padded dilate/shrink morphology so the boundary leaves a reasonable gap around asteroid mass without clipping to the world edges.
- Asteroid rendering should remain 1-bit procedural geometry: hollow square rock tiles with foreground boundary lines, ore as 1/2/3 non-occluding projected 3D rings randomly placed inside the rock tile and tilted no more than 45 degrees from flat, and diamond as a static projected tetrahedron wireframe with randomized per-tile orientation.
- Rock outlines should only draw exposed edges. Do not draw interior borders between adjacent rock/ore/diamond tiles. Convex outer corners should not be square; use a small tile-local chamfer/rounding treatment. Concave inner corners should get a 1px connector only for true notches where the diagonal tile is also rock; remove the connector for pure diagonal-touch cases. Keep this visual treatment close to the tile collision grid.
- The mining ray should stop at the first hard asteroid/boundary collision. It should emit impact particles at the hit point and mine asteroid tiles authoritatively on the server.
- Mining priority is resource before rock: plain rock takes `0.5s` and removes the tile, each ore takes `0.5s` and decrements ore amount before the underlying rock can be mined, and diamond takes `5s` before converting the tile back to plain rock.
- Mining rays should collide with other players before farther asteroid hits. Ship hits should stop the ray, emit impact particles from the renderer using the authoritative ray endpoint, and apply server-authoritative health damage over time.
- Players start with `3` health bars and can eventually upgrade up to `7`; the HUD should render health as segmented bars, not a single continuous bar.
- Player resource counts should allow up to `999` of each resource type and clamp there.
- Mining progress belongs to the tile/resource phase, not just the player input hold. If a player mines a diamond for `3s`, stops, then returns later, the remaining mine time should be about `2s`; progress should clear only when that phase completes or the tile phase changes.
- Diamonds should stay statically oriented until mined. Once a diamond has mining progress, its projected tetrahedron orientation should shift slightly based on the persisted tile mining progress and keep that rotation even when no one is actively mining it. It should not spin based on wall-clock time.
- Player HUD should be rendered into the 1-bit canvas, not HTML. It currently shows local player health plus ROCK/ORE/DIAMOND resource counts from the authoritative snapshot.
- The upgrade system is authoritative on the server and driven by the shared table in `shared/upgrades.js`. Pressing `u` opens the canvas upgrade panel under the HUD; movement/mining are paused while the panel is active, and Enter/Space buys the selected upgrade if resources are available.
- Current upgrade tracks are SPEED, CONTROL, RANGE, POWER, HULL, REPAIR, and ARMOR. Early mobility costs mostly ROCK/ORE; stronger combat/survival upgrades scale harder into ORE/DIAMOND because they directly affect fight outcomes.
- Upgrade visuals should remain procedural and 1-bit: RANGE changes actual ray length, POWER increases ray rotation and impact particle density, SPEED increases the shared thruster plume, and HULL increases segmented HP bars. CONTROL/REPAIR/ARMOR may stay HUD/menu-visible until a clean ship-silhouette treatment is designed.
- Pressing `t` should open a talk input without clearing the existing talk bubble. The hidden input exists only for browser text editing behavior; visible chat UI and persistent talk bubbles should render into the canvas with crisp 1-bit bitmap text, including selection/highlight state.
- Active asteroid boundary generation should avoid world-edge clipping. Generate asteroid mass with an edge margin inside a tile field large enough for the morphology radius, then derive the playable mask with padded dilate/shrink morphology so the final visible boundary is organic and not a hidden square world bound.
