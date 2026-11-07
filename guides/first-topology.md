# Build your first topology (canvas walkthrough)

1. Open the game (`python -m http.server 8068` → http://localhost:8068/visual/).
2. Drag a **PC** from the palette onto the grid (on a phone, tap PC, then tap the grid).
3. Drag a **SWITCH** onto the grid.
4. Cable them: drag from the switch's pink port dot onto the PC, or turn on **CABLE**
   and drag device to device. The terminal echoes `lab.topology.connect`.
5. In the terminal, run `nodes` to confirm. With the bridge on (see 05-client.md),
   `lab_state/state.json` and `lab.topology.get` show the same topology.
6. Double-click the switch, then **+ Monitoring**, to attach a simulated integration.
7. `verify alert SW-01`: a test trap shows up in **SYSTEMS › MONITORING**.

Tips appear at each step. You construct the pieces; the guides supply the sequence and the judgment.
