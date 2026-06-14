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
- Ship art should be procedural 1-bit projected geometry made of occluding line spheres only: one main centered sphere, with three smaller line spheres around the rear/bottom of the ship. Spheres should write 0-bits as occlusion masks before drawing 1-bit lines, but should not dither-shade or add extra decorative interior rings.
- The rear boosters should produce one shared visual-only 1-bit particle plume from the point between the boosters while thrusting, with randomized particle velocities and lifetimes.
- Star background should be a deterministic single layer. Larger/brighter 1-bit star shapes should appear at lower frequencies than smaller/dimmer stars, and the star layer should use parallax rather than moving 1:1 with the camera.
- The camera should not be clamped to the map bounds. Map bounds should render as a dashed line when visible.
