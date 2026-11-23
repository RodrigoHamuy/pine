// The world behind the rider: sky and road.
Game.world = function (ctx, t, s) {
  const W = Game.W, H = Game.H, G = Game.GROUND;
  ctx.fillStyle = "#8fcdf0"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#74c488"; ctx.fillRect(0, G - 40, W, 40);
  ctx.fillStyle = "#59636f"; ctx.fillRect(0, G - 6, W, H - G + 6);
};
