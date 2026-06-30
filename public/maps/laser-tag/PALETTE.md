# Laser Tag Map Palette

Each source PNG pixel is one map tile. Use exact RGB values.

| Color | Meaning |
| --- | --- |
| `#000000` | Open floor |
| `#ffffff` | Rock blocker (`ASTEROID_TILE.rock`) |
| `#00ffff` | Optional starting diamond target embedded in rock |
| `#ff0000` | Red team spawn marker |
| `#0000ff` | Blue team spawn marker |
| `#ff66aa` | Red team gate marker |
| `#66aaff` | Blue team gate marker |

Do not use `ASTEROID_TILE.wall` for laser tag maps. Wall is vestigial here.

Cyan diamond pixels define the preferred runtime diamond spawn candidates for that map. If a map has any cyan pixels, runtime diamond spawn attempts use those tiles; if a map has no cyan pixels, runtime diamonds fall back to any rock tile with at least one cardinal open-floor face.
Each connected gate marker group becomes a target. Per team, top-to-bottom gates are named `NORTH GATE`, then `SOUTH GATE`.
