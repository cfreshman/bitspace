we are building BITSPACE:
- 1-bit space game
- socket-based competitive arena gameplay for up to 8 players
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
the pi can be accessed over ssh from anywhere as `cyrus@rain.remote:7006`, and has port `7024` available for the incoming traffic for this game
the pi already has other servers running on it that you need to avoid disturbing


LLM instructions
- never run the app itself. *I* run the app


## LLM ERRATA

- Frontend build tooling is acceptable. A static no-build frontend is not required if a build step gives the project a cleaner structure.
- The Raspberry Pi already has `pm2` and `nginx` installed. Deployment work should assume those are available and avoid disturbing unrelated services on the Pi.
- Deployment scripts should run locally and use `rsync` over SSH to update the remote app files.
- Engine design matters because the scaffold will constrain gameplay later. Do not invent the full game design, but do make careful engine architecture choices for a 1-bit, socket-based, competitive arena game.
- The game render should be square so play is not directionally biased by a wide viewport. Try a `384x384` logical 1-bit framebuffer by default: `24x24` visible tiles at `16px` each.
- Do not use common default app ports like `3000`. BITSPACE should default to port `7024` locally and in production unless explicitly overridden.
- Do not implement game mechanics such as resource spawning, scoring, upgrades, building, traps, combat, or win conditions unless explicitly asked. Keep the engine scaffold neutral: networking, ticks, input, snapshots, entity/render hooks, and debug movement are acceptable.
- The visible page should only be an object-fit contained canvas on a black page background unless UI is explicitly requested.
- The main menu should render the 1-bit starfield behind the menu UI, scrolling left as if the player/camera is moving to the right. Do not show a blank boot mark once menu UI is active.
- Default rendering colors should use the configured 1-bit pixel art palette: foreground `#74cbef`, framebuffer background `#1f2433`, and black page background.
- Canvas sizing should fill the actual browser viewport without `vh` or percentage height. Use `visualViewport`/`innerHeight` based JS sizing for the full-page canvas box, keep the canvas backing store at the logical framebuffer size, and rely on literal CSS `object-fit: contain` for the square game view with black along the sides/letterbox area. Do not manually contain-scale the framebuffer in the renderer.
- Player movement uses a normalized WASD combined vector. Diagonal input must not double velocity. The ship points toward the movement vector while thrusting and keeps its previous facing direction while idle.
- Mouse click-hold powers the mining ray visual. It aims from the closest point on the main ship orb toward the mouse and currently remains visual scaffolding only.
- The main ship sphere currently uses radius `7` in the `16px` tile grid.
- Ship art should be procedural 1-bit projected geometry made of occluding line spheres only: one main centered sphere, with three smaller line spheres around the rear/bottom of the ship. One thruster should occlude the top/front side of the main sphere; the other two sit 120-degree-ish around the lengthwise axis underneath/behind it. Spheres should write 0-bits as occlusion masks before drawing 1-bit lines, but should not dither-shade or add extra decorative interior rings.
- The rear boosters should produce one shared visual-only 1-bit particle plume from the point between the boosters while thrusting, with randomized particle velocities and lifetimes.
- Star background should be a deterministic single layer. Larger/brighter 1-bit star shapes should appear at lower frequencies than smaller/dimmer stars, and the star layer should use parallax rather than moving 1:1 with the camera.
- The camera should not be clamped to the map bounds. Do not keep a hidden square world boundary in asteroid-backed arenas. The playable asteroid boundary is the collision boundary.
- Lobby and match playable boundaries should both render as dashed 1-bit boundary lines. Do not make the lobby box solid unless explicitly requested.
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
- Mining impact particles should render in a top world pass after ships and mining rays, so the mining contact is visible when close to rock or another player. Thruster particles can remain behind ships.
- Mining priority is resource before rock: plain rock takes `0.5s` and removes the tile, each ore takes `0.5s` and decrements ore amount before the underlying rock can be mined, and diamond takes `5s` before converting the tile back to plain rock.
- Mining rays should collide with other players before farther asteroid hits. Ship hits should stop the ray, emit impact particles from the renderer using the authoritative ray endpoint, and apply server-authoritative health damage over time.
- Players start with `3` health bars and can eventually upgrade up to `7`; the HUD should render health as segmented bars, not a single continuous bar.
- Ship-local health indicators should be inside the main orb. Use a small inner circle/arc: full health is a full inner circle, damage pulls the arc back symmetrically from both sides, and near-death leaves only the bottom dot. Do not draw external rings, gauges, or bars around the ship.
- One health bar is currently `100` HP. Player-facing health upgrade text should use bars, such as `1 HP BAR PER 20S`, not raw HP numbers unless raw combat math is being debugged.
- Player resource counts should allow up to `999` of each resource type and clamp there.
- Mining progress belongs to the tile/resource phase, not just the player input hold. If a player mines a diamond for `3s`, stops, then returns later, the remaining mine time should be about `2s`; progress should clear only when that phase completes or the tile phase changes.
- Diamonds should stay statically oriented until mined. Once a diamond has mining progress, its projected tetrahedron orientation should shift slightly based on the persisted tile mining progress and keep that rotation even when no one is actively mining it. It should not spin based on wall-clock time.
- Player HUD should be rendered into the 1-bit canvas, not HTML. It currently shows local player health plus ROCK/ORE/DIAMOND resource counts from the authoritative snapshot.
- The upgrade system is authoritative on the server and driven by the shared table in `shared/upgrades.js`. Pressing `u` opens a canvas overlay anchored at the `U - UPGRADES` HUD hint; movement/mining are paused while the overlay is active. Mouse hover selects an upgrade row, click buys it, and `u`/Escape closes.
- Upgrade panel height should be derived from layout constants and content count, not hand-tuned as an arbitrary box.
- Current upgrade tracks are SPEED, RANGE, POWER, HEALTH, and REPAIR. Upgrades spend ORE/DIAMOND only; ROCK is reserved as a future placeable/building material. Combat/survival upgrades scale harder into DIAMOND because they directly affect fight outcomes.
- Base ship speed should feel deliberately constrained for cave navigation and mining. SPEED level 1 is intentionally a strong early upgrade so players can buy it quickly and feel a clear improvement, but the old fast movement range should take multiple SPEED levels to reach.
- POWER is one ray stat. Mining speed and player damage should use the same multiplier unless a future balance pass explicitly splits PvE and PvP.
- Upgrade hover details should show four lines with label colons: `CURRENT:`, `NEXT:`, `COST:`, and `CLICK BUY`/`NEED RESOURCES`/`MAXED`. Stats should be exact mechanical values, such as `+12% THRUST / +13% SPEED`, not generic descriptions.
- Upgrade visuals should remain procedural and 1-bit: RANGE changes actual ray length, POWER increases ray rotation and impact particle density, SPEED increases the shared thruster plume, and HEALTH increases segmented HP bars.
- Pressing `t` should open a talk input without clearing the existing talk bubble. The hidden input exists only for browser text editing behavior; visible chat UI and persistent talk bubbles should render into the canvas with crisp 1-bit bitmap text, including selection/highlight state.
- Active asteroid boundary generation should avoid world-edge clipping. Generate asteroid mass with an edge margin inside a tile field large enough for the morphology radius, then derive the playable mask with padded dilate/shrink morphology so the final visible boundary is organic and not a hidden square world bound.
- The core room loop is now explicitly part of the game design: browser clients keep a stable local client id, refresh should reattach them to their active room unless they intentionally leave, rooms move through MENU/WAITING/ACTIVE/ENDED, and the ended state must expose a clear winner.
- Client room identity must use a persisted private `clientSecret` paired with the visible client id. Refresh/reconnect should preserve that secret, stale sockets must not be allowed to keep sending input, and each page load should use a fresh input session so reset sequence numbers are accepted.
- The server must support many simultaneous rooms, not a singleton current room. Socket events, snapshots, asteroid updates, countdowns, starts, leaves, and reconnects must route by the client room membership. `READY` may join an available non-counting-down waiting room or create another; it must not be blocked by unrelated active matches.
- Refresh/reconnect must resume by a stored `roomId` through a resume-only event. It must not call `READY`, because `READY` is allowed to create/join waiting rooms and would incorrectly move menu clients into a lobby.
- Remote play should use client-side prediction for the local ship's displayed position, velocity, facing, aim, and thrusting state. The server remains authoritative; snapshots correct the predicted ship gradually and hard-snap only when the error is large.
- Client-side prediction must also resolve display collisions against the current asteroid/boundary mask and visible ships, so the predicted local ship does not visually pass inside rock, lobby bounds, or other players while waiting for authoritative correction.
- The waiting room should feel like a pregame arena: ready joins the active waiting room, players can fly around together while waiting, the first joined client can start early, the game starts at 8 players, early start, or 5 minutes after the first join.
- Waiting-room combat should not damage players. Pregame interaction can be disposable because the actual match starts from a fresh seeded arena with fresh spawns/resources.
- Player spawn positions should be seed-randomized and spread across available spawn slots, not assigned directly from join order. Lobby spawns and active-match spawns should both avoid deterministic player-one/player-two compass positions.
- READY on the initial menu is a normal instant screen button with hover state. The waiting lobby is not the asteroid field; it is a small boxed-in arena with physical START/LEAVE button objects. Those physical lobby buttons should not show hover state or loading bars; they trigger instantly from the actual authoritative mining ray collision.
- Starting the match from the lobby should not immediately begin the active game. START arms the same 10-second countdown used by the natural timer, emits one mechanical beep for everyone, and then starts when the countdown reaches zero. The natural five-minute timer should emit that same beep when it reaches 10 seconds remaining.
- Do not expose implementation details like host names in the waiting lobby UI unless explicitly requested.
- Eliminated players should continue spectating the player who killed them when possible, otherwise another surviving player, until the game ends or they leave. The ended overlay is player-relative: winners see `YOU WON!`; losers see `GAME OVER`.
- When a player is eliminated, show a brief authoritative 1-bit canvas notification at the top right: `A PLAYER HAS BEEN ELIMINATED`. Drive it from snapshot alive-state transitions, not local prediction.
