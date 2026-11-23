// The game itself: a 640 x 360 picture for a moment t (seconds) and the jumps so far.
// Everything is a function of the time, so the same moment always looks the same.
Game.W = 640;
Game.H = 360;
Game.GROUND = 300;
Game.SPEED = 150;
Game.AIR = 0.75;
Game.RIDER = 190;

/** How far the bicycle is off the road at t. */
Game.lift = function (t, jumps) {
  for (let i = jumps.length - 1; i >= 0; i--) {
    const u = (t - jumps[i]) / Game.AIR;
    if (u >= 0 && u < 1) return 96 * 4 * u * (1 - u);
    if (u >= 1) break;
  }
  return 0;
};

/** Where fish number i hangs over the road, in the world. */
Game.fishAt = (i) => 760 + i * 540;
/** When the rider passes fish number i. */
Game.passes = (i) => (Game.fishAt(i) - Game.RIDER - 44) / Game.SPEED;
/** The jumps of somebody who catches all of them: for the title screen. */
Game.auto = (t) => { const out = []; for (let i = 0; Game.passes(i) - 0.4 < t; i++) out.push(Game.passes(i) - 0.4); return out; };

Game.frame = function (ctx, t, jumps) {
  const s = t * Game.SPEED, G = Game.GROUND;
  Game.world(ctx, t, s);
  let caught = 0;
  for (let i = Math.max(0, Math.floor((s - 400) / 540) - 1); Game.fishAt(i) - s < Game.W + 40; i++) {
    const at = Game.passes(i), got = t >= at && Game.lift(at, jumps) > 50;
    if (t < at || !got) Game.fish(ctx, Game.fishAt(i) - s, G - 190 + 5 * Math.sin(t * 3 + i), t);
    else if (t - at < 0.4) Game.sparkle(ctx, Game.RIDER + 44, G - 190, (t - at) / 0.4);
  }
  for (let i = 0; Game.passes(i) <= t; i++) if (Game.lift(Game.passes(i), jumps) > 50) caught++;
  const up = Game.lift(t, jumps);
  Game.shadow(ctx, Game.RIDER, G, up);
  const pedals = Game.bicycle(ctx, Game.RIDER, G - up, s);
  Game.pelican(ctx, Game.RIDER, G - up, t, pedals, up);
  ctx.font = "700 20px ui-rounded, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(20, 40, 60, .78)";
  ctx.fillText("FISH  " + caught, 20, 16);
  if (t < 3) { ctx.globalAlpha = Math.min(1, 3 - t); ctx.font = "600 14px system-ui, sans-serif"; ctx.fillText("space to jump", 20, 44); ctx.globalAlpha = 1; }
};

Game.shadow = function (ctx, x, G, up) {
  ctx.fillStyle = "rgba(20, 30, 40, " + (0.22 - up / 700) + ")";
  ctx.beginPath(); ctx.ellipse(x, G + 3, 58 - up / 5, 5, 0, 0, 7); ctx.fill();
};

Game.fish = function (ctx, x, y, t) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(0.12 * Math.sin(t * 5 + x));
  ctx.fillStyle = "#ff8a3d";
  ctx.beginPath(); ctx.ellipse(0, 0, 15, 8, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(-25, -8); ctx.lineTo(-25, 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(8, -2, 2.6, 0, 7); ctx.fill();
  ctx.fillStyle = "#1c2733"; ctx.beginPath(); ctx.arc(8.6, -2, 1.3, 0, 7); ctx.fill();
  ctx.restore();
};

Game.sparkle = function (ctx, x, y, u) {
  ctx.strokeStyle = "rgba(255, 170, 60, " + (1 - u) + ")"; ctx.lineWidth = 3; ctx.lineCap = "round";
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, r0 = 8 + 26 * u, r1 = 16 + 34 * u; ctx.beginPath(); ctx.moveTo(x + r0 * Math.cos(a), y + r0 * Math.sin(a)); ctx.lineTo(x + r1 * Math.cos(a), y + r1 * Math.sin(a)); ctx.stroke(); }
};
