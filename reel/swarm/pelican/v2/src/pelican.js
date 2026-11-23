// The pelican. It sits on the saddle, holds the handlebar with a wing and pedals: a foot on each pedal.
Game.pelican = function (ctx, x, y, t, pedals, up) {
  const bob = 1.5 * Math.sin(t * 9), seat = pedals.seat, hip = [seat[0] + 6, seat[1] - 6 + bob];
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // A leg goes from the hip over a knee to its pedal. The far leg first, darker, behind the frame's near side.
  const leg = (foot, color) => {
    const dx = foot[0] - hip[0], dy = foot[1] - hip[1], d = Math.min(Math.hypot(dx, dy), 47.9), L = 24;
    const base = Math.atan2(dy, dx), bend = Math.acos(d / (2 * L)), knee = [hip[0] + L * Math.cos(base - bend), hip[1] + L * Math.sin(base - bend)];
    ctx.strokeStyle = color; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(hip[0], hip[1]); ctx.lineTo(knee[0], knee[1]); ctx.lineTo(foot[0], foot[1] - 3); ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(foot[0] + 3, foot[1] - 3, 9, 3.5, 0, 0, 7); ctx.fill();
  };
  leg(pedals.far, "#d9822b");
  // Tail and body.
  const bx = x - 14, by = y - 96 + bob;
  ctx.fillStyle = "#e8edf2"; ctx.beginPath(); ctx.moveTo(bx - 20, by - 4); ctx.lineTo(bx - 46, by - 16); ctx.lineTo(bx - 42, by - 2); ctx.lineTo(bx - 48, by + 8); ctx.lineTo(bx - 18, by + 10); ctx.closePath(); ctx.fill();
  const body = ctx.createLinearGradient(0, by - 22, 0, by + 22); body.addColorStop(0, "#ffffff"); body.addColorStop(1, "#dfe6ec");
  ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(bx, by, 29, 21, -0.18, 0, 7); ctx.fill();
  leg(pedals.near, "#f59a36");
  // The neck: an S from the chest up to the head, which leans into the wind when the bicycle is in the air.
  const hx = x + 22 + up / 30, hy = y - 146 + bob * 1.4 - up / 24;
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 13; ctx.beginPath(); ctx.moveTo(bx + 18, by - 8); ctx.bezierCurveTo(bx + 44, by - 14, x + 2, hy + 18, hx - 2, hy + 4); ctx.stroke();
  // The beak with the pouch under it: what makes it a pelican.
  const tip = [hx + 50, hy + 14 - up / 30];
  ctx.fillStyle = "#f7a531"; ctx.beginPath(); ctx.moveTo(hx + 4, hy + 4); ctx.quadraticCurveTo(hx + 26, hy + 36 + 3 * Math.sin(t * 9), tip[0] - 2, tip[1] + 2); ctx.lineTo(hx + 6, hy - 1); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fbc34a"; ctx.beginPath(); ctx.moveTo(hx + 5, hy - 5); ctx.lineTo(tip[0], tip[1] - 1); ctx.quadraticCurveTo(tip[0] + 3, tip[1] + 5, tip[0] - 4, tip[1] + 4); ctx.lineTo(hx + 5, hy + 4); ctx.closePath(); ctx.fill();
  // Head, crest and eye.
  ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(hx, hy, 11, 0, 7); ctx.fill();
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(hx - 8, hy - 6); ctx.lineTo(hx - 17, hy - 10 - up / 20); ctx.moveTo(hx - 9, hy - 2); ctx.lineTo(hx - 19, hy - 3 - up / 20); ctx.stroke();
  ctx.fillStyle = "#ffd9a0"; ctx.beginPath(); ctx.arc(hx + 3, hy - 2, 4.6, 0, 7); ctx.fill();
  ctx.fillStyle = "#1c2733"; ctx.beginPath(); ctx.arc(hx + 3.6, hy - 2, 2.4, 0, 7); ctx.fill();
  // The wing reaches for the handlebar; in the air it lifts.
  const grip = pedals.grip;
  ctx.fillStyle = "#f4f7fa"; ctx.strokeStyle = "#c3ccd5"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(bx - 14, by - 10); ctx.quadraticCurveTo(bx + 8, by - 26 - up / 5, grip[0] - 2, grip[1] + 2 - up / 12); ctx.quadraticCurveTo(bx + 16, by + 8, bx - 16, by + 8); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#3b4654"; ctx.beginPath(); ctx.moveTo(bx - 16, by + 8); ctx.quadraticCurveTo(bx - 2, by + 6, bx + 6, by + 1); ctx.lineTo(bx - 14, by - 2); ctx.closePath(); ctx.fill();
};
