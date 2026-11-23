// The bicycle. x is the middle between the wheels, y the road under them, s how far it has rolled.
// Returns where the two pedals are, so that the rider's feet can be on them.
Game.bicycle = function (ctx, x, y, s) {
  const R = 27, rear = [x - 42, y - R], front = [x + 44, y - R], crank = [x - 4, y - 25], seat = [x - 20, y - 70], head = [x + 28, y - 72];
  const line = (a, b, w, c) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // The wheels turn as far as the road went by under them.
  for (const [cx, cy] of [rear, front]) {
    ctx.strokeStyle = "#1f2a36"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(cx, cy, R - 2.5, 0, 7); ctx.stroke();
    ctx.strokeStyle = "#c9d2da"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, R - 6, 0, 7); ctx.stroke();
    ctx.strokeStyle = "rgba(190, 200, 210, .95)"; ctx.lineWidth = 1.2;
    for (let k = 0; k < 10; k++) { const a = s / R + k * Math.PI / 5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (R - 6) * Math.cos(a), cy + (R - 6) * Math.sin(a)); ctx.stroke(); }
    ctx.fillStyle = "#1f2a36"; ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, 7); ctx.fill();
  }
  // The frame.
  const red = "#e5533a";
  line(rear, crank, 4.5, red); line(crank, seat, 4.5, red); line(seat, head, 4.5, red); line(crank, head, 4.5, red); line(rear, seat, 3.5, red);
  line(head, front, 4.5, "#c8402b");
  line(head, [x + 24, y - 88], 3.5, "#2b3743"); line([x + 24, y - 88], [x + 36, y - 91], 4.5, "#2b3743");
  line([seat[0] - 9, seat[1] - 4], [seat[0] + 10, seat[1] - 5], 6, "#2b3743");
  // The crank turns once for two and a half turns of a wheel.
  const a = s / R / 2.5, far = [crank[0] - 11 * Math.cos(a), crank[1] - 11 * Math.sin(a)], near = [crank[0] + 11 * Math.cos(a), crank[1] + 11 * Math.sin(a)];
  line(crank, far, 3, "#8794a1"); line(crank, near, 3, "#b9c3cd");
  ctx.fillStyle = "#2b3743"; ctx.beginPath(); ctx.arc(crank[0], crank[1], 5.5, 0, 7); ctx.fill();
  for (const p of [far, near]) line([p[0] - 6, p[1]], [p[0] + 6, p[1]], 3.5, "#1f2a36");
  return { far, near, grip: [x + 34, y - 90], seat };
};
