# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Allenhua/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Allenhua/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for the make.fun token-radar-01 bounty:
https://make.fun/bounty/token-radar-01 It reads the sealed
DefiLlama snapshot, ranks protocols that record no token by an implied token value
calibrated from the snapshot's own live-token protocols (median market-cap-to-TVL
per category, winsorized and shrunk toward the global median), and writes a static
dashboard with a farm plan for every protocol.

Run: `MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>`
