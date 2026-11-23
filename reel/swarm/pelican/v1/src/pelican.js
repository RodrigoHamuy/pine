// The pelican on the saddle.
Game.pelican = function (ctx, x, y, t, pedals, up) {
  const bx = x - 14, by = y - 96;
  ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.ellipse(bx, by, 27, 20, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(bx + 16, by - 8); ctx.lineTo(x + 14, y - 124); ctx.stroke();
  ctx.beginPath(); ctx.arc(x + 14, y - 126, 10, 0, 7); ctx.fill();
  ctx.fillStyle = "#fbc34a"; ctx.beginPath(); ctx.moveTo(x + 20, y - 130); ctx.lineTo(x + 46, y - 124); ctx.lineTo(x + 20, y - 121); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#1c2733"; ctx.beginPath(); ctx.arc(x + 17, y - 128, 2.2, 0, 7); ctx.fill();
  ctx.strokeStyle = "#f59a36"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(bx - 4, by + 18); ctx.lineTo(bx - 4, by + 34); ctx.moveTo(bx + 8, by + 18); ctx.lineTo(bx + 8, by + 34); ctx.stroke();
};
