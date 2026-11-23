// The bicycle. x is the middle between the wheels, y the road under them.
Game.bicycle = function (ctx, x, y, s) {
  const R = 27, rear = [x - 42, y - R], front = [x + 44, y - R], crank = [x - 4, y - 25], seat = [x - 20, y - 70], head = [x + 28, y - 72];
  const line = (a, b, w, c) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
  for (const [cx, cy] of [rear, front]) { ctx.strokeStyle = "#1f2a36"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(cx, cy, R - 2.5, 0, 7); ctx.stroke(); }
  line(rear, crank, 4, "#e5533a"); line(crank, seat, 4, "#e5533a"); line(seat, head, 4, "#e5533a"); line(crank, head, 4, "#e5533a"); line(head, front, 4, "#e5533a");
  line(head, [x + 26, y - 86], 3, "#2b3743");
  const far = [crank[0] - 11, crank[1]], near = [crank[0] + 11, crank[1]];
  line(far, near, 3, "#8794a1");
  return { far, near, grip: [x + 26, y - 86], seat };
};
