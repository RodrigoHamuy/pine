// The world behind the rider: sky, sun, clouds, two rows of hills and the road. s is how far the rider has come.
Game.world = function (ctx, t, s) {
  const W = Game.W, H = Game.H, G = Game.GROUND;
  const sky = ctx.createLinearGradient(0, 0, 0, G);
  sky.addColorStop(0, "#58b7ee"); sky.addColorStop(1, "#d9f1fb");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  // The sun, with a soft ring.
  ctx.fillStyle = "rgba(255, 244, 200, .5)"; ctx.beginPath(); ctx.arc(520, 78, 46, 0, 7); ctx.fill();
  ctx.fillStyle = "#fff3b8"; ctx.beginPath(); ctx.arc(520, 78, 30, 0, 7); ctx.fill();
  // Clouds drift by themselves and fall behind slowly.
  const puff = (x, y, rx, ry) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.fill(); };
  const cloud = (x, y, k) => { puff(x, y, 34 * k, 13 * k); puff(x - 22 * k, y + 5 * k, 22 * k, 10 * k); puff(x + 24 * k, y + 6 * k, 24 * k, 10 * k); puff(x + 4 * k, y - 9 * k, 20 * k, 12 * k); };
  ctx.fillStyle = "rgba(255, 255, 255, .92)";
  [[60, 60, 1.1], [300, 96, 0.8], [470, 40, 0.7], [700, 82, 1.2], [900, 54, 0.9]].forEach(([x, y, k], i) => cloud(((x - s * 0.06 - t * (6 + i)) % 1040 + 1040) % 1040 - 120, y, k));
  // Hills: the far row moves a quarter as fast as the road, the near row half.
  const hills = (far, base, amp, color) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, G);
    for (let x = 0; x <= W; x += 8) { const u = (x + s * far) / 90; ctx.lineTo(x, base - amp * (0.6 * Math.sin(u) + 0.4 * Math.sin(u * 2.3 + 1.7))); }
    ctx.lineTo(W, G); ctx.closePath(); ctx.fill();
  };
  hills(0.25, 232, 34, "#a9dcb4");
  hills(0.5, 262, 22, "#74c488");
  // The verge and the road, with dashes that pass at the rider's speed.
  ctx.fillStyle = "#5fae6f"; ctx.fillRect(0, G - 14, W, 14);
  ctx.fillStyle = "#59636f"; ctx.fillRect(0, G - 6, W, H - G + 6);
  ctx.fillStyle = "#6d7783"; ctx.fillRect(0, G - 6, W, 3);
  ctx.fillStyle = "#f4f1e4";
  for (let x = -(s % 80); x < W; x += 80) ctx.fillRect(x, G + 26, 42, 5);
  // Tufts of grass on the verge.
  ctx.strokeStyle = "#3f8f55"; ctx.lineWidth = 2; ctx.lineCap = "round";
  for (let x = -(s % 130); x < W + 20; x += 130) { ctx.beginPath(); ctx.moveTo(x, G - 6); ctx.lineTo(x - 4, G - 18); ctx.moveTo(x + 3, G - 6); ctx.lineTo(x + 5, G - 20); ctx.moveTo(x + 6, G - 6); ctx.lineTo(x + 12, G - 16); ctx.stroke(); }
};
