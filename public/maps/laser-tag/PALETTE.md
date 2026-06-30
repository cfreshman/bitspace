# Laser Tag Map Palette

Each source PNG pixel is one map tile. Use exact RGB values.

| Color | Meaning |
| --- | --- |
| `#000000` | Open floor |
| `#ffffff` | Rock blocker (`ASTEROID_TILE.rock`) |
| `#00ffff` | Rock blocker (`ASTEROID_TILE.rock`) |
| `#ff0000` | Red team spawn marker |
| `#0000ff` | Blue team spawn marker |
| `#ff66aa` | Red team gate marker |
| `#66aaff` | Blue team gate marker |

Do not use `ASTEROID_TILE.wall` for laser tag maps. Wall is vestigial here.

Each connected gate marker group becomes a target. Per team, top-to-bottom gates are named `NORTH GATE`, then `SOUTH GATE`.
